# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Quanto** is a progressive web app (PWA) for comparing product prices per 100g/ml and managing shopping lists with price memory. The entire app runs locally in the browser—no backend required until API integration is needed.

- **Live**: https://franciscombp.github.io/quanto/
- **Architecture**: HTML + vanilla JavaScript + localStorage (no build, no dependencies)
- **Design system**: Red color scheme (#c41e1e) inspired by Supermaxi/Comisariato supermarkets
- **Offline**: Service Worker with network-first caching strategy

## Development

### Run locally

```bash
# Python
python3 -m http.server 8000

# Or Node.js
npx http-server
```

Then open `http://localhost:8000/`

### Key development workflows

- **Clear Service Worker cache**: Change `CACHE_VERSION` in `assets/sw.js` to force a fresh cache
- **Validate JavaScript syntax**: `node -c assets/app.js`
- **Check for smart quotes**: `grep -P '[""''«»‹›„‚]' assets/app.js` (causes syntax errors)
- **Commit and deploy**: `git push origin main` → GitHub Pages updates automatically

### Disabling browser autocomplete

When adding input fields, always include `autocomplete="off"` to prevent credit card autocomplete or other unwanted suggestions. Example:
```html
<input type="text" autocomplete="off" />
```

## Architecture

### File Structure

```
/
├── index.html              # App shell (5 screens, modals, navbar)
├── manifest.json           # PWA metadata
├── assets/
│   ├── app.js             # UI logic, event delegation, render functions (1800+ lines)
│   ├── utils.js           # Shared utilities (DOM, format, UI helpers)
│   ├── tokens.css         # Design system (colors, typography, layout)
│   └── sw.js              # Service Worker (network-first caching)
├── data/
│   ├── store.js           # Data layer: localStorage + sync queue
│   └── api.js             # Future API client (stubs for barcode/search)
└── docs/                  # Documentation
```

### Layers

**1. Presentation** (`index.html` + `assets/tokens.css`)
- 5 screens: home, comparar, escanear, listas, historial
- Navigation via `data-view` attribute and `data-goto` buttons
- Bottom sheet modal for actions
- Navbar with 4 items (fixed at bottom)
- Color tokens: `--brand` (#c41e1e), `--brand-deep` (#8b1515), `--on-brand` (#fff)

**2. Logic** (`assets/app.js`)
- Render functions for each screen
- Event delegation through main `document.addEventListener("click")`
- Wizard for adding items (multi-step form)
- OCR parsing with Tesseract.js (loaded from CDN on demand)
- State management via `state` object (not persisted; render functions fetch from store)

**3. Utilities** (`assets/utils.js`)
- DOM: `$()`, `$$()`
- Format: `fmt()` (price), `esc()` (HTML escape), `parseNumero()`
- UI: `toast()`, `icon()`, `debounce()`, `throttle()`

**4. Data** (`data/store.js`)
- Single source of truth: localStorage
- Three price states: `estimado`, `verificado_en_tienda`, `facturado`
- Multiple shopping lists with items
- Sync queue for future backend integration
- Core exports:
  - Lists: `getListas()`, `crearLista()`, `getListaActivaId()`
  - Items: `guardarProducto()`, `getLista()`, `eliminarItem()`
  - Totals: `calcularTotales()`
  - History: `getHistorialListasCerradas()`

**5. APIs** (`data/api.js`)
- Prepared stubs for future services:
  - `searchByBarcode(code)`
  - `searchProduct(nombre)`
  - `compareOnline(productos)`
  - `syncData(items)`
- Currently unused but ready for phase 2 (backend integration)

**6. Offline** (`assets/sw.js`)
- Service Worker with network-first strategy
- Cache version: bumped each time to invalidate old caches
- Cleans up old cache versions on activation
- Falls back to cached `index.html` for missing documents

## Key Flows

### Comparador Manual (Manual Price Comparison)

1. User enters product data: name, price, quantity, unit
2. App displays: total content (quantity × units), normalized price (per 100g/ml)
3. Results show ranking of cheapest product
4. Can add multiple products in sequence

Event delegation handles:
- `[data-goto]` → navigation
- `#addCompareRow` → add new product
- `#fillExample` → demo data
- `[data-quick]`, `[data-unit]` → quick input changes

### Comparador OCR (Camera Comparison)

1. User captures product label
2. Tesseract.js extracts text (price, content, units)
3. Parsing logic extracts:
   - Price (supports "$3", "3.50", "3,50")
   - Content (grams, ml, units)
   - Number of items in pack
   - Product name (Spanish words only, filters noise)
4. Results show ranking

### Listas (Shopping Lists)

1. Create new list (with optional store name)
2. Add items manually or from comparador
3. Each item has state: `estimado` → `verificado_en_tienda` → `en_carrito` → `facturado`
4. Close list when done shopping (records actual total paid)
5. Items move to historial

### Historial (Purchase History)

- Shows closed lists with total paid vs estimated
- No editing (immutable records)

## Important Implementation Details

### Event Delegation

All click handlers use event delegation through `document.addEventListener("click")` to handle dynamically created elements. This prevents listeners from being attached before elements exist.

Example:
```javascript
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-goto]");
  if (nav) {
    goto(nav.dataset.goto);
    return;
  }
  // ... more handlers
});
```

### Render Functions

Each screen has a render function that regenerates HTML from state/store data:
- `renderHome()`
- `renderCompareRows()` + `renderResultadosComparacion()`
- `renderEscaner()` + `renderScanTray()`
- `renderListas()`
- `renderHistorial()`

These functions:
1. Query data from `data/store.js`
2. Generate HTML
3. Inject into DOM
4. Attach event listeners (in render function, after elements exist)

### Sheet Modal

Bottom sheet (modal) for detailed actions. Usage:
```javascript
function openSomeSheet() {
  const content = `<div>...</div>`;
  openSheet(content);
  // Now add event listeners to #someBtn within the sheet
}
```

### State Object

Temporary UI state (not persisted):
```javascript
const state = {
  view: "home",
  scanReturnTo: "home",
  compareRows: [],
  compareStep: 0,
  // ...
};
```

Rendering functions always fetch fresh data from `data/store.js` rather than relying on state.

### Service Worker Cache Invalidation

When making changes to assets, bump `CACHE_VERSION` in `assets/sw.js`:
```javascript
const CACHE_VERSION = "v7-syntax-fixed";  // Change this
```

The Service Worker will:
1. Detect the new version on next visit
2. Delete old cache versions
3. Fetch fresh assets

Users may need to refresh twice or visit in incognito mode to see changes immediately.

## Extending the App

### Add a new screen

1. Add `<section class="screen" id="view-xyz">` to `index.html`
2. Create `renderXyz()` function in `assets/app.js`
3. Add route to `renderView(view)` switch
4. Add navigation button with `data-goto="xyz"`

### Connect to APIs (Phase 2)

Implement the stubs in `data/api.js`:
```javascript
export const services = {
  async searchByBarcode(code) {
    // Call barcode API
  },
  async searchProduct(nombre) {
    // Call product search API
  },
  // ...
};
```

Then update store.js to use these services in sync queue processing.

### Add new data model

1. Add localStorage keys in `data/store.js`
2. Create getter/setter functions
3. Add to sync queue if backend sync needed
4. Update render functions to display new data

## CSS Architecture (tokens.css)

Design tokens as CSS variables:
- **Colors**: `--brand`, `--brand-deep`, `--on-brand`, `--ink-1` through `--ink-3`, `--bg-*`
- **Typography**: `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--display`
- **Spacing**: `--spacing-xs` through `--spacing-xl`
- **Shadows**: `--shadow-sm`, `--shadow`, `--shadow-lg`

Light/dark mode:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --brand: #ff6b6b;  /* Lighter red for dark mode */
    /* ... */
  }
}
```

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| SyntaxError: Invalid character | Smart quotes (", ") in code. Replace with `"` |
| Clicks don't work on new buttons | Check that button is in HTML and event delegation is set up |
| Old cached code still showing | Bump `CACHE_VERSION` in `sw.js` |
| Inputs autocompleting credit cards | Add `autocomplete="off"` to input elements |
| UI state lost on page reload | That's correct—state is temporary. Data persists in localStorage via `data/store.js` |

## Testing the UI (without external tools)

1. Open DevTools (F12)
2. Click buttons and verify:
   - Navigation works (screen changes)
   - Data persists (reload page, data still there)
   - Offline works (disable network in DevTools, reload, features still work)
   - Modals open/close correctly
3. Test OCR: paste a sample receipt label, check if Tesseract extracts text correctly
4. Test mobile: use DevTools device emulation (iPhone/Android)

## Code style notes

- No comments needed for obvious code
- Variable names are descriptive (`nombreListaActiva`, `estado_compra`)
- Spanish function/variable names throughout (keep consistent)
- Imports at top of `app.js` from `data/store.js`
- Prefer arrow functions for callbacks
- Use `?.` optional chaining for safe DOM queries
- Use `closest()` for event delegation, not repeated `parent` traversal

## Current state

- ✅ All 5 screens functional
- ✅ Offline-first with Service Worker
- ✅ PWA installable
- ✅ OCR with Tesseract.js
- ✅ Price comparison logic
- ✅ Shopping list management
- ⏳ API integration (prepared, not implemented)
- ⏳ Multi-user sync (design ready, not implemented)
