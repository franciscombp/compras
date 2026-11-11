/**
 * Capa de APIs externas y catálogo local.
 *
 * - searchProduct(nombre): busca en data/catalogo.json (descargado cada
 *   semana por GitHub Actions, ver lab/fetch-catalogo.mjs). Funciona
 *   offline una vez cacheado por el Service Worker.
 * - searchByBarcode(code): consulta Open Food Facts (API pública con CORS)
 *   y cae al catálogo local si no hay conexión.
 * - leerEtiqueta(canvas): manda la foto al lector IA (worker/, Cloudflare +
 *   Claude) y devuelve { precio, contenido, unidad, unidades, nombre }. La URL
 *   y la clave se guardan por dispositivo en localStorage; si no están, el
 *   escáner usa el OCR local (Tesseract) como siempre.
 *
 * Formato de producto del catálogo (claves cortas para que el JSON pese poco):
 *   { n: nombre, m: marca, c: contenido, u: unidad, e: envases,
 *     p: precio|null, t: tienda|null, b: barcode|null }
 */

let catalogoPromise = null;

function getCatalogo() {
  if (!catalogoPromise) {
    catalogoPromise = fetch("./data/catalogo.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : { productos: [] }))
      .catch(() => ({ productos: [] }));
  }
  return catalogoPromise;
}

function normalizarTexto(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Lector IA de etiquetas (opcional)
// ---------------------------------------------------------------------------

const LECTOR_KEY = "quanto.lector";
// Si despliegas el Worker, puedes fijar aquí la URL para no configurarla en
// cada teléfono. La configuración guardada en el dispositivo tiene prioridad.
const LECTOR_URL_DEFECTO = "";

export function getLectorConfig() {
  try {
    const guardado = JSON.parse(localStorage.getItem(LECTOR_KEY) || "null");
    if (guardado?.url) return { url: guardado.url, token: guardado.token || "" };
  } catch { /* valor corrupto: se ignora */ }
  return { url: LECTOR_URL_DEFECTO, token: "" };
}

export function setLectorConfig({ url, token }) {
  const limpia = String(url || "").trim().replace(/\/+$/, "");
  if (!limpia) {
    localStorage.removeItem(LECTOR_KEY);
    return getLectorConfig();
  }
  if (!/^https?:\/\//i.test(limpia)) throw new Error("url_invalida");
  localStorage.setItem(LECTOR_KEY, JSON.stringify({ url: limpia, token: String(token || "").trim() }));
  return getLectorConfig();
}

/** Hay lector configurado y conexión para usarlo. */
export function lectorDisponible() {
  return Boolean(getLectorConfig().url) && navigator.onLine;
}

/** Canvas -> JPEG base64 acotado (lado mayor 1280 px): suficiente para leer y barato en tokens. */
export function canvasABase64(canvas, ladoMax = 1280) {
  let fuente = canvas;
  const mayor = Math.max(canvas.width, canvas.height);
  if (mayor > ladoMax) {
    const escala = ladoMax / mayor;
    fuente = document.createElement("canvas");
    fuente.width = Math.round(canvas.width * escala);
    fuente.height = Math.round(canvas.height * escala);
    fuente.getContext("2d").drawImage(canvas, 0, 0, fuente.width, fuente.height);
  }
  return fuente.toDataURL("image/jpeg", 0.82).split(",")[1];
}

export const services = {
  /**
   * Busca productos por nombre en el catálogo local.
   * Devuelve hasta `limite` resultados ordenados por relevancia simple
   * (cuántas palabras de la consulta aparecen en el nombre).
   */
  async searchProduct(nombre, limite = 6) {
    const q = normalizarTexto(nombre).trim();
    if (q.length < 2) return [];
    const palabras = q.split(/\s+/);
    const { productos = [] } = await getCatalogo();

    const puntuados = [];
    for (const p of productos) {
      const objetivo = normalizarTexto(`${p.n} ${p.m || ""}`);
      let puntos = 0;
      for (const w of palabras) if (objetivo.includes(w)) puntos++;
      if (puntos === palabras.length) puntos += objetivo.startsWith(palabras[0]) ? 2 : 0;
      if (puntos > 0) puntuados.push({ p, puntos });
    }
    puntuados.sort((a, b) => b.puntos - a.puntos || a.p.n.length - b.p.n.length);
    return puntuados.slice(0, limite).map(({ p }) => ({
      nombre: p.n, marca: p.m, contenido: p.c, unidad: p.u,
      envases: p.e || 1, precio: p.p, tienda: p.t, barcode: p.b,
    }));
  },

  /**
   * Busca un producto por código de barras: primero Open Food Facts
   * (público, con CORS), si falla, el catálogo local.
   */
  async searchByBarcode(code) {
    const limpio = String(code || "").replace(/\D/g, "");
    if (limpio.length < 8) return null;
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${limpio}.json?fields=product_name_es,product_name,brands,quantity`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = await res.json();
        const pr = data.product;
        if (pr) {
          return {
            nombre: pr.product_name_es || pr.product_name || null,
            marca: pr.brands || null,
            cantidadTexto: pr.quantity || null,
            fuente: "openfoodfacts",
          };
        }
      }
    } catch { /* sin conexión o timeout: cae al catálogo local */ }

    const { productos = [] } = await getCatalogo();
    const p = productos.find((x) => x.b === limpio);
    return p ? { nombre: p.n, marca: p.m, contenido: p.c, unidad: p.u, precio: p.p, fuente: "catalogo" } : null;
  },

  /**
   * Lee una etiqueta con el lector IA. Devuelve el mismo objeto que
   * parseEtiqueta (assets/ocr.js) más `confianza` ("alta" | "media" | "baja").
   * Lanza Error con .codigo si no hay lector, no hay red o el Worker falla,
   * para que el escáner caiga al OCR local.
   */
  async leerEtiqueta(canvas, { timeoutMs = 25000 } = {}) {
    const { url, token } = getLectorConfig();
    if (!url) throw Object.assign(new Error("sin_lector"), { codigo: "sin_lector" });
    if (!navigator.onLine) throw Object.assign(new Error("sin_red"), { codigo: "sin_red" });

    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ imagen: canvasABase64(canvas), tipo: "image/jpeg" }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw Object.assign(new Error("conexion"), { codigo: e?.name === "TimeoutError" ? "timeout" : "conexion" });
    }

    let data = null;
    try { data = await res.json(); } catch { /* cuerpo vacío o no JSON */ }
    if (!res.ok) throw Object.assign(new Error(data?.error || `http_${res.status}`), { codigo: data?.error || `http_${res.status}`, status: res.status });

    const unidad = ["g", "ml", "unidad"].includes(data?.unidad) ? data.unidad : null;
    const contenido = Number.isFinite(data?.contenido) && data.contenido > 0 && unidad ? Math.round(data.contenido) : null;
    return {
      precio: Number.isFinite(data?.precio) && data.precio > 0 ? data.precio : null,
      contenido,
      unidad: contenido ? unidad : null,
      unidades: Math.min(48, Math.max(1, Math.round(Number(data?.unidades) || 1))),
      nombre: String(data?.nombre || "").trim(),
      confianza: ["alta", "media", "baja"].includes(data?.confianza) ? data.confianza : "media",
    };
  },

  /** Metadatos del catálogo local (fecha de actualización, fuentes). */
  async catalogoInfo() {
    const cat = await getCatalogo();
    return { actualizado: cat.actualizado || null, fuentes: cat.fuentes || [], total: (cat.productos || []).length };
  },

  // Comparador online (futuro): enviaría la lista a un backend propio.
  async compareOnline() { return null; },

  // Sync multi-dispositivo (futuro).
  async syncData() { return null; },
};

export function tieneConexion() {
  return navigator.onLine;
}
