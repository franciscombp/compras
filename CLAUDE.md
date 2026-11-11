# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Quanto** is a progressive web app (PWA) that works as a personal savings guide for grocery shopping: it compares product prices per 100g/ml, keeps shopping lists with a budget, remembers every price you see or pay (per product and store) and turns that memory into price traffic lights, store comparisons, restock suggestions and concrete savings tips. The entire app runs locally in the browser—no backend required until API integration is needed.

- **Live**: https://franciscombp.github.io/compras/
- **Architecture**: HTML + vanilla JavaScript + localStorage (no build, no dependencies)
- **Design system**: Red color scheme (#c41e1e) inspired by Supermaxi/Comisariato supermarkets
- **Offline**: Service Worker with network-first caching strategy

## Development

### Run locally (web)

```bash
# Python
python3 -m http.server 8000

# Or Node.js
npx http-server
```

Then open `http://localhost:8000/`

### Build the iOS app (Mac only)

```bash
cd native && npm install && npm run ios   # copies the web, syncs Capacitor, opens Xcode
```

### Key development workflows

- **Clear Service Worker cache**: Change `CACHE_VERSION` in `assets/sw.js` to force a fresh cache
- **Validate JavaScript syntax**: `node -c assets/app.js`
- **Run the logic tests**: `node lab/parser-test.mjs && node lab/vivo-test.mjs && node lab/ahorro-test.mjs`
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
│   ├── ocr.js             # Shared OCR module: image preprocessing + label parser
│   ├── vivo.js            # Live sweep logic: cluster OCR lines into price tags, track them across frames (pure, tested)
│   ├── utils.js           # Shared utilities (DOM, format, UI helpers)
│   ├── tokens.css         # Design system (colors, typography, layout)
│   └── sw.js              # Service Worker (network-first caching)
├── data/
│   ├── store.js           # Data layer: localStorage + sync queue + price memory, budgets, settings, backup
│   ├── ahorro.js          # Savings engine: product stats, price traffic light, summary, frequents, store comparison, tips (pure, tested)
│   ├── api.js             # searchProduct (local catalog) + searchByBarcode (Open Food Facts) + leerEtiqueta (Worker)
│   ├── nativo.js          # Bridge to the native plugin (QuantoNativo); returns null/false on the web
│   └── catalogo.json      # Product catalog: seed + weekly GitHub Action updates
├── lab/                   # Internal tools (NOT linked from the app)
│   ├── etiquetas.html     # Label-testing page: upload photos, see OCR + parse results
│   ├── parser-test.mjs    # Parser unit tests: node lab/parser-test.mjs
│   ├── vivo-test.mjs      # Live sweep tests: node lab/vivo-test.mjs
│   ├── ahorro-test.mjs    # Savings engine tests: node lab/ahorro-test.mjs [seed.json]  (seed = localStorage dump for browser tests)
│   └── fetch-catalogo.mjs # Catalog fetcher (runs in weekly GitHub Action)
├── worker/                # Optional Cloudflare Worker: label reader with Claude (see worker/README.md)
│   ├── src/index.js       # POST {imagen, tipo} -> {precio, contenido, unidad, unidades, nombre, confianza}
│   └── wrangler.toml      # ORIGENES_PERMITIDOS, MODELO; secrets: ANTHROPIC_API_KEY, LECTOR_TOKEN
├── native/                # Optional iOS wrapper: Capacitor + Vision + Apple Intelligence (see native/README.md)
│   ├── scripts/build-web.mjs       # copies the PWA to native/dist (no Service Worker)
│   └── ios/App/App/*.swift         # QuantoNativoPlugin (bridge), LectorEtiqueta (Vision OCR + barcode), AppleIA (Foundation Models), Recordatorios (EventKit)
├── .github/workflows/
│   └── actualizar-catalogo.yml  # Weekly cron (Mon 09:00 UTC) + manual dispatch
└── docs/                  # Documentation
```

### Layers

**1. Presentation** (`index.html` + `assets/tokens.css`)
- 5 screens: home, comparar, escanear, listas, ahorro (tabs Resumen / Precios / Compras)
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
  - Lists: `getListas()`, `crearLista()`, `getListaActivaId()`, `actualizarLista()`, `setPresupuesto()` (lists carry `comercio_principal` and `presupuesto`)
  - Items: `guardarProducto()`, `getLista()`, `eliminarItem()`
  - Totals: `calcularTotales()`
  - History: `getHistorialListasCerradas()`
  - Price memory: `registrarPrecio()`, `getPrecios()`, `claveProducto()`, `precioNormalizado()`. Observations are recorded automatically by `verificarEnTienda`, `facturarItem`, `guardarProducto` (when created already verified/invoiced) and `guardarComparacion`; duplicates (same key, store, price within 6 h) collapse. Store = item.comercio → list.comercio_principal → ajustes.tienda_habitual
  - Settings: `getAjustes()` / `setAjustes()` (`tienda_habitual`, `presupuesto_defecto`)
  - Backup: `exportarDatos()` / `importarDatos(json, "fusionar"|"reemplazar")`

**4b. Savings engine** (`data/ahorro.js`, pure functions over the store)
- `estadisticasProducto(nombre)`: last / minimum / habitual (median) price per 100 g/ml (or per package when no content), per store, trend, series. Product keys are fuzzy: `clavesCompatibles()` merges names sharing most words ("Leche Vita" ↔ "Leche entera Vita 1 L")
- `semaforoPrecio({nombre, precio, contenido, unidad})` → `bueno` / `normal` / `caro` / `sin_datos` with an explanatory text (≤ min → bueno; ≤ −5 % vs habitual → bueno; ≥ +8 % → caro)
- `resumenAhorro()`, `productosFrecuentes()` (interval between purchases, `toca` when due), `sugerenciasRecompra(listaId)`, `comparativaTiendas()`, `consejos({listaId})` (rule engine: caro, tienda, recompra, subida, caja, gasto, mes, inicio), `resumenParaCoach()` (plain text for Apple Intelligence)

**5. APIs** (`data/api.js`)
- `searchProduct(nombre)`: local catalog search
- `searchByBarcode(code)`: Open Food Facts, falls back to the local catalog
- `leerEtiqueta(canvas)`: sends the label photo to the Worker in `worker/` and returns the same shape as `parseEtiqueta`. Config (URL + optional token) lives in localStorage via `getLectorConfig()` / `setLectorConfig()`; `lectorDisponible()` is true when a URL is set and the device is online
- Stubs for phase 2: `compareOnline(productos)`, `syncData(items)`

**5b. Native bridge** (`data/nativo.js`)
- Single entry point to the device. `esNativo()`, `capacidades()` (cached: vision, codigoBarras, barrido, recordatorios, compartir, appleIntelligence, plataforma), `leerEtiquetaNativa(canvas, {rapido, nivelRapido, ladoMax})`, `interpretarEtiqueta(texto)`, `interpretarProducto(frase)`, `explicarComparacion(resumen)` (cached by text), `haptico(tipo)`, `mantenerPantalla(activo)`, `exportarRecordatorios(lista, items)`, `importarRecordatorios(lista)`, `compartir(texto, titulo)` (native sheet, else `navigator.share`, else clipboard)
- On the web every function returns `null`/`false` and `app.js` falls back to local logic. Android would implement the same Capacitor plugin name and methods
- `app.js` adds `html.nativo` at startup; `tokens.css` uses it for native-only tweaks. Anything written by Apple Intelligence is shown with a leading ✦ (`.ia-nota`)

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

Two modes on the camera screen, chosen with the chips on the stage and remembered in localStorage (`quanto.scan_modo`):

- **Barrido** (native only, default there): `cicloBarrido()` sends full frames to Vision every ~100 ms with `ia: false`; `agruparEtiquetas()` in `vivo.js` clusters the OCR lines into price tags and parses each; `Seguimiento` tracks them across frames and confirms a tag on its 2nd sighting; confirmed tags enter `scanSession.capturas` once (`incorporarPista`) with a cropped thumbnail, then `refinarConIA()` asks Apple Intelligence to reread that tag's text (name, content, pack; never the price; skipped if the user edited the capture). `dibujarOverlay()` draws boxes and price-per-100 chips on `#scanOverlay`, best in green; tapping a box confirms it immediately or opens `openCapturaSheet`. Pause chip stops the loop; the tray and verdict below are the same as in capture mode.
- **Captura** (manual button, plus optional Auto):

1. User captures product label
2. `leerDatosEtiqueta(canvas)` in `app.js` picks the reader:
   - **Native** (only inside the Capacitor app, via `data/nativo.js`): Vision OCR returns text plus per-word boxes and any barcode; if the device has Apple Intelligence the plugin also returns an `ia` interpretation (fuente `apple`), otherwise `parseEtiqueta` runs on the Vision text (fuente `vision`). With a barcode, `completarPorCodigo()` fills missing name/content from `searchByBarcode()` (price always comes from the label)
   - **Lector IA** (if configured in the "Lector IA" sheet on the camera screen and online): `services.leerEtiqueta()` posts the JPEG to the Cloudflare Worker, Claude returns structured JSON. Any failure falls back to the local path and shows one toast per minute at most.
   - **Local OCR**: Tesseract.js extracts text, then `parseEtiqueta` in `ocr.js` extracts price ("$3", "3.50", "3,50"), content (g, ml, units), pack count and a product name
3. Auto mode detects a stable frame with the cheap reader (Vision when native, Tesseract otherwise), then confirms that single frame with Apple Intelligence or the Lector IA when available (one call per capture, not per cycle)
4. Results show ranking; when native with Apple Intelligence, `explicarVeredicto()` appends a short natural-language explanation (`.ia-nota`) after the comparison settles (700 ms debounce, cached per summary)

### Listas (Shopping Lists)

Each row shows price per 100 g/ml and a price traffic light (`semChip`) from the memory; the list card shows a budget bar (`htmlPresupuesto`: grey = estimated total, green/amber/red = what is already in the cart) when the list has `presupuesto`. The item sheet shows what the memory knows (`htmlMemoriaItem`).

List options (⋯) also offer: name, store and budget; **Enviar a Recordatorios** / **Traer pendientes de Recordatorios** (native only, EventKit via `nativo.js`; items import with `fuente: "recordatorios"`, duplicates unchecked by `buscarItemSimilar`) and **Compartir lista** (`textoLista()` → native share sheet, `navigator.share` or clipboard).

1. Create new list (with optional store name)
2. Add items manually (5-step wizard in `openAddItemSheet`) or from comparador. In the wizard, leaving the name step with a phrase that contains numbers calls `interpretarProducto()` (Apple Intelligence) and prefills price, quantity and content; the summary step re-renders from `wizard.datos`
3. Each item has state: `estimado` → `verificado_en_tienda` → `en_carrito` → `facturado`
4. Close list when done shopping (records actual total paid)
5. Items move to historial

### Ahorro (Savings guide, `renderAhorro`)

- **Resumen**: KPIs (this month vs last, average ticket, saved by comparing, shelf vs checkout), Apple Intelligence coach note when native (`pedirConsejoCoach` → `redactarConsejo`), tips (`tipCard`, clickable: goto or add product), restock chips (`sugChip` → `agregarSugerido`), store comparison, top spend (90 days), most-bought products
- **Precios**: searchable list of every product in the memory with sparkline, trend arrow and minimum; tap → `openPrecioSheet` with stores and history
- **Compras**: closed lists with total paid vs expected (immutable)
- Home shows a compact version (`renderHomeAhorro`, `renderHomeRecompra`) and the settings button (`openAjustesSheet`: habitual store, default budget, Lector IA on web, backup export/import)

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
