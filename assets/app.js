/**
 * Quanto - capa de UI.
 * La capa de datos vive en data/store.js (localStorage + syncQueue) y no
 * se toca desde aquí salvo por sus funciones exportadas.
 *
 * Navegación: main[data-view] con 5 pantallas (home, comparar, escanear,
 * listas, historial). Una acción principal por pantalla.
 */

import {
  getLista, guardarProducto, marcarEnCarrito, aplazarItem, reactivarItem,
  verificarEnTienda, facturarItem, puedeMarcarEnCarrito,
  calcularTotales, sincronizarPendientes, getSyncQueue, guardarComparacion,
  getListas, getListaActivaId, setListaActiva, crearLista, renombrarLista,
  duplicarLista, cerrarLista, getHistorialListasCerradas, eliminarItem,
} from "../data/store.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  view: "home",
  scanReturnTo: "home",
  compareRows: [nuevaFilaComparacion()],
  compareStep: 0,
};

function nuevaFilaComparacion(datos = {}) {
  return { nombre: "", precio: null, cantidad: null, unidad: "g", unidades: 1, ...datos };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function fmt(n) {
  return n === null || n === undefined || Number.isNaN(n) ? "-" : "$" + Number(n).toFixed(2);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.innerHTML = `${icon("check")}<span>${esc(msg)}</span>`;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Punto que "vuela" desde el origen hasta un tab del nav (feedback de agregar). */
function flyToNav(origin, destino = "listas") {
  const target = $(`.nav-item[data-goto="${destino}"]`);
  if (!origin || !target || reducedMotion.matches) return;
  const o = origin.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const dot = document.createElement("div");
  dot.className = "fly-dot";
  dot.style.left = `${o.left + o.width / 2 - 6}px`;
  dot.style.top = `${o.top + o.height / 2 - 6}px`;
  document.body.appendChild(dot);
  requestAnimationFrame(() => {
    dot.style.transform = `translate(${t.left + t.width / 2 - (o.left + o.width / 2)}px, ${t.top + t.height / 2 - (o.top + o.height / 2)}px) scale(.3)`;
    dot.style.opacity = "0";
  });
  setTimeout(() => {
    dot.remove();
    target.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }],
      { duration: 300, easing: "ease-out" }
    );
  }, 640);
}

/** Anima el número del precio ganador de 0 al valor final. */
function countUp(el, valor) {
  const inicio = performance.now();
  const dur = 450;
  function frame(t) {
    const p = Math.min(1, (t - inicio) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(valor * eased);
    if (p < 1) requestAnimationFrame(frame);
    else el.textContent = fmt(valor);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Bottom sheet con foco atrapado + Escape
// ---------------------------------------------------------------------------

const sheet = $("#bottomSheet");
const scrim = $("#sheetScrim");
const sheetContent = $("#bottomSheetContent");
let sheetLastFocused = null;

function sheetFocusables() {
  return $$('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])', sheet)
    .filter((el) => !el.disabled && el.offsetParent !== null);
}

function openSheet(html) {
  sheetLastFocused = document.activeElement;
  sheetContent.innerHTML = html;
  sheet.classList.add("open");
  scrim.classList.add("open");
  const titulo = $(".sheet-title", sheetContent);
  sheet.setAttribute("aria-label", titulo ? titulo.textContent.trim() : "Panel de acciones");
  setTimeout(() => { if (sheet.classList.contains("open")) sheetFocusables()[0]?.focus(); }, 80);
}

function closeSheet() {
  sheet.classList.remove("open");
  scrim.classList.remove("open");
  if (sheetLastFocused && document.body.contains(sheetLastFocused)) sheetLastFocused.focus();
  sheetLastFocused = null;
}
scrim.addEventListener("click", closeSheet);

document.addEventListener("keydown", (e) => {
  if (!sheet.classList.contains("open")) return;
  if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
  if (e.key !== "Tab") return;
  const list = sheetFocusables();
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  const dentro = sheet.contains(document.activeElement);
  if (e.shiftKey && (!dentro || document.activeElement === first)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (!dentro || document.activeElement === last)) { e.preventDefault(); first.focus(); }
});

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

const main = $("main");

function goto(view) {
  if (state.view === "escanear" && view !== "escanear") detenerCamara();
  if (view === "escanear" && state.view !== "escanear") state.scanReturnTo = state.view;
  state.view = view;
  main.dataset.view = view;
  $$(".nav-item").forEach((t) => {
    const activo = t.dataset.goto === view;
    t.classList.toggle("active", activo);
    if (activo) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
  renderView(view);
}

function renderView(view) {
  if (view === "home") renderHome();
  if (view === "comparar") renderResultadosComparacion();
  if (view === "escanear") iniciarEscaneo();
  if (view === "listas") renderListas();
  if (view === "historial") renderHistorial();
}

// Event delegation - manejar todos los clicks
document.addEventListener("click", (e) => {
  // Navegación por data-goto
  const nav = e.target.closest("[data-goto]");
  if (nav) {
    goto(nav.dataset.goto);
    return;
  }

  // Home: nueva lista
  if (e.target.closest("#homeNuevaLista")) {
    openNuevaListaSheet();
    return;
  }

  // Comparador: agregar producto
  if (e.target.closest("#addCompareRow")) {
    state.compareRows.push(nuevaFilaComparacion());
    renderCompareRows();
    return;
  }

  // Comparador: ejemplo
  if (e.target.closest("#fillExample")) {
    state.compareRows = [
      { nombre: "Leche 1L", precio: 2.50, cantidad: 1, unidad: "ml", unidades: 1000 },
      { nombre: "Leche 500ml", precio: 1.50, cantidad: 2, unidad: "ml", unidades: 500 }
    ];
    renderCompareRows();
    return;
  }
});

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

function renderHome() {
  const listaId = getListaActivaId();
  const lista = getListas().find((l) => l.id === listaId);
  const items = getLista(listaId);
  const activos = items.filter((i) => i.estado_compra !== "aplazado");
  const t = calcularTotales(listaId);

  $("#homeListaActiva").innerHTML = `
    <button class="list-row is-active" data-goto="listas">
      <span class="row-main">
        <span class="row-title">${esc(lista?.nombre || "Mi lista")}</span>
        <span class="row-meta">${activos.length ? `${activos.length} ${activos.length === 1 ? "item" : "items"} · estimado ${fmt(t.totalEstimado)}` : "Todavía sin items"}</span>
      </span>
      <span class="row-end" style="color:var(--ink-3)">${icon("chevron")}</span>
    </button>`;

  const cerradas = getHistorialListasCerradas();
  $("#homeHistorialBlock").innerHTML = cerradas.length ? `
    <p class="block-label">Última compra cerrada</p>
    <button class="list-row" data-goto="historial">
      <span class="row-main">
        <span class="row-title">${esc(cerradas[0].nombre)}</span>
        <span class="row-meta">${new Date(cerradas[0].cerrada_en ?? cerradas[0].creada_en).toLocaleDateString("es-EC")}</span>
      </span>
      <span class="row-end item-price facturado tabular">${fmt(cerradas[0].total_facturado_final)}</span>
    </button>` : "";
}

// Removido: ahora usa delegación de eventos arriba

// ---------------------------------------------------------------------------
// Comparador manual
// ---------------------------------------------------------------------------

function renderCompareRows() {
  const total = state.compareRows.length;
  const step = Math.min(Math.max(state.compareStep, 0), Math.max(total - 1, 0));
  state.compareStep = step;

  if (!total) {
    $("#compareRows").innerHTML = `<div class="compare-widget"><div class="hint-card">Agrega un producto para empezar.</div></div>`;
    renderResultadosComparacion();
    return;
  }

  const row = state.compareRows[step];
  const i = step;
  const unidad = row.unidad || "g";
  const presets = unidad === "unidad"
    ? [1, 2, 6, 12]
    : unidad === "ml"
      ? [250, 500, 1000, 2000]
      : [100, 250, 500, 1000];

  $("#compareRows").innerHTML = `
    <div class="compare-widget">
      <div class="compare-progress">
        <div class="compare-progress-meta">
          <span class="compare-step-pill">Paso ${step + 1} de ${total}</span>
          <span class="compare-step-copy">${total > 1 ? "Completa un producto a la vez y al terminar te muestro el ganador." : "Agrega otro producto para comparar."}</span>
        </div>
        <div class="compare-progress-bar">
          <div class="compare-progress-fill" style="width:${((step + 1) / Math.max(total, 1)) * 100}%"></div>
        </div>
      </div>

      <div class="card compare-card" data-i="${i}">
        <div class="compare-card-head">
          <div>
            <p class="compare-tag">Producto ${String.fromCharCode(65 + i)}</p>
            <p class="compare-lede">Escribe lo básico y sigue con el siguiente.</p>
          </div>
          ${total > 1 ? `<button class="remove-row" data-remove="${i}" aria-label="Quitar producto ${String.fromCharCode(65 + i)}">✕</button>` : ""}
        </div>

        <label class="field hero-field">
          <span class="hero-label">¿Qué producto es?</span>
          <input class="input hero-input" id="cmp-nombre-${i}" data-k="nombre" value="${esc(row.nombre)}" placeholder="Ej. Atún en lata">
        </label>

        <div class="compare-unit-row" role="group" aria-label="Tipo de medida">
          ${["g", "ml", "unidad"].map((u) => `<button type="button" class="unit-pill ${u === unidad ? "is-active" : ""}" data-unit="${u}" data-i="${i}">${u === "unidad" ? "unid." : u}</button>`).join("")}
        </div>

        <div class="compare-quick-row">
          ${presets.slice(0, 3).map((v) => `<button type="button" class="quick-pill" data-quick="${v}" data-i="${i}">${v}${unidad === "unidad" ? " ud" : unidad === "ml" ? " ml" : " g"}</button>`).join("")}
        </div>

        <div class="field-grid-2">
          <div class="field">
            <label for="cmp-precio-${i}">Precio total</label>
            <input class="input tabular" id="cmp-precio-${i}" data-k="precio" type="number" inputmode="decimal" step="0.01" min="0" value="${row.precio ?? ""}" placeholder="0.00">
          </div>
          <div class="field">
            <label for="cmp-cantidad-${i}">Contenido</label>
            <input class="input tabular" id="cmp-cantidad-${i}" data-k="cantidad" type="number" inputmode="decimal" step="any" min="0" value="${row.cantidad ?? ""}" placeholder="${unidad === "unidad" ? "1" : unidad === "ml" ? "500" : "100"}">
          </div>
        </div>

        <div class="field-grid-2 compare-bottom">
          <div class="field">
            <label for="cmp-unidades-${i}">Nº de envases</label>
            <input class="input tabular" id="cmp-unidades-${i}" data-k="unidades" type="number" inputmode="numeric" step="1" min="1" value="${row.unidades ?? 1}">
          </div>
          <div class="field">
            <label>Resumen</label>
            <div class="compare-summary" data-total-row="${i}"></div>
          </div>
        </div>
      </div>

      <div class="compare-actions">
        <button class="btn btn-quiet" type="button" data-step-nav="prev" ${step === 0 ? "disabled" : ""}>Anterior</button>
        <button class="btn" type="button" data-step-nav="next">${step === total - 1 ? "Ver resultado" : "Siguiente"}</button>
      </div>

      <div class="compare-actions compare-actions-secondary">
        <button class="btn btn-tonal" type="button" data-action="add-step">Agregar otro producto</button>
      </div>
    </div>`;
  renderResultadosComparacion();
}

$("#compareRows").addEventListener("input", (e) => {
  const card = e.target.closest("[data-i]");
  if (!card) return;
  const i = Number(card.dataset.i);
  const k = e.target.dataset.k;
  if (!k) return;
  const v = e.target.value;
  state.compareRows[i][k] = ["precio", "cantidad", "unidades"].includes(k)
    ? (v === "" ? null : Number(v))
    : v;
  renderResultadosComparacion();
});

$("#compareRows").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (btn) {
    state.compareRows.splice(Number(btn.dataset.remove), 1);
    state.compareStep = Math.max(0, Math.min(state.compareStep, state.compareRows.length - 1));
    renderCompareRows();
    return;
  }

  const stepNav = e.target.closest("[data-step-nav]");
  if (stepNav) {
    if (stepNav.dataset.stepNav === "prev") {
      state.compareStep = Math.max(0, state.compareStep - 1);
    } else {
      if (state.compareStep < state.compareRows.length - 1) {
        state.compareStep += 1;
      } else {
        renderResultadosComparacion();
      }
    }
    renderCompareRows();
    return;
  }

  const addStep = e.target.closest("[data-action='add-step']");
  if (addStep) {
    state.compareRows.push(nuevaFilaComparacion());
    state.compareStep = state.compareRows.length - 1;
    renderCompareRows();
    return;
  }

  const unitBtn = e.target.closest("[data-unit]");
  if (unitBtn) {
    const i = Number(unitBtn.dataset.i);
    state.compareRows[i].unidad = unitBtn.dataset.unit;
    renderCompareRows();
    return;
  }

  const quickBtn = e.target.closest("[data-quick]");
  if (quickBtn) {
    const i = Number(quickBtn.dataset.i);
    state.compareRows[i].cantidad = Number(quickBtn.dataset.quick);
    renderCompareRows();
  }
});


function normalizar(row, idx) {
  const totalContenido = row.cantidad * row.unidades;
  const normalizado = row.unidad === "unidad"
    ? row.precio / totalContenido
    : (row.precio / totalContenido) * 100;
  const baseLabel = row.unidad === "unidad" ? "por unidad" : `por 100 ${row.unidad}`;
  const etiqueta = row.nombre.trim() || `Producto ${String.fromCharCode(65 + idx)}`;
  return { ...row, idx, etiqueta, totalContenido, normalizado, baseLabel };
}

function filaValida(r) {
  return r.precio > 0 && r.cantidad > 0 && r.unidades > 0;
}

function renderResultadosComparacion() {
  // Actualiza los totales por fila sin re-renderizar los inputs.
  state.compareRows.forEach((row, i) => {
    const slot = $(`[data-total-row="${i}"]`);
    if (!slot) return;
    slot.textContent = filaValida(row)
      ? `Total: ${row.cantidad * row.unidades} ${row.unidad === "unidad" ? "unid." : row.unidad}`
      : "";
  });

  const box = $("#compareResults");
  const validas = state.compareRows
    .map((r, i) => ({ ...r, __i: i }))
    .filter(filaValida);

  if (validas.length < 2) {
    box.innerHTML = `<div class="hint-card">Completa precio, contenido y envases de al menos dos productos para ver cuál conviene.</div>`;
    return;
  }

  const norm = validas.map((r) => normalizar(r, r.__i)).sort((a, b) => a.normalizado - b.normalizado);
  const mejor = norm[0];
  const resto = norm.slice(1);

  // Las animaciones de entrada solo se disparan cuando cambia el ganador,
  // no en cada tecla (el bloque se re-renderiza en vivo).
  const winnerKey = `${mejor.__i}|${mejor.etiqueta}`;
  const winnerNuevo = winnerKey !== renderResultadosComparacion.lastWinnerKey;
  renderResultadosComparacion.lastWinnerKey = winnerKey;

  const trucos = resto
    .filter((r) => r.unidades > 1 && r.totalContenido < mejor.totalContenido && r.normalizado > mejor.normalizado)
    .map((r) => `“${esc(r.etiqueta)}” parece más barato, pero trae menos producto en total (${r.totalContenido} ${r.unidad} vs ${mejor.totalContenido} ${mejor.unidad}).`);

  box.innerHTML = `
    <div class="result-winner ${winnerNuevo ? "" : "no-anim"}">
      <span class="winner-pill">${icon("check")} Mejor compra</span>
      <p class="title" style="margin-bottom:6px">${esc(mejor.etiqueta)}</p>
      <div class="winner-price tabular"><span id="winnerPriceValue">${fmt(mejor.normalizado)}</span> <small>${mejor.baseLabel}</small></div>
      <p class="caption" style="margin-top:6px">${fmt(mejor.precio)} · ${mejor.totalContenido} ${mejor.unidad === "unidad" ? "unidades" : mejor.unidad} en total</p>
      <div class="button-row" style="margin-top:16px">
        <button class="btn btn-tonal" id="addWinnerToList">${icon("plus")} Agregar a mi lista</button>
      </div>
    </div>
    <div class="card" style="margin-top:12px">
      ${norm.map((r) => {
        const esMejor = r === mejor;
        return `
        <div class="result-row">
          <div style="min-width:0; flex:1">
            <div style="font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(r.etiqueta)}</div>
            <div class="micro tabular">${fmt(r.normalizado)} ${r.baseLabel} · ${r.totalContenido} ${r.unidad === "unidad" ? "unid." : r.unidad}</div>
            <div class="result-bar-track"><div class="result-bar ${esMejor ? "is-best" : ""}" style="width:${((r.normalizado / norm[norm.length - 1].normalizado) * 100).toFixed(1)}%"></div></div>
          </div>
          <span class="result-delta tabular ${esMejor ? "is-best" : ""}">${esMejor ? "Mejor" : `+${(((r.normalizado / mejor.normalizado) - 1) * 100).toFixed(1)}%`}</span>
        </div>`;
      }).join("")}
      ${trucos.map((t) => `<div class="trick-note">${icon("alert")}<span>${t}</span></div>`).join("")}
    </div>`;

  if (winnerNuevo && !reducedMotion.matches) countUp($("#winnerPriceValue"), mejor.normalizado);

  $("#addWinnerToList")?.addEventListener("click", (ev) => {
    const btn = ev.currentTarget;
    guardarProducto({
      nombre: mejor.etiqueta,
      cantidad: 1,
      contenido: mejor.totalContenido,
      unidad_medida: mejor.unidad,
      precio_estimado: mejor.precio,
      estado_precio: "estimado",
      fuente: "manual",
    });
    guardarComparacion({
      origen: "comparador",
      items: norm.map(({ etiqueta, precio, totalContenido, unidad, normalizado }) =>
        ({ nombre: etiqueta, precio, totalContenido, unidad, normalizado })),
    });
    flyToNav(btn);
    btn.innerHTML = `${icon("check")} Agregado`;
    btn.disabled = true;
    toast(`Agregado a “${nombreListaActiva()}”`);
    setTimeout(() => {
      if (document.body.contains(btn)) {
        btn.innerHTML = `${icon("plus")} Agregar a mi lista`;
        btn.disabled = false;
      }
    }, 1600);
  });
}

function nombreListaActiva() {
  const lista = getListas().find((l) => l.id === getListaActivaId());
  return lista?.nombre || "Mi lista";
}

// ---------------------------------------------------------------------------
// Escáner (cámara + OCR)
// ---------------------------------------------------------------------------

let camaraStream = null;
let tesseractPromise = null;
let ocrWorkerPromise = null;

/**
 * Sesión de comparación con cámara: se capturan 2+ etiquetas seguidas,
 * el veredicto se calcula en vivo y cada captura puede editarse,
 * agregarse al carrito o descartarse. La sesión sobrevive al cambio de
 * vista (puedes ir a Listas y volver) hasta que el usuario la termina.
 */
const scanSession = { capturas: [], auto: false };
let scanSeq = 0;
let autoTimer = null;
let autoOcupado = false;
let autoLentos = 0;
let autoFirmaPrevia = null;
let autoCooldownHasta = 0;

function detenerCamara() {
  clearTimeout(autoTimer);
  autoTimer = null;
  if (camaraStream) {
    camaraStream.getTracks().forEach((t) => t.stop());
    camaraStream = null;
  }
}

function soporteCamara() {
  if (!window.isSecureContext) return "inseguro";
  if (!navigator.mediaDevices?.getUserMedia) return "no_soportado";
  return "ok";
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { tesseractPromise = null; reject(new Error("ocr_load")); };
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

/** Worker de OCR único y reutilizado: las capturas sucesivas salen rápido. */
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = loadTesseract()
      .then((T) => T.createWorker("spa"))
      .catch((e) => { ocrWorkerPromise = null; throw e; });
  }
  return ocrWorkerPromise;
}

async function leerEtiqueta(canvas) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas);
  return { texto: data.text || "", confianza: data.confidence ?? 0 };
}

/**
 * Extrae precio, contenido, nº de envases y candidato a nombre del texto OCR.
 * Entiende los formatos habituales de góndola:
 *  - precio con o sin símbolo, cerca de palabras clave (PVP, precio, ahora, oferta)
 *  - "antes / ahora": se queda con el precio de oferta, no con el tachado
 *  - packs: "6 x 80 g", "pack 6 unidades", "3 un x 170g"
 *  - medidas en g, kg, mg, ml, cc, cl, l, lb, oz (convierte a g / ml)
 *  - precio unitario ya impreso ("$3.99/kg", "1.25 por 100 g") - si la etiqueta
 *    no trae gramaje, el contenido se deduce de ahí
 */
function parseNumero(s) {
  return Number(String(s).replace(",", "."));
}

const UNIDADES_MEDIDA = {
  kg: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000], kgs: ["g", 1000],
  g: ["g", 1], gr: ["g", 1], grs: ["g", 1], gramo: ["g", 1], gramos: ["g", 1],
  mg: ["g", 0.001],
  lb: ["g", 453.6], lbs: ["g", 453.6], libra: ["g", 453.6], libras: ["g", 453.6],
  oz: ["g", 28.35],
  ml: ["ml", 1], cc: ["ml", 1], cl: ["ml", 10],
  l: ["ml", 1000], lt: ["ml", 1000], lts: ["ml", 1000], litro: ["ml", 1000], litros: ["ml", 1000],
};
const RE_UNIDAD = "kgs?|kilos?|grs?|gramos?|mg|lbs?|libras?|oz|ml|cc|cl|lts?|litros?|g|l";

function parseEtiqueta(texto) {
  let t = texto.replace(/\s+/g, " ");

  // --- Precio unitario impreso ("$3.99/kg", "0.85 por 100 g", "1.10 c/u") --
  // Se detecta primero y se retira del texto: su número no es el precio total
  // ni su medida ("100 g") es el contenido del envase.
  let unitarioImpreso = null; // { base, porCien } o { base: "unidad", porUno }
  const unit = t.match(new RegExp(`(?:\\$|usd)?\\s*(\\d{1,4}[.,]\\d{1,2})\\s*(?:\\/|por\\s+)(?:cada\\s+)?(100\\s*)?(${RE_UNIDAD})\\b`, "i"));
  if (unit) {
    const conv = UNIDADES_MEDIDA[unit[3].toLowerCase()];
    if (conv) {
      const cantidadRef = (unit[2] ? 100 : 1) * conv[1]; // en g o ml
      unitarioImpreso = { base: conv[0], porCien: (parseNumero(unit[1]) / cantidadRef) * 100 };
      t = t.replace(unit[0], " ");
    }
  }
  const cu = t.match(/(?:\$\s*)?(\d{1,4}[.,]\d{2})\s*c\s*\/?\s*u\b/i);
  if (cu) { unitarioImpreso = { base: "unidad", porUno: parseNumero(cu[1]) }; }

  // --- Precio: junta candidatos y elige el más creíble ---------------------
  const candidatos = [];
  for (const m of t.matchAll(/(\$|usd\s*)?\s*(\d{1,4}[.,]\d{2})(?![\d])/gi)) {
    const antesDe = t.slice(Math.max(0, m.index - 18), m.index).toLowerCase();
    let peso = 0;
    if (m[1]) peso += 2;                                             // trae símbolo
    if (/pvp|precio|ahora|oferta|lleva|paga/.test(antesDe)) peso += 3; // palabra clave
    if (/antes|normal|regular|tachado/.test(antesDe)) peso -= 4;      // precio viejo
    if (/\/|por\s*$/.test(antesDe)) peso -= 2;                        // es unitario, no total
    candidatos.push({ valor: parseNumero(m[2]), peso, index: m.index });
  }
  // Entero con símbolo ("$3") como último recurso
  const entero = t.match(/\$\s*(\d{1,4})(?![\d.,])/);
  if (entero && !candidatos.length) candidatos.push({ valor: Number(entero[1]), peso: 0, index: entero.index });
  candidatos.sort((a, b) => b.peso - a.peso || a.index - b.index);
  let precio = candidatos[0]?.valor ?? null;
  if (precio !== null && (precio <= 0 || precio > 5000)) precio = null;

  // --- Pack: "6 x 80 g", "pack de 6", "x6", "6 unid" -----------------------
  let unidades = 1;
  const packMedida = t.match(new RegExp(`(\\d{1,2})\\s*(?:x|×)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${RE_UNIDAD})\\b`, "i"));
  const packSolo = t.match(/(?:pack\s*(?:de\s*)?|x\s?)(\d{1,2})\s*(?:un(?:id(?:ades)?)?\.?\b|$)/i)
    || t.match(/(\d{1,2})\s*un(?:id(?:ades)?)?\.?\b/i);
  if (packMedida) unidades = Number(packMedida[1]);
  else if (packSolo) unidades = Number(packSolo[1]);
  if (unidades < 1 || unidades > 48) unidades = 1;

  // --- Contenido por envase ------------------------------------------------
  let contenido = null, unidad = null;
  const medida = packMedida
    ? { valor: packMedida[2], u: packMedida[3] }
    : (() => {
        const m = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${RE_UNIDAD})\\b`, "i"));
        return m ? { valor: m[1], u: m[2] } : null;
      })();
  if (medida) {
    const conv = UNIDADES_MEDIDA[medida.u.toLowerCase()];
    if (conv) {
      unidad = conv[0];
      contenido = Math.round(parseNumero(medida.valor) * conv[1]);
      if (contenido <= 0) { contenido = null; unidad = null; }
    }
  }

  // Sin gramaje pero con precio total y unitario impreso => deducir contenido
  if (!contenido && precio && unitarioImpreso?.porCien) {
    contenido = Math.round((precio / unitarioImpreso.porCien) * 100 / unidades);
    unidad = unitarioImpreso.base;
  }

  // --- Nombre: la línea "más de producto" del texto ------------------------
  const RUIDO = /pvp|precio|oferta|ahora|antes|lleva|gratis|paga|ahorr|promo|desc|unid|total|caja|cod|sku/i;
  const nombre = texto.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-záéíóúñ]{4,}/i.test(l) && !RUIDO.test(l))
    .sort((a, b) => {
      // prefiere líneas sin dígitos; entre iguales, la más larga
      const da = /\d/.test(a) ? 1 : 0, db = /\d/.test(b) ? 1 : 0;
      return da - db || b.length - a.length;
    })[0] || "";

  return { precio, contenido, unidad, unidades, nombre };
}

const PROBLEMAS_CAMARA = {
  inseguro: {
    titulo: "Contexto no seguro",
    cuerpo: "El navegador solo permite usar la cámara en páginas HTTPS (o en localhost). Abre la app desde una dirección segura y vuelve a intentarlo.",
    reintentar: false,
  },
  no_soportado: {
    titulo: "Este navegador no soporta cámara",
    cuerpo: "Tu navegador no ofrece acceso a la cámara (getUserMedia). Prueba con una versión reciente de Chrome, Safari o Firefox.",
    reintentar: false,
  },
  NotAllowedError: {
    titulo: "Permiso de cámara bloqueado",
    cuerpo: "El sitio no tiene permiso para usar la cámara. Actívalo tocando el candado en la barra de direcciones y reintenta.",
    reintentar: true,
  },
  NotFoundError: {
    titulo: "No se encontró cámara",
    cuerpo: "No se detectó ninguna cámara en este dispositivo.",
    reintentar: false,
  },
  NotReadableError: {
    titulo: "La cámara está ocupada",
    cuerpo: "Otra aplicación está usando la cámara ahora mismo. Ciérrala y reintenta.",
    reintentar: true,
  },
  generico: {
    titulo: "No se pudo abrir la cámara",
    cuerpo: "Ocurrió un error inesperado al iniciar la cámara. Reintenta o continúa manualmente.",
    reintentar: true,
  },
  sin_lectura: {
    titulo: "No se encontró un precio",
    cuerpo: "La foto no tenía un precio legible. Acércate a la etiqueta, cuida el enfoque y reintenta.",
    reintentar: true,
  },
  ocr_load: {
    titulo: "No se pudo cargar el lector",
    cuerpo: "El motor de lectura (OCR) se descarga la primera vez y necesita conexión. Revisa tu internet y reintenta.",
    reintentar: true,
  },
};

function renderProblemaCamara(codigo) {
  const p = PROBLEMAS_CAMARA[codigo] || PROBLEMAS_CAMARA.generico;
  $("#scanStage").innerHTML = `
    <div class="card camera-problem" role="alert">
      <div class="icon-circle" style="margin-bottom:12px; background:var(--danger-soft); color:var(--danger); border-color:color-mix(in oklab, var(--danger) 30%, transparent)">${icon("alert")}</div>
      <p class="problem-title">${p.titulo}</p>
      <p class="problem-body">${p.cuerpo}</p>
      <div class="button-col" style="margin-top:16px">
        ${p.reintentar ? `<button class="btn" id="scanRetry">Reintentar</button>` : ""}
        <button class="btn ${p.reintentar ? "btn-ghost" : ""}" data-goto="comparar">Continuar manualmente</button>
      </div>
    </div>`;
  $("#scanRetry")?.addEventListener("click", iniciarEscaneo);
  renderScanTray();
}

function setScanStatus(msg) {
  const el = $("#scanStatus");
  if (el) el.textContent = msg;
}

function flashCamara() {
  const stage = $(".camera-stage");
  if (!stage || reducedMotion.matches) return;
  const flash = document.createElement("div");
  flash.className = "camera-flash zap";
  stage.appendChild(flash);
  setTimeout(() => flash.remove(), 420);
}

/** Frame actual recortado a la zona del marco-guía (OCR más rápido y limpio). */
function capturarFrame() {
  const video = $("#scanVideo");
  if (!video || !video.videoWidth) return null;
  const w = video.videoWidth, h = video.videoHeight;
  const sx = w * 0.08, sy = h * 0.12, sw = w * 0.84, sh = h * 0.72;
  const escala = Math.min(1, 1000 / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * escala);
  canvas.height = Math.round(sh * escala);
  canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function miniatura(canvas) {
  const t = document.createElement("canvas");
  const escala = 180 / canvas.width;
  t.width = 180;
  t.height = Math.max(1, Math.round(canvas.height * escala));
  t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.6);
}

async function iniciarEscaneo() {
  detenerCamara();
  scanSession.auto = false;
  renderScanTray();
  const soporte = soporteCamara();
  if (soporte !== "ok") { renderProblemaCamara(soporte); return; }

  $("#scanStage").innerHTML = `
    <div class="camera-stage">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="camera-frame" aria-hidden="true"></div>
      <button class="auto-chip" id="autoChip" aria-pressed="false" title="Captura sola cuando la lectura es estable">Auto</button>
      <div class="camera-status" id="scanStatus" aria-live="polite">Pidiendo permiso de cámara…</div>
    </div>
    <button class="btn btn-block" id="scanCapture" disabled style="margin-top:12px">${icon("camera")} Capturar etiqueta</button>`;

  const video = $("#scanVideo");
  try {
    camaraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    if (state.view !== "escanear") { detenerCamara(); return; }
    video.srcObject = camaraStream;
    await video.play().catch(() => {});
    setScanStatus("Encuadra el precio y captura - puedes tomar varias seguidas.");
    $("#scanCapture").disabled = false;
    getOcrWorker().catch(() => {}); // precalienta el OCR para la primera captura
  } catch (err) {
    detenerCamara();
    renderProblemaCamara(PROBLEMAS_CAMARA[err.name] ? err.name : "generico");
    return;
  }

  $("#scanCapture").addEventListener("click", () => capturarEtiqueta());
  $("#autoChip").addEventListener("click", () => setAuto(!scanSession.auto));
}

/** Captura manual: la cámara sigue encendida para encadenar la siguiente. */
async function capturarEtiqueta() {
  const btn = $("#scanCapture");
  const canvas = capturarFrame();
  if (!canvas) return;
  flashCamara();
  if (btn) btn.disabled = true;
  setScanStatus("Leyendo etiqueta…");
  try {
    const lectura = await leerEtiqueta(canvas);
    const datos = parseEtiqueta(lectura.texto);
    if (datos.precio === null && datos.contenido === null) {
      setScanStatus("No se leyó un precio - acércate a la etiqueta y captura otra vez.");
      return;
    }
    const cap = agregarCaptura(datos, canvas);
    setScanStatus(`Capturada: ${fmt(cap.precio)}${cap.contenido ? ` · ${cap.contenido} ${cap.unidad}` : ""} - lista para la siguiente.`);
  } catch (e) {
    setScanStatus("No se pudo cargar el lector (necesita conexión la primera vez). Reintenta.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function agregarCaptura(datos, canvas) {
  const cap = {
    id: "cap" + (++scanSeq),
    nombre: datos.nombre || "",
    precio: datos.precio,
    contenido: datos.contenido,
    unidad: datos.unidad || "g",
    unidades: datos.unidades || 1,
    thumb: miniatura(canvas),
    agregadaComo: null, // id del ItemLista si ya se agregó / marcó
  };
  scanSession.capturas.push(cap);
  renderScanTray();
  return cap;
}

// ------------------------- Auto-escaneo condicional --------------------------
// Solo captura cuando dos lecturas seguidas coinciden (precio estable) con
// confianza suficiente. Si el OCR va lento en este dispositivo, se apaga solo.

function setAuto(on) {
  scanSession.auto = on;
  const chip = $("#autoChip");
  if (chip) {
    chip.setAttribute("aria-pressed", String(on));
    chip.classList.toggle("on", on);
  }
  clearTimeout(autoTimer);
  autoFirmaPrevia = null;
  autoLentos = 0;
  if (on) {
    setScanStatus("Auto activado: mantén la etiqueta quieta dentro del marco.");
    programarCicloAuto(600);
  }
}

function programarCicloAuto(ms = 1500) {
  clearTimeout(autoTimer);
  if (!scanSession.auto || state.view !== "escanear") return;
  autoTimer = setTimeout(cicloAuto, ms);
}

async function cicloAuto() {
  if (!scanSession.auto || state.view !== "escanear" || !camaraStream) return;
  if (autoOcupado || Date.now() < autoCooldownHasta) { programarCicloAuto(); return; }
  autoOcupado = true;
  try {
    const canvas = capturarFrame();
    if (!canvas) return;
    const t0 = performance.now();
    const lectura = await leerEtiqueta(canvas);
    const duracion = performance.now() - t0;
    if (duracion > 3500) {
      autoLentos++;
      if (autoLentos >= 2) {
        setAuto(false);
        setScanStatus("El escaneo automático va lento en este dispositivo - mejor usa el botón Capturar.");
        return;
      }
    } else {
      autoLentos = 0;
    }
    if (!scanSession.auto) return;
    const datos = parseEtiqueta(lectura.texto);
    if (datos.precio === null || lectura.confianza < 55) { autoFirmaPrevia = null; return; }
    const firma = `${datos.precio}|${datos.contenido ?? ""}`;
    const yaCapturada = scanSession.capturas.some(
      (c) => c.precio === datos.precio && (c.contenido ?? null) === (datos.contenido ?? null)
    );
    if (firma === autoFirmaPrevia && !yaCapturada) {
      flashCamara();
      const cap = agregarCaptura(datos, canvas);
      setScanStatus(`Auto: capturada ${fmt(cap.precio)} ✓ - apunta a la siguiente etiqueta.`);
      autoCooldownHasta = Date.now() + 3000;
      autoFirmaPrevia = null;
    } else {
      autoFirmaPrevia = firma;
    }
  } catch (e) {
    setAuto(false);
    setScanStatus("Auto no disponible ahora (falló el lector). Usa el botón Capturar.");
  } finally {
    autoOcupado = false;
    programarCicloAuto();
  }
}

// ------------------- Bandeja de capturas y veredicto ------------------------

function capturaNormalizada(cap, idx) {
  return normalizar({
    nombre: cap.nombre || `Captura ${idx + 1}`,
    precio: cap.precio,
    cantidad: cap.contenido,
    unidad: cap.unidad,
    unidades: cap.unidades || 1,
  }, idx);
}

function veredictoEscaner() {
  const comparables = scanSession.capturas
    .map((cap, idx) => ({ cap, idx }))
    .filter(({ cap }) => cap.precio > 0 && cap.contenido > 0);
  if (comparables.length < 2) return null;
  const norm = comparables
    .map(({ cap, idx }) => ({ cap, ...capturaNormalizada(cap, idx) }))
    .sort((a, b) => a.normalizado - b.normalizado);
  return { mejor: norm[0], resto: norm.slice(1) };
}

function renderScanTray() {
  const tray = $("#scanTray");
  const actions = $("#scanActions");
  if (!tray || !actions) return;
  const caps = scanSession.capturas;
  const ver = veredictoEscaner();
  const mejorId = ver?.mejor.cap.id;

  const cards = caps.map((c, i) => {
    const total = c.contenido ? c.contenido * (c.unidades || 1) : null;
    const norm = c.precio > 0 && total
      ? (c.unidad === "unidad" ? c.precio / total : (c.precio / total) * 100)
      : null;
    const unidadCorta = c.unidad === "unidad" ? "unid." : c.unidad;
    const enLista = c.agregadaComo ? null : buscarItemSimilar(c.nombre);
    return `
      <button class="scan-card ${c.id === mejorId ? "is-best" : ""}" data-cap="${c.id}" style="--stagger:${Math.min(i, 8) * 40}ms" aria-label="Revisar captura ${i + 1}">
        ${c.id === mejorId ? `<span class="sc-flag chip chip-menos">Mejor</span>` : ""}
        <img src="${c.thumb}" alt="">
        <div class="sc-precio tabular">${fmt(c.precio)}</div>
        <div class="sc-meta tabular">${total ? `${total} ${unidadCorta}${norm ? ` · ${fmt(norm)}/${c.unidad === "unidad" ? "unid." : `100 ${c.unidad}`}` : ""}` : "Sin gramaje - toca para completar"}</div>
        ${c.nombre ? `<div class="sc-meta" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(c.nombre)}</div>` : ""}
        ${c.agregadaComo
          ? `<span class="chip chip-menos" style="margin-top:6px">✓ En tu carrito</span>`
          : enLista
            ? `<span class="chip chip-neutro" style="margin-top:6px">Ya en tu lista</span>`
            : ""}
      </button>`;
  }).join("");

  const veredicto = ver ? `
    <div class="result-winner no-anim" style="margin-top:12px; padding:16px">
      <span class="winner-pill">${icon("check")} Conviene</span>
      <p class="title" style="font-size:16px; margin:2px 0 6px">${esc(ver.mejor.etiqueta)}</p>
      <p class="caption tabular" style="color:var(--brand-deep); font-weight:650">${fmt(ver.mejor.normalizado)} ${ver.mejor.baseLabel}</p>
      ${ver.resto.map((r) => `<p class="caption tabular" style="margin-top:4px">${esc(r.etiqueta)}: +${(((r.normalizado / ver.mejor.normalizado) - 1) * 100).toFixed(1)}% más caro</p>`).join("")}
    </div>` : caps.length === 1
      ? `<p class="caption" style="margin-top:10px">Captura otra etiqueta para comparar - o toca la tarjeta para agregarla directo.</p>`
      : "";

  tray.innerHTML = caps.length
    ? `<p class="block-label" style="margin:16px 0 8px">Etiquetas capturadas (${caps.length})</p><div class="scan-tray">${cards}</div>${veredicto}`
    : "";

  const mejorPendiente = ver && !ver.mejor.cap.agregadaComo;
  actions.innerHTML = `
    ${mejorPendiente ? `<button class="btn btn-block" id="scanAddBest">${icon("plus")} La mejor al carrito · ${fmt(ver.mejor.cap.precio)}</button>` : ""}
    ${caps.length >= 2 ? `<button class="btn btn-ghost btn-block" id="scanOpenManual">Ajustar en comparador manual</button>` : ""}
    ${caps.length ? `<button class="btn btn-quiet" id="scanFinish">${caps.some((c) => c.agregadaComo) ? "Terminar" : "Terminar sin agregar"}</button>` : ""}`;

  $$("[data-cap]", tray).forEach((el) => el.addEventListener("click", () => {
    const cap = caps.find((c) => c.id === el.dataset.cap);
    if (cap) openCapturaSheet(cap);
  }));
  $("#scanAddBest")?.addEventListener("click", (ev) => agregarCapturaAlCarrito(ver.mejor.cap, ev.currentTarget));
  $("#scanOpenManual")?.addEventListener("click", abrirCapturasEnComparador);
  $("#scanFinish")?.addEventListener("click", terminarSesionEscaner);
}

// -------------------- Capturas → carrito / lista activa ---------------------

function normalizarNombre(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Busca en la lista activa un item que parezca el mismo producto. */
function buscarItemSimilar(nombre) {
  const n = normalizarNombre(nombre);
  if (!n) return null;
  const tokens = n.split(" ").filter((t) => t.length > 2);
  return getLista().find((i) => {
    const m = normalizarNombre(i.nombre);
    if (!m) return false;
    if (m === n || m.includes(n) || n.includes(m)) return true;
    if (!tokens.length) return false;
    const mt = new Set(m.split(" "));
    const comunes = tokens.filter((t) => mt.has(t)).length;
    return comunes / tokens.length >= 0.6;
  }) || null;
}

function agregarCapturaAlCarrito(cap, origin) {
  const existente = buscarItemSimilar(cap.nombre);
  if (existente) { openDuplicadoSheet(cap, existente); return; }
  crearItemDesdeCaptura(cap, origin);
}

function crearItemDesdeCaptura(cap, origin) {
  // Precio leído de la etiqueta en góndola => "verificado_en_tienda" (nunca
  // definitivo hasta facturar), y directo al carrito: ya lo tienes en la mano.
  const item = guardarProducto({
    nombre: cap.nombre || "Producto escaneado",
    cantidad: 1,
    contenido: cap.contenido ? cap.contenido * (cap.unidades || 1) : null,
    unidad_medida: cap.contenido ? cap.unidad : null,
    precio_estimado: cap.precio ?? 0,
    precio_verificado: cap.precio ?? 0,
    estado_precio: "verificado_en_tienda",
    estado_compra: "en_carrito",
    fuente: "ocr",
  });
  cap.agregadaComo = item.id;
  if (origin) flyToNav(origin);
  toast(`En tu carrito · “${nombreListaActiva()}”`);
  renderScanTray();
}

function openDuplicadoSheet(cap, existente) {
  const enCarrito = existente.estado_compra === "en_carrito";
  openSheet(`
    <h2 class="sheet-title">${enCarrito ? "Ya está en tu carrito" : "Ya está en tu lista"}</h2>
    <p class="sheet-sub">“${esc(existente.nombre)}” ${enCarrito ? "ya está marcado en el carrito" : "está en tu lista de compras"}. ¿Qué hacemos con esta lectura de ${fmt(cap.precio)}?</p>
    <div class="button-col">
      ${enCarrito
        ? `<button class="btn btn-block" id="dupActualizar">Actualizar su precio a ${fmt(cap.precio)}</button>`
        : `<button class="btn btn-block" id="dupMarcar">Marcarlo en el carrito a ${fmt(cap.precio)}</button>`}
      <button class="btn btn-ghost btn-block" id="dupNuevo">Agregar como item aparte</button>
      <button class="btn btn-quiet" id="dupCancelar">Cancelar</button>
    </div>`);
  $("#dupMarcar", sheetContent)?.addEventListener("click", () => {
    verificarEnTienda(existente.id, cap.precio ?? 0);
    marcarEnCarrito(existente.id, true);
    cap.agregadaComo = existente.id;
    closeSheet(); toast("Marcado en tu carrito con el precio de la etiqueta"); renderScanTray();
  });
  $("#dupActualizar", sheetContent)?.addEventListener("click", () => {
    verificarEnTienda(existente.id, cap.precio ?? 0);
    cap.agregadaComo = existente.id;
    closeSheet(); toast("Precio actualizado"); renderScanTray();
  });
  $("#dupNuevo", sheetContent)?.addEventListener("click", () => { closeSheet(); crearItemDesdeCaptura(cap); });
  $("#dupCancelar", sheetContent)?.addEventListener("click", closeSheet);
}

function openCapturaSheet(cap) {
  openSheet(`
    <h2 class="sheet-title">Revisar captura</h2>
    <p class="sheet-sub">Corrige lo que el OCR no leyó bien antes de decidir.</p>
    <div class="field"><label for="ecNombre">Nombre</label><input class="input" id="ecNombre" value="${esc(cap.nombre)}" placeholder="Ej. Atún lomitos"></div>
    <div class="field-grid-3">
      <div class="field"><label for="ecPrecio">Precio</label><input class="input tabular" id="ecPrecio" type="number" inputmode="decimal" step="0.01" min="0" value="${cap.precio ?? ""}"></div>
      <div class="field"><label for="ecContenido">Por envase</label><input class="input tabular" id="ecContenido" type="number" inputmode="decimal" step="any" min="0" value="${cap.contenido ?? ""}"></div>
      <div class="field"><label for="ecUnidad">Unidad</label><select class="input" id="ecUnidad">
        <option value="g" ${cap.unidad === "g" ? "selected" : ""}>g</option>
        <option value="ml" ${cap.unidad === "ml" ? "selected" : ""}>ml</option>
        <option value="unidad" ${cap.unidad === "unidad" ? "selected" : ""}>unid.</option>
      </select></div>
    </div>
    <div class="field"><label for="ecUnidades">Nº de envases</label><input class="input tabular" id="ecUnidades" type="number" inputmode="numeric" step="1" min="1" value="${cap.unidades || 1}"></div>
    <div class="button-col">
      <button class="btn btn-block" id="ecGuardar">Guardar cambios</button>
      ${cap.agregadaComo ? "" : `<button class="btn btn-tonal btn-block" id="ecAgregar">${icon("plus")} Agregar esta al carrito</button>`}
      <button class="btn btn-danger btn-block" id="ecQuitar">Quitar captura</button>
      <button class="btn btn-quiet" id="ecCancelar">Cancelar</button>
    </div>`);
  const leerCampos = () => {
    cap.nombre = $("#ecNombre", sheetContent).value.trim();
    cap.precio = Number($("#ecPrecio", sheetContent).value || 0) || null;
    cap.contenido = Number($("#ecContenido", sheetContent).value || 0) || null;
    cap.unidad = $("#ecUnidad", sheetContent).value;
    cap.unidades = Math.max(1, Number($("#ecUnidades", sheetContent).value || 1));
  };
  $("#ecGuardar", sheetContent).addEventListener("click", () => { leerCampos(); closeSheet(); renderScanTray(); });
  $("#ecAgregar", sheetContent)?.addEventListener("click", () => { leerCampos(); closeSheet(); agregarCapturaAlCarrito(cap); });
  $("#ecQuitar", sheetContent).addEventListener("click", () => {
    scanSession.capturas = scanSession.capturas.filter((c) => c !== cap);
    closeSheet(); renderScanTray();
  });
  $("#ecCancelar", sheetContent).addEventListener("click", closeSheet);
}

function abrirCapturasEnComparador() {
  const filas = scanSession.capturas.filter((c) => c.precio > 0);
  if (!filas.length) return;
  state.compareRows = filas.map((c) => nuevaFilaComparacion({
    nombre: c.nombre, precio: c.precio, cantidad: c.contenido, unidad: c.unidad, unidades: c.unidades || 1,
  }));
  while (state.compareRows.length < 2) state.compareRows.push(nuevaFilaComparacion());
  renderCompareRows();
  goto("comparar");
  toast("Capturas cargadas en el comparador");
}

function terminarSesionEscaner() {
  const ver = veredictoEscaner();
  if (ver) {
    // También cuenta si "solo comparaste": queda registro para analítica.
    guardarComparacion({
      origen: "escaner",
      items: [ver.mejor, ...ver.resto].map((r) => ({
        nombre: r.etiqueta, precio: r.precio, totalContenido: r.totalContenido,
        unidad: r.unidad, normalizado: r.normalizado,
      })),
    });
  }
  const agregoAlgo = scanSession.capturas.some((c) => c.agregadaComo);
  scanSession.capturas = [];
  setAuto(false);
  renderScanTray();
  if (agregoAlgo) {
    goto("listas");
    toast("Lo escaneado quedó en tu carrito");
  } else {
    toast(ver ? "Comparación guardada - nada agregado" : "Sesión reiniciada");
    setScanStatus("Sesión nueva: captura la primera etiqueta.");
  }
}

$("#escanearBack").addEventListener("click", () => goto(state.scanReturnTo || "home"));

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

function badgeItem(item) {
  if (item.estado_precio === "facturado")
    return { cls: "badge-facturado", txt: "Facturado", precioCls: "facturado", precio: item.precio_facturado, pre: "" };
  if (item.estado_precio === "verificado_en_tienda")
    return { cls: "badge-verificado", txt: "Verificado", precioCls: "verificado", precio: item.precio_verificado, pre: "" };
  return { cls: "badge-estimado", txt: "Estimado", precioCls: "estimado", precio: item.precio_estimado, pre: "~" };
}

function metaItem(item) {
  const partes = [`x${item.cantidad}`];
  if (item.contenido) partes.push(`${item.contenido} ${item.unidad_medida || ""}`.trim());
  if (item.comercio) partes.push(item.comercio);
  return partes.join(" · ");
}

function syncCaption() {
  const queue = getSyncQueue();
  const pendientes = queue.filter((q) => q.estado === "pendiente").length;
  if (pendientes) return `${pendientes} cambios por sincronizar`;
  if (queue.some((q) => q.estado === "error")) return "Guardado aquí · se sincronizará al reconectar";
  return "Guardado en este dispositivo";
}

function renderListas() {
  const listaId = getListaActivaId();
  const listas = getListas();
  const activa = listas.find((l) => l.id === listaId);
  const items = getLista(listaId);
  const activos = items.filter((i) => i.estado_compra !== "aplazado");
  const aplazados = items.filter((i) => i.estado_compra === "aplazado");
  const otras = listas.filter((l) => l.estado === "activa" && l.id !== listaId);
  const t = calcularTotales(listaId);

  const itemRow = (item, idx = 0) => {
    const b = badgeItem(item);
    return `
      <button class="list-row ${item.estado_compra === "en_carrito" ? "strike" : ""}" data-item="${item.id}" style="--stagger:${Math.min(idx, 8) * 40}ms">
        <span class="row-main">
          <span class="row-title">${esc(item.nombre)}</span>
          <span class="row-meta">${esc(metaItem(item))}</span>
        </span>
        <span class="row-end">
          <span class="badge ${b.cls}">${b.txt}</span>
          <div class="item-price ${b.precioCls} tabular">${b.pre}${fmt(b.precio)}</div>
        </span>
      </button>`;
  };

  $("#listasContainer").innerHTML = `
    <div class="card block">
      <div style="display:flex; align-items:center; gap:10px">
        <div style="flex:1; min-width:0">
          <p class="title" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(activa?.nombre || "Mi lista")}</p>
          <p class="micro" style="margin-top:2px">Lista activa</p>
        </div>
        <button class="icon-btn" id="listaOpciones" aria-label="Opciones de la lista">⋯</button>
      </div>
      <div class="totals-strip tabular">
        <div class="t-estimado"><div class="t-label">Estimado</div><div class="t-value">${fmt(t.totalEstimado)}</div></div>
        <div class="t-verificado"><div class="t-label">Verificado</div><div class="t-value">${fmt(t.totalVerificado)}</div></div>
        <div class="t-facturado"><div class="t-label">Facturado</div><div class="t-value ${t.totalFacturado === null ? "pending" : ""}">${t.totalFacturado === null ? "-" : fmt(t.totalFacturado)}</div></div>
      </div>
      <p class="micro" style="margin-top:10px">El precio verificado en góndola aún puede cambiar en caja; el facturado es el definitivo.</p>
    </div>

    ${activos.length
      ? activos.map((it, i) => itemRow(it, i)).join("")
      : `<div class="empty-state block"><p>Esta lista está vacía.</p><button class="btn btn-tonal" id="emptyAddItem">${icon("plus")} Agregar el primer item</button></div>`}

    ${aplazados.length ? `
      <p class="block-label" style="margin-top:20px">Para después</p>
      ${aplazados.map((it, i) => itemRow(it, activos.length + i)).join("")}` : ""}

    <div class="button-col" style="margin-top:20px">
      ${activos.length ? `<button class="btn btn-block" id="addItemBtn">${icon("plus")} Agregar item</button>` : ""}
      ${activos.length ? `<button class="btn btn-ghost btn-block" id="cerrarCompraBtn">Cerrar compra</button>` : ""}
    </div>

    ${otras.length ? `
      <p class="block-label" style="margin-top:28px">Otras listas</p>
      ${otras.map((l) => {
        const n = getLista(l.id).filter((i) => i.estado_compra !== "aplazado").length;
        return `
          <button class="list-row" data-lista="${l.id}">
            <span class="row-main">
              <span class="row-title">${esc(l.nombre)}</span>
              <span class="row-meta">${n} ${n === 1 ? "item" : "items"} · toca para activar</span>
            </span>
            <span class="row-end" style="color:var(--ink-3)">${icon("chevron")}</span>
          </button>`;
      }).join("")}` : ""}

    <div class="button-row" style="margin-top:16px">
      <button class="btn btn-tonal" id="nuevaListaBtn">${icon("plus")} Nueva lista</button>
    </div>
    <p class="micro" style="margin-top:20px; text-align:center">${syncCaption()}</p>`;

  $("#listaOpciones").addEventListener("click", () => openOpcionesListaSheet(activa));
  $("#addItemBtn")?.addEventListener("click", () => openAddItemSheet());
  $("#emptyAddItem")?.addEventListener("click", () => openAddItemSheet());
  $("#cerrarCompraBtn")?.addEventListener("click", openCerrarCompraSheet);
  $("#nuevaListaBtn").addEventListener("click", openNuevaListaSheet);
  $$("[data-item]").forEach((el) => el.addEventListener("click", () => {
    const item = getLista().find((i) => i.id === el.dataset.item);
    if (item) openItemSheet(item);
  }));
  $$("[data-lista]").forEach((el) => el.addEventListener("click", () => {
    setListaActiva(el.dataset.lista);
    toast("Lista activada");
    renderListas();
  }));
}

function openNuevaListaSheet() {
  openSheet(`
    <h2 class="sheet-title">Nueva lista</h2>
    <p class="sheet-sub">Puedes tener varias listas a la vez, por ejemplo por tienda o por ocasión.</p>
    <div class="field"><label for="nlNombre">Nombre</label><input class="input" id="nlNombre" placeholder="Ej. Mercado semanal"></div>
    <div class="button-col">
      <button class="btn btn-block" id="nlCrear">Crear y activar</button>
      <button class="btn btn-quiet" id="nlCancelar">Cancelar</button>
    </div>`);
  $("#nlCrear", sheetContent).addEventListener("click", () => {
    const nombre = $("#nlNombre", sheetContent).value.trim();
    crearLista(nombre || "Nueva lista");
    closeSheet();
    toast("Lista creada");
    renderView(state.view);
  });
  $("#nlCancelar", sheetContent).addEventListener("click", closeSheet);
}

function openOpcionesListaSheet(lista) {
  if (!lista) return;
  openSheet(`
    <h2 class="sheet-title">${esc(lista.nombre)}</h2>
    <p class="sheet-sub">Opciones de la lista activa.</p>
    <div class="field"><label for="olNombre">Renombrar</label><input class="input" id="olNombre" value="${esc(lista.nombre)}"></div>
    <div class="button-col">
      <button class="btn btn-block" id="olGuardar">Guardar nombre</button>
      <button class="btn btn-ghost btn-block" id="olDuplicar">Duplicar lista</button>
      <button class="btn btn-quiet" id="olCancelar">Cancelar</button>
    </div>`);
  $("#olGuardar", sheetContent).addEventListener("click", () => {
    const nombre = $("#olNombre", sheetContent).value.trim();
    if (nombre) renombrarLista(lista.id, nombre);
    closeSheet(); renderListas();
  });
  $("#olDuplicar", sheetContent).addEventListener("click", () => {
    duplicarLista(lista.id);
    closeSheet(); toast("Lista duplicada y activada"); renderListas();
  });
  $("#olCancelar", sheetContent).addEventListener("click", closeSheet);
}

// --------------------------- Item: agregar / editar -------------------------

/**
 * Wizard multi-paso tipo Airbnb para agregar items.
 * Flujo: nombre → precio → cantidad → contenido → resumen → confirmar
 */
function openAddItemSheet(prefill = {}) {
  const wizard = {
    step: 0,
    datos: {
      nombre: prefill.nombre || "",
      precio: prefill.precio ?? null,
      cantidad: prefill.cantidad || 1,
      contenido: prefill.contenido ?? null,
      unidad_medida: prefill.unidad_medida || "g",
    },
  };

  const renderStep = () => {
    const paso = wizard.step;
    const d = wizard.datos;
    const valid = paso === 0 ? d.nombre.trim().length >= 2
      : paso === 1 ? d.precio && d.precio > 0
        : paso === 2 ? d.cantidad > 0
          : paso === 3 ? !d.contenido || d.contenido > 0
            : true;

    // Update progress
    const steps = sheetContent.querySelectorAll(".wizard-progress .step");
    steps.forEach((el, i) => {
      el.classList.toggle("active", i === paso);
      el.classList.toggle("done", i < paso);
    });

    // Show/hide screens
    const screens = sheetContent.querySelectorAll(".wizard-screen");
    screens.forEach((el, i) => {
      el.classList.toggle("active", i === paso);
    });

    // Update buttons
    const btnNext = sheetContent.querySelector("#wizardSiguiente");
    const btnPrev = sheetContent.querySelector("#wizardAnterior");
    if (btnNext) btnNext.disabled = !valid;
    if (btnPrev) btnPrev.style.display = paso === 0 ? "none" : "block";
  };

  const avanzar = () => {
    if (wizard.step < 4) {
      wizard.step++;
      renderStep();
      setTimeout(() => {
        const input = sheetContent.querySelector(".input-hero");
        if (input) input.focus();
      }, 50);
    }
  };

  const retroceder = () => {
    if (wizard.step > 0) {
      wizard.step--;
      renderStep();
    }
  };

  const guardar = () => {
    const contenido = Number(wizard.datos.contenido || 0);
    guardarProducto({
      nombre: wizard.datos.nombre.trim() || "Producto",
      cantidad: wizard.datos.cantidad,
      precio_estimado: wizard.datos.precio,
      contenido: contenido > 0 ? contenido : null,
      unidad_medida: contenido > 0 ? wizard.datos.unidad_medida : null,
      estado_precio: "estimado",
      fuente: prefill.fuente || "manual",
    });
    closeSheet();
    toast("Item agregado");
    renderView(state.view);
  };

  openSheet(`
    <div class="wizard-container">
      <h2 class="sheet-title">Agregar item</h2>

      <div class="wizard-progress">
        <div class="step"></div>
        <div class="step"></div>
        <div class="step"></div>
        <div class="step"></div>
        <div class="step"></div>
      </div>

      <!-- Paso 0: Nombre -->
      <div class="wizard-screen" data-step="0">
        <div class="wizard-content">
          <div>
            <div class="wizard-field-hero">
              <label class="label">¿Qué producto?</label>
              <input class="input-hero" id="wzNombre" type="text"
                value="${esc(wizard.datos.nombre)}"
                placeholder="Leche, pan, café…"
                maxlength="50">
              <div class="wizard-hint">Por ejemplo: "Leche entera 1L" o "Pan integral"</div>
            </div>
            <p class="micro" id="wzVozEstado" style="margin-top:12px"></p>
          </div>
          <button class="icon-btn" id="wzVoz" aria-label="Dictar" style="align-self:flex-end; margin:12px 0 0">${icon("mic")}</button>
        </div>
      </div>

      <!-- Paso 1: Precio -->
      <div class="wizard-screen" data-step="1">
        <div class="wizard-content">
          <div style="text-align:center">
            <p class="sheet-sub">Precio total</p>
            <div style="margin:32px 0">
              <div class="wizard-big-number">
                <span>$</span>
                <input class="input-hero" id="wzPrecio" type="number"
                  value="${wizard.datos.precio ?? ""}"
                  placeholder="0.00"
                  step="0.01" min="0" max="9999"
                  inputmode="decimal"
                  style="width:120px; text-align:center">
              </div>
            </div>
            <div class="wizard-hint">Precio que viste en la etiqueta</div>
          </div>
        </div>
      </div>

      <!-- Paso 2: Cantidad -->
      <div class="wizard-screen" data-step="2">
        <div class="wizard-content">
          <div style="text-align:center">
            <p class="sheet-sub">¿Cuántos vas a llevar?</p>
            <div style="margin:40px 0 32px">
              <div class="wizard-big-number">
                <input class="input-hero" id="wzCantidad" type="number"
                  value="${wizard.datos.cantidad}"
                  placeholder="1"
                  step="1" min="1" max="99"
                  inputmode="numeric"
                  style="width:90px; text-align:center">
                <span class="unit">unid.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Paso 3: Contenido (opcional) -->
      <div class="wizard-screen" data-step="3">
        <div class="wizard-content">
          <div>
            <p class="sheet-sub">¿Cuánto contiene cada uno? (opcional)</p>
            <div class="wizard-field-hero" style="margin-top:24px">
              <label class="label">Contenido por envase</label>
              <div style="display:grid; grid-template-columns:1fr auto; gap:12px">
                <input class="input-hero" id="wzContenido" type="number"
                  value="${wizard.datos.contenido ?? ""}"
                  placeholder="170"
                  step="any" min="0" max="9999"
                  inputmode="decimal"
                  style="grid-column:1">
                <select class="input-hero" id="wzUnidad" style="grid-column:2; width:90px; text-align:center">
                  <option value="g" ${wizard.datos.unidad_medida === "g" ? "selected" : ""}>g</option>
                  <option value="ml" ${wizard.datos.unidad_medida === "ml" ? "selected" : ""}>ml</option>
                  <option value="unidad" ${wizard.datos.unidad_medida === "unidad" ? "selected" : ""}>un.</option>
                </select>
              </div>
              <div class="wizard-hint">Lo usa para calcular precio por 100g/ml</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Paso 4: Resumen -->
      <div class="wizard-screen" data-step="4">
        <div class="wizard-content">
          <div>
            <p class="sheet-sub">¿Todo correcto?</p>
            <div class="wizard-summary">
              <div class="wizard-summary-row">
                <strong>Producto</strong>
                <span class="value">${esc(wizard.datos.nombre)}</span>
              </div>
              <div class="wizard-summary-row">
                <strong>Precio</strong>
                <span class="value">${fmt(wizard.datos.precio)}</span>
              </div>
              <div class="wizard-summary-row">
                <strong>Cantidad</strong>
                <span class="value">${wizard.datos.cantidad} unid.</span>
              </div>
              ${wizard.datos.contenido ? `
                <div class="wizard-summary-row">
                  <strong>Contenido</strong>
                  <span class="value">${wizard.datos.contenido} ${wizard.datos.unidad_medida}</span>
                </div>` : ""}
            </div>
          </div>
        </div>
      </div>

      <!-- Botones de navegación -->
      <div class="wizard-actions">
        <button class="btn btn-ghost btn-back" id="wizardAnterior" aria-label="Anterior">${icon("back")}</button>
        <button class="btn btn-block" id="wizardSiguiente">Siguiente</button>
      </div>
    </div>`);

  // Setup listeners - usar querySelector para evitar problemas
  configurarDictado();

  const inNombre = sheetContent.querySelector("#wzNombre");
  const inPrecio = sheetContent.querySelector("#wzPrecio");
  const inCantidad = sheetContent.querySelector("#wzCantidad");
  const inContenido = sheetContent.querySelector("#wzContenido");
  const inUnidad = sheetContent.querySelector("#wzUnidad");
  const btnAnt = sheetContent.querySelector("#wizardAnterior");
  const btnSig = sheetContent.querySelector("#wizardSiguiente");

  if (inNombre) {
    inNombre.addEventListener("input", (e) => { wizard.datos.nombre = e.target.value; });
    inNombre.addEventListener("keypress", (e) => { if (e.key === "Enter") avanzar(); });
  }
  if (inPrecio) {
    inPrecio.addEventListener("input", (e) => { wizard.datos.precio = e.target.value ? parseNumero(e.target.value) : null; });
    inPrecio.addEventListener("keypress", (e) => { if (e.key === "Enter") avanzar(); });
  }
  if (inCantidad) inCantidad.addEventListener("input", (e) => { wizard.datos.cantidad = Math.max(1, Number(e.target.value || 1)); });
  if (inContenido) inContenido.addEventListener("input", (e) => { wizard.datos.contenido = e.target.value ? parseNumero(e.target.value) : null; });
  if (inUnidad) inUnidad.addEventListener("change", (e) => { wizard.datos.unidad_medida = e.target.value; });

  if (btnAnt) btnAnt.addEventListener("click", retroceder);
  if (btnSig) btnSig.addEventListener("click", () => { wizard.step === 4 ? guardar() : avanzar(); });

  renderStep();
  setTimeout(() => inNombre?.focus(), 50);
}

function configurarDictado() {
  const btn = $(“#wzVoz”, sheetContent);
  const estado = $(“#wzVozEstado”, sheetContent);
  if (!btn || !estado) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.style.display = “none”;
    return;
  }
  let escuchando = false;
  let rec = null;
  btn.addEventListener(“click”, () => {
    if (escuchando) { rec?.stop(); return; }
    rec = new SR();
    rec.lang = “es-EC”;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    escuchando = true;
    estado.innerHTML = `Escuchando…`;
    rec.onresult = (ev) => {
      const datos = parseVoz(ev.results[0][0].transcript);
      if (datos.nombre) $(“#wzNombre”, sheetContent).value = datos.nombre;
      if (datos.precio !== null) $(“#wzPrecio”, sheetContent).value = datos.precio;
      if (datos.cantidad > 1) $(“#wzCantidad”, sheetContent).value = datos.cantidad;
      estado.textContent = `Escuché: “${ev.results[0][0].transcript}”`;
    };
    rec.onerror = (ev) => {
      estado.textContent = ev.error === “not-allowed”
        ? “Micrófono bloqueado”
        : "No se pudo escuchar. Intenta otra vez.";
    };
    rec.onend = () => { escuchando = false; };
    rec.start();
  });
}

function parseVoz(texto) {
  const lower = texto.toLowerCase();
  const numeros = lower.match(/\d+[.,]?\d*/g) || [];
  let precio = null, cantidad = 1;
  if (numeros.length) {
    precio = Number(numeros[numeros.length - 1].replace(",", "."));
    if (lower.includes("centavo")) precio /= 100;
    if (numeros.length > 1) cantidad = Number(numeros[0].replace(",", "."));
  }
  const nombre = lower
    .replace(/agregar|kilos?|kilo|libras?|libra|d[oó]lares?|centavos?|\ba\b|\bde\b/g, " ")
    .replace(/\d+[.,]?\d*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { nombre: nombre || texto, precio, cantidad };
}

// ------------------------------ Item: detalle -------------------------------

function openItemSheet(item) {
  const b = badgeItem(item);
  const aplazado = item.estado_compra === "aplazado";
  const enCarrito = item.estado_compra === "en_carrito";
  openSheet(`
    <h2 class="sheet-title">${esc(item.nombre)}</h2>
    <p class="sheet-sub">${esc(metaItem(item))} · <span class="badge ${b.cls}">${b.txt}</span></p>

    <div class="field">
      <label for="itPrecio">Precio visto en la tienda</label>
      <input class="input tabular" id="itPrecio" type="number" inputmode="decimal" step="0.01" min="0" value="${(item.precio_verificado ?? item.precio_estimado ?? 0).toFixed(2)}">
      <p class="micro" style="margin-top:6px">Es el precio de góndola: puede variar en caja por promociones o errores de etiqueta.</p>
    </div>
    <div class="button-col">
      <button class="btn btn-block" id="itVerificar">Guardar precio verificado</button>
      ${aplazado
        ? `<button class="btn btn-ghost btn-block" id="itReactivar">Reactivar en la lista</button>`
        : `${puedeMarcarEnCarrito(item)
            ? `<button class="btn btn-tonal btn-block" id="itCarrito">${enCarrito ? "Sacar del carrito" : "Marcar en carrito"}</button>`
            : `<p class="micro" style="text-align:center">Verifica el precio para poder marcarlo en el carrito.</p>`}
          <button class="btn btn-ghost btn-block" id="itAplazar">Comprar después</button>`}
      <button class="btn btn-danger btn-block" id="itEliminar">Eliminar de la lista</button>
      <button class="btn btn-quiet" id="itCancelar">Cancelar</button>
    </div>`);

  $("#itVerificar", sheetContent).addEventListener("click", () => {
    verificarEnTienda(item.id, Number($("#itPrecio", sheetContent).value || 0));
    closeSheet(); toast("Precio verificado en tienda"); renderListas();
  });
  $("#itCarrito", sheetContent)?.addEventListener("click", () => {
    marcarEnCarrito(item.id, !enCarrito);
    closeSheet(); renderListas();
  });
  $("#itAplazar", sheetContent)?.addEventListener("click", () => {
    aplazarItem(item.id, null);
    closeSheet(); toast("Movido a “Para después”"); renderListas();
  });
  $("#itReactivar", sheetContent)?.addEventListener("click", () => {
    reactivarItem(item.id);
    closeSheet(); renderListas();
  });
  $("#itEliminar", sheetContent).addEventListener("click", () => {
    eliminarItem(item.id);
    closeSheet(); toast("Item eliminado"); renderListas();
  });
  $("#itCancelar", sheetContent).addEventListener("click", closeSheet);
}

// ----------------------------- Cerrar compra --------------------------------

function precioReferenciaCierre(item) {
  return item.estado_precio === "verificado_en_tienda"
    ? (item.precio_verificado ?? 0)
    : (item.precio_estimado ?? 0);
}

function openCerrarCompraSheet() {
  const listaId = getListaActivaId();
  const t = calcularTotales(listaId);
  const items = getLista(listaId).filter((i) => i.estado_compra !== "aplazado");
  if (!items.length) return;

  openSheet(`
    <h2 class="sheet-title">Cerrar compra</h2>
    <p class="sheet-sub">Compara lo que pagaste contra lo verificado en tienda (${fmt(t.totalVerificado)}). Las diferencias suelen venir de promociones o ajustes en caja - no son un error tuyo.</p>
    <div class="seg" role="group" aria-label="Modo de cierre" style="margin-bottom:18px">
      <button id="ccModoTotal" aria-pressed="true">Total del recibo</button>
      <button id="ccModoItems" aria-pressed="false">Item por item</button>
    </div>
    <div id="ccTotal">
      <div class="field"><label for="ccRecibo">Total del recibo</label><input class="input tabular" id="ccRecibo" type="number" inputmode="decimal" step="0.01" min="0" value="${t.totalVerificado.toFixed(2)}"></div>
    </div>
    <div id="ccItems" hidden>
      ${items.map((i) => `
        <div class="cierre-item-row" data-cc="${i.id}">
          <div style="min-width:0">
            <div style="font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(i.nombre)}</div>
            <div class="micro tabular">x${i.cantidad} · ${i.estado_precio === "verificado_en_tienda" ? `verificado ${fmt(i.precio_verificado)}` : `estimado ~${fmt(i.precio_estimado)}`}</div>
          </div>
          <input class="input tabular cc-precio" type="number" inputmode="decimal" step="0.01" min="0" aria-label="Precio facturado de ${esc(i.nombre)}" value="${precioReferenciaCierre(i).toFixed(2)}">
          <span class="chip chip-neutro cierre-item-chip" aria-live="polite"></span>
        </div>`).join("")}
      <div style="display:flex; justify-content:space-between; margin-top:14px; font-weight:700">
        <span>Total calculado</span><span class="tabular" id="ccCalculado"></span>
      </div>
    </div>
    <div class="button-col" style="margin-top:18px">
      <button class="btn btn-block" id="ccConfirmar">Cerrar esta lista</button>
      <button class="btn btn-quiet" id="ccCancelar">Cancelar</button>
    </div>`);

  let modo = "total";
  const btnTotal = $("#ccModoTotal", sheetContent);
  const btnItems = $("#ccModoItems", sheetContent);
  function setModo(m) {
    modo = m;
    $("#ccTotal", sheetContent).hidden = m !== "total";
    $("#ccItems", sheetContent).hidden = m !== "items";
    btnTotal.setAttribute("aria-pressed", String(m === "total"));
    btnItems.setAttribute("aria-pressed", String(m === "items"));
    if (m === "items") actualizarCierre();
  }
  btnTotal.addEventListener("click", () => setModo("total"));
  btnItems.addEventListener("click", () => setModo("items"));

  function lecturas() {
    return $$("[data-cc]", sheetContent).map((row) => ({
      item: items.find((i) => i.id === row.dataset.cc),
      precio: Number($(".cc-precio", row).value || 0),
      chip: $(".cierre-item-chip", row),
    }));
  }

  function actualizarCierre() {
    let total = 0;
    lecturas().forEach(({ item, precio, chip }) => {
      total += precio * (item.cantidad || 1);
      if (item.estado_precio !== "verificado_en_tienda") {
        chip.textContent = "Sin verificar";
        chip.className = "chip chip-neutro cierre-item-chip";
        return;
      }
      const dif = precio - (item.precio_verificado ?? 0);
      if (Math.abs(dif) < 0.005) { chip.textContent = "Coincide"; chip.className = "chip chip-menos cierre-item-chip"; }
      else if (dif < 0) { chip.textContent = `−${fmt(Math.abs(dif))}`; chip.className = "chip chip-menos cierre-item-chip"; }
      else { chip.textContent = `+${fmt(dif)}`; chip.className = "chip chip-mas cierre-item-chip"; }
    });
    $("#ccCalculado", sheetContent).textContent = fmt(total);
  }
  $$(".cc-precio", sheetContent).forEach((inp) => inp.addEventListener("input", actualizarCierre));

  $("#ccConfirmar", sheetContent).addEventListener("click", () => {
    let total, baseVerificado, detalle = null;
    if (modo === "items") {
      total = 0;
      // La diferencia agregada es la suma de las diferencias por item:
      // solo los items verificados tienen una base contra la cual comparar.
      let sumaDif = 0, coinciden = 0, verificados = 0;
      lecturas().forEach(({ item, precio }) => {
        total += precio * (item.cantidad || 1);
        if (item.estado_precio === "verificado_en_tienda") {
          verificados++;
          const dif = (precio - (item.precio_verificado ?? 0)) * (item.cantidad || 1);
          sumaDif += dif;
          if (Math.abs(dif) < 0.005) coinciden++;
        }
        facturarItem(item.id, precio);
      });
      baseVerificado = total - sumaDif;
      detalle = { coinciden, verificados };
    } else {
      total = Number($("#ccRecibo", sheetContent).value || 0);
      // Base capturada al abrir el sheet, antes de facturar los items.
      baseVerificado = t.totalVerificado;
      items.forEach((i) => facturarItem(i.id, precioReferenciaCierre(i)));
    }
    const cerrada = cerrarLista(listaId, total, baseVerificado);
    closeSheet();
    mostrarResultadoCierre(cerrada, detalle);
    renderListas();
  });
  $("#ccCancelar", sheetContent).addEventListener("click", closeSheet);
}

function mostrarResultadoCierre(lista, detalle) {
  const dif = lista.diferencia_vs_verificado;
  const menos = dif <= 0;
  openSheet(`
    <h2 class="sheet-title">Compra cerrada</h2>
    <p class="sheet-sub">“${esc(lista.nombre)}” quedó archivada en el historial.</p>
    <span class="chip ${menos ? "chip-menos" : "chip-mas"}" style="font-size:14px; padding:8px 16px">
      ${menos ? `Pagaste ${fmt(Math.abs(dif))} menos de lo esperado` : `Pagaste ${fmt(dif)} más de lo esperado`}
    </span>
    ${detalle?.verificados ? `<p class="caption" style="margin-top:12px">${detalle.coinciden} de ${detalle.verificados} precios verificados coincidieron en caja.</p>` : ""}
    <div class="button-col" style="margin-top:20px">
      <button class="btn btn-block" id="rcListo">Listo</button>
    </div>`);
  $("#rcListo", sheetContent).addEventListener("click", () => { closeSheet(); goto("historial"); });
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

function renderHistorial() {
  const cerradas = getHistorialListasCerradas();
  const cont = $("#historialContainer");
  if (!cerradas.length) {
    cont.innerHTML = `
      <div class="empty-state">
        <p>Cuando cierres una compra aparecerá aquí, con lo que pagaste de verdad.</p>
        <button class="btn btn-tonal" data-goto="listas">Ir a mi lista</button>
      </div>`;
    return;
  }

  const ultimas = cerradas.slice(0, 8).reverse();
  const max = Math.max(...ultimas.map((l) => l.total_facturado_final ?? 0), 1);
  const barras = ultimas.length >= 2 ? `
    <div class="card block">
      <p class="block-label" style="margin-bottom:4px">Tendencia de gasto</p>
      <p class="micro" style="margin-bottom:12px">Total facturado de tus últimas ${ultimas.length} compras.</p>
      <div class="bars" role="img" aria-label="Gráfico de barras con el total de las últimas compras cerradas">
        ${ultimas.map((l, i) => `<div class="bar" style="height:${Math.max(6, ((l.total_facturado_final ?? 0) / max) * 100)}%; --stagger:${i * 55}ms" title="${esc(l.nombre)} · ${fmt(l.total_facturado_final)}"></div>`).join("")}
      </div>
      <div class="bars-labels">
        ${ultimas.map((l) => `<span>${new Date(l.cerrada_en ?? l.creada_en).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit" })}</span>`).join("")}
      </div>
    </div>` : "";

  cont.innerHTML = barras + cerradas.map((l, i) => {
    const dif = l.diferencia_vs_verificado ?? 0;
    const menos = dif <= 0;
    return `
      <div class="list-row" style="cursor:default; --stagger:${Math.min(i, 8) * 40}ms">
        <span class="row-main">
          <span class="row-title">${esc(l.nombre)}</span>
          <span class="row-meta">${new Date(l.cerrada_en ?? l.creada_en).toLocaleDateString("es-EC")}</span>
          <span class="chip ${menos ? "chip-menos" : "chip-mas"}" style="margin-top:6px">${menos ? `${fmt(Math.abs(dif))} menos de lo esperado` : `${fmt(dif)} más de lo esperado`}</span>
        </span>
        <span class="row-end item-price facturado tabular">${fmt(l.total_facturado_final)}</span>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

window.addEventListener("online", () => {
  sincronizarPendientes().then(() => { if (state.view === "listas") renderListas(); });
});

renderCompareRows();
goto("home");

// Hook de depuración solo en desarrollo local: permite simular capturas
// del escáner sin cámara (QA del veredicto, duplicados y carrito).
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.__quanto = { scanSession, agregarCaptura, renderScanTray, buscarItemSimilar, veredictoEscaner };
}
