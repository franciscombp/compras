/**
 * Descarga/actualiza el catálogo de productos que usa la app para sugerir
 * nombres, contenidos y (cuando se puede) precios.
 *
 * Corre en GitHub Actions (ver .github/workflows/actualizar-catalogo.yml)
 * cada semana, o a mano: node lab/fetch-catalogo.mjs
 *
 * Diseño: cada fuente es un "sondeo" que puede fallar sin tumbar el resto.
 * El resultado va a data/catalogo.json y el detalle de qué funcionó a
 * lab/catalogo-report.json (para iterar sobre fuentes reales).
 *
 * Fuentes:
 *  1. Open Food Facts (ec.openfoodfacts.org) - API pública documentada.
 *     Da nombres, marcas y contenido (¡clave para precio/100g!), sin precios.
 *  2. Sondeo VTEX en tiendas de súper de Ecuador - muchas tiendas LATAM
 *     usan VTEX, que expone /api/catalog_system/pub/products/search sin auth.
 *     Si responde, trae nombre + precio + EAN.
 *  3. Sondeo WordPress REST en supermaxi.com - su web es WP; si expone
 *     el listado de productos, trae nombres (precios no publicados).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extraerMedidaDeNombre } from "../assets/ocr.js";

const UA = "QuantoCatalogo/1.0 (app personal de comparación de precios; francisco@maldonado.pro)";
const TIMEOUT = 15000;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normalizar(nombre, extra = {}) {
  const medida = extraerMedidaDeNombre(`${nombre} ${extra.cantidadTexto || ""}`);
  return {
    n: String(nombre).trim().slice(0, 80),
    m: extra.marca?.trim().slice(0, 40) || null,
    c: medida.contenido,
    u: medida.unidad,
    e: medida.unidades,
    p: extra.precio > 0 ? Number(extra.precio.toFixed(2)) : null,
    t: extra.tienda || null,
    b: extra.barcode || null,
  };
}

// --- Fuente 1: Open Food Facts Ecuador -------------------------------------
async function fuenteOpenFoodFacts() {
  const productos = [];
  for (let page = 1; page <= 10; page++) {
    const data = await getJson(
      "https://ec.openfoodfacts.org/api/v2/search?countries_tags_en=ecuador" +
      "&fields=code,product_name_es,product_name,brands,quantity&page_size=100&page=" + page
    );
    const lote = data.products || [];
    for (const pr of lote) {
      const nombre = pr.product_name_es || pr.product_name;
      if (!nombre || nombre.length < 3) continue;
      productos.push(normalizar(nombre, {
        marca: pr.brands,
        cantidadTexto: pr.quantity,
        barcode: pr.code,
        tienda: null,
      }));
    }
    if (lote.length < 100) break;
  }
  return productos;
}

// --- Fuente 2: sondeo VTEX en tiendas candidatas ---------------------------
const TIENDAS_VTEX = [
  { host: "https://www.aki.com.ec", tienda: "Akí" },
  { host: "https://www.supermaxi.com", tienda: "Supermaxi" },
  { host: "https://www.tia.com.ec", tienda: "Tía" },
];

async function fuenteVtex({ host, tienda }) {
  const productos = [];
  for (let from = 0; from < 250; from += 50) {
    const data = await getJson(`${host}/api/catalog_system/pub/products/search?_from=${from}&_to=${from + 49}`);
    if (!Array.isArray(data) || !data.length) break;
    for (const pr of data) {
      const item = pr.items?.[0];
      const oferta = item?.sellers?.[0]?.commertialOffer;
      if (!pr.productName) continue;
      productos.push(normalizar(pr.productName, {
        marca: pr.brand,
        precio: oferta?.Price,
        barcode: item?.ean,
        tienda,
      }));
    }
  }
  return productos;
}

// --- Fuente 3: sondeo WordPress REST en supermaxi.com ----------------------
async function fuenteWordpressSupermaxi() {
  const tipos = await getJson("https://www.supermaxi.com/wp-json/wp/v2/types");
  const candidatos = Object.keys(tipos).filter((k) => /produ|item|catalo/i.test(k));
  const productos = [];
  for (const tipo of candidatos) {
    const base = tipos[tipo]?._links?.["wp:items"]?.[0]?.href;
    if (!base) continue;
    for (let page = 1; page <= 3; page++) {
      const posts = await getJson(`${base}${base.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(posts) || !posts.length) break;
      for (const p of posts) {
        const nombre = p.title?.rendered?.replace(/<[^>]+>/g, "");
        if (nombre) productos.push(normalizar(nombre, { tienda: "Supermaxi" }));
      }
      if (posts.length < 100) break;
    }
  }
  if (!productos.length) throw new Error("WP responde pero sin tipos de producto expuestos");
  return productos;
}

// --- Orquestación ----------------------------------------------------------
const fuentes = [
  { id: "openfoodfacts-ec", fn: fuenteOpenFoodFacts },
  ...TIENDAS_VTEX.map((t) => ({ id: `vtex:${t.host.replace("https://www.", "")}`, fn: () => fuenteVtex(t) })),
  { id: "wordpress:supermaxi.com", fn: fuenteWordpressSupermaxi },
];

const reporte = { corrida: new Date().toISOString(), fuentes: [] };
const todos = [];

for (const f of fuentes) {
  try {
    const productos = await f.fn();
    todos.push(...productos);
    reporte.fuentes.push({ id: f.id, ok: true, productos: productos.length });
    console.log(`✓ ${f.id}: ${productos.length} productos`);
  } catch (e) {
    reporte.fuentes.push({ id: f.id, ok: false, error: String(e?.message || e) });
    console.log(`✗ ${f.id}: ${e?.message || e}`);
  }
}

// De-duplicación: por barcode si hay, si no por nombre normalizado.
const vistos = new Map();
for (const p of todos) {
  const clave = p.b || p.n.toLowerCase().replace(/\s+/g, " ");
  const previo = vistos.get(clave);
  // Se queda el que tenga más datos (precio > contenido > nada)
  if (!previo || (p.p && !previo.p) || (p.c && !previo.c)) vistos.set(clave, { ...previo, ...p });
}
const productosFinal = [...vistos.values()].slice(0, 4000);

// Si ninguna fuente remota funcionó, conserva el catálogo actual (semilla).
let catalogoPrevio = { productos: [] };
try { catalogoPrevio = JSON.parse(readFileSync(new URL("../data/catalogo.json", import.meta.url), "utf8")); } catch {}

const algunaFuenteOk = reporte.fuentes.some((f) => f.ok && f.productos > 0);
const catalogo = algunaFuenteOk
  ? { actualizado: reporte.corrida, fuentes: reporte.fuentes.filter((f) => f.ok).map((f) => f.id), productos: productosFinal }
  : catalogoPrevio;

if (algunaFuenteOk) {
  writeFileSync(new URL("../data/catalogo.json", import.meta.url), JSON.stringify(catalogo));
  console.log(`Catálogo escrito: ${productosFinal.length} productos`);
} else {
  console.log("Ninguna fuente respondió: se conserva el catálogo existente.");
}
writeFileSync(new URL("./catalogo-report.json", import.meta.url), JSON.stringify(reporte, null, 2));
