/**
 * Capa de datos de Justo — offline-first, preparada para backend futuro.
 * V3: modelo de 3 estados de precio + listas múltiples.
 *
 * PLAN DE MIGRACIÓN:
 * Fase 1 (actual)  -> localStorage + syncQueue en localStorage.
 * Fase 2 (futura)  -> Mismos métodos, pero sincronizarPendientes() hace fetch
 *                     real contra los endpoints de docs/api-contract.md.
 * Fase 3 (futura)  -> Multiusuario con reconciliación por timestamp o CRDT.
 *
 * REGLA: la UI NUNCA debe tocar localStorage directamente.
 * Siempre pasa por las funciones exportadas aquí.
 *
 * MODELO DE PRECIO (3 estados, no 2):
 *   "estimado"            -> precio de referencia, sin verificar. Badge gris, prefijo "~".
 *   "verificado_en_tienda"-> visto en góndola/etiqueta (OCR, manual, voz). Badge secundario.
 *                            AÚN puede cambiar en caja por promos, error de etiqueta, etc.
 *   "facturado"            -> precio real del recibo al cerrar la compra. Único estado
 *                            considerado definitivo. Badge de acento.
 *
 * MODELO DE LISTAS:
 *   Lista { id, nombre, creada_en, estado: "activa"|"cerrada", comercio_principal,
 *           total_facturado_final, diferencia_vs_verificado }
 *   Cada ItemLista pertenece a una lista_id.
 */

const LS_KEY_LISTAS = "justo:listas";           // catálogo de listas
const LS_KEY_ITEMS = "justo:items";             // todos los items, de todas las listas
const LS_KEY_ACTIVE_LIST = "justo:activeListId";
const LS_KEY_QUEUE = "justo:syncQueue";
const LS_KEY_COMPARACIONES = "justo:comparaciones";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function leer(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn("justo:store leer()", key, e);
    return fallback;
  }
}

function escribir(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("justo:store escribir()", key, e);
  }
}

function encolarCambio(tipo_operacion, payload) {
  const queue = leer(LS_KEY_QUEUE, []);
  queue.push({
    id: uuid(),
    tipo_operacion,
    payload,
    timestamp: Date.now(),
    estado: "pendiente",
  });
  escribir(LS_KEY_QUEUE, queue);
}

// ---------------------------------------------------------------------------
// Reglas de negocio centralizadas
// ---------------------------------------------------------------------------

const NIVEL_PRECIO = {
  estimado: 0,
  verificado_en_tienda: 1,
  facturado: 2,
};

/** Solo puede ir "en_carrito" si el precio fue al menos verificado en tienda. */
export function puedeMarcarEnCarrito(item) {
  return item && NIVEL_PRECIO[item.estado_precio] >= NIVEL_PRECIO.verificado_en_tienda;
}

/** Solo se puede facturar (cerrar compra) si el item fue al menos verificado. */
export function puedeFacturar(item) {
  return item && NIVEL_PRECIO[item.estado_precio] >= NIVEL_PRECIO.verificado_en_tienda;
}

// ---------------------------------------------------------------------------
// Listas (gestión de múltiples listas)
// ---------------------------------------------------------------------------

export function getListas() {
  return leer(LS_KEY_LISTAS, []);
}

export function getListaActivaId() {
  let id = leer(LS_KEY_ACTIVE_LIST, null);
  const listas = getListas();
  if (!id || !listas.find((l) => l.id === id && l.estado === "activa")) {
    const primeraActiva = listas.find((l) => l.estado === "activa");
    if (primeraActiva) {
      id = primeraActiva.id;
      escribir(LS_KEY_ACTIVE_LIST, id);
    } else {
      const nueva = crearLista("Mi lista");
      id = nueva.id;
    }
  }
  return id;
}

export function setListaActiva(id) {
  escribir(LS_KEY_ACTIVE_LIST, id);
  encolarCambio("set_lista_activa", { id });
}

export function crearLista(nombre, comercioPrincipal = null) {
  const listas = getListas();
  const nueva = {
    id: uuid(),
    nombre: nombre || "Nueva lista",
    creada_en: Date.now(),
    estado: "activa",
    comercio_principal: comercioPrincipal,
    total_facturado_final: null,
    diferencia_vs_verificado: null,
  };
  listas.push(nueva);
  escribir(LS_KEY_LISTAS, listas);
  escribir(LS_KEY_ACTIVE_LIST, nueva.id);
  encolarCambio("crear_lista", nueva);
  return nueva;
}

export function renombrarLista(id, nombre) {
  const listas = getListas();
  const idx = listas.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  listas[idx] = { ...listas[idx], nombre };
  escribir(LS_KEY_LISTAS, listas);
  encolarCambio("renombrar_lista", { id, nombre });
  return listas[idx];
}

export function duplicarLista(id, nuevoNombre) {
  const listas = getListas();
  const original = listas.find((l) => l.id === id);
  if (!original) return null;
  const nueva = crearLista(nuevoNombre || `${original.nombre} (copia)`, original.comercio_principal);
  const items = getTodosLosItems().filter((i) => i.lista_id === id);
  items.forEach((item) => {
    guardarProducto({
      ...item,
      lista_id: nueva.id,
      estado_precio: "estimado",
      estado_compra: "activo",
      precio_verificado: null,
      precio_facturado: null,
    });
  });
  return nueva;
}

/**
 * Cierra una lista: registra el total realmente pagado (del recibo) y
 * calcula la diferencia vs. lo que se había verificado en tienda.
 * totalFacturado puede venir de un solo número (recibo completo) o de la
 * suma de precios facturados por item, según cómo lo use la UI.
 *
 * baseVerificado: total verificado ANTES de facturar los items. Si la UI ya
 * facturó item por item, calcularTotales() aquí devolvería los precios
 * facturados (diferencia siempre 0), así que la UI debe capturar la base
 * antes de facturar y pasarla.
 */
export function cerrarLista(id, totalFacturado, baseVerificado = null) {
  const listas = getListas();
  const idx = listas.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const base = baseVerificado ?? calcularTotales(id).totalVerificado;
  const diferencia = totalFacturado - base;
  listas[idx] = {
    ...listas[idx],
    estado: "cerrada",
    cerrada_en: Date.now(),
    total_facturado_final: totalFacturado,
    diferencia_vs_verificado: diferencia,
  };
  escribir(LS_KEY_LISTAS, listas);
  encolarCambio("cerrar_lista", { id, totalFacturado, diferencia });
  return listas[idx];
}

export function getHistorialListasCerradas() {
  return getListas()
    .filter((l) => l.estado === "cerrada")
    .sort((a, b) => (b.cerrada_en ?? b.creada_en) - (a.cerrada_en ?? a.creada_en));
}

// ---------------------------------------------------------------------------
// Items de lista
// ---------------------------------------------------------------------------

function getTodosLosItems() {
  return leer(LS_KEY_ITEMS, []);
}

function guardarTodosLosItems(items) {
  escribir(LS_KEY_ITEMS, items);
}

/** Devuelve los items de la lista activa (o de listaId si se especifica). */
export function getLista(listaId) {
  const id = listaId || getListaActivaId();
  return getTodosLosItems().filter((i) => i.lista_id === id);
}

/**
 * item esperado (parcial, se completan defaults):
 * { nombre, comercio, cantidad, contenido, unidad_medida, precio_estimado,
 *   precio_verificado, precio_facturado, estado_precio, estado_compra, fuente, lista_id }
 */
export function guardarProducto(item) {
  const items = getTodosLosItems();
  const listaId = item.lista_id || getListaActivaId();
  const nuevo = {
    id: uuid(),
    lista_id: listaId,
    nombre: item.nombre || "Producto sin nombre",
    comercio: item.comercio || null,
    cantidad: item.cantidad ?? 1,
    contenido: item.contenido ?? null, // gramaje/volumen por envase (ej. 170)
    unidad_medida: item.unidad_medida || null, // "g" | "ml" | "unidad"
    estado_precio: item.estado_precio || "estimado", // estimado | verificado_en_tienda | facturado
    estado_compra: item.estado_compra || "activo", // activo | en_carrito | aplazado
    precio_estimado: item.precio_estimado ?? item.precio_referencia ?? 0,
    precio_verificado: item.precio_verificado ?? null,
    precio_facturado: item.precio_facturado ?? null,
    motivo_aplazado: item.motivo_aplazado || null,
    fuente: item.fuente || "manual", // manual | ocr | voz
    creado_en: Date.now(),
  };
  items.push(nuevo);
  guardarTodosLosItems(items);
  encolarCambio("crear_item", nuevo);
  return nuevo;
}

export function actualizarItem(id, cambios) {
  const items = getTodosLosItems();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...cambios };
  guardarTodosLosItems(items);
  encolarCambio("actualizar_item", { id, cambios });
  return items[idx];
}

export function eliminarItem(id) {
  const items = getTodosLosItems().filter((i) => i.id !== id);
  guardarTodosLosItems(items);
  encolarCambio("eliminar_item", { id });
}

/** Estimado -> Verificado en tienda (se vio en góndola/etiqueta/OCR/voz). */
export function verificarEnTienda(id, precioVisto) {
  return actualizarItem(id, {
    estado_precio: "verificado_en_tienda",
    precio_verificado: precioVisto,
  });
}

/** Verificado -> Facturado (precio real del recibo, vía cierre de compra). */
export function facturarItem(id, precioReal) {
  return actualizarItem(id, {
    estado_precio: "facturado",
    precio_facturado: precioReal,
  });
}

export function marcarEnCarrito(id, enCarrito) {
  const items = getTodosLosItems();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  if (enCarrito && !puedeMarcarEnCarrito(item)) {
    // La UI debe interceptar esto y abrir el sheet de "verificar precio en tienda".
    return null;
  }
  return actualizarItem(id, {
    estado_compra: enCarrito ? "en_carrito" : "activo",
  });
}

export function aplazarItem(id, motivo) {
  return actualizarItem(id, {
    estado_compra: "aplazado",
    motivo_aplazado: motivo || null,
  });
}

export function reactivarItem(id) {
  return actualizarItem(id, {
    estado_compra: "activo",
    motivo_aplazado: null,
  });
}

// ---------------------------------------------------------------------------
// Totales derivados (usar en el header de la lista) — SIEMPRE por lista
// ---------------------------------------------------------------------------

function precioEfectivo(item) {
  if (item.estado_precio === "facturado") return item.precio_facturado ?? 0;
  if (item.estado_precio === "verificado_en_tienda") return item.precio_verificado ?? 0;
  return item.precio_estimado ?? 0;
}

export function calcularTotales(listaId) {
  const items = getLista(listaId);
  const activos = items.filter((i) => i.estado_compra !== "aplazado");
  const aplazados = items.filter((i) => i.estado_compra === "aplazado");

  const totalEstimado = activos.reduce(
    (sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1),
    0
  );

  const verificadosOMas = activos.filter(
    (i) => NIVEL_PRECIO[i.estado_precio] >= NIVEL_PRECIO.verificado_en_tienda
  );
  const totalVerificado = verificadosOMas.reduce(
    (sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1),
    0
  );

  const facturados = activos.filter((i) => i.estado_precio === "facturado");
  const totalFacturado = facturados.length
    ? facturados.reduce((sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1), 0)
    : null; // null = "aún no se ha cerrado la compra"

  const totalAplazado = aplazados.reduce(
    (sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1),
    0
  );

  return {
    totalEstimado,
    totalVerificado,
    totalFacturado,
    totalAplazado,
    countActivos: activos.length,
    countVerificados: verificadosOMas.length,
    countFacturados: facturados.length,
    countAplazados: aplazados.length,
    countEnCarrito: activos.filter((i) => i.estado_compra === "en_carrito").length,
  };
}

// ---------------------------------------------------------------------------
// Comparaciones (motor comparador) — guardado ligero para analítica futura
// ---------------------------------------------------------------------------

export function getComparaciones() {
  return leer(LS_KEY_COMPARACIONES, []);
}

export function guardarComparacion(payload) {
  const comparaciones = getComparaciones();
  const registro = { id: uuid(), ...payload, creado_en: Date.now() };
  comparaciones.push(registro);
  escribir(LS_KEY_COMPARACIONES, comparaciones);
  encolarCambio("crear_comparacion", registro);
  return registro;
}

// ---------------------------------------------------------------------------
// Sincronización — fetch real contra docs/api-contract.md, offline-first
// ---------------------------------------------------------------------------
// localStorage sigue siendo la fuente de verdad local: si el fetch falla,
// el cambio queda "pendiente" y se reintenta con backoff. Tras MAX_REINTENTOS
// pasa a "error" y solo se reintenta cuando vuelve la conexión (evento online).

const API_BASE =
  (typeof window !== "undefined" && window.JUSTO_API_BASE) || "/api";
const MAX_REINTENTOS = 3;
const RETRY_DELAYS_MS = [2000, 8000, 30000];
const FETCH_TIMEOUT_MS = 6000;

export function getSyncQueue() {
  return leer(LS_KEY_QUEUE, []);
}

/** Traduce una operación de la cola al request del contrato REST. */
function requestParaCambio(cambio) {
  const { tipo_operacion, payload } = cambio;
  switch (tipo_operacion) {
    case "crear_lista":
      return { method: "POST", url: `${API_BASE}/listas`, body: payload };
    case "renombrar_lista":
    case "cerrar_lista":
    case "set_lista_activa":
      return {
        method: "PATCH",
        url: `${API_BASE}/listas/${payload.id}`,
        body: { tipo_operacion, ...payload },
      };
    case "crear_item":
    case "actualizar_item":
    case "eliminar_item": {
      const listaId =
        payload.lista_id || payload.cambios?.lista_id || getListaActivaId();
      return {
        method: "PATCH",
        url: `${API_BASE}/listas/${listaId}`,
        body: { tipo_operacion, item: payload },
      };
    }
    case "crear_comparacion":
      return { method: "POST", url: `${API_BASE}/comparaciones`, body: payload };
    default:
      return null;
  }
}

async function enviarCambio(cambio) {
  const req = requestParaCambio(cambio);
  if (!req) throw new Error(`Operación desconocida: ${cambio.tipo_operacion}`);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

let syncEnCurso = false;
let reintentoProgramado = null;

/**
 * Intenta enviar todos los cambios pendientes al backend.
 * Devuelve { sincronizados, fallidos } y programa un reintento con backoff
 * si algo falló. Nunca borra datos locales: localStorage es el fallback.
 */
export async function sincronizarPendientes() {
  if (syncEnCurso) return { sincronizados: 0, fallidos: 0, motivo: "en_curso" };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sincronizados: 0, fallidos: 0, motivo: "offline" };
  }

  const queue = getSyncQueue();
  const pendientes = queue.filter((q) => q.estado === "pendiente");
  if (pendientes.length === 0) return { sincronizados: 0, fallidos: 0 };

  syncEnCurso = true;
  let sincronizados = 0;
  let fallidos = 0;
  try {
    for (const cambio of pendientes) {
      try {
        await enviarCambio(cambio);
        cambio.estado = "sincronizado";
        sincronizados++;
      } catch (e) {
        cambio.reintentos = (cambio.reintentos || 0) + 1;
        if (cambio.reintentos >= MAX_REINTENTOS) cambio.estado = "error";
        fallidos++;
      }
    }
    // Merge por id: conserva operaciones encoladas mientras corría el sync.
    const porId = new Map(queue.map((q) => [q.id, q]));
    const actualizada = getSyncQueue().map((q) => porId.get(q.id) || q);
    escribir(LS_KEY_QUEUE, actualizada);
  } finally {
    syncEnCurso = false;
  }

  if (fallidos > 0) programarReintento();
  return { sincronizados, fallidos };
}

function programarReintento() {
  if (reintentoProgramado) return;
  const pendiente = getSyncQueue().find((q) => q.estado === "pendiente");
  if (!pendiente) return;
  const nivel = Math.min(pendiente.reintentos || 0, RETRY_DELAYS_MS.length - 1);
  reintentoProgramado = setTimeout(() => {
    reintentoProgramado = null;
    sincronizarPendientes();
  }, RETRY_DELAYS_MS[nivel]);
}

/** Al recuperar conexión, los cambios en "error" vuelven a ser candidatos. */
function reactivarErroresDeSync() {
  const queue = getSyncQueue();
  let cambio = false;
  queue.forEach((q) => {
    if (q.estado === "error") {
      q.estado = "pendiente";
      q.reintentos = 0;
      cambio = true;
    }
  });
  if (cambio) escribir(LS_KEY_QUEUE, queue);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    reactivarErroresDeSync();
    sincronizarPendientes().then((r) => console.log("justo:sync", r));
  });
}
