/**
 * Puente con la plataforma nativa.
 *
 * Única puerta por la que la web habla con el dispositivo. En iOS la
 * implementa el plugin QuantoNativo (native/ios/App/App/QuantoNativoPlugin.swift):
 * Vision para OCR y código de barras, Apple Intelligence para interpretar.
 * En web todo devuelve null/false y la app usa sus alternativas (lector IA
 * remoto, Tesseract, parser local, textos fijos). Para Android basta con
 * implementar un plugin con el mismo nombre y los mismos métodos
 * (por ejemplo ML Kit + Gemini Nano).
 */

import { canvasABase64 } from "./api.js";

const SIN_CAPACIDADES = {
  vision: false, codigoBarras: false, barrido: false, barridoNativo: false, recordatorios: false,
  compartir: typeof navigator !== "undefined" && Boolean(navigator.share || navigator.clipboard),
  appleIntelligence: false, plataforma: "web",
};

function plugin() {
  const C = window.Capacitor;
  if (!C?.isNativePlatform?.()) return null;
  return C.Plugins?.QuantoNativo || null;
}

export function esNativo() {
  return Boolean(plugin());
}

let capsPromise = null;
/** Capacidades del dispositivo (se consultan una vez). */
export function capacidades() {
  if (!capsPromise) {
    capsPromise = (async () => {
      const p = plugin();
      if (!p) return SIN_CAPACIDADES;
      try { return { ...SIN_CAPACIDADES, ...(await p.capacidades()) }; } catch { return SIN_CAPACIDADES; }
    })();
  }
  return capsPromise;
}

/**
 * OCR nativo de una etiqueta. Devuelve
 * { texto, palabras:[{text,bbox}], codigo, ia, iaEstado } o null si no hay
 * plugin. `rapido` evita la interpretación con Apple Intelligence.
 */
export async function leerEtiquetaNativa(canvas, { rapido = false, nivelRapido = false, ladoMax = 1280 } = {}) {
  const p = plugin();
  if (!p) return null;
  return p.leerEtiqueta({ imagen: canvasABase64(canvas, ladoMax), ia: !rapido, rapido: nivelRapido });
}

/**
 * Interpreta con Apple Intelligence el texto de una etiqueta ya leída
 * (barrido en vivo: el OCR corre en cada fotograma, la IA solo al confirmar).
 * Devuelve { precio, contenido, unidad, unidades, nombre, confianza } o null.
 */
export async function interpretarEtiqueta(texto) {
  const p = plugin();
  if (!p || !String(texto || "").trim()) return null;
  try {
    const r = await p.interpretarEtiqueta({ texto });
    if (!r || r.ia === null) return null;
    return {
      precio: Number.isFinite(r.precio) && r.precio > 0 ? r.precio : null,
      contenido: Number.isFinite(r.contenido) && r.contenido > 0 ? r.contenido : null,
      unidad: ["g", "ml", "unidad"].includes(r.unidad) ? r.unidad : null,
      unidades: Math.min(48, Math.max(1, Number(r.unidades) || 1)),
      nombre: String(r.nombre || "").trim(),
      confianza: r.confianza || "media",
    };
  } catch {
    return null;
  }
}

/**
 * Interpreta una frase dictada o escrita ("dos leches Vita de litro a 1.25").
 * Devuelve { nombre, cantidad, precio, contenido, unidad } o null.
 */
export async function interpretarProducto(frase) {
  const p = plugin();
  if (!p || !String(frase || "").trim()) return null;
  try {
    const r = await p.interpretarProducto({ frase });
    if (!r || r.ia === null || !r.nombre) return null;
    return {
      nombre: String(r.nombre),
      cantidad: Math.min(99, Math.max(1, Number(r.cantidad) || 1)),
      precio: Number.isFinite(r.precio) && r.precio > 0 ? r.precio : null,
      contenido: Number.isFinite(r.contenido) && r.contenido > 0 ? r.contenido : null,
      unidad: ["g", "ml", "unidad"].includes(r.unidad) ? r.unidad : null,
    };
  } catch {
    return null;
  }
}

const explicaciones = new Map();
/**
 * Explicación en lenguaje natural de una comparación ya calculada.
 * `resumen` es texto plano con los productos ordenados; se cachea por texto
 * para no volver a preguntar en cada re-render. Devuelve { titulo, explicacion } o null.
 */
export async function explicarComparacion(resumen) {
  const p = plugin();
  if (!p || !resumen) return null;
  if (explicaciones.has(resumen)) return explicaciones.get(resumen);
  const promesa = (async () => {
    try {
      const r = await p.explicarComparacion({ resumen });
      if (!r || r.ia === null || !r.explicacion) return null;
      return { titulo: String(r.titulo || "").trim(), explicacion: String(r.explicacion).trim() };
    } catch {
      return null;
    }
  })();
  explicaciones.set(resumen, promesa);
  return promesa;
}

const consejosIA = new Map();
/**
 * Consejo semanal redactado por Apple Intelligence a partir del resumen de
 * data/ahorro.js. Cacheado por texto. Devuelve { titulo, consejo } o null.
 */
export async function redactarConsejo(resumen) {
  const p = plugin();
  if (!p || !resumen) return null;
  if (consejosIA.has(resumen)) return consejosIA.get(resumen);
  const promesa = (async () => {
    try {
      const r = await p.redactarConsejo({ resumen });
      if (!r || r.ia === null || !r.consejo) return null;
      return { titulo: String(r.titulo || "").trim(), consejo: String(r.consejo).trim() };
    } catch {
      return null;
    }
  })();
  consejosIA.set(resumen, promesa);
  return promesa;
}

// ---------------------------------------------------------------------------
// Barrido nativo: cámara SwiftUI a pantalla completa; el cerebro sigue aquí
// ---------------------------------------------------------------------------

let oyentesBarrido = [];

async function soltarOyentesBarrido() {
  const hs = oyentesBarrido;
  oyentesBarrido = [];
  for (const h of hs) { try { await h.remove(); } catch { /* ya quitado */ } }
}

/**
 * Abre la cámara nativa. Callbacks:
 *  - onEtiqueta({ id, texto, precio, lineas, palabras, caja, miniatura }) por etiqueta confirmada
 *  - onToque({ id }) al tocar una etiqueta ya confirmada
 *  - onCerrado({ motivo }) al cerrarse (por la persona o por la web)
 * Devuelve false si no hay plugin; lanza Error con .codigo si no se pudo abrir.
 */
export async function abrirBarridoNativo({ onEtiqueta, onToque, onCerrado } = {}) {
  const p = plugin();
  if (!p) return false;
  await soltarOyentesBarrido();
  const alta = async (evento, cb) => { if (cb) oyentesBarrido.push(await p.addListener(evento, cb)); };
  await alta("barridoEtiqueta", onEtiqueta);
  await alta("barridoToque", onToque);
  await alta("barridoCerrado", async (e) => { await soltarOyentesBarrido(); onCerrado?.(e || {}); });
  try {
    await p.abrirBarrido();
    return true;
  } catch (e) {
    await soltarOyentesBarrido();
    throw Object.assign(new Error(String(e?.message || e)), { codigo: /sin_permiso/.test(String(e?.message || e)) ? "sin_permiso" : "barrido" });
  }
}

export async function cerrarBarridoNativo() {
  try { await plugin()?.cerrarBarrido(); } catch { /* ya cerrado */ }
}

/** Textos y estado ("mejor" | "ok" | "sinGramaje") de cada etiqueta para el overlay nativo. */
export function actualizarEtiquetasNativas(etiquetas) {
  plugin()?.actualizarEtiquetas({ etiquetas }).catch(() => {});
}

/** Vibración corta: "exito" | "aviso" | "toque". En web no hace nada. */
export function haptico(tipo = "toque") {
  plugin()?.haptico({ tipo }).catch(() => {});
}

/** Evita que el teléfono se apague mientras se escanea en la góndola. */
export function mantenerPantalla(activo) {
  plugin()?.mantenerPantalla({ activo: Boolean(activo) }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Recordatorios (lista de compras de Apple) y compartir (Notas, WhatsApp...)
// ---------------------------------------------------------------------------

/**
 * Crea en Recordatorios una lista con ese nombre (o la reutiliza) y añade un
 * recordatorio por item. Devuelve { creados, omitidos } o null si no hay
 * plugin. Lanza Error con .codigo "sin_permiso" si la persona lo negó.
 */
export async function exportarRecordatorios(lista, items) {
  const p = plugin();
  if (!p) return null;
  try {
    return await p.exportarRecordatorios({ lista, items });
  } catch (e) {
    throw Object.assign(new Error(String(e?.message || e)), { codigo: /sin_permiso/.test(String(e?.message || e)) ? "sin_permiso" : "recordatorios" });
  }
}

/** Recordatorios pendientes de una lista (o de todas). [{ nombre, nota, lista }] o null. */
export async function importarRecordatorios(lista = null) {
  const p = plugin();
  if (!p) return null;
  try {
    const r = await p.importarRecordatorios(lista ? { lista } : {});
    return Array.isArray(r?.items) ? r.items : [];
  } catch (e) {
    throw Object.assign(new Error(String(e?.message || e)), { codigo: /sin_permiso/.test(String(e?.message || e)) ? "sin_permiso" : "recordatorios" });
  }
}

/**
 * Comparte texto: hoja nativa en iOS (Notas, Mensajes, WhatsApp...),
 * navigator.share en web móvil, portapapeles en escritorio.
 * Devuelve "compartido" | "copiado" | "cancelado" | null.
 */
export async function compartir(texto, titulo = "Lista de compras") {
  const p = plugin();
  if (p) {
    try {
      const r = await p.compartir({ texto, titulo });
      return r?.completado ? "compartido" : "cancelado";
    } catch { return null; }
  }
  if (navigator.share) {
    try { await navigator.share({ title: titulo, text: texto }); return "compartido"; }
    catch (e) { if (e?.name === "AbortError") return "cancelado"; }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(texto); return "copiado"; } catch { /* sin permiso */ }
  }
  return null;
}
