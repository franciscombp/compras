# Arquitectura Limpia — Quanto v2

## 🏗️ Estructura

```
/
├── index.html           # App shell (PWA)
├── manifest.json        # Metadatos PWA
├── assets/
│   ├── app.js          # Lógica de UI
│   ├── utils.js        # Funciones compartidas
│   ├── tokens.css      # Design system
│   └── sw.js           # Service Worker
├── data/
│   ├── store.js        # localStorage + lógica
│   └── api.js          # APIs externas (futuro)
└── docs/ (README, DEPLOY, etc)
```

## 📦 Capas

### 1. **Presentación** (index.html + tokens.css)
- 5 pantallas: home, comparar, escanear, listas, historial
- Navegación con data-view
- Componentes: botones, tarjetas, inputs
- Design system rojo Supermaxi (#c41e1e)

### 2. **Lógica** (assets/app.js)
- Renderización de vistas
- Manejo de eventos
- Integración con data/store.js
- Manejo del wizard

### 3. **Utilidades** (assets/utils.js)
- DOM: $, $$
- Format: fmt, esc, parseNumero
- UI: toast, icon
- Helpers: debounce, throttle

### 4. **Datos** (data/store.js)
- localStorage como fuente única
- Funciones de lógica de negocio
- Gestión de listas y items

### 5. **APIs** (data/api.js)
- **Futuro**: búsqueda de productos
- **Futuro**: escaneo de códigos
- **Futuro**: sincronización

### 6. **Offline** (assets/sw.js)
- Service Worker
- Network-first strategy
- Caché fallback

## 🎨 Colores

- `--brand`: #c41e1e (rojo Supermaxi)
- `--brand-deep`: #8b1515
- `--on-brand`: #ffffff

## 🚀 Flujos

1. **Comparador manual** → llenar datos → ver resultado
2. **Comparador OCR** → capturar → parsear → ver ranking
3. **Listas** → crear → agregar items → cerrar → historial

## 🔌 Preparado para APIs

```javascript
// data/api.js
services.searchByBarcode(code)
services.searchProduct(nombre)
services.compareOnline(productos)
services.syncData(items)
```

## 📱 PWA

- Instalable
- Offline-first
- Sincronización
- Push notifications (futuro)

---
Estado: v2 Limpia y escalable
