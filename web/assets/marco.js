/**
 * Detector de etiquetas de precio, al estilo del escáner de documentos:
 * busca en la imagen el rectángulo claro que contiene texto (la etiqueta de
 * góndola) para leer solo eso y no el resto del estante.
 *
 * Funciona sobre píxeles RGBA ({ data, width, height }) sin DOM, así que se
 * prueba en Node (tests/marco-test.mjs). La app lo llama con un fotograma
 * reducido a ~320 px de ancho: tarda unos pocos milisegundos.
 *
 * Método:
 *  1. Luminancia y umbral de Otsu: la etiqueta es más clara que el riel.
 *  2. Componentes conexas de la zona clara, con los agujeros rellenos (el
 *     texto oscuro dentro de la etiqueta queda "dentro" de su componente).
 *  3. Cada componente se puntúa por rectangularidad, tamaño, proporción,
 *     cantidad de texto dentro y cercanía al centro.
 *  4. Se devuelven las candidatas con su caja y sus cuatro esquinas.
 */

/** Umbral de Otsu sobre un histograma de 256 niveles. */
export function umbralOtsu(hist, total) {
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const varEntre = pesoB * pesoF * (mB - mF) * (mB - mF);
    if (varEntre > mejor) { mejor = varEntre; umbral = t; }
  }
  return umbral;
}

const OPCIONES = {
  areaMin: 0.012,       // fracción mínima de la imagen
  areaMax: 0.72,        // más que esto es fondo claro, no una etiqueta
  aspectoMin: 0.45,     // ancho / alto
  aspectoMax: 4.5,
  rectMin: 0.68,        // área rellena / área de su caja
  textoMin: 0.02,       // fracción de píxeles oscuros dentro (texto)
  textoMax: 0.65,
  luzMin: 95,           // una "etiqueta" muy oscura no es una etiqueta
  maxCandidatas: 6,
};

/**
 * Detecta etiquetas en una imagen RGBA. Devuelve candidatas ordenadas de
 * mejor a peor: { x0, y0, x1, y1, esquinas: [tl, tr, br, bl], puntaje,
 * rectangularidad, texto } en píxeles de la imagen recibida.
 */
export function detectarEtiquetas({ data, width: w, height: h }, opciones = {}) {
  const o = { ...OPCIONES, ...opciones };
  const n = w * h;
  if (!n) return [];

  // 1) Luminancia, histograma global y del centro de la imagen
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  const histCentro = new Uint32Array(256);
  let nCentro = 0;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    lum[p] = l;
    hist[l]++;
    const x = p % w, y = (p / w) | 0;
    if (x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8) { histCentro[l]++; nCentro++; }
  }
  // Primero el umbral global; si no aparece nada (luz desigual, flash,
  // sombra a un lado), el del centro, que es donde suele estar la etiqueta.
  const umbrales = [Math.max(o.luzMin, umbralOtsu(hist, n))];
  const tCentro = Math.max(o.luzMin, umbralOtsu(histCentro, nCentro || 1));
  if (Math.abs(tCentro - umbrales[0]) > 12) umbrales.push(tCentro);
  for (const t of umbrales) {
    const r = candidatasConUmbral(lum, w, h, t, o);
    if (r.length) return r;
  }
  return [];
}

function candidatasConUmbral(lum, w, h, t, o) {
  const n = w * h;
  const claro = new Uint8Array(n);
  for (let p = 0; p < n; p++) claro[p] = lum[p] > t ? 1 : 0;

  // 2) Agujeros: lo oscuro que no toca el borde por camino oscuro está
  //    encerrado por algo claro (texto dentro de una etiqueta).
  const fuera = new Uint8Array(n);
  const cola = new Int32Array(n);
  let ini = 0, fin = 0;
  const sembrar = (p) => { if (!claro[p] && !fuera[p]) { fuera[p] = 1; cola[fin++] = p; } };
  for (let x = 0; x < w; x++) { sembrar(x); sembrar((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { sembrar(y * w); sembrar(y * w + w - 1); }
  while (ini < fin) {
    const p = cola[ini++], x = p % w;
    if (x > 0) sembrar(p - 1);
    if (x < w - 1) sembrar(p + 1);
    if (p >= w) sembrar(p - w);
    if (p < n - w) sembrar(p + w);
  }
  // relleno = claro o agujero
  const relleno = new Uint8Array(n);
  for (let p = 0; p < n; p++) relleno[p] = claro[p] || !fuera[p] ? 1 : 0;

  // 3) Componentes conexas del relleno
  const etiqueta = new Int32Array(n);
  const comps = [];
  for (let semilla = 0; semilla < n; semilla++) {
    if (!relleno[semilla] || etiqueta[semilla]) continue;
    const id = comps.length + 1;
    let area = 0, oscuros = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
    let tl = 0, br = 0, tr = 0, bl = 0;
    ini = 0; fin = 0;
    etiqueta[semilla] = id; cola[fin++] = semilla;
    while (ini < fin) {
      const p = cola[ini++], x = p % w, y = (p / w) | 0;
      area++;
      if (!claro[p]) oscuros++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const s = x + y, d = x - y;
      if (s < sMin) { sMin = s; tl = p; }
      if (s > sMax) { sMax = s; br = p; }
      if (d > dMax) { dMax = d; tr = p; }
      if (d < dMin) { dMin = d; bl = p; }
      const vecinos = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
      for (const q of vecinos) {
        if (q >= 0 && relleno[q] && !etiqueta[q]) { etiqueta[q] = id; cola[fin++] = q; }
      }
    }
    comps.push({ area, oscuros, x0, y0, x1: x1 + 1, y1: y1 + 1, tl, tr, br, bl });
  }

  // 4) Puntuación
  const cx = w / 2, cy = h / 2, diag = Math.hypot(cx, cy);
  const punto = (p) => ({ x: p % w, y: (p / w) | 0 });
  const candidatas = [];
  for (const c of comps) {
    const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    const fraccion = c.area / n;
    if (fraccion < o.areaMin || fraccion > o.areaMax) continue;
    const aspecto = bw / bh;
    if (aspecto < o.aspectoMin || aspecto > o.aspectoMax) continue;
    const esquinas = [punto(c.tl), punto(c.tr), punto(c.br), punto(c.bl)];
    // Rectangularidad contra el cuadrilátero de sus esquinas: tolera
    // etiquetas algo giradas o en perspectiva.
    const areaQuad = Math.abs(areaPoligono(esquinas)) || bw * bh;
    const rectangularidad = Math.min(1, c.area / Math.max(areaQuad, 1));
    if (rectangularidad < o.rectMin) continue;
    const texto = c.oscuros / c.area;
    if (texto < o.textoMin || texto > o.textoMax) continue;
    const dist = Math.hypot((c.x0 + c.x1) / 2 - cx, (c.y0 + c.y1) / 2 - cy) / diag;
    const puntaje = rectangularidad * Math.sqrt(fraccion) * (1 - 0.6 * dist) * (texto > 0.05 ? 1 : 0.7);
    candidatas.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, esquinas, puntaje, rectangularidad, texto });
  }
  return candidatas.sort((a, b) => b.puntaje - a.puntaje).slice(0, o.maxCandidatas);
}

export function areaPoligono(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** La mejor etiqueta o null. */
export function mejorEtiqueta(imagen, opciones) {
  return detectarEtiquetas(imagen, opciones)[0] || null;
}

/** Intersección sobre unión de dos cajas { x0, y0, x1, y1 }. */
export function iouCajas(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  if (!inter) return 0;
  return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter);
}

/**
 * Escala una caja (y sus esquinas) de la imagen reducida a la original y le
 * suma un margen relativo, sin salirse de la imagen.
 */
export function escalarCaja(c, factor, ancho, alto, margen = 0.06) {
  const mx = (c.x1 - c.x0) * margen, my = (c.y1 - c.y0) * margen;
  return {
    x0: Math.max(0, Math.floor((c.x0 - mx) * factor)),
    y0: Math.max(0, Math.floor((c.y0 - my) * factor)),
    x1: Math.min(ancho, Math.ceil((c.x1 + mx) * factor)),
    y1: Math.min(alto, Math.ceil((c.y1 + my) * factor)),
    esquinas: (c.esquinas || []).map((p) => ({ x: p.x * factor, y: p.y * factor })),
  };
}
