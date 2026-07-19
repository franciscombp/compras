# Contrato de API futura — Justo

## Fase actual (1): localStorage + cola de sincronización
Toda la app funciona hoy sin backend. Los datos viven en `localStorage` y las escrituras se registran en una `syncQueue` para poder sincronizar después sin cambiar la UI.

## Fase 2: API REST propia

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/productos?nombre=&categoria=` | Catálogo maestro de productos normalizados |
| GET | `/api/precios?producto_id=&comercio_id=&ciudad=` | Precios observados por comercio/ciudad/fecha, para comparar el mismo producto entre tiendas |
| GET | `/api/comercios` | Catálogo de comercios/cadenas/mercados |
| GET | `/api/mercado?producto_id=&mercado_id=&fecha=` | Referencias de precio de frescos/cárnicos por mercado público |
| POST | `/api/listas` | Crear/sincronizar lista de compra del usuario |
| PATCH | `/api/listas/:id` | Actualizar lista existente (metadatos, cierre, o items — ver protocolo abajo) |
| POST | `/api/comparaciones` | Guardar resultado de una comparación para analítica futura |

### Protocolo de sincronización (implementado en `data/store.js`)

`sincronizarPendientes()` recorre la `syncQueue` y traduce cada operación local a un request:

| `tipo_operacion` local | Request |
|---|---|
| `crear_lista` | `POST /api/listas` con la lista completa |
| `renombrar_lista`, `cerrar_lista`, `set_lista_activa` | `PATCH /api/listas/:id` con `{ tipo_operacion, ...payload }` |
| `crear_item`, `actualizar_item`, `eliminar_item` | `PATCH /api/listas/:listaId` con `{ tipo_operacion, item }` |
| `crear_comparacion` | `POST /api/comparaciones` con el registro |

Semántica de errores y reintentos:

- Cada operación tiene timeout de 6 s (`AbortController`).
- Si falla, la operación queda `pendiente` y se incrementa `reintentos`; se programa
  un reintento con backoff (2 s → 8 s → 30 s).
- Tras 3 fallos pasa a estado `error` y deja de reintentar automáticamente.
- Al recibir el evento `online`, los estados `error` vuelven a `pendiente` y se
  reintenta desde cero.
- **localStorage es siempre la fuente de verdad local**: un fallo de red nunca
  pierde ni bloquea datos; la app sigue 100% funcional offline.

## Fase 3: multiusuario
Reconciliación por timestamp o CRDT si se necesita soporte multi-dispositivo/multiusuario real.

## Entidades

```
Producto { id, nombre, categoria, unidad_base }
Comercio { id, nombre, tipo: "cadena" | "tienda" | "mercado" }
PrecioObservado { id, producto_id, comercio_id, precio, fecha, fuente: "manual"|"ocr"|"voz"|"api" }
Lista {
  id, nombre, creada_en,
  estado: "activa" | "cerrada",
  comercio_principal,
  total_facturado_final,      // total real del recibo al cerrar
  diferencia_vs_verificado    // total_facturado_final - suma de precios verificados
}
ItemLista {
  id, lista_id, nombre, comercio, cantidad,
  contenido, unidad_medida,   // gramaje/volumen por envase (ej. 170 g), opcional
  estado_precio: "estimado" | "verificado_en_tienda" | "facturado",
  estado_compra: "activo" | "en_carrito" | "aplazado",
  precio_estimado, precio_verificado, precio_facturado,
  motivo_aplazado, fuente: "manual" | "ocr" | "voz", creado_en
}
```

## Nota conceptual: por qué "verificado_en_tienda" no es un precio definitivo

El modelo de precio tiene **3 estados, no 2**, y el orden solo avanza
(`estimado → verificado_en_tienda → facturado`):

- **estimado**: referencia sin verificar, sin haber visitado la tienda.
- **verificado_en_tienda**: el precio visto en la góndola o etiqueta (por OCR,
  manual o voz). **Nunca debe presentarse como definitivo**: promociones que
  se aplican solo en caja, errores de etiquetado y sustituciones de producto
  pueden cambiar el precio final.
- **facturado**: el precio real tomado del recibo al cerrar la compra. Es el
  único estado considerado verdaderamente definitivo.

Cualquier cliente o backend que consuma esta API debe respetar esa distinción:
`precio_verificado` es una observación, `precio_facturado` es un hecho.
