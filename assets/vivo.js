/**
 * Barrido en vivo: la cámara analiza el estante en continuo. Este módulo
 * agrupa las líneas que ve el OCR en etiquetas de precio, las parsea y las
 * sigue entre fotogramas para que cada etiqueta se agregue una sola vez.
 * Es lógica pura (sin DOM) para poder probarla en Node: lab/vivo-test.mjs.
 */

import { parseEtiqueta, extraerPistas } from "./ocr.js";

const RE_PRECIO_LINEA = /(?:^|\s)\$?\s?\d{1,4}[.,]\d{2}(?!\d)/;

function union(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function seCruzan(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  if (!inter) return 0;
  const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
  return inter / (area(a) + area(b) - inter);
}

function centro(b) {
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

function dentro(p, b) {
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
}

/**
 * Agrupa líneas cercanas en etiquetas. Cada línea se expande en proporción a
 * su alto (las líneas de una misma etiqueta están a menos de una línea de
 * distancia; dos etiquetas vecinas, más lejos) y se unen las que se tocan.
 * Si un grupo contiene dos precios separados en horizontal, se parte: son
 * dos etiquetas pegadas en el riel de la góndola.
 */
export function agruparEtiquetas(lineas, palabras = [], { expH = 0.8, expV = 0.9 } = {}) {
  const ls = (lineas || []).filter((l) => l?.bbox && String(l.text || "").trim());
  if (!ls.length) return [];
  const exp = ls.map((l) => {
    const h = Math.max(1, l.bbox.y1 - l.bbox.y0);
    return { x0: l.bbox.x0 - h * expH, x1: l.bbox.x1 + h * expH, y0: l.bbox.y0 - h * expV, y1: l.bbox.y1 + h * expV };
  });
  const padre = ls.map((_, i) => i);
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++)
      if (seCruzan(exp[i], exp[j])) padre[raiz(i)] = raiz(j);

  const grupos = new Map();
  ls.forEach((l, i) => {
    const r = raiz(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(l);
  });

  const regiones = [];
  for (const grupo of grupos.values()) {
    for (const sub of dividirPorPrecios(grupo)) {
      const region = construirRegion(sub, palabras);
      if (region.datos.precio !== null) regiones.push(region);
    }
  }
  return regiones.sort((a, b) => a.bbox.x0 - b.bbox.x0);
}

function dividirPorPrecios(grupo) {
  const precios = grupo.filter((l) => RE_PRECIO_LINEA.test(l.text));
  if (precios.length < 2) return [grupo];
  // Precios cuyos rangos horizontales no se solapan: etiquetas distintas.
  const anclas = [];
  for (const p of precios.sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    const solapa = anclas.some((a) => p.bbox.x0 < a.bbox.x1 && a.bbox.x0 < p.bbox.x1);
    if (!solapa) anclas.push(p);
  }
  if (anclas.length < 2) return [grupo];
  const subs = anclas.map(() => []);
  for (const l of grupo) {
    const cx = centro(l.bbox).x;
    let mejor = 0, dist = Infinity;
    anclas.forEach((a, i) => {
      const d = Math.abs(centro(a.bbox).x - cx);
      if (d < dist) { dist = d; mejor = i; }
    });
    subs[mejor].push(l);
  }
  return subs.filter((s) => s.length);
}

function construirRegion(lineasRegion, palabras) {
  const orden = [...lineasRegion].sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
  const bbox = orden.map((l) => l.bbox).reduce(union);
  const texto = orden.map((l) => l.text).join("\n");
  const dentroDe = (palabras || []).filter((w) => w?.bbox && dentro(centro(w.bbox), bbox));
  const datos = parseEtiqueta(texto, extraerPistas({ words: dentroDe }));
  return { bbox, texto, lineas: orden, palabras: dentroDe, datos };
}

export function firmaDe(datos) {
  return `${datos.precio}|${datos.contenido ?? ""}|${datos.unidad ?? ""}|${datos.unidades || 1}`;
}

/**
 * Sigue las etiquetas entre fotogramas. Una etiqueta se confirma cuando se
 * ha visto `confirmarTras` veces (evita lecturas fugaces); las que dejan de
 * verse durante `olvidarMs` salen del overlay, pero las confirmadas ya
 * fueron entregadas y no se vuelven a entregar aunque reaparezcan.
 */
export class Seguimiento {
  constructor({ confirmarTras = 2, olvidarMs = 1500 } = {}) {
    this.confirmarTras = confirmarTras;
    this.olvidarMs = olvidarMs;
    this.pistas = [];
    this.entregadas = new Set();
    this.seq = 0;
  }

  actualizar(regiones, ahora = Date.now()) {
    const libres = new Set(this.pistas);
    const asignadas = new Map();

    // 1) Por posición: la misma etiqueta apenas se mueve entre fotogramas.
    for (const r of regiones) {
      let mejor = null, mejorIou = 0.3;
      for (const p of libres) {
        const v = iou(r.bbox, p.bbox);
        if (v > mejorIou && p.datos.precio === r.datos.precio) { mejor = p; mejorIou = v; }
      }
      if (mejor) { asignadas.set(r, mejor); libres.delete(mejor); }
    }
    // 2) Por firma: la cámara saltó pero es la misma etiqueta (mismo precio y gramaje).
    for (const r of regiones) {
      if (asignadas.has(r)) continue;
      const firma = firmaDe(r.datos);
      for (const p of libres) {
        if (firmaDe(p.datos) === firma) { asignadas.set(r, p); libres.delete(p); break; }
      }
    }

    const nuevasConfirmadas = [];
    for (const r of regiones) {
      let p = asignadas.get(r);
      if (!p) {
        p = { id: "t" + (++this.seq), vistas: 0, confirmada: false, creada: ahora };
        this.pistas.push(p);
      }
      p.vistas++;
      p.ultimaVez = ahora;
      p.bbox = p.bbox ? suavizar(p.bbox, r.bbox) : r.bbox;
      // Se queda con la lectura más completa (la que trae gramaje) y, a igualdad, la más reciente.
      if (!p.datos || (r.datos.contenido && !p.datos.contenido) || Boolean(r.datos.contenido) === Boolean(p.datos.contenido)) {
        p.datos = r.datos;
        p.texto = r.texto;
      }
      p.firma = firmaDe(p.datos);
      if (!p.confirmada && p.vistas >= this.confirmarTras) {
        p.confirmada = true;
        if (!this.entregadas.has(p.firma)) {
          this.entregadas.add(p.firma);
          nuevasConfirmadas.push(p);
        }
      }
    }

    this.pistas = this.pistas.filter((p) => ahora - p.ultimaVez <= this.olvidarMs);
    return { visibles: this.pistas.slice(), nuevasConfirmadas };
  }

  /** Confirma una pista a mano (toque en pantalla). */
  confirmar(id) {
    const p = this.pistas.find((x) => x.id === id);
    if (!p || p.confirmada) return null;
    p.confirmada = true;
    if (this.entregadas.has(p.firma)) return null;
    this.entregadas.add(p.firma);
    return p;
  }

  reiniciar() {
    this.pistas = [];
    this.entregadas.clear();
  }
}

function suavizar(prev, nueva, k = 0.5) {
  return {
    x0: prev.x0 + (nueva.x0 - prev.x0) * k, y0: prev.y0 + (nueva.y0 - prev.y0) * k,
    x1: prev.x1 + (nueva.x1 - prev.x1) * k, y1: prev.y1 + (nueva.y1 - prev.y1) * k,
  };
}

/**
 * Convierte una caja en píxeles del fotograma analizado a píxeles de la
 * pantalla, con el vídeo mostrado en object-fit: cover.
 */
export function mapearCaja(bbox, frame, video, pantalla) {
  const aVideo = video.w / frame.w;
  const escala = Math.max(pantalla.w / video.w, pantalla.h / video.h);
  const offX = (pantalla.w - video.w * escala) / 2;
  const offY = (pantalla.h - video.h * escala) / 2;
  const f = aVideo * escala;
  return { x0: offX + bbox.x0 * f, y0: offY + bbox.y0 * f, x1: offX + bbox.x1 * f, y1: offY + bbox.y1 * f };
}

/** Precio normalizado (por 100 g/ml o por unidad) de una lectura, o null. */
export function normalizadoDe(d) {
  if (!(d?.precio > 0) || !(d.contenido > 0)) return null;
  const total = d.contenido * (d.unidades || 1);
  return d.unidad === "unidad" ? d.precio / total : (d.precio / total) * 100;
}
