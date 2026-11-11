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

const SIN_CAPACIDADES = { vision: false, codigoBarras: false, appleIntelligence: false, plataforma: "web" };

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
export async function leerEtiquetaNativa(canvas, { rapido = false } = {}) {
  const p = plugin();
  if (!p) return null;
  return p.leerEtiqueta({ imagen: canvasABase64(canvas), ia: !rapido });
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

/** Vibración corta: "exito" | "aviso" | "toque". En web no hace nada. */
export function haptico(tipo = "toque") {
  plugin()?.haptico({ tipo }).catch(() => {});
}

/** Evita que el teléfono se apague mientras se escanea en la góndola. */
export function mantenerPantalla(activo) {
  plugin()?.mantenerPantalla({ activo: Boolean(activo) }).catch(() => {});
}
