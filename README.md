# Quanto — Precio justo, sin trucos

Compara el precio real de productos por 100 g/ml y lleva tus listas de compra con memoria de precios.

## Características

- **Comparador manual**: Ingresa precio, contenido y cantidad de envases; calcula automáticamente el costo por 100 g/ml.
- **Escáner con OCR**: Captura etiquetas de productos y extrae precio + contenido (entiende packs, ofertas, precios unitarios ya impresos).
- **Listas de compra**: Guarda items con estado de compra, verifica precios en tienda vs estimado.
- **Historial**: Cierra compras, ve cuánto pagaste de verdad vs lo que esperabas.
- **Offline**: PWA con cache; funciona sin conexión una vez instalada.

## 🚀 En Producción

**Live**: https://franciscombp.github.io/quanto/

Actualiza automáticamente en GitHub Pages cada vez que hagas `git push origin main`.

Ver [`DEPLOY.md`](./DEPLOY.md) para configuración completa y flujo de desarrollo.

## Instalación como PWA

1. Abre la app en un navegador (ej: Chrome Mobile)
2. Toca el menú (⋮) → "Instalar" o "Agregar a pantalla principal"
3. La app se instala como app nativa con icono y acceso offline

## Desarrollo local

```bash
# Servidor estático (Python)
python3 -m http.server 8000

# O Node.js (con http-server si lo tienes)
npx http-server
```

Luego abre `http://localhost:8000/`.

## Estructura

- `index.html` — marcado principal con 5 pantallas
- `assets/app.js` — lógica de UI, comparador, escáner OCR
- `assets/tokens.css` — design system (colores, tipografía, componentes)
- `data/store.js` — capa de datos (localStorage + sync queue)
- `assets/sw.js` — service worker para cache y offline
- `manifest.json` — metadatos PWA

## Sin dependencias

HTML + JavaScript puro. El OCR (Tesseract) se carga bajo demanda desde CDN. Sin build, sin node_modules.

## Licencia

Mírale el corazón.
