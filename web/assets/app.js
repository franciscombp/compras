/**
 * Quanto - capa de UI.
 * La capa de datos vive en data/store.js (localStorage + syncQueue) y no
 * se toca desde aquí salvo por sus funciones exportadas.
 *
 * Navegación: main[data-view] con 5 pantallas (home, comparar, escanear,
 * listas, ahorro). Una acción principal por pantalla.
 */

import {
  getLista, guardarProducto, marcarEnCarrito, aplazarItem, reactivarItem,
  verificarEnTienda, facturarItem, puedeMarcarEnCarrito,
  calcularTotales, sincronizarPendientes, getSyncQueue, guardarComparacion,
  getListas, getListaActivaId, setListaActiva, crearLista, renombrarLista,
  duplicarLista, cerrarLista, getHistorialListasCerradas, eliminarItem,
  actualizarLista, setPresupuesto, getAjustes, setAjustes, exportarDatos, importarDatos,
} from "../data/store.js";
import {
  estadisticasProducto, semaforoPrecio, productosConMemoria, resumenAhorro,
  sugerenciasRecompra, consejos, resumenParaCoach, precioNormalizado,
} from "../data/ahorro.js";
import { parseNumero, parseLectura, parseEtiqueta, extraerPistas, extraerMedidaDeNombre, preprocesarEtiqueta } from "./ocr.js";
import { services, getLectorConfig, setLectorConfig, lectorDisponible } from "../data/api.js";
import { esNativo, capacidades, leerEtiquetaNativa, interpretarEtiqueta, interpretarProducto, explicarComparacion, redactarConsejo, haptico, mantenerPantalla, exportarRecordatorios, importarRecordatorios, compartir, abrirBarridoNativo, cerrarBarridoNativo, actualizarEtiquetasNativas } from "../data/nativo.js";
import { agruparEtiquetas, Seguimiento, mapearCaja, normalizadoDe, firmaDe } from "./vivo.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

if (esNativo()) document.documentElement.classList.add("nativo");

const state = {
  view: "home",
  scanReturnTo: "home",
  ahorroTab: "resumen",
  compareRows: [nuevaFilaComparacion(), nuevaFilaComparacion()],
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
  if (view === "comparar") {
    // Comparar necesita al menos dos productos: déjalos listos para llenar.
    while (state.compareRows.length < 2) state.compareRows.push(nuevaFilaComparacion());
    renderCompareRows();
  }
  if (view === "escanear") iniciarEscaneo();
  if (view === "listas") renderListas();
  if (view === "ahorro") renderAhorro();
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

  // Ajustes
  if (e.target.closest("#ajustesBtn")) {
    openAjustesSheet();
    return;
  }

  // Consejos: cada tarjeta lleva a una pantalla o agrega un producto
  const tip = e.target.closest("[data-tip-goto], [data-tip-add]");
  if (tip) {
    if (tip.dataset.tipAdd) agregarSugerido(tip.dataset.tipAdd, tip);
    else goto(tip.dataset.tipGoto);
    return;
  }

  // Recompra sugerida
  const sug = e.target.closest("[data-sug]");
  if (sug) {
    agregarSugerido(sug.dataset.sug, sug);
    return;
  }

  // Pestañas de Ahorro
  const tab = e.target.closest("#ahorroTabs [data-tab]");
  if (tab) {
    state.ahorroTab = tab.dataset.tab;
    renderAhorro();
    return;
  }

  // Escáner: configurar el lector IA
  if (e.target.closest("#lectorConfig")) {
    openLectorSheet();
    return;
  }

  // Comparador: agregar producto (y dejar el cursor listo en el precio)
  if (e.target.closest("#addCompareRow")) {
    state.compareRows.push(nuevaFilaComparacion());
    renderCompareRows();
    $(`#cmp-precio-${state.compareRows.length - 1}`)?.focus();
    return;
  }

  // Comparador: ejemplo
  if (e.target.closest("#fillExample")) {
    state.compareRows = [
      nuevaFilaComparacion({ nombre: "Atún lata suelta", precio: 1.20, cantidad: 80, unidad: "g", unidades: 1 }),
      nuevaFilaComparacion({ nombre: "Atún pack ×6", precio: 6.00, cantidad: 80, unidad: "g", unidades: 6 }),
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

  renderHomeAhorro(listaId);
  renderHomeRecompra(listaId);

  const cerradas = getHistorialListasCerradas();
  $("#homeHistorialBlock").innerHTML = cerradas.length ? `
    <p class="block-label">Última compra cerrada</p>
    <button class="list-row" data-goto="ahorro">
      <span class="row-main">
        <span class="row-title">${esc(cerradas[0].nombre)}</span>
        <span class="row-meta">${new Date(cerradas[0].cerrada_en ?? cerradas[0].creada_en).toLocaleDateString("es-EC")}</span>
      </span>
      <span class="row-end item-price facturado tabular">${fmt(cerradas[0].total_facturado_final)}</span>
    </button>` : "";
}

/** Precios por 100 g/ml suelen ser centavos: tres decimales cuando hace falta distinguirlos. */
function fmtNorm(v) {
  return v > 0 && v < 1 ? `$${v.toFixed(3)}` : fmt(v);
}

function fmtFecha(ts) {
  return new Date(ts).toLocaleDateString("es-EC", { day: "numeric", month: "short" });
}

function pct(v) {
  return `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
}

const SEM_CORTO = { bueno: "Buen precio", normal: "Habitual", caro: "Caro" };

/** Chip de semáforo para un precio (vacío si no hay memoria). */
function semChip({ nombre, precio, contenido = null, unidad = null, unidades = 1 }, { largo = false } = {}) {
  const sem = semaforoPrecio({ nombre, precio, contenido, unidad, unidades });
  if (sem.nivel === "sin_datos") return "";
  return `<span class="sem sem-${sem.nivel}" title="${esc(sem.texto)}">${largo ? esc(sem.texto) : SEM_CORTO[sem.nivel]}</span>`;
}

function tipCard(c) {
  const accion = c.accion?.agregar ? `data-tip-add="${esc(c.accion.agregar)}"` : `data-tip-goto="${esc(c.accion?.goto || "ahorro")}"`;
  return `
    <button class="tip-card tip-${c.tipo}" ${accion}>
      <span>
        <span class="tip-kind">${TIP_KIND[c.tipo] || "Consejo"}</span>
        <span class="tip-title">${esc(c.titulo)}</span>
        <span class="tip-text">${esc(c.texto)}</span>
      </span>
      <span style="color:var(--ink-3)">${c.accion?.agregar ? icon("plus") : icon("chevron")}</span>
    </button>`;
}
const TIP_KIND = { caro: "Está caro", tienda: "Dónde comprar", recompra: "Te toca reponer", subida: "Subió de precio", caja: "Revisa el recibo", gasto: "Tu mayor gasto", mes: "Este mes", inicio: "Para empezar" };

function sugChip(sg) {
  return `
    <button class="sug-chip ${sg.toca ? "toca" : ""}" data-sug="${esc(sg.nombre)}" data-precio="${sg.precioRef ?? ""}" data-contenido="${sg.contenido ?? ""}" data-unidad="${sg.unidad ?? ""}">
      <span class="sug-name">${icon("plus")} ${esc(sg.nombre)}</span>
      <span class="sug-meta">${esc(sg.motivo)}${sg.precioRef ? ` · ~${fmt(sg.precioRef)}` : ""}</span>
    </button>`;
}

/** Agrega a la lista activa un producto sugerido (recompra o consejo). */
function agregarSugerido(nombre, origen) {
  if (buscarItemSimilar(nombre)) { toast(`"${nombre}" ya está en tu lista`); return; }
  const stats = estadisticasProducto(nombre);
  const d = origen?.dataset || {};
  guardarProducto({
    nombre,
    cantidad: 1,
    contenido: Number(d.contenido) || null,
    unidad_medida: d.unidad || null,
    precio_estimado: Number(d.precio) || stats?.ultimo.precio || 0,
    estado_precio: "estimado",
    fuente: "sugerencia",
  });
  origen?.classList.add("added");
  haptico("toque");
  toast(`"${nombre}" agregado a "${nombreListaActiva()}"`);
  if (state.view === "home") renderHome();
  if (state.view === "ahorro") renderAhorro();
}

function renderHomeAhorro(listaId) {
  const box = $("#homeAhorroBlock");
  const r = resumenAhorro();
  if (!r.compras && r.observaciones < 2) {
    box.innerHTML = `
      <div class="card" style="background:linear-gradient(145deg, var(--brand-soft), var(--surface)); border-color:var(--brand-line)">
        <p class="title" style="font-size:16px">Tu guía de ahorro empieza con la primera compra</p>
        <p class="caption" style="margin-top:6px">Escanea etiquetas, verifica precios y cierra tus compras. Quanto aprende lo que sueles pagar y te avisa cuándo un precio es bueno, dónde conviene comprar y qué te toca reponer.</p>
      </div>`;
    return;
  }
  const [tip] = consejos({ listaId, limite: 1 });
  const variacion = r.variacionMes === null ? "primer mes con datos" : `${pct(r.variacionMes)} vs. mes pasado`;
  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline">
      <p class="block-label">Tu ahorro</p>
      <button class="btn-link" data-goto="ahorro" style="margin-bottom:10px">Ver todo</button>
    </div>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Este mes</div>
        <div class="kpi-value tabular">${fmt(r.gastoMes)}</div>
        <div class="kpi-sub">${esc(variacion)}</div>
      </div>
      <div class="kpi kpi-brand">
        <div class="kpi-label">Ahorrado comparando</div>
        <div class="kpi-value tabular good">${fmt(r.ahorroComparando)}</div>
        <div class="kpi-sub">${r.comparacionesConAhorro} ${r.comparacionesConAhorro === 1 ? "comparación" : "comparaciones"} · ${r.productosEnMemoria} precios en memoria</div>
      </div>
    </div>
    ${tip ? tipCard(tip) : ""}`;
}

function renderHomeRecompra(listaId) {
  const box = $("#homeRecompraBlock");
  const sugs = sugerenciasRecompra(listaId, { limite: 6 });
  box.innerHTML = sugs.length ? `
    <p class="block-label">Para volver a comprar</p>
    <div class="chip-row">${sugs.map(sugChip).join("")}</div>
    <p class="micro" style="margin-top:8px">Según lo que llevas en tus compras cerradas. Toca para agregar a "${esc(nombreListaActiva())}".</p>` : "";
}

// ---------------------------------------------------------------------------
// Comparador manual
// ---------------------------------------------------------------------------

function renderCompareRows() {
  const rows = state.compareRows;

  if (!rows.length) {
    $("#compareRows").innerHTML = `<div class="hint-card">Agrega dos o más productos para ver cuál sale más barato de verdad.</div>`;
    renderResultadosComparacion();
    return;
  }

  // Tamaños de envase más comunes por unidad: un toque en vez de teclear.
  const PRESETS_CONTENIDO = {
    g: [100, 170, 200, 250, 400, 500, 1000],
    ml: [200, 250, 330, 500, 750, 1000, 2000],
    unidad: [1, 2, 4, 6, 12],
  };

  $("#compareRows").innerHTML = rows.map((row, i) => {
    const unidad = row.unidad || "g";
    const letra = String.fromCharCode(65 + i);
    const phCant = unidad === "unidad" ? "1" : unidad === "ml" ? "500" : "100";
    const sufijo = unidad === "unidad" ? " u" : ` ${unidad}`;
    const chips = PRESETS_CONTENIDO[unidad] || PRESETS_CONTENIDO.g;
    return `
    <div class="cmp-card" data-i="${i}">
      <div class="cmp-card-top">
        <span class="cmp-badge">${letra}</span>
        <input class="cmp-name" id="cmp-nombre-${i}" data-k="nombre" value="${esc(row.nombre)}" placeholder="Nombre (opcional)" autocomplete="off" list="catalogoSug">
        ${rows.length > 1 ? `<button class="cmp-remove" data-remove="${i}" aria-label="Quitar producto ${letra}">✕</button>` : ""}
      </div>

      <div class="cmp-fields">
        <div class="cmp-fgroup">
          <span class="cmp-flabel" id="cmp-lprecio-${i}">Precio</span>
          <div class="cmp-field cmp-field-price">
            <span class="cmp-affix">$</span>
            <input class="cmp-input tabular" id="cmp-precio-${i}" data-k="precio" type="number" inputmode="decimal" step="0.01" min="0" value="${row.precio ?? ""}" placeholder="0.00" autocomplete="off" aria-labelledby="cmp-lprecio-${i}">
          </div>
        </div>
        <div class="cmp-fgroup">
          <span class="cmp-flabel" id="cmp-lcant-${i}">Contenido</span>
          <div class="cmp-field cmp-field-amount">
            <input class="cmp-input tabular" id="cmp-cantidad-${i}" data-k="cantidad" type="number" inputmode="decimal" step="any" min="0" value="${row.cantidad ?? ""}" placeholder="${phCant}" autocomplete="off" aria-labelledby="cmp-lcant-${i}">
            <select class="cmp-unit" data-k="unidad" aria-label="Unidad del producto ${letra}">
              <option value="g" ${unidad === "g" ? "selected" : ""}>g</option>
              <option value="ml" ${unidad === "ml" ? "selected" : ""}>ml</option>
              <option value="unidad" ${unidad === "unidad" ? "selected" : ""}>u</option>
            </select>
          </div>
        </div>
        <div class="cmp-fgroup">
          <span class="cmp-flabel" id="cmp-lenv-${i}">Envases</span>
          <div class="cmp-field cmp-field-packs">
            <button type="button" class="cmp-step" data-env-step="-1" aria-label="Menos envases">−</button>
            <span class="cmp-envval tabular" aria-labelledby="cmp-lenv-${i}">${row.unidades ?? 1}</span>
            <button type="button" class="cmp-step" data-env-step="1" aria-label="Más envases">+</button>
          </div>
        </div>
      </div>

      <div class="cmp-chips" role="group" aria-label="Tamaños comunes del producto ${letra}">
        ${chips.map((v) => `<button type="button" class="cmp-chip ${row.cantidad === v ? "is-sel" : ""}" data-preset="${v}">${v}${sufijo}</button>`).join("")}
      </div>

      <div class="cmp-live" data-total-row="${i}"></div>
    </div>`;
  }).join("");
  renderResultadosComparacion();
}

// Sugerencias del catálogo mientras se escribe el nombre; al elegir una,
// el contenido/unidad (y precio si el catálogo lo trae) se llenan solos.
let sugerenciasTimer = null;
let ultimasSugerencias = [];
function sugerirDelCatalogo(texto, fila) {
  clearTimeout(sugerenciasTimer);
  sugerenciasTimer = setTimeout(async () => {
    ultimasSugerencias = await services.searchProduct(texto);
    const dl = $("#catalogoSug");
    if (dl) dl.innerHTML = ultimasSugerencias.map((s) => `<option value="${esc(s.nombre)}"></option>`).join("");
  }, 180);

  // ¿Eligió una sugerencia exacta? Autollenar lo que falte.
  const elegida = ultimasSugerencias.find((s) => s.nombre === texto);
  if (elegida) {
    const row = state.compareRows[fila];
    if (elegida.contenido && !row.cantidad) {
      row.cantidad = elegida.contenido;
      row.unidad = elegida.unidad || row.unidad;
      row.unidades = elegida.envases || 1;
    }
    if (elegida.precio && !row.precio) row.precio = elegida.precio;
    renderCompareRows();
    toast(`Datos de "${elegida.nombre}" puestos`);
  }
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
  if (k === "nombre") sugerirDelCatalogo(v, i);
  renderResultadosComparacion();
});

// El <select> de unidad emite "change": re-render para actualizar el placeholder.
$("#compareRows").addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-k='unidad']");
  if (!sel) return;
  const i = Number(e.target.closest("[data-i]").dataset.i);
  state.compareRows[i].unidad = sel.value;
  renderCompareRows();
});

$("#compareRows").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (btn) {
    state.compareRows.splice(Number(btn.dataset.remove), 1);
    renderCompareRows();
    return;
  }

  const card = e.target.closest("[data-i]");
  if (!card) return;
  const i = Number(card.dataset.i);

  // Chip de tamaño común: un toque llena el contenido.
  const chip = e.target.closest("[data-preset]");
  if (chip) {
    state.compareRows[i].cantidad = Number(chip.dataset.preset);
    renderCompareRows();
    return;
  }

  // Stepper de envases: -/+ sin teclado.
  const step = e.target.closest("[data-env-step]");
  if (step) {
    const actual = state.compareRows[i].unidades ?? 1;
    state.compareRows[i].unidades = Math.min(48, Math.max(1, actual + Number(step.dataset.envStep)));
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
  // El ejemplo solo tiene sentido cuando aún no hay nada escrito.
  const hayDatos = state.compareRows.some((r) => r.nombre.trim() || r.precio || r.cantidad);
  const exampleRow = $("#fillExampleRow");
  if (exampleRow) exampleRow.style.display = hayDatos ? "none" : "";

  // Actualiza la línea en vivo de cada tarjeta sin re-renderizar los inputs.
  state.compareRows.forEach((row, i) => {
    const slot = $(`[data-total-row="${i}"]`);
    if (!slot) return;
    if (filaValida(row)) {
      const n = normalizar(row, i);
      const u = row.unidad === "unidad" ? "u" : row.unidad;
      slot.textContent = `${fmt(n.normalizado)} ${n.baseLabel} · total ${n.totalContenido} ${u}`;
      slot.classList.add("is-on");
    } else {
      const falta = [];
      if (!(row.precio > 0)) falta.push("el precio");
      if (!(row.cantidad > 0)) falta.push("el contenido");
      if (!(row.unidades > 0)) falta.push("los envases");
      slot.textContent = falta.length ? `Falta ${falta.join(" y ")}` : "";
      slot.classList.remove("is-on");
    }
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
    .map((r) => `"${esc(r.etiqueta)}" parece más barato, pero trae menos producto en total (${r.totalContenido} ${r.unidad} vs ${mejor.totalContenido} ${mejor.unidad}).`);

  box.innerHTML = `
    <div class="result-winner ${winnerNuevo ? "" : "no-anim"}">
      <span class="winner-pill">${icon("check")} Mejor compra</span>
      <p class="title" style="margin-bottom:6px">${esc(mejor.etiqueta)}</p>
      <div class="winner-price tabular"><span id="winnerPriceValue">${fmt(mejor.normalizado)}</span> <small>${mejor.baseLabel}</small></div>
      <p class="caption" style="margin-top:6px">${fmt(mejor.precio)} · ${mejor.totalContenido} ${mejor.unidad === "unidad" ? "unidades" : mejor.unidad} en total</p>
      ${mejor.etiqueta ? htmlMemoriaGanador(mejor) : ""}
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
  explicarVeredicto(norm, $(".result-winner", box));

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
    toast(`Agregado a "${nombreListaActiva()}"`);
    setTimeout(() => {
      if (document.body.contains(btn)) {
        btn.innerHTML = `${icon("plus")} Agregar a mi lista`;
        btn.disabled = false;
      }
    }, 1600);
  });
}

/** En el comparador: cómo se compara el ganador con lo que ya pagaste por ese producto. */
function htmlMemoriaGanador(mejor) {
  const sem = semaforoPrecio({ nombre: mejor.etiqueta, precio: mejor.precio, contenido: mejor.totalContenido, unidad: mejor.unidad });
  if (sem.nivel === "sin_datos") return "";
  return `<p class="caption" style="margin-top:8px"><span class="sem sem-${sem.nivel}">${SEM_CORTO[sem.nivel]}</span> ${esc(sem.texto)}</p>`;
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
const scanSession = { capturas: [], auto: false, modo: null };
let scanSeq = 0;

/**
 * Barrido en vivo (solo en la app nativa): Vision analiza el estante en
 * continuo, assets/vivo.js agrupa y sigue cada etiqueta, y las confirmadas
 * entran solas en la sesión. Apple Intelligence refina cada una después.
 */
const barrido = {
  seguimiento: new Seguimiento({ confirmarTras: 2, olvidarMs: 1500 }),
  timer: null, ocupado: false, pausado: false, frame: null, cajas: [],
  lentos: 0, fallos: 0, nivelRapido: false, statusTimer: null,
  nativoActivo: false, nativoVisitado: false,
};

function modoEscaneo() {
  if (!esNativo()) return "captura";
  if (scanSession.modo) return scanSession.modo;
  let guardado = null;
  try { guardado = localStorage.getItem("quanto.scan_modo"); } catch { /* sin storage */ }
  return guardado === "captura" ? "captura" : "barrido";
}

function setModoEscaneo(modo) {
  scanSession.modo = modo;
  try { localStorage.setItem("quanto.scan_modo", modo); } catch { /* sin storage */ }
  iniciarEscaneo();
}
let autoTimer = null;
let autoOcupado = false;
let autoLentos = 0;
let autoFirmaPrevia = null;
let autoCooldownHasta = 0;

function detenerCamara() {
  clearTimeout(autoTimer);
  autoTimer = null;
  clearTimeout(barrido.timer);
  barrido.timer = null;
  if (barrido.nativoActivo) cerrarBarridoNativo();
  barrido.nativoVisitado = false;
  mantenerPantalla(false);
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
  // blocks:true trae las cajas de cada palabra: el tamaño del texto es la
  // mejor pista para distinguir el precio del resto de números.
  const { data } = await worker.recognize(preprocesarEtiqueta(canvas), {}, { text: true, blocks: true });
  return { data, texto: data.text || "", confianza: data.confidence ?? 0 };
}

let avisoLectorIA = 0;

const FUENTES_LECTURA = { apple: "Apple Intelligence", vision: "Vision", ia: "IA", ocr: "OCR" };

/**
 * Lee la etiqueta con el mejor lector disponible, en este orden:
 *  1. nativo (Vision para el texto; Apple Intelligence para interpretarlo si
 *     el iPhone lo soporta, si no el parser local sobre el texto de Vision)
 *  2. lector IA remoto (worker/) si está configurado y hay red
 *  3. OCR local con Tesseract
 * Devuelve { datos, fuente } con fuente "apple" | "vision" | "ia" | "ocr".
 * `rapido` evita la interpretación con Apple Intelligence (auto-escaneo).
 */
async function leerDatosEtiqueta(canvas, { rapido = false } = {}) {
  if (esNativo()) {
    try {
      const r = await leerEtiquetaNativa(canvas, { rapido });
      const base = parseEtiqueta(r.texto || "", extraerPistas({ words: r.palabras || [] }));
      let datos = base, fuente = "vision";
      if (r.ia && r.ia.precio) {
        const ia = r.ia;
        const conContenido = ia.contenido && ia.unidad;
        fuente = "apple";
        datos = {
          precio: ia.precio,
          contenido: conContenido ? ia.contenido : base.contenido,
          unidad: conContenido ? ia.unidad : base.unidad,
          unidades: ia.unidades || base.unidades || 1,
          nombre: ia.nombre || base.nombre,
        };
      }
      if (r.codigo && !rapido) datos = await completarPorCodigo(datos, r.codigo);
      return { datos, fuente };
    } catch (e) {
      if (Date.now() - avisoLectorIA > 60000) {
        avisoLectorIA = Date.now();
        toast("El lector nativo falló; se usa otro lector.");
      }
    }
  }
  if (lectorDisponible()) {
    try {
      const datos = await services.leerEtiqueta(canvas);
      return { datos, fuente: "ia" };
    } catch (e) {
      // Avisa como mucho una vez por minuto para no tapar el estado de la cámara.
      if (Date.now() - avisoLectorIA > 60000) {
        avisoLectorIA = Date.now();
        toast(MENSAJES_LECTOR[e?.codigo] || "El lector IA no respondió; se usa el OCR del teléfono.");
      }
    }
  }
  const lectura = await leerEtiqueta(canvas);
  return { datos: parseLectura(lectura.data), fuente: "ocr", confianzaOcr: lectura.confianza };
}

const porCodigo = new Map();
/**
 * Si la foto traía código de barras, completa nombre y contenido desde
 * Open Food Facts o el catálogo local. El precio siempre es el de la etiqueta.
 */
async function completarPorCodigo(datos, codigo) {
  if (datos.nombre && datos.contenido) return datos;
  if (!porCodigo.has(codigo)) porCodigo.set(codigo, services.searchByBarcode(codigo).catch(() => null));
  const p = await porCodigo.get(codigo);
  if (!p) return datos;
  const out = { ...datos };
  const nombre = [p.nombre, p.marca && !String(p.nombre || "").toLowerCase().includes(String(p.marca).toLowerCase()) ? p.marca : ""].filter(Boolean).join(" ").trim();
  if (nombre && (!out.nombre || out.nombre.length < 4)) out.nombre = nombre;
  if (!out.contenido) {
    const m = p.contenido && p.unidad ? { contenido: p.contenido, unidad: p.unidad, unidades: 1 } : extraerMedidaDeNombre(p.cantidadTexto || p.nombre || "");
    if (m.contenido) { out.contenido = m.contenido; out.unidad = m.unidad; if (m.unidades > 1 && out.unidades === 1) out.unidades = m.unidades; }
  }
  return out;
}

const MENSAJES_LECTOR = {
  clave: "La clave del lector IA no coincide. Revísala en Lector IA.",
  api_key: "El Worker no tiene una API key válida de Anthropic.",
  sin_api_key: "El Worker no tiene configurada la API key de Anthropic.",
  limite: "El lector IA está saturado; se usa el OCR del teléfono por ahora.",
  timeout: "El lector IA tardó demasiado; se usa el OCR del teléfono.",
  http_403: "El Worker rechaza este origen. Revisa ORIGENES_PERMITIDOS.",
};

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
  refrescarBotonLectorIA();
  const modo = modoEscaneo();
  const selectorModo = esNativo() ? `
      <div class="modo-switch" role="tablist" aria-label="Modo de escaneo">
        <button class="stage-chip ${modo === "barrido" ? "on" : ""}" role="tab" aria-selected="${modo === "barrido"}" data-modo="barrido">Barrido ✦</button>
        <button class="stage-chip ${modo === "captura" ? "on" : ""}" role="tab" aria-selected="${modo === "captura"}" data-modo="captura">Captura</button>
      </div>` : "";
  if (modo === "barrido" && (await capacidades()).barridoNativo) { renderBarridoNativo(selectorModo); return; }
  const soporte = soporteCamara();
  if (soporte !== "ok") { renderProblemaCamara(soporte); return; }
  $("#scanStage").innerHTML = modo === "barrido" ? `
    <div class="camera-stage barrido">
      <video id="scanVideo" autoplay playsinline muted></video>
      <canvas class="scan-overlay" id="scanOverlay" aria-label="Etiquetas detectadas"></canvas>
      <div class="stage-top">${selectorModo}<button class="auto-chip" id="barridoPausa" aria-pressed="false">Pausa</button></div>
      <div class="camera-status" id="scanStatus" aria-live="polite">Pidiendo permiso de cámara…</div>
    </div>
    <p class="caption barrido-hint">Pasea la cámara por el estante: cada etiqueta de precio se agrega sola y el ganador se marca en verde. Toca una etiqueta para agregarla ya o revisarla.</p>` : `
    <div class="camera-stage">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="camera-frame" aria-hidden="true"></div>
      <div class="stage-top">${selectorModo}<button class="auto-chip" id="autoChip" aria-pressed="false" title="Captura sola cuando la lectura es estable">Auto</button></div>
      <div class="camera-status" id="scanStatus" aria-live="polite">Pidiendo permiso de cámara…</div>
    </div>
    <button class="btn btn-block" id="scanCapture" disabled style="margin-top:12px">${icon("camera")} Capturar etiqueta</button>`;

  $$("[data-modo]", $("#scanStage")).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.modo !== modo) setModoEscaneo(b.dataset.modo);
  }));

  const video = $("#scanVideo");
  try {
    camaraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    if (state.view !== "escanear") { detenerCamara(); return; }
    video.srcObject = camaraStream;
    await video.play().catch(() => {});
    mantenerPantalla(true);
    if (modo === "barrido") {
      setScanStatus("Buscando etiquetas de precio…");
      iniciarBarrido();
    } else {
      setScanStatus("Encuadra el precio y captura - puedes tomar varias seguidas.");
      $("#scanCapture").disabled = false;
      if (!esNativo()) getOcrWorker().catch(() => {}); // precalienta Tesseract; en nativo lee Vision
    }
  } catch (err) {
    detenerCamara();
    renderProblemaCamara(PROBLEMAS_CAMARA[err.name] ? err.name : "generico");
    return;
  }

  $("#scanCapture")?.addEventListener("click", () => capturarEtiqueta());
  $("#autoChip")?.addEventListener("click", () => setAuto(!scanSession.auto));
  $("#barridoPausa")?.addEventListener("click", () => setBarridoPausa(!barrido.pausado));
  $("#scanOverlay")?.addEventListener("pointerdown", tocarOverlay);
}

// ------------------------- Barrido con cámara nativa -------------------------
// La cámara, Vision y el seguimiento corren en SwiftUI (native/ios/App/App/
// Barrido*.swift). Aquí llega cada etiqueta confirmada: se parsea con el mismo
// parser, entra en la bandeja y se devuelve al overlay el precio por 100 g.

function renderBarridoNativo(selectorModo) {
  $("#scanStage").innerHTML = `
    <div class="card barrido-nativo">
      <div class="stage-top" style="position:static; justify-content:flex-start; margin-bottom:12px">${selectorModo}</div>
      <p class="title" style="font-size:16px">Barrido con la cámara nativa ✦</p>
      <p class="caption" style="margin-top:6px">Se abre a pantalla completa. Pasea la cámara por el estante: cada etiqueta de precio se agrega sola, el ganador se marca en verde y vuelves aquí con todo listo para comparar.</p>
      <button class="btn btn-block" id="abrirBarrido" style="margin-top:14px">${icon("camera")} Abrir cámara</button>
      <p class="micro" id="scanStatus" aria-live="polite" style="margin-top:10px; text-align:center"></p>
    </div>`;
  $$("[data-modo]", $("#scanStage")).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.modo !== modoEscaneo()) setModoEscaneo(b.dataset.modo);
  }));
  $("#abrirBarrido").addEventListener("click", lanzarBarridoNativo);
  if (!barrido.nativoVisitado) { barrido.nativoVisitado = true; lanzarBarridoNativo(); }
  else setScanStatus(scanSession.capturas.length ? `${scanSession.capturas.length} etiquetas en la bandeja.` : "");
}

async function lanzarBarridoNativo() {
  if (barrido.nativoActivo) return;
  barrido.nativoActivo = true;
  setScanStatus("Abriendo la cámara…");
  try {
    const ok = await abrirBarridoNativo({
      onEtiqueta: incorporarEtiquetaNativa,
      onToque: ({ id } = {}) => {
        const cap = scanSession.capturas.find((c) => c.nativoIds?.includes(id));
        if (!cap) return;
        cerrarBarridoNativo();
        setTimeout(() => openCapturaSheet(cap), 350);
      },
      onCerrado: () => {
        barrido.nativoActivo = false;
        renderScanTray();
        setScanStatus(scanSession.capturas.length ? `${scanSession.capturas.length} etiquetas en la bandeja · abre la cámara para seguir.` : "Abre la cámara para empezar.");
      },
    });
    if (!ok) { barrido.nativoActivo = false; setScanStatus("La cámara nativa no está disponible aquí."); }
  } catch (e) {
    barrido.nativoActivo = false;
    setScanStatus(e?.codigo === "sin_permiso" ? "Permite la cámara en Ajustes > Quanto." : "No se pudo abrir la cámara nativa.");
  }
}

function incorporarEtiquetaNativa(e) {
  const datos = parseEtiqueta(e?.texto || "", extraerPistas({ words: e?.palabras || [] }));
  if (datos.precio === null && e?.precio > 0) datos.precio = e.precio;
  if (datos.precio === null) return;
  const firma = firmaDe(datos);
  // La cámara puede volver a entregar la misma etiqueta con otro id (la firma
  // nativa es más laxa que la de aquí): se conservan todos sus ids.
  const repetida = scanSession.capturas.find((c) => c.firma === firma);
  if (repetida) {
    repetida.nativoIds = [...new Set([...(repetida.nativoIds || []), e.id])];
    enviarChipsNativos();
    return;
  }
  const cap = agregarCaptura(datos, e.miniatura || miniaturaVacia());
  cap.firma = firma;
  cap.texto = e.texto || "";
  cap.fuente = "vision";
  cap.nativoIds = [e.id];
  enviarChipsNativos();
  refinarConIA(cap);
}

/** Le dice al overlay nativo qué mostrar sobre cada etiqueta ya analizada. */
function enviarChipsNativos() {
  if (!barrido.nativoActivo) return;
  const mejorFirma = veredictoEscaner()?.mejor.cap.firma;
  actualizarEtiquetasNativas(scanSession.capturas.flatMap((c) => {
    const norm = normalizadoDe(c);
    const medida = c.unidad === "unidad" ? "u" : `100 ${c.unidad}`;
    const chip = norm ? `${fmtNorm(norm)} / ${medida}` : `${fmt(c.precio)} · ¿gramaje?`;
    const estado = c.firma === mejorFirma ? "mejor" : norm ? "ok" : "sinGramaje";
    return (c.nativoIds || []).map((id) => ({ id, chip, estado }));
  }));
}

function miniaturaVacia() {
  const c = document.createElement("canvas");
  c.width = 180; c.height = 62;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1b1d1a";
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// ------------------------------ Barrido en vivo ------------------------------

function iniciarBarrido() {
  barrido.seguimiento.reiniciar();
  barrido.pausado = false;
  barrido.lentos = 0;
  barrido.fallos = 0;
  barrido.cajas = [];
  programarBarrido(250);
}

function programarBarrido(ms = 60) {
  clearTimeout(barrido.timer);
  if (modoEscaneo() !== "barrido" || state.view !== "escanear") return;
  barrido.timer = setTimeout(cicloBarrido, ms);
}

/** Fotograma completo (sin recorte) reducido a `anchoMax` para el barrido. */
function capturarFrameCompleto(anchoMax = 1024) {
  const video = $("#scanVideo");
  if (!video || !video.videoWidth) return null;
  const escala = Math.min(1, anchoMax / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function cicloBarrido() {
  if (state.view !== "escanear" || !camaraStream || modoEscaneo() !== "barrido") return;
  if (barrido.pausado || barrido.ocupado) { programarBarrido(150); return; }
  barrido.ocupado = true;
  try {
    const frame = capturarFrameCompleto(1024);
    if (!frame) return;
    const t0 = performance.now();
    const r = await leerEtiquetaNativa(frame, { rapido: true, nivelRapido: barrido.nivelRapido, ladoMax: 1024 });
    const duracion = performance.now() - t0;
    if (!r) return;
    // Si Vision tarda en este iPhone, baja al nivel rápido (precios grandes se leen igual).
    if (duracion > 1200 && !barrido.nivelRapido && ++barrido.lentos >= 2) barrido.nivelRapido = true;

    const regiones = agruparEtiquetas(r.lineas || [], r.palabras || []);
    const { visibles, nuevasConfirmadas } = barrido.seguimiento.actualizar(regiones, Date.now());
    barrido.frame = { w: frame.width, h: frame.height, canvas: frame };
    dibujarOverlay(visibles);
    nuevasConfirmadas.forEach((p) => incorporarPista(p, frame));
    if (!nuevasConfirmadas.length && !barrido.statusTimer) setScanStatus(resumenBarrido(visibles));
    barrido.fallos = 0;
  } catch (e) {
    if (++barrido.fallos >= 3) {
      setScanStatus("El barrido falló en este dispositivo. Cambia a Captura.");
      barrido.ocupado = false;
      return;
    }
  } finally {
    barrido.ocupado = false;
  }
  programarBarrido(60);
}

function resumenBarrido(visibles) {
  const n = scanSession.capturas.length;
  const ver = veredictoEscaner();
  if (ver) return `${n} etiquetas · conviene ${ver.mejor.etiqueta} (${fmt(ver.mejor.normalizado)} ${ver.mejor.baseLabel})`;
  if (n === 1) return "1 etiqueta · sigue hasta la siguiente para comparar";
  if (n > 1) return `${n} etiquetas · falta el gramaje de alguna: tócala para completarlo`;
  return visibles.length ? "Etiqueta a la vista… mantén un instante" : "Buscando etiquetas de precio…";
}

function setBarridoPausa(on) {
  barrido.pausado = on;
  const chip = $("#barridoPausa");
  if (chip) {
    chip.textContent = on ? "Seguir" : "Pausa";
    chip.setAttribute("aria-pressed", String(on));
    chip.classList.toggle("on", on);
  }
  setScanStatus(on ? "En pausa: toca una etiqueta para revisarla o agregarla." : resumenBarrido(barrido.seguimiento.pistas));
  if (!on) programarBarrido(0);
}

function capturaDePista(p) {
  return scanSession.capturas.find((c) => c.firma === p.firma) || null;
}

/** Recorte de la etiqueta en el fotograma, con un poco de aire, para la miniatura. */
function recortarRegion(frame, bbox) {
  const pad = Math.max(8, (bbox.y1 - bbox.y0) * 0.25);
  const x0 = Math.max(0, bbox.x0 - pad), y0 = Math.max(0, bbox.y0 - pad);
  const x1 = Math.min(frame.width, bbox.x1 + pad), y1 = Math.min(frame.height, bbox.y1 + pad);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(x1 - x0));
  c.height = Math.max(1, Math.round(y1 - y0));
  c.getContext("2d").drawImage(frame, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function incorporarPista(p, frame) {
  if (capturaDePista(p)) return;
  const cap = agregarCaptura(p.datos, recortarRegion(frame, p.bbox));
  cap.firma = p.firma;
  cap.texto = p.texto;
  cap.fuente = "vision";
  haptico("toque");
  avisoBarrido(`Agregada: ${fmt(cap.precio)}${cap.contenido ? ` · ${cap.contenido} ${cap.unidad}` : " · sin gramaje: tócala para completarlo"}`);
  refinarConIA(cap);
}

/** Mensaje breve en el estado; luego vuelve al resumen del barrido. */
function avisoBarrido(msg) {
  setScanStatus(msg);
  clearTimeout(barrido.statusTimer);
  barrido.statusTimer = setTimeout(() => {
    barrido.statusTimer = null;
    if (modoEscaneo() === "barrido" && !barrido.pausado) setScanStatus(resumenBarrido(barrido.seguimiento.pistas));
  }, 1800);
}

/**
 * Apple Intelligence relee el texto de la etiqueta confirmada (una vez por
 * etiqueta, no por fotograma) y mejora nombre, gramaje y pack. No toca lo
 * que la persona ya corrigió a mano ni cambia el precio leído.
 */
async function refinarConIA(cap) {
  const caps = await capacidades();
  if (!caps.appleIntelligence || !cap.texto) return;
  const ia = await interpretarEtiqueta(cap.texto);
  if (!ia || cap.editada || !scanSession.capturas.includes(cap)) return;
  if (ia.nombre) cap.nombre = ia.nombre;
  if (ia.contenido && ia.unidad && (!cap.contenido || ia.confianza === "alta")) { cap.contenido = ia.contenido; cap.unidad = ia.unidad; }
  if (ia.unidades > 1 && (cap.unidades || 1) === 1) cap.unidades = ia.unidades;
  cap.fuente = "apple";
  renderScanTray();
  enviarChipsNativos();
  if (modoEscaneo() === "barrido" && !barrido.statusTimer) setScanStatus(resumenBarrido(barrido.seguimiento.pistas));
}

function tocarOverlay(e) {
  const canvas = e.currentTarget;
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = barrido.cajas.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y - 30 && y <= c.y + c.h);
  if (!hit) return;
  const pista = barrido.seguimiento.pistas.find((p) => p.id === hit.id);
  if (!pista) return;
  const cap = capturaDePista(pista);
  if (cap) { openCapturaSheet(cap); return; }
  const confirmada = barrido.seguimiento.confirmar(pista.id);
  if (confirmada && barrido.frame) incorporarPista(confirmada, barrido.frame.canvas);
}

function dibujarOverlay(visibles) {
  const canvas = $("#scanOverlay"), video = $("#scanVideo");
  if (!canvas || !video?.videoWidth || !barrido.frame) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const mejorFirma = veredictoEscaner()?.mejor.cap.firma;
  barrido.cajas = [];

  for (const p of visibles) {
    const b = mapearCaja(p.bbox, barrido.frame, { w: video.videoWidth, h: video.videoHeight }, { w: cw, h: ch });
    const pad = 6;
    const x = b.x0 - pad, y = b.y0 - pad, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
    const cap = capturaDePista(p);
    const d = cap || p.datos;
    const esMejor = Boolean(cap) && cap.firma === mejorFirma;
    const color = esMejor ? "#34c759" : cap ? "#ffffff" : "rgba(255,255,255,.6)";

    ctx.lineWidth = esMejor ? 3 : 2;
    ctx.strokeStyle = color;
    ctx.setLineDash(cap ? [] : [6, 5]);
    trazarRedondo(ctx, x, y, w, h, 10);
    ctx.stroke();
    ctx.setLineDash([]);

    const norm = normalizadoDe(d);
    const medida = d.unidad === "unidad" ? "u" : `100 ${d.unidad}`;
    const texto = norm ? `${fmt(norm)} / ${medida}` : `${fmt(d.precio)} · ¿gramaje?`;
    const chip = esMejor ? `★ Mejor · ${texto}` : cap?.fuente === "apple" ? `✦ ${texto}` : texto;
    dibujarChip(ctx, x, y, w, chip, esMejor ? "#34c759" : cap ? "#c41e1e" : "rgba(0,0,0,.55)", cw);
    barrido.cajas.push({ id: p.id, x, y, w, h });
  }
}

function trazarRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dibujarChip(ctx, x, y, w, texto, fondo, cw) {
  ctx.font = "650 13px -apple-system, system-ui, sans-serif";
  const ancho = Math.ceil(ctx.measureText(texto).width) + 18;
  const alto = 24;
  let cx = Math.min(Math.max(4, x), cw - ancho - 4);
  let cy = y - alto - 6;
  if (cy < 4) cy = y + 6; // sin sitio arriba: dentro de la caja
  ctx.fillStyle = fondo;
  trazarRedondo(ctx, cx, cy, ancho, alto, 12);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, cx + 9, cy + alto / 2 + 0.5);
}

function refrescarBotonLectorIA() {
  const b = $("#lectorConfig");
  if (!b) return;
  if (esNativo()) b.textContent = "Lector: Vision nativo ✦";
  else b.textContent = getLectorConfig().url ? "Lector IA: activado ✦" : "Lector IA: configurar";
}

/**
 * Panel para conectar el lector IA (worker/README.md): URL del Worker y clave
 * opcional. Se guarda en este dispositivo; sin URL, el escáner usa Tesseract.
 */
function openLectorSheet() {
  const cfg = getLectorConfig();
  openSheet(`
    <h2 class="sheet-title">Lector IA de etiquetas</h2>
    <p class="sheet-sub">Manda la foto a tu Worker de Cloudflare y Claude lee precio y contenido. Si no está configurado o no hay señal, se usa el OCR del teléfono. Cómo desplegarlo: carpeta <code>worker/</code> del repositorio.</p>
    <div class="field"><label for="lcUrl">URL del Worker</label><input class="input" id="lcUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://quanto-lector.tu-cuenta.workers.dev" value="${esc(cfg.url)}"></div>
    <div class="field"><label for="lcToken">Clave (opcional, la misma que LECTOR_TOKEN)</label><input class="input" id="lcToken" type="password" autocomplete="off" placeholder="Déjalo vacío si no pusiste clave" value="${esc(cfg.token)}"></div>
    <div class="button-col">
      <button class="btn btn-block" id="lcGuardar">Guardar</button>
      ${cfg.url ? `<button class="btn btn-danger btn-block" id="lcQuitar">Desactivar lector IA</button>` : ""}
      <button class="btn btn-quiet" id="lcCancelar">Cancelar</button>
    </div>`);
  const refrescar = refrescarBotonLectorIA;
  $("#lcGuardar", sheetContent).addEventListener("click", () => {
    try {
      const nueva = setLectorConfig({ url: $("#lcUrl", sheetContent).value, token: $("#lcToken", sheetContent).value });
      closeSheet(); refrescar();
      toast(nueva.url ? "Lector IA activado para este dispositivo." : "Lector IA desactivado.");
    } catch {
      toast("La URL debe empezar por https://");
    }
  });
  $("#lcQuitar", sheetContent)?.addEventListener("click", () => {
    setLectorConfig({ url: "" }); closeSheet(); refrescar(); toast("Lector IA desactivado.");
  });
  $("#lcCancelar", sheetContent).addEventListener("click", closeSheet);
}

/** Captura manual: la cámara sigue encendida para encadenar la siguiente. */
async function capturarEtiqueta() {
  const btn = $("#scanCapture");
  const canvas = capturarFrame();
  if (!canvas) return;
  flashCamara();
  if (btn) btn.disabled = true;
  setScanStatus(esNativo() ? "Leyendo etiqueta con Vision…" : lectorDisponible() ? "Leyendo etiqueta con IA…" : "Leyendo etiqueta…");
  try {
    const { datos, fuente } = await leerDatosEtiqueta(canvas);
    if (datos.precio === null && datos.contenido === null) {
      setScanStatus("No se leyó un precio - acércate a la etiqueta y captura otra vez.");
      return;
    }
    const cap = agregarCaptura(datos, canvas);
    haptico("exito");
    const sello = fuente === "ocr" ? "" : ` (${FUENTES_LECTURA[fuente]})`;
    setScanStatus(`Capturada${sello}: ${fmt(cap.precio)}${cap.contenido ? ` · ${cap.contenido} ${cap.unidad}` : ""} - lista para la siguiente.`);
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
    thumb: typeof canvas === "string" ? canvas : miniatura(canvas),
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
    const nativo = esNativo();
    let datos, confianza;
    if (nativo) {
      ({ datos } = await leerDatosEtiqueta(canvas, { rapido: true }));
      confianza = 100;
    } else {
      const lectura = await leerEtiqueta(canvas);
      datos = parseLectura(lectura.data);
      confianza = lectura.confianza;
    }
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
    if (datos.precio === null || confianza < 55) { autoFirmaPrevia = null; return; }
    const firma = `${datos.precio}|${datos.contenido ?? ""}`;
    const yaCapturada = scanSession.capturas.some(
      (c) => c.precio === datos.precio && (c.contenido ?? null) === (datos.contenido ?? null)
    );
    if (firma === autoFirmaPrevia && !yaCapturada) {
      flashCamara();
      // El OCR local detecta que la etiqueta está quieta; la lectura buena la
      // hace el lector IA cuando existe (una llamada por captura, no por ciclo).
      let finales = datos;
      if (nativo || lectorDisponible()) {
        setScanStatus(nativo ? "Auto: etiqueta estable, interpretando…" : "Auto: etiqueta estable, leyendo con IA…");
        const { datos: mejores, fuente } = await leerDatosEtiqueta(canvas);
        if ((fuente === "ia" || fuente === "apple") && mejores.precio !== null) finales = mejores;
      }
      const cap = agregarCaptura(finales, canvas);
      haptico("exito");
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

/**
 * Pide a Apple Intelligence una explicación corta del veredicto y la inserta
 * bajo el ganador. Se espera a que la comparación deje de cambiar (el
 * comparador re-renderiza en cada tecla) y la respuesta se cachea por resumen.
 */
let explicacionTimer = null;
function explicarVeredicto(norm, contenedor) {
  if (!contenedor || !esNativo()) return;
  const resumen = norm.map((r, i) =>
    `${i + 1}. ${r.etiqueta}: ${fmt(r.precio)}${r.unidades > 1 ? ` por ${r.unidades} envases` : ""}, ${r.totalContenido} ${r.unidad === "unidad" ? "unidades" : r.unidad} en total, ${fmt(r.normalizado)} ${r.baseLabel}`
  ).join("\n");
  clearTimeout(explicacionTimer);
  explicacionTimer = setTimeout(async () => {
    const caps = await capacidades();
    if (!caps.appleIntelligence) return;
    const nota = document.createElement("p");
    nota.className = "ia-nota";
    nota.textContent = "✦ Pensando…";
    contenedor.appendChild(nota);
    const r = await explicarComparacion(resumen);
    if (!document.body.contains(nota)) return;
    if (!r) { nota.remove(); return; }
    nota.innerHTML = `✦ ${r.titulo ? `<strong>${esc(r.titulo)}</strong> ` : ""}${esc(r.explicacion)}`;
  }, 700);
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
        ${c.nombre ? `<div class="sc-meta" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${c.fuente === "apple" ? "✦ " : ""}${esc(c.nombre)}</div>` : ""}
        ${c.nombre && c.precio > 0 ? `<div style="margin-top:4px">${semChip({ nombre: c.nombre, precio: c.precio, contenido: c.contenido, unidad: c.unidad, unidades: c.unidades })}</div>` : ""}
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

  if (ver) explicarVeredicto([ver.mejor, ...ver.resto], $(".result-winner", tray));

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
  toast(`En tu carrito · "${nombreListaActiva()}"`);
  renderScanTray();
}

function openDuplicadoSheet(cap, existente) {
  const enCarrito = existente.estado_compra === "en_carrito";
  openSheet(`
    <h2 class="sheet-title">${enCarrito ? "Ya está en tu carrito" : "Ya está en tu lista"}</h2>
    <p class="sheet-sub">"${esc(existente.nombre)}" ${enCarrito ? "ya está marcado en el carrito" : "está en tu lista de compras"}. ¿Qué hacemos con esta lectura de ${fmt(cap.precio)}?</p>
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
    cap.editada = true;
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
  if (item.contenido) partes.push(`${item.contenido} ${item.unidad_medida === "unidad" ? "unid." : (item.unidad_medida || "")}`.trim());
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
    const precio = item.precio_verificado ?? item.precio_estimado;
    const norm = precioNormalizado({ precio, contenido: item.contenido, unidad: item.unidad_medida });
    const porCien = norm ? ` · ${fmtNorm(norm)}/${item.unidad_medida === "unidad" ? "u" : `100 ${item.unidad_medida}`}` : "";
    return `
      <button class="list-row ${item.estado_compra === "en_carrito" ? "strike" : ""}" data-item="${item.id}" style="--stagger:${Math.min(idx, 8) * 40}ms">
        <span class="row-main">
          <span class="row-title">${esc(item.nombre)}</span>
          <span class="row-meta">${esc(metaItem(item))}${porCien}${semChip({ nombre: item.nombre, precio, contenido: item.contenido, unidad: item.unidad_medida })}</span>
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
      ${htmlPresupuesto(activa, t, activos)}
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
  $("#fijarPresupuesto")?.addEventListener("click", () => openOpcionesListaSheet(activa, { foco: "presupuesto" }));
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

/** Barra de presupuesto: lo que ya va en el carrito y lo estimado frente al tope. */
function htmlPresupuesto(lista, t, activos) {
  if (!lista?.presupuesto) {
    return `<p class="micro" style="margin-top:12px"><button class="btn-link" id="fijarPresupuesto" style="padding:0; font-size:12.5px">Fijar un presupuesto para esta compra</button></p>`;
  }
  const tope = lista.presupuesto;
  const carrito = activos.filter((i) => i.estado_compra === "en_carrito")
    .reduce((s, i) => s + ((i.precio_facturado ?? i.precio_verificado ?? i.precio_estimado ?? 0) * (i.cantidad || 1)), 0);
  const estimado = t.totalEstimado;
  const ratioC = Math.min(1, carrito / tope), ratioE = Math.min(1, estimado / tope);
  const estado = carrito > tope ? "over" : carrito > tope * 0.85 ? "warn" : "";
  const resta = tope - carrito;
  const nota = carrito > tope
    ? `Te pasas por ${fmt(carrito - tope)} con lo que ya llevas.`
    : estimado > tope
      ? `Te quedan ${fmt(resta)}. Ojo: con todo lo de la lista llegarías a ${fmt(estimado)}, ${fmt(estimado - tope)} por encima.`
      : `Te quedan ${fmt(resta)} · toda la lista cabe en el presupuesto.`;
  return `
    <div class="budget">
      <div class="budget-head"><span>Presupuesto <strong class="tabular">${fmt(tope)}</strong></span><span>En carrito <strong class="tabular">${fmt(carrito)}</strong></span></div>
      <div class="budget-track" role="progressbar" aria-valuemin="0" aria-valuemax="${tope}" aria-valuenow="${carrito.toFixed(2)}" aria-label="Gasto en carrito frente al presupuesto">
        <div class="budget-fill estimado" style="width:${(ratioE * 100).toFixed(1)}%"></div>
        <div class="budget-fill ${estado}" style="width:${(ratioC * 100).toFixed(1)}%"></div>
      </div>
      <p class="budget-note ${carrito > tope ? "over" : ""}">${nota}</p>
    </div>`;
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

function openOpcionesListaSheet(lista, { foco = null } = {}) {
  if (!lista) return;
  openSheet(`
    <h2 class="sheet-title">${esc(lista.nombre)}</h2>
    <p class="sheet-sub">Opciones de la lista activa.</p>
    <div class="field"><label for="olNombre">Nombre</label><input class="input" id="olNombre" value="${esc(lista.nombre)}" autocomplete="off"></div>
    <div class="field-grid-3" style="grid-template-columns:1fr 1fr">
      <div class="field"><label for="olTienda">Tienda</label><input class="input" id="olTienda" value="${esc(lista.comercio_principal || "")}" placeholder="Ej. Supermaxi" autocomplete="off"></div>
      <div class="field"><label for="olPresupuesto">Presupuesto</label><input class="input tabular" id="olPresupuesto" type="number" inputmode="decimal" step="1" min="0" value="${lista.presupuesto ?? ""}" placeholder="Sin tope" autocomplete="off"></div>
    </div>
    <p class="micro" style="margin:-6px 0 14px">La tienda sirve para tu memoria de precios: así sabrás dónde te sale más barato cada producto.</p>
    <div class="button-col">
      <button class="btn btn-block" id="olGuardar">Guardar</button>
      ${esNativo() ? `<button class="btn btn-tonal btn-block" id="olRecordatorios">${icon("check")} Enviar a Recordatorios</button>
      <button class="btn btn-ghost btn-block" id="olImportar">Traer pendientes de Recordatorios</button>` : ""}
      <button class="btn btn-ghost btn-block" id="olCompartir">Compartir lista${esNativo() ? " (Notas, WhatsApp…)" : ""}</button>
      <button class="btn btn-ghost btn-block" id="olDuplicar">Duplicar lista</button>
      <button class="btn btn-quiet" id="olCancelar">Cancelar</button>
    </div>`);
  $("#olGuardar", sheetContent).addEventListener("click", () => {
    const nombre = $("#olNombre", sheetContent).value.trim();
    if (nombre && nombre !== lista.nombre) renombrarLista(lista.id, nombre);
    actualizarLista(lista.id, { comercio_principal: $("#olTienda", sheetContent).value.trim() || null });
    setPresupuesto(lista.id, Number($("#olPresupuesto", sheetContent).value || 0));
    closeSheet(); renderListas();
  });
  if (foco === "presupuesto") setTimeout(() => $("#olPresupuesto", sheetContent)?.focus(), 120);
  $("#olDuplicar", sheetContent).addEventListener("click", () => {
    duplicarLista(lista.id);
    closeSheet(); toast("Lista duplicada y activada"); renderListas();
  });
  $("#olRecordatorios", sheetContent)?.addEventListener("click", () => { closeSheet(); enviarARecordatorios(lista); });
  $("#olImportar", sheetContent)?.addEventListener("click", () => { closeSheet(); traerDeRecordatorios(lista); });
  $("#olCompartir", sheetContent).addEventListener("click", () => { closeSheet(); compartirLista(lista); });
  $("#olCancelar", sheetContent).addEventListener("click", closeSheet);
}

// ------------------ Lista <-> Recordatorios / Notas / compartir --------------

function itemsExportables(lista) {
  return getLista(lista.id).filter((i) => i.estado_compra !== "aplazado");
}

function notaDeItem(i) {
  const precio = i.precio_verificado ?? i.precio_estimado;
  return [
    i.cantidad > 1 ? `×${i.cantidad}` : null,
    i.contenido ? `${i.contenido} ${i.unidad_medida}` : null,
    precio > 0 ? `~${fmt(precio)}` : null,
  ].filter(Boolean).join(" · ");
}

function textoLista(lista) {
  const items = itemsExportables(lista);
  const t = calcularTotales(lista.id);
  const lineas = items.map((i) => `• ${i.nombre}${notaDeItem(i) ? ` (${notaDeItem(i)})` : ""}`);
  return `${lista.nombre}\n${lineas.join("\n")}\n\nEstimado: ${fmt(t.totalEstimado)}\nHecho con Quanto`;
}

async function enviarARecordatorios(lista) {
  const items = itemsExportables(lista);
  if (!items.length) { toast("La lista está vacía."); return; }
  try {
    const r = await exportarRecordatorios(lista.nombre, items.map((i) => ({ nombre: i.nombre, nota: notaDeItem(i) || null })));
    if (!r) { toast("Recordatorios solo está disponible en la app de iPhone."); return; }
    haptico("exito");
    toast(r.creados ? `${r.creados} ${r.creados === 1 ? "item enviado" : "items enviados"} a Recordatorios · "${lista.nombre}"${r.omitidos ? ` (${r.omitidos} ya estaban)` : ""}` : "Todo ya estaba en Recordatorios.");
  } catch (e) {
    toast(e?.codigo === "sin_permiso" ? "Permite el acceso a Recordatorios en Ajustes > Quanto." : "No se pudo hablar con Recordatorios.");
  }
}

async function traerDeRecordatorios(lista) {
  let pendientes;
  try {
    pendientes = await importarRecordatorios(lista.nombre);
    if (pendientes && !pendientes.length) pendientes = await importarRecordatorios(null);
  } catch (e) {
    toast(e?.codigo === "sin_permiso" ? "Permite el acceso a Recordatorios en Ajustes > Quanto." : "No se pudo leer Recordatorios.");
    return;
  }
  if (!pendientes) { toast("Recordatorios solo está disponible en la app de iPhone."); return; }
  if (!pendientes.length) { toast("No hay pendientes en Recordatorios."); return; }
  const candidatos = pendientes.slice(0, 60).map((p, i) => ({ ...p, i, yaEsta: Boolean(buscarItemSimilar(p.nombre)) }));
  openSheet(`
    <h2 class="sheet-title">Traer de Recordatorios</h2>
    <p class="sheet-sub">Pendientes encontrados. Los que ya están en "${esc(lista.nombre)}" vienen desmarcados.</p>
    <div class="import-list">
      ${candidatos.map((c) => `
        <label class="import-row">
          <input type="checkbox" data-imp="${c.i}" ${c.yaEsta ? "" : "checked"}>
          <span class="row-main"><span class="row-title">${esc(c.nombre)}</span><span class="row-meta">${esc([c.lista, c.nota].filter(Boolean).join(" · "))}${c.yaEsta ? " · ya en tu lista" : ""}</span></span>
        </label>`).join("")}
    </div>
    <div class="button-col" style="margin-top:12px">
      <button class="btn btn-block" id="impAgregar">Agregar seleccionados</button>
      <button class="btn btn-quiet" id="impCancelar">Cancelar</button>
    </div>`);
  $("#impAgregar", sheetContent).addEventListener("click", () => {
    const marcados = $$("[data-imp]:checked", sheetContent).map((el) => candidatos[Number(el.dataset.imp)]);
    marcados.forEach((c) => guardarProducto({ nombre: c.nombre, cantidad: 1, precio_estimado: 0, estado_precio: "estimado", fuente: "recordatorios", lista_id: lista.id }));
    closeSheet();
    toast(marcados.length ? `${marcados.length} ${marcados.length === 1 ? "item traído" : "items traídos"} de Recordatorios` : "Nada seleccionado");
    renderListas();
  });
  $("#impCancelar", sheetContent).addEventListener("click", closeSheet);
}

async function compartirLista(lista) {
  if (!itemsExportables(lista).length) { toast("La lista está vacía."); return; }
  const r = await compartir(textoLista(lista), lista.nombre);
  if (r === "copiado") toast("Lista copiada: pégala en Notas o donde quieras.");
  else if (r === null) toast("No se pudo compartir en este navegador.");
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
    if (btnNext) { btnNext.disabled = !valid; btnNext.textContent = paso === 4 ? "Agregar a la lista" : "Siguiente"; }
    if (btnPrev) btnPrev.style.display = paso === 0 ? "none" : "block";

    if (paso === 4) {
      const resumen = sheetContent.querySelector(".wizard-summary");
      if (resumen) resumen.innerHTML = `
        <div class="wizard-summary-row"><strong>Producto</strong><span class="value">${esc(d.nombre)}</span></div>
        <div class="wizard-summary-row"><strong>Precio</strong><span class="value">${fmt(d.precio)}</span></div>
        <div class="wizard-summary-row"><strong>Cantidad</strong><span class="value">${d.cantidad} unid.</span></div>
        ${d.contenido ? `<div class="wizard-summary-row"><strong>Contenido</strong><span class="value">${d.contenido} ${d.unidad_medida}</span></div>` : ""}
        ${d.contenido && d.precio ? `<div class="wizard-summary-row"><strong>Por ${d.unidad_medida === "unidad" ? "unidad" : `100 ${d.unidad_medida}`}</strong><span class="value tabular">${fmt(d.unidad_medida === "unidad" ? d.precio / d.contenido : (d.precio / d.contenido) * 100)}</span></div>` : ""}`;
    }
  };

  /**
   * Al salir del nombre, Apple Intelligence (si existe) interpreta la frase
   * completa ("dos leches Vita de litro a 1.25") y rellena los demás pasos.
   * Solo completa lo que la persona no haya escrito ya.
   */
  let interpretando = false;
  const salirDelNombre = async () => {
    if (interpretando) return;
    const frase = wizard.datos.nombre.trim();
    const caps = await capacidades();
    const conNumeros = /\d|\b(un[oa]?|dos|tres|cuatro|cinco|seis|media|medio|litro|kilo|gramos?|centavos?)\b/i.test(frase);
    if (!caps.appleIntelligence || !conNumeros) { avanzar(); return; }
    interpretando = true;
    const btn = sheetContent.querySelector("#wizardSiguiente");
    const estado = sheetContent.querySelector("#wzVozEstado");
    if (btn) { btn.disabled = true; btn.textContent = "Interpretando ✦"; }
    const p = await interpretarProducto(frase);
    interpretando = false;
    if (btn) btn.textContent = "Siguiente";
    if (p) {
      const d = wizard.datos;
      d.nombre = p.nombre || d.nombre;
      if (p.precio && !(prefill.precio > 0)) d.precio = p.precio;
      if (p.cantidad > 1 && d.cantidad === 1) d.cantidad = p.cantidad;
      if (p.contenido && !d.contenido) { d.contenido = p.contenido; d.unidad_medida = p.unidad || d.unidad_medida; }
      const set = (id, v) => { const el = sheetContent.querySelector(id); if (el && v !== null && v !== undefined) el.value = v; };
      set("#wzNombre", d.nombre); set("#wzPrecio", d.precio); set("#wzCantidad", d.cantidad); set("#wzContenido", d.contenido); set("#wzUnidad", d.unidad_medida);
      const partes = [p.precio ? fmt(p.precio) : null, p.cantidad > 1 ? `${p.cantidad} unid.` : null, p.contenido ? `${p.contenido} ${p.unidad}` : null].filter(Boolean);
      if (estado && partes.length) estado.textContent = `✦ Apple Intelligence entendió: ${d.nombre} · ${partes.join(" · ")}. Revisa y sigue.`;
      haptico("toque");
    }
    avanzar();
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
              <p class="sheet-sub">¿Qué vamos a llevar?</p>
              <input class="input-hero" id="wzNombre" type="text"
                value="${esc(wizard.datos.nombre)}"
                placeholder="Ej. Leche entera 1L"
                maxlength="50"
                autocomplete="off">
              <div class="wizard-hint">${esNativo() ? "Dicta con el micrófono del teclado todo junto: \"dos leches Vita de litro a 1.25\"" : "Sé específico: marca, volumen, tipo"}</div>
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
            <p class="sheet-sub">¿Cuánto cuesta?</p>
            <div style="margin:32px 0">
              <div class="wizard-big-number">
                <span>$</span>
                <input class="input-hero" id="wzPrecio" type="number"
                  value="${wizard.datos.precio ?? ""}"
                  placeholder="0.00"
                  step="0.01" min="0" max="9999"
                  inputmode="decimal"
                  autocomplete="off"
                  style="width:120px; text-align:center">
              </div>
            </div>
            <div class="wizard-hint">Precio total de la etiqueta</div>
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
                <button type="button" class="wz-step" data-wz-cant="-1" aria-label="Menos unidades">−</button>
                <input class="input-hero" id="wzCantidad" type="number"
                  value="${wizard.datos.cantidad}"
                  placeholder="1"
                  step="1" min="1" max="99"
                  inputmode="numeric"
                  autocomplete="off"
                  style="width:90px; text-align:center">
                <button type="button" class="wz-step" data-wz-cant="1" aria-label="Más unidades">+</button>
              </div>
              <div class="wizard-hint" style="margin-top:10px">unidades</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Paso 3: Contenido (opcional) -->
      <div class="wizard-screen" data-step="3">
        <div class="wizard-content">
          <div>
            <p class="sheet-sub">Detalles (opcional)</p>
            <div class="wizard-field-hero" style="margin-top:24px">
              <label class="label">Contenido de cada uno</label>
              <div style="display:grid; grid-template-columns:1fr auto; gap:12px">
                <input class="input-hero" id="wzContenido" type="number"
                  value="${wizard.datos.contenido ?? ""}"
                  placeholder="170"
                  step="any" min="0" max="9999"
                  inputmode="decimal"
                  autocomplete="off"
                  style="grid-column:1">
                <select class="input-hero" id="wzUnidad" style="grid-column:2; width:90px; text-align:center">
                  <option value="g" ${wizard.datos.unidad_medida === "g" ? "selected" : ""}>g</option>
                  <option value="ml" ${wizard.datos.unidad_medida === "ml" ? "selected" : ""}>ml</option>
                  <option value="unidad" ${wizard.datos.unidad_medida === "unidad" ? "selected" : ""}>un.</option>
                </select>
              </div>
              <div class="wz-chips">
                ${[100, 170, 200, 250, 330, 500, 750, 1000].map((v) => `<button type="button" class="cmp-chip" data-wz-cont="${v}">${v}</button>`).join("")}
              </div>
              <div class="wizard-hint">Ayuda a calcular el precio real por 100g/ml</div>
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

  // Cada cambio revalida el paso: sin esto "Siguiente" se queda bloqueado.
  if (inNombre) {
    inNombre.addEventListener("input", (e) => { wizard.datos.nombre = e.target.value; renderStep(); });
    inNombre.addEventListener("keypress", (e) => { if (e.key === "Enter" && wizard.datos.nombre.trim().length >= 2) salirDelNombre(); });
  }
  if (inPrecio) {
    inPrecio.addEventListener("input", (e) => { wizard.datos.precio = e.target.value ? parseNumero(e.target.value) : null; renderStep(); });
    inPrecio.addEventListener("keypress", (e) => { if (e.key === "Enter" && wizard.datos.precio > 0) avanzar(); });
  }
  if (inCantidad) inCantidad.addEventListener("input", (e) => { wizard.datos.cantidad = Math.max(1, Number(e.target.value || 1)); renderStep(); });
  if (inContenido) inContenido.addEventListener("input", (e) => { wizard.datos.contenido = e.target.value ? parseNumero(e.target.value) : null; renderStep(); });

  // Stepper de cantidad y chips de contenido: tocar en vez de teclear.
  $$("[data-wz-cant]", sheetContent).forEach((b) => b.addEventListener("click", () => {
    wizard.datos.cantidad = Math.min(99, Math.max(1, (wizard.datos.cantidad || 1) + Number(b.dataset.wzCant)));
    if (inCantidad) inCantidad.value = wizard.datos.cantidad;
    renderStep();
  }));
  $$("[data-wz-cont]", sheetContent).forEach((b) => b.addEventListener("click", () => {
    wizard.datos.contenido = Number(b.dataset.wzCont);
    if (inContenido) inContenido.value = wizard.datos.contenido;
    renderStep();
  }));
  if (inUnidad) inUnidad.addEventListener("change", (e) => { wizard.datos.unidad_medida = e.target.value; });

  if (btnAnt) btnAnt.addEventListener("click", retroceder);
  if (btnSig) btnSig.addEventListener("click", () => { wizard.step === 4 ? guardar() : wizard.step === 0 ? salirDelNombre() : avanzar(); });

  renderStep();
  setTimeout(() => inNombre?.focus(), 50);
}

function configurarDictado() {
  const btn = $("#wzVoz", sheetContent);
  const estado = $("#wzVozEstado", sheetContent);
  if (!btn || !estado) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.style.display = "none";
    return;
  }
  let escuchando = false;
  let rec = null;
  btn.addEventListener("click", () => {
    if (escuchando) { rec?.stop(); return; }
    rec = new SR();
    rec.lang = "es-EC";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    escuchando = true;
    estado.innerHTML = `Escuchando…`;
    rec.onresult = (ev) => {
      const datos = parseVoz(ev.results[0][0].transcript);
      if (datos.nombre) $("#wzNombre", sheetContent).value = datos.nombre;
      if (datos.precio !== null) $("#wzPrecio", sheetContent).value = datos.precio;
      if (datos.cantidad > 1) $("#wzCantidad", sheetContent).value = datos.cantidad;
      estado.textContent = `Escuché: "${ev.results[0][0].transcript}"`;
    };
    rec.onerror = (ev) => {
      estado.textContent = ev.error === "not-allowed"
        ? "Micrófono bloqueado"
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

    ${htmlMemoriaItem(item)}
    <div class="field">
      <label for="itPrecio">Precio visto en la tienda</label>
      <input class="input tabular" id="itPrecio" type="number" inputmode="decimal" step="0.01" min="0" value="${(item.precio_verificado ?? item.precio_estimado ?? 0).toFixed(2)}" autocomplete="off">
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
    closeSheet(); toast('Movido a "Para después"'); renderListas();
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

/** Lo que tu memoria sabe del producto, dentro de la ficha del item. */
function htmlMemoriaItem(item) {
  const precio = item.precio_verificado ?? item.precio_estimado;
  const sem = semaforoPrecio({ nombre: item.nombre, precio, contenido: item.contenido, unidad: item.unidad_medida });
  const st = sem.stats;
  if (!st) return `<p class="micro" style="margin:-6px 0 14px">Aún no tienes precios guardados de este producto: en cuanto lo verifiques o lo escanees, Quanto lo recordará.</p>`;
  const donde = (o) => `${fmt(o.precio)}${o.tienda ? ` en ${esc(o.tienda)}` : ""} (${fmtFecha(o.fecha)})`;
  return `
    <div class="card" style="margin:-6px 0 14px; padding:12px 14px">
      <p class="micro" style="margin-bottom:4px">Tu memoria · ${st.n} ${st.n === 1 ? "precio visto" : "precios vistos"}</p>
      <p class="caption">Último: <strong>${donde(st.ultimo)}</strong> · Mínimo: <strong>${donde(st.minimo)}</strong></p>
      ${sem.nivel !== "sin_datos" ? `<p style="margin-top:8px"><span class="sem sem-${sem.nivel}">${SEM_CORTO[sem.nivel]}</span> <span class="caption">${esc(sem.texto)}</span></p>` : ""}
    </div>`;
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
    <p class="sheet-sub">"${esc(lista.nombre)}" quedó archivada en el historial.</p>
    <span class="chip ${menos ? "chip-menos" : "chip-mas"}" style="font-size:14px; padding:8px 16px">
      ${menos ? `Pagaste ${fmt(Math.abs(dif))} menos de lo esperado` : `Pagaste ${fmt(dif)} más de lo esperado`}
    </span>
    ${detalle?.verificados ? `<p class="caption" style="margin-top:12px">${detalle.coinciden} de ${detalle.verificados} precios verificados coincidieron en caja.</p>` : ""}
    <div class="button-col" style="margin-top:20px">
      <button class="btn btn-block" id="rcListo">Listo</button>
    </div>`);
  $("#rcListo", sheetContent).addEventListener("click", () => { closeSheet(); goto("ahorro"); });
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

function renderAhorro() {
  $$("#ahorroTabs [data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === state.ahorroTab)));
  const cont = $("#ahorroContainer");
  if (state.ahorroTab === "precios") { cont.innerHTML = htmlPrecios(""); conectarPrecios(cont); return; }
  if (state.ahorroTab === "compras") { cont.innerHTML = htmlCompras(); return; }
  cont.innerHTML = htmlResumen();
  pedirConsejoCoach(cont);
}

function htmlResumen() {
  const r = resumenAhorro();
  const listaId = getListaActivaId();
  if (!r.compras && r.observaciones < 2) {
    return `
      <div class="empty-state">
        <p>Aquí verás cuánto gastas, cuánto ahorras y qué precios conviene aprovechar. Todo sale de tus propias compras.</p>
        <button class="btn btn-tonal" data-goto="escanear">Escanear una etiqueta</button>
      </div>`;
  }
  const tips = consejos({ listaId, limite: 5 });
  const sugs = sugerenciasRecompra(listaId, { limite: 6 });
  const tiendas = r.tiendas.filter((t) => t.compara >= 1);
  const variacion = r.variacionMes === null ? "sin mes anterior" : `${pct(r.variacionMes)} vs. ${fmt(r.gastoAnterior)} el mes pasado`;
  const caja = r.menosQueVerificado - r.masQueVerificado;
  return `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Este mes</div><div class="kpi-value tabular">${fmt(r.gastoMes)}</div><div class="kpi-sub">${r.comprasMes} ${r.comprasMes === 1 ? "compra" : "compras"} · ${esc(variacion)}</div></div>
      <div class="kpi"><div class="kpi-label">Ticket promedio</div><div class="kpi-value tabular">${fmt(r.ticketPromedio)}</div><div class="kpi-sub">${r.compras} compras cerradas</div></div>
      <div class="kpi kpi-brand"><div class="kpi-label">Ahorrado comparando</div><div class="kpi-value tabular good">${fmt(r.ahorroComparando)}</div><div class="kpi-sub">por elegir la mejor opción en ${r.comparacionesConAhorro} ${r.comparacionesConAhorro === 1 ? "comparación" : "comparaciones"}</div></div>
      <div class="kpi"><div class="kpi-label">Góndola vs. caja</div><div class="kpi-value tabular ${caja >= 0 ? "good" : "bad"}">${caja >= 0 ? "" : "−"}${fmt(Math.abs(caja))}</div><div class="kpi-sub">${caja >= 0 ? "pagaste menos de lo verificado" : "pagaste más de lo verificado"}</div></div>
    </div>
    <div id="coachBox"></div>

    ${tips.length ? `<p class="block-label" style="margin-top:22px">Para ti</p>${tips.map(tipCard).join("")}` : ""}

    ${sugs.length ? `
      <p class="block-label" style="margin-top:22px">Te toca reponer</p>
      <div class="chip-row">${sugs.map(sugChip).join("")}</div>` : ""}

    ${tiendas.length ? `
      <p class="block-label" style="margin-top:22px">Dónde compras más barato</p>
      <div class="card">
        ${tiendas.map((t) => `
          <div class="store-row" style="display:block">
            <div style="display:flex; justify-content:space-between; gap:10px"><strong>${esc(t.tienda)}</strong><span class="caption tabular">gana en ${t.gana} de ${t.compara}</span></div>
            <div class="store-bar" style="width:${Math.max(4, Math.round(t.ratio * 100))}%; opacity:${t.ratio ? 1 : .25}"></div>
            ${t.ejemplos.length ? `<p class="micro" style="margin-top:6px">${t.ejemplos.map((e) => `${esc(e.nombre)} ${e.pct}% menos que en ${esc(e.vs)}`).join(" · ")}</p>` : ""}
          </div>`).join("")}
        <p class="micro" style="margin-top:10px">Solo cuenta productos que viste en dos o más tiendas. Pon la tienda en cada lista (⋯) para alimentar esto.</p>
      </div>` : ""}

    ${r.topGasto.length ? `
      <p class="block-label" style="margin-top:22px">En qué se te va (90 días)</p>
      <div class="card">
        ${r.topGasto.map((e) => `
          <div class="top-row">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(e.nombre)}</span>
            <span class="tabular"><strong>${fmt(e.gasto)}</strong> <span class="micro">${Math.round(e.pct * 100)}%</span></span>
            <div class="top-track"><span style="width:${Math.round(e.pct * 100)}%"></span></div>
          </div>`).join("")}
      </div>` : ""}

    ${r.frecuentes.length ? `
      <p class="block-label" style="margin-top:22px">Lo que más compras</p>
      <div class="card">
        ${r.frecuentes.map((f) => `
          <div class="hist-row">
            <span>${esc(f.nombre)}<br><span class="hist-meta">${f.veces} compras${f.intervaloDias ? ` · cada ${f.intervaloDias} días` : ""} · última hace ${f.diasDesde} d</span></span>
            <span class="tabular" style="text-align:right">${fmt(f.gasto)}<br><span class="hist-meta">${f.cantidad} unid.</span></span>
          </div>`).join("")}
      </div>` : ""}`;
}

/** Apple Intelligence redacta el consejo de la semana a partir de los números reales. */
async function pedirConsejoCoach(cont) {
  const box = $("#coachBox", cont);
  if (!box || !esNativo()) return;
  const caps = await capacidades();
  if (!caps.appleIntelligence) return;
  box.innerHTML = `<p class="ia-nota">✦ Tu coach está mirando tus números…</p>`;
  const r = await redactarConsejo(resumenParaCoach({ listaId: getListaActivaId() }));
  if (!document.body.contains(box)) return;
  box.innerHTML = r ? `<p class="ia-nota">✦ ${r.titulo ? `<strong>${esc(r.titulo)}</strong> ` : ""}${esc(r.consejo)}</p>` : "";
}

function sparkline(serie) {
  const vals = serie.slice(-10).map((o) => o.valor);
  if (vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), rango = max - min || 1;
  const w = 64, h = 26, pad = 3;
  const pts = vals.map((v, i) => [pad + (i * (w - pad * 2)) / (vals.length - 1), h - pad - ((v - min) / rango) * (h - pad * 2)]);
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2"/></svg>`;
}

function htmlPrecios(filtro) {
  const todos = productosConMemoria();
  const q = normalizarNombre(filtro);
  const lista = q ? todos.filter((s) => normalizarNombre(s.nombre).includes(q)) : todos;
  const filas = lista.map((s) => {
    const flecha = s.tendencia > 0 ? `<span class="trend-up">↑</span>` : s.tendencia < 0 ? `<span class="trend-down">↓</span>` : `<span class="trend-flat">→</span>`;
    const bajoMinimo = s.ultimo.valor <= s.minimo.valor * 1.01 && s.n > 1;
    return `
      <button class="price-row" data-clave="${esc(s.clave)}">
        <span style="min-width:0">
          <span class="pr-name">${esc(s.nombre)}</span>
          <span class="pr-meta">${s.ultimo.tienda ? `${esc(s.ultimo.tienda)} · ` : ""}${fmtFecha(s.ultimo.fecha)} · ${s.n} ${s.n === 1 ? "precio" : "precios"}${bajoMinimo ? ` · <span class="trend-down">en su mínimo</span>` : s.minimo.tienda && s.minimo.valor < s.ultimo.valor * 0.97 ? ` · mín. ${fmtNorm(s.minimo.valor)} en ${esc(s.minimo.tienda)}` : ""}</span>
        </span>
        <span class="pr-end">
          ${sparkline(s.serie)}
          <span style="text-align:right"><span class="pr-value tabular">${fmtNorm(s.ultimo.valor)} ${flecha}</span><br><span class="micro">${esc(s.base)}</span></span>
        </span>
      </button>`;
  }).join("");
  return `
    <div class="field" style="margin-bottom:12px"><input class="input" id="precioBuscar" type="search" placeholder="Buscar producto…" value="${esc(filtro)}" autocomplete="off" aria-label="Buscar en tu memoria de precios"></div>
    ${todos.length ? "" : `<div class="empty-state"><p>Todavía no hay precios guardados. Se llenan solos cuando escaneas etiquetas, verificas precios en tienda o cierras compras.</p><button class="btn btn-tonal" data-goto="escanear">Escanear una etiqueta</button></div>`}
    ${todos.length && !lista.length ? `<p class="caption">Nada coincide con "${esc(filtro)}".</p>` : ""}
    <div id="preciosLista">${filas}</div>
    ${todos.length ? `<p class="micro" style="margin-top:12px; text-align:center">${todos.length} productos · precio por 100 g/ml o por envase, según lo que sepa de cada uno.</p>` : ""}`;
}

function conectarPrecios(cont) {
  const input = $("#precioBuscar", cont);
  input?.addEventListener("input", () => {
    const pos = input.selectionStart;
    cont.innerHTML = htmlPrecios(input.value);
    conectarPrecios(cont);
    const nuevo = $("#precioBuscar", cont);
    nuevo.focus();
    nuevo.setSelectionRange(pos, pos);
  });
  $$("[data-clave]", cont).forEach((b) => b.addEventListener("click", () => {
    const st = productosConMemoria().find((s) => s.clave === b.dataset.clave);
    if (st) openPrecioSheet(st);
  }));
}

function openPrecioSheet(st) {
  const serie = [...st.serie].reverse().slice(0, 12);
  openSheet(`
    <h2 class="sheet-title">${esc(st.nombre)}</h2>
    <p class="sheet-sub">${st.n} ${st.n === 1 ? "precio visto" : "precios vistos"} · ${esc(st.base)}</p>
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi"><div class="kpi-label">Último</div><div class="kpi-value tabular">${fmtNorm(st.ultimo.valor)}</div><div class="kpi-sub">${st.ultimo.tienda ? `${esc(st.ultimo.tienda)} · ` : ""}${fmtFecha(st.ultimo.fecha)}</div></div>
      <div class="kpi"><div class="kpi-label">Mínimo</div><div class="kpi-value tabular good">${fmtNorm(st.minimo.valor)}</div><div class="kpi-sub">${st.minimo.tienda ? `${esc(st.minimo.tienda)} · ` : ""}${fmtFecha(st.minimo.fecha)}</div></div>
    </div>
    <p class="caption" style="margin-bottom:12px">Tu precio habitual: <strong class="tabular">${fmtNorm(st.habitual)}</strong> ${esc(st.base)}${st.tiendas.length > 1 ? ` · más barato en <strong>${esc(st.tiendas[0].tienda)}</strong>` : ""}</p>
    ${st.tiendas.length ? `<div class="card" style="margin-bottom:12px">${st.tiendas.map((t) => `<div class="hist-row"><span>${esc(t.tienda)}<br><span class="hist-meta">${t.n} ${t.n === 1 ? "precio" : "precios"}</span></span><span class="tabular">${fmtNorm(t.mediana)}</span></div>`).join("")}</div>` : ""}
    <div class="card">
      ${serie.map((o) => `<div class="hist-row"><span>${fmtFecha(o.fecha)}<br><span class="hist-meta">${esc(o.tienda || "sin tienda")} · ${esc(o.fuente)}</span></span><span class="tabular">${fmtNorm(o.valor)}<br><span class="hist-meta">${fmt(o.precio)} envase</span></span></div>`).join("")}
    </div>
    <div class="button-col" style="margin-top:14px">
      <button class="btn btn-tonal btn-block" id="phAgregar">${icon("plus")} Agregar a mi lista</button>
      <button class="btn btn-quiet" id="phCerrar">Cerrar</button>
    </div>`);
  $("#phAgregar", sheetContent).addEventListener("click", () => { closeSheet(); agregarSugerido(st.nombre); });
  $("#phCerrar", sheetContent).addEventListener("click", closeSheet);
}

function htmlCompras() {
  const cerradas = getHistorialListasCerradas();
  if (!cerradas.length) {
    return `
      <div class="empty-state">
        <p>Cuando cierres una compra aparecerá aquí, con lo que pagaste de verdad.</p>
        <button class="btn btn-tonal" data-goto="listas">Ir a mi lista</button>
      </div>`;
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

  return barras + cerradas.map((l, i) => {
    const dif = l.diferencia_vs_verificado ?? 0;
    const menos = dif <= 0;
    const n = getLista(l.id).filter((it) => it.estado_compra !== "aplazado").length;
    return `
      <div class="list-row" style="cursor:default; --stagger:${Math.min(i, 8) * 40}ms">
        <span class="row-main">
          <span class="row-title">${esc(l.nombre)}</span>
          <span class="row-meta">${new Date(l.cerrada_en ?? l.creada_en).toLocaleDateString("es-EC")}${l.comercio_principal ? ` · ${esc(l.comercio_principal)}` : ""} · ${n} ${n === 1 ? "item" : "items"}</span>
          <span class="chip ${menos ? "chip-menos" : "chip-mas"}" style="margin-top:6px">${menos ? `${fmt(Math.abs(dif))} menos de lo esperado` : `${fmt(dif)} más de lo esperado`}</span>
        </span>
        <span class="row-end item-price facturado tabular">${fmt(l.total_facturado_final)}</span>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function openAjustesSheet() {
  const a = getAjustes();
  const d = exportarDatos();
  openSheet(`
    <h2 class="sheet-title">Ajustes</h2>
    <p class="sheet-sub">Todo se guarda en este dispositivo. ${d.items.length} items, ${d.listas.length} listas y ${d.precios.length} precios en memoria.</p>
    <div class="field"><label for="ajTienda">Tienda habitual</label><input class="input" id="ajTienda" value="${esc(a.tienda_habitual || "")}" placeholder="Ej. Supermaxi" autocomplete="off"><p class="micro" style="margin-top:6px">Se usa cuando una lista no tiene tienda, para saber dónde viste cada precio.</p></div>
    <div class="field"><label for="ajPresupuesto">Presupuesto por defecto para listas nuevas</label><input class="input tabular" id="ajPresupuesto" type="number" inputmode="decimal" step="1" min="0" value="${a.presupuesto_defecto ?? ""}" placeholder="Sin tope" autocomplete="off"></div>
    <div class="button-col">
      <button class="btn btn-block" id="ajGuardar">Guardar</button>
      ${esNativo() ? "" : `<button class="btn btn-ghost btn-block" id="ajLector">Lector IA (Worker)</button>`}
      <button class="btn btn-ghost btn-block" id="ajExportar">${esNativo() ? "Compartir copia de seguridad" : "Descargar copia de seguridad"}</button>
      <label class="btn btn-ghost btn-block" style="cursor:pointer">Restaurar copia…<input type="file" id="ajImportar" accept="application/json,.json" hidden></label>
      <div class="seg" role="group" aria-label="Modo de restauración"><button id="ajModoFusionar" aria-pressed="true">Añadir a lo que hay</button><button id="ajModoReemplazar" aria-pressed="false">Reemplazar todo</button></div>
      <button class="btn btn-quiet" id="ajCerrar">Cerrar</button>
    </div>`);
  let modo = "fusionar";
  const setModo = (m) => {
    modo = m;
    $("#ajModoFusionar", sheetContent).setAttribute("aria-pressed", String(m === "fusionar"));
    $("#ajModoReemplazar", sheetContent).setAttribute("aria-pressed", String(m === "reemplazar"));
  };
  $("#ajModoFusionar", sheetContent).addEventListener("click", () => setModo("fusionar"));
  $("#ajModoReemplazar", sheetContent).addEventListener("click", () => setModo("reemplazar"));
  $("#ajGuardar", sheetContent).addEventListener("click", () => {
    setAjustes({ tienda_habitual: $("#ajTienda", sheetContent).value.trim(), presupuesto_defecto: Number($("#ajPresupuesto", sheetContent).value || 0) || null });
    closeSheet(); toast("Ajustes guardados"); renderView(state.view);
  });
  $("#ajLector", sheetContent)?.addEventListener("click", () => { closeSheet(); openLectorSheet(); });
  $("#ajExportar", sheetContent).addEventListener("click", async () => {
    const json = JSON.stringify(exportarDatos(), null, 0);
    const nombre = `quanto-copia-${new Date().toISOString().slice(0, 10)}.json`;
    if (esNativo()) { await compartir(json, nombre); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Copia descargada");
  });
  $("#ajImportar", sheetContent).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = importarDatos(await file.text(), modo);
      closeSheet();
      toast(`Copia restaurada: ${r.items} items, ${r.precios} precios`);
      renderView(state.view);
    } catch {
      toast("Ese archivo no es una copia de Quanto.");
    }
  });
  $("#ajCerrar", sheetContent).addEventListener("click", closeSheet);
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
  window.__quanto = { scanSession, agregarCaptura, renderScanTray, buscarItemSimilar, veredictoEscaner, importarDatos };
}
