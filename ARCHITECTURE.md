# 🏗️ Arquitectura de Quanto

## Visión general

Quanto es una **Progressive Web App** (PWA) sin dependencias externas que funciona completamente en el navegador. La arquitectura es **offline-first** con localStorage como fuente de verdad.

```
┌─────────────────────────────────────────┐
│  index.html (5 pantallas con data-view) │
├─────────────────────────────────────────┤
│ assets/app.js       │ assets/tokens.css │
│ - Lógica de UI      │ - Design system   │
│ - Navegación        │ - Componentes     │
│ - Comparador OCR    │ - Animaciones     │
├─────────────────────────────────────────┤
│ data/store.js (capa de datos)           │
│ - localStorage + sincronización         │
│ - Queue de cambios pendientes           │
├─────────────────────────────────────────┤
│ assets/sw.js (service worker)           │
│ - Cache offline                         │
│ - Actualización en background           │
└─────────────────────────────────────────┘
```

## Capas

### 1. **Presentación** (`index.html` + `assets/tokens.css`)

**HTML estructural**:
- 5 pantallas: `home`, `comparar`, `escanear`, `listas`, `historial`
- Vista activa controlada por `main[data-view]`
- Componentes reutilizables: botones, tarjetas, bottom sheets
- Iconos SVG incrustados (no requests externos)

**Design System** (`tokens.css`):
- Variables CSS: colores, tipografía, espaciado, sombras, radios
- Soporte light/dark mode con `prefers-color-scheme`
- Componentes: `.card`, `.btn`, `.input`, `.badge`, `.list-row`
- Animaciones: entrada de pantallas, transiciones suaves
- Mobile-first: 420px ancho base, navbar fijo inferior

### 2. **Lógica de UI** (`assets/app.js` - 1500 líneas)

**Navegación**:
```javascript
goto(view) → renderView(view)
// Sincroniza main[data-view], nav-bar y renderiza contenido
```

**Pantallas**:

| Pantalla | Función | Interacciones |
|----------|---------|---|
| `home` | `renderHome()` | Lista activa, resumen, último historial |
| `comparar` | `renderResultadosComparacion()` | Inputs dinámicos, cálculo en vivo, barras |
| `escanear` | `iniciarEscaneo()` | Cámara, OCR, auto-captura, edición |
| `listas` | `renderListas()` | CRUD de items, cierre de compra |
| `historial` | `renderHistorial()` | Gráfico de tendencia, detalles |

**Bottom sheets**: modal para editar items, crear listas, etc.
- Foco atrapado (Tab/Escape), accesibilidad

**Comparador**:
```javascript
normalizar(row) → { normalizado, etiqueta, baseLabel }
// Normaliza a precio por 100g/ml o por unidad
```

**Escáner OCR**:
```javascript
parseEtiqueta(texto) → { precio, contenido, unidad, unidades, nombre }
// Parse inteligente de etiquetas (precio, pack, unidades)

agregarCaptura(datos, canvas) → captura
// Guarda captura con miniatura JPG
```

### 3. **Datos** (`data/store.js` - 520 líneas)

**localStorage keys**:
```javascript
"quanto:listas"        // [{ id, nombre, estado, creada_en }]
"quanto:items:{listaId}"  // [{ id, nombre, cantidad, ... }]
"quanto:lista_activa_id"  // UUID
"quanto:comparaciones" // Historial de análisis
"quanto:sync_queue"    // Cambios pendientes (para futuro backend)
```

**API principal**:
```javascript
// Listas
getListas(), getListaActivaId(), setListaActiva(id)
crearLista(nombre), renombrarLista(id, nombre), duplicarLista(id)
cerrarLista(id, total, baseVerificado)

// Items
getLista(id?), guardarProducto(datos), eliminarItem(id)
marcarEnCarrito(id, bool), aplazarItem(id), reactivarItem(id)
verificarEnTienda(id, precio), facturarItem(id, precio)

// Comparaciones
guardarComparacion(datos), calcularTotales(id)

// Sync
getSyncQueue(), sincronizarPendientes()
```

**Transacciones**:
```javascript
function guardarProducto(datos) {
  const item = { id: crypto.randomUUID(), ...datos };
  push to lista
  queue for sync
  return item
}
```

Sin transacciones reales, pero el queue permite futuros syncs a backend.

### 4. **Service Worker** (`assets/sw.js`)

**Estrategia**: offline-first cache
```javascript
// 1. Check cache
// 2. If miss, fetch + add to cache
// 3. If offline, return cached or fallback index.html (SPA)
```

**Assets en cache**:
- Archivos estáticos: HTML, CSS, JS, manifest, datos del usuario (store.js no se cachea, viene de localStorage)
- OCR (Tesseract) se carga bajo demanda desde CDN, no se cachea (muy pesado)

**Actualización**:
```javascript
// Service worker auto-actualiza en background
// Nueva visita = nuevo cache si hay cambios en app.js/tokens.css
```

### 5. **PWA** (`manifest.json` + meta tags)

**Instalabilidad**:
- Icono SVG 192x192 + 512x512
- Nombre, descripción, tema verde
- Atajos: "Comparar precios"
- Modo standalone (sin barra de direcciones)

**iOS**:
- `apple-mobile-web-app-capable`: instala como app
- `apple-mobile-web-app-status-bar-style`: barra translúcida
- `apple-touch-icon`: icono para pantalla principal

## Patrones

### Estado UI
```javascript
const state = {
  view: "home",
  compareRows: [ /* input form state */ ],
  scanSession: { capturas: [], auto: false }
};
```
Guardado en memoria durante la sesión; no sobrevive a reload (por diseño).

### Rendering
```javascript
// Cada pantalla es renderizada completa
renderListas() → $("#listasContainer").innerHTML = ...
```
No es virtual DOM, es string templates y re-attach de listeners.
**Cuando migrar**: si los listeners se pierden o duplican en pantallas complejas.

### Validación
```javascript
// En boundaries (usuario input):
Number(input.value) // convierte y valida tipo
filaValida(row) → precio > 0 && cantidad > 0

// No validar internamente (confiar en store.js)
```

### Errores
```javascript
// Graceful degradation:
loadTesseract().catch(() => {
  renderProblemaCamara("ocr_load")
  // Usuario puede continuar manualmente
})
```

## Flows principales

### Agregar item (manual)

```
home/listas → click "Agregar item"
  → openAddItemSheet(prefill?)
    → usuario ingresa nombre, precio, cantidad, contenido
    → click "Guardar"
      → guardarProducto(datos)
        → agrega a lista en localStorage
        → queue para sync
      → flyToNav() (animación hacia "Listas" tab)
      → renderListas() (actualiza UI)
```

### Comparar con cámara

```
home → "Comparar con cámara"
  → iniciarEscaneo()
    → pide acceso a cámara
    → renderiza preview + botón "Capturar"
    → usuario captura etiqueta
      → capturarEtiqueta()
        → leerEtiqueta(canvas) via OCR
        → parseEtiqueta(texto)
        → agregarCaptura(datos)
        → renderScanTray() (muestra capturas + veredicto)
    → usuario puede editar, agregar al carrito, o repetir
```

### Cerrar compra

```
listas → "Cerrar compra"
  → openCerrarCompraSheet()
    → modo "total" o "item por item"
    → usuario ingresa totales
    → para cada item: facturarItem(id, precio)
    → cerrarLista(id, total_final)
      → crea entrada en historial
      → calcula diferencia vs verificado
    → ir a historial
```

## Decisiones técnicas

### ✅ Por qué sin frameworks

- App pequeña (5 pantallas, <2KB minificado sin comentarios)
- PWA standalone ≠ SPA en routing (no hay history.pushState)
- Service worker + localStorage cubren estado
- OCR es el único "peso", se carga bajo demanda

### ✅ Por qué localStorage

- Datos offline-first
- Sincronización manual a backend (futuro)
- No requiere IndexedDB (datos pequeños: <1MB)
- TTL: datos no expirar automáticamente (usuario elige)

### ✅ Por qué string templates en lugar de Virtual DOM

- Renderizado simple: cada pantalla se renderiza completa
- No hay interactividad dinámica dentro de listas (no edición inline)
- Cuando sea necesario: migrar a Preact (muy pequeño, compatible)

### ⚠️ Limitaciones actuales

- **OCR offline**: requiere conexión la 1ª vez (Tesseract se carga desde CDN)
- **Sin backend**: si el usuario borra localStorage, todo se pierde
- **Sync manual**: no hay sync automático (queue solo prepara datos)
- **Sin transacciones**: si se interrumpe guardarProducto, estado puede quedar inconsistente (raro)

### 🔮 Mejoras futuras

1. **Backend sync**: HTTP POST `/api/sync` con queue
2. **Backup a iCloud/Google Drive**: nativo desde PWA
3. **Compartir listas**: genera link con lista serializada
4. **Notificaciones push**: cuando hay ofertas en ítems guardados
5. **Predicción de precios**: histórico → "espera a la próxima oferta"

## Testing

```bash
# Manual (no hay tests automatizados aún)
1. python3 -m http.server 8000
2. Abre http://localhost:8000/
3. Prueba cada pantalla en mobile (Chrome DevTools)
4. Desactiva conexión (DevTools → Offline)
5. Verifica que todo sigue funcionando
```

## Deploy

**GitHub Pages** (automático):
```bash
git push origin main
# GitHub Actions (futuro) pueden dispararse
# O manual: Settings → Pages → Deploy from main
```

**Variable de path**: `/quanto/` en GitHub, `/` si es www personal
- Manejado en: manifest.json start_url, sw.js SCOPE

## Observabilidad

**Actualmente**: ninguna (future: analytics sin tracking)
- LocalStorage puede mostrar contadores de listas/items
- Service worker: `console.log` en desarrollo

**Métricas interesantes** (si agregamos):
- Uso de comparador vs cámara
- Exactitud OCR (usuario corrigió X campo)
- Promedio de items por lista
- Trending: qué categorías compran más
