# Arquitectura

Quanto es una app web sin build ni servidor, más una app de iPhone en SwiftUI. Los datos viven en el dispositivo. La web corre en el navegador o instalada como PWA. La app de iPhone tiene interfaz nativa pero ejecuta la misma lógica de la web (parser, datos y motor de ahorro) con JavaScriptCore, y suma Vision, Apple Intelligence, Recordatorios y Siri.

`CLAUDE.md` tiene la referencia técnica completa. Este documento es el resumen.

## Piezas

```
web/                         ios/Quanto/ (SwiftUI)                  worker/
 index.html, assets/app.js    Vistas/ (Inicio, Comparar, Listas,     src/index.js
 assets/ocr.js   ──┐            Ahorro, Ajustes, Escáner)            (Claude lee la foto)
 data/store.js   ──┼─ scripts/logica-ios.mjs ─► Recursos/logica.js       ▲
 data/ahorro.js  ──┘                              │ JavaScriptCore       │
 data/api.js ──────────────────────────┐          ▼                      │
                                       │        Nucleo/MotorJS + Datos   │
                                       │        Camara/ (Vision, marco)  │
                                       │        Servicios/ (Apple        │
                                       │          Intelligence, EventKit)│
                                       └─────────────────────────────────┘
```

## Capas de la web

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Presentación | `web/index.html`, `web/assets/tokens.css` | 5 pantallas (inicio, comparar, cámara, listas, ahorro), hoja inferior, barra de navegación |
| Interfaz | `web/assets/app.js` | Render de cada pantalla, eventos por delegación, asistente de alta, cámara |
| Lector | `web/assets/ocr.js` | Preprocesado de imagen y parser de etiquetas |
| Barrido | `web/assets/vivo.js` | Agrupa el texto de un fotograma en etiquetas y las sigue entre fotogramas |
| Marco | `web/assets/marco.js` | Encuentra el rectángulo de la etiqueta en la imagen, como el escáner de documentos |
| Datos | `web/data/store.js` | Listas, items, precios en tres estados, memoria de precios, presupuesto, ajustes, copia de seguridad |
| Ahorro | `web/data/ahorro.js` | Estadísticas por producto, semáforo, recompra, tiendas, consejos |
| Puente nativo | `web/data/nativo.js` | Única puerta al dispositivo; en web devuelve `null` y la app usa sus alternativas |
| APIs | `web/data/api.js` | Catálogo local, Open Food Facts, lector con Claude |
| Offline | `web/assets/sw.js` | Service Worker con red primero y caché de respaldo |

## Datos

- **Precio en tres estados**: estimado, verificado en tienda (góndola) y facturado (recibo). Solo el facturado es definitivo.
- **Memoria de precios**: cada precio verificado, facturado, escaneado o comparado se guarda con producto, tienda y fecha. De ahí salen el semáforo, el mínimo, la tendencia y la comparativa de tiendas.
- **Cola de sincronización**: cada cambio se encola para un backend futuro (`docs/api-contract.md`). Hoy no hay servidor.

## Lectura de etiquetas

En orden de preferencia:

Antes de leer, se busca el **marco de la etiqueta** (como el escáner de documentos) y se lee solo lo de adentro, para no mezclar el precio con otros carteles del estante.

1. **App de iPhone** (SwiftUI): Vision detecta el rectángulo, lo endereza y lee el texto y el código de barras en cada fotograma; el texto pasa por el mismo parser de `ocr.js` (en JavaScriptCore) y Apple Intelligence afina nombre, contenido y pack si el teléfono lo soporta. Ver `ios/README.md`.
2. **Lector con Claude**: si se configuró el Worker y hay conexión.
3. **Tesseract** en el navegador, con el parser de `ocr.js`.
