/**
 * Capa de APIs externas y catálogo local.
 *
 * - searchProduct(nombre): busca en data/catalogo.json (descargado cada
 *   semana por GitHub Actions, ver lab/fetch-catalogo.mjs). Funciona
 *   offline una vez cacheado por el Service Worker.
 * - searchByBarcode(code): consulta Open Food Facts (API pública con CORS)
 *   y cae al catálogo local si no hay conexión.
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
