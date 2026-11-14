# Arquitectura

Quanto es una app web sin build ni servidor. Los datos viven en el dispositivo (`localStorage`). La misma web corre en el navegador, instalada como PWA y dentro de la app de iPhone, donde además usa Vision y Apple Intelligence a través de un plugin nativo.

`CLAUDE.md` tiene la referencia técnica completa. Este documento es el resumen.

## Piezas

```
web/                        native/ios/App/App/              worker/
 index.html                  QuantoNativoPlugin.swift ◄──┐    src/index.js
 assets/app.js  ──────────►  LectorEtiqueta.swift        │    (Claude lee la foto)
 assets/ocr.js               AppleIA.swift               │        ▲
 assets/vivo.js              Recordatorios.swift         │        │
 data/store.js               BarridoView / Modelo        │        │
 data/ahorro.js              EtiquetasVivo.swift         │        │
 data/nativo.js ─────────────────────────────────────────┘        │
 data/api.js ─────────────────────────────────────────────────────┘
```

## Capas de la web

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Presentación | `web/index.html`, `web/assets/tokens.css` | 5 pantallas (inicio, comparar, cámara, listas, ahorro), hoja inferior, barra de navegación |
| Interfaz | `web/assets/app.js` | Render de cada pantalla, eventos por delegación, asistente de alta, cámara |
| Lector | `web/assets/ocr.js` | Preprocesado de imagen y parser de etiquetas |
| Barrido | `web/assets/vivo.js` | Agrupa el texto de un fotograma en etiquetas y las sigue entre fotogramas |
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

1. **App de iPhone**: Vision lee el texto y el código de barras; Apple Intelligence lo interpreta si el teléfono lo soporta. El modo *Barrido* usa una cámara SwiftUI que analiza cada fotograma.
2. **Lector con Claude**: si se configuró el Worker y hay conexión.
3. **Tesseract** en el navegador, con el parser de `ocr.js`.
