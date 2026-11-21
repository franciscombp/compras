/**
 * Detector de etiquetas de precio, al estilo del escáner de documentos:
 * busca en la imagen el rectángulo de papel claro que contiene texto (la
 * etiqueta de góndola) para leer solo eso y no el resto del estante.
 *
 * Funciona sobre píxeles RGBA ({ data, width, height }) sin DOM, así que se
 * prueba en Node (tests/marco-test.mjs). La app lo llama con un fotograma
 * reducido a ~256 px de ancho.
 *
 * Método (afinado con fotos reales de góndola de Supermaxi):
 *  1. Luminancia y saturación por píxel.
 *  2. Varias máscaras: "papel blanco" (claro y sin color) en una escalera de
 *     umbrales de brillo, y "claro de cualquier color" con Otsu para
 *     etiquetas amarillas o de color. La escalera separa la etiqueta blanca
 *     de lo que la rodea aunque eso también sea claro (franja del estante,
 *     cartel de promoción).
 *  3. Componentes conexas de cada máscara con los agujeros rellenos (el texto
 *     oscuro de la etiqueta queda dentro de su componente).
 *  4. Cada componente se puntúa por rectangularidad, blancura, tamaño,
 *     proporción, cantidad de texto y cercanía al centro.
 *  5. Si un rectángulo limpio está dentro de otro, gana el de adentro: es la
 *     etiqueta, no el cartel o la franja que la contiene.
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
  aspectoMax: 4.2,
  rectMin: 0.72,        // área rellena / área de su cuadrilátero
  textoMin: 0.03,       // fracción de píxeles oscuros dentro (texto)
  textoMax: 0.6,
  luzMin: 95,           // una "etiqueta" muy oscura no es una etiqueta
  satBlanco: 62,        // saturación máxima (0-255) para contar como papel blanco
  escalera: [150, 170, 188, 204, 218, 230, 240],
  maxCandidatas: 6,
};

/**
 * Detecta etiquetas en una imagen RGBA. Devuelve candidatas ordenadas de
 * mejor a peor: { x0, y0, x1, y1, esquinas: [tl, tr, br, bl], puntaje,
 * rectangularidad, blancura, texto } en píxeles de la imagen recibida.
 */
export function detectarEtiquetas({ data, width: w, height: h }, opciones = {}) {
  const o = { ...OPCIONES, ...opciones };
  const n = w * h;
  if (!n) return [];

  // 1) Luminancia, saturación e histogramas (global y del centro)
  const lum = new Uint8Array(n);
  const sat = new Uint8Array(n);
  const hist = new Uint32Array(256);
  const histCentro = new Uint32Array(256);
  let nCentro = 0;
  const cx0 = w * 0.2, cx1 = w * 0.8, cy0 = h * 0.2, cy1 = h * 0.8;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = (r * 299 + g * 587 + b * 114) / 1000 | 0;
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    lum[p] = l;
    sat[p] = max ? ((max - min) * 255 / max) | 0 : 0;
    hist[l]++;
    const x = p % w, y = (p / w) | 0;
    if (x > cx0 && x < cx1 && y > cy0 && y < cy1) { histCentro[l]++; nCentro++; }
  }
  const otsu = Math.max(o.luzMin, umbralOtsu(hist, n));
  const otsuCentro = Math.max(o.luzMin, umbralOtsu(histCentro, nCentro || 1));

  // 2) Máscaras a probar
  const pruebas = [];
  const vistos = new Set();
  const agregar = (t, blanco) => {
    const k = `${blanco ? "b" : "c"}${Math.round(t / 6)}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    pruebas.push({ t, blanco });
  };
  for (const t of [otsu, otsuCentro, ...o.escalera]) if (t >= o.luzMin) agregar(t, true);
  agregar(otsu, false);
  agregar(otsuCentro, false);

  // Dos rejillas de "texto en papel": papel blanco con tinta negra (la
  // etiqueta típica) y papel de cualquier color (ofertas amarillas, rojas).
  const rejilla = rejillaTexto(lum, sat, w, h, o, false);
  const rejillaColor = rejillaTexto(lum, sat, w, h, o, true);
  const buf = {
    claro: new Uint8Array(n), fuera: new Uint8Array(n), etiqueta: new Int32Array(n), cola: new Int32Array(n), rejilla, rejillaColor,
  };
  let candidatas = [];
  for (const { t, blanco } of pruebas) {
    const { claro } = buf;
    if (blanco) for (let p = 0; p < n; p++) claro[p] = lum[p] > t && sat[p] < o.satBlanco ? 1 : 0;
    else for (let p = 0; p < n; p++) claro[p] = lum[p] > t ? 1 : 0;
    candidatas = candidatas.concat(componentes(w, h, buf, sat, o, blanco));
  }
  candidatas = candidatas.concat(bloquesDeTinta(rejilla, w, h, o));

  // Solo para el laboratorio: todas las candidatas, sin filtrar.
  if (opciones.diagnostico) return candidatas.sort((a, b) => b.puntaje - a.puntaje);

  // 5) Rectángulos uno dentro de otro:
  //    - si el de afuera está "sucio" (tiene color, como el cartel azul de
  //      promoción, o es poco rectangular), gana el de adentro: la etiqueta;
  //    - si el de afuera es igual de limpio, es la etiqueta completa y el de
  //      adentro es un pedazo de ella (parte con menos luz que quedó fuera a
  //      un nivel de brillo más alto): gana el de afuera.
  //    Entre casi iguales (misma etiqueta a dos umbrales) queda el de mejor puntaje.
  candidatas.sort((a, b) => b.puntaje - a.puntaje);
  const descartadas = new Set();
  for (const a of candidatas) {
    for (const b of candidatas) {
      if (a === b || descartadas.has(a) || descartadas.has(b)) continue;
      const areaA = (a.x1 - a.x0) * (a.y1 - a.y0), areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (!(areaB < areaA && contiene(a, b) && areaB > areaA * 0.08)) continue;
      const afueraSucio = a.blancura < b.blancura - 0.08 || a.rectangularidad < 0.9 || a.rectangularidad < b.rectangularidad - 0.06 || (a.refinado && !b.refinado);
      descartadas.add(afueraSucio ? a : b);
    }
  }
  const finales = [];
  for (const c of candidatas) {
    if (descartadas.has(c)) continue;
    if (finales.some((f) => iouCajas(f, c) > 0.7)) continue;
    finales.push(c);
  }
  unirBloquesDeFranja(finales, candidatas);
  return finales.slice(0, o.maxCandidatas);
}

/**
 * Bloques de texto sacados de una franja (etiqueta tan blanca como el
 * estante) pueden salir partidos entre umbrales: la mitad izquierda de la
 * etiqueta a un nivel de brillo y el precio a otro. Si el mejor candidato es
 * uno de esos bloques, se le suman los bloques del mismo renglón y cercanos.
 */
function unirBloquesDeFranja(finales, todas) {
  const top = finales[0];
  if (!top?.refinado) return;
  let unido = true;
  while (unido) {
    unido = false;
    for (const q of todas) {
      if (q === top || !q.refinado) continue;
      const altoT = top.y1 - top.y0, altoQ = q.y1 - q.y0;
      const solape = Math.min(top.y1, q.y1) - Math.max(top.y0, q.y0);
      const hueco = Math.max(q.x0 - top.x1, top.x0 - q.x1, 0);
      const yaDentro = q.x0 >= top.x0 && q.x1 <= top.x1 && q.y0 >= top.y0 && q.y1 <= top.y1;
      if (yaDentro || solape < 0.5 * Math.min(altoT, altoQ) || hueco > 0.8 * Math.max(altoT, altoQ)) continue;
      // Lado a lado sí; que el bloque crezca en alto (otra línea de texto de
      // la lata o del cartel de arriba) no.
      if (Math.max(top.y1, q.y1) - Math.min(top.y0, q.y0) > 1.2 * altoT) continue;
      top.x0 = Math.min(top.x0, q.x0); top.x1 = Math.max(top.x1, q.x1);
      top.y0 = Math.min(top.y0, q.y0); top.y1 = Math.max(top.y1, q.y1);
      unido = true;
    }
  }
  top.esquinas = [{ x: top.x0, y: top.y0 }, { x: top.x1, y: top.y0 }, { x: top.x1, y: top.y1 }, { x: top.x0, y: top.y1 }];
  for (let i = finales.length - 1; i > 0; i--) if (iouCajas(top, finales[i]) > 0.3) finales.splice(i, 1);
}

function contiene(a, b, holgura = 3) {
  return b.x0 >= a.x0 - holgura && b.y0 >= a.y0 - holgura && b.x1 <= a.x1 + holgura && b.y1 <= a.y1 + holgura;
}

/** Componentes de la máscara `buf.claro` con agujeros rellenos, ya puntuadas. */
function componentes(w, h, buf, sat, o, blanco) {
  const n = w * h;
  const { claro, fuera, etiqueta, cola } = buf;
  fuera.fill(0);
  etiqueta.fill(0);

  // Agujeros: lo oscuro que no toca el borde por camino oscuro está encerrado
  // por algo claro (el texto dentro de una etiqueta).
  let ini = 0, fin = 0;
  for (let x = 0; x < w; x++) {
    for (const p of [x, (h - 1) * w + x]) if (!claro[p] && !fuera[p]) { fuera[p] = 1; cola[fin++] = p; }
  }
  for (let y = 0; y < h; y++) {
    for (const p of [y * w, y * w + w - 1]) if (!claro[p] && !fuera[p]) { fuera[p] = 1; cola[fin++] = p; }
  }
  while (ini < fin) {
    const p = cola[ini++], x = p % w;
    let q;
    if (x > 0 && !claro[q = p - 1] && !fuera[q]) { fuera[q] = 1; cola[fin++] = q; }
    if (x < w - 1 && !claro[q = p + 1] && !fuera[q]) { fuera[q] = 1; cola[fin++] = q; }
    if (p >= w && !claro[q = p - w] && !fuera[q]) { fuera[q] = 1; cola[fin++] = q; }
    if (p < n - w && !claro[q = p + w] && !fuera[q]) { fuera[q] = 1; cola[fin++] = q; }
  }

  const salida = [];
  let id = 0;
  for (let semilla = 0; semilla < n; semilla++) {
    if (etiqueta[semilla] || (!claro[semilla] && fuera[semilla])) continue;
    id++;
    let area = 0, oscuros = 0, blancos = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
    let tl = 0, br = 0, tr = 0, bl = 0;
    ini = 0; fin = 0;
    etiqueta[semilla] = id; cola[fin++] = semilla;
    while (ini < fin) {
      const p = cola[ini++], x = p % w, y = (p / w) | 0;
      area++;
      if (!claro[p]) oscuros++;
      else if (sat[p] < o.satBlanco) blancos++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const s = x + y, d = x - y;
      if (s < sMin) { sMin = s; tl = p; }
      if (s > sMax) { sMax = s; br = p; }
      if (d > dMax) { dMax = d; tr = p; }
      if (d < dMin) { dMin = d; bl = p; }
      let q;
      if (x > 0 && !etiqueta[q = p - 1] && (claro[q] || !fuera[q])) { etiqueta[q] = id; cola[fin++] = q; }
      if (x < w - 1 && !etiqueta[q = p + 1] && (claro[q] || !fuera[q])) { etiqueta[q] = id; cola[fin++] = q; }
      if (p >= w && !etiqueta[q = p - w] && (claro[q] || !fuera[q])) { etiqueta[q] = id; cola[fin++] = q; }
      if (p < n - w && !etiqueta[q = p + w] && (claro[q] || !fuera[q])) { etiqueta[q] = id; cola[fin++] = q; }
    }

    const bw = x1 + 1 - x0, bh = y1 + 1 - y0;
    const fraccion = area / n;
    if (fraccion < o.areaMin) continue;
    const blancura = blancos / Math.max(1, area - oscuros);

    // Una franja que cruza la imagen de lado a lado es el estante, no la
    // etiqueta. Si la etiqueta es igual de blanca que el estante, la encuentra
    // bloquesDeTinta() por su texto.
    if ((x0 <= 1 && x1 >= w - 2) || (y0 <= 1 && y1 >= h - 2)) continue;

    if (fraccion > o.areaMax) continue;
    const aspecto = bw / bh;
    if (aspecto < o.aspectoMin || aspecto > o.aspectoMax) continue;
    const punto = (p) => ({ x: p % w, y: (p / w) | 0 });
    const esquinas = [punto(tl), punto(tr), punto(br), punto(bl)];
    // Rectangularidad contra el cuadrilátero de sus esquinas: tolera
    // etiquetas algo giradas o en perspectiva.
    const areaQuad = Math.abs(areaPoligono(esquinas)) || bw * bh;
    const rectangularidad = Math.min(1, area / Math.max(areaQuad, 1));
    if (rectangularidad < o.rectMin) continue;
    const texto = oscuros / area;
    if (texto < o.textoMin || texto > o.textoMax) continue;

    const caja = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    const densidad = densidadTexto(blanco ? buf.rejilla : buf.rejillaColor, caja);
    if (densidad < 0.04) continue;   // zona clara sin texto (reflejo, cartel en blanco)
    const puntaje = rectangularidad ** 4 * (0.35 + 0.65 * blancura) * Math.sqrt(fraccion) * factorCentro(caja, w, h) * factorTexto(densidad) * factorBorde(caja, w, h);
    salida.push({ ...caja, esquinas, puntaje, rectangularidad, blancura, texto, densidad, blanco });
  }
  return salida;
}

/**
 * Fracción de la caja cubierta por celdas de "texto en papel". Una etiqueta
 * es casi toda texto; un estante o un cartel con una etiqueta chica, poco.
 */
function factorTexto(densidad) {
  return Math.min(1, 0.25 + densidad * 2.5);
}

/** Quien captura apunta a la etiqueta: cuanto más al centro, mejor. */
function factorCentro(c, w, h) {
  const d = Math.hypot((c.x0 + c.x1) / 2 - w / 2, (c.y0 + c.y1) / 2 - h / 2) / Math.hypot(w / 2, h / 2);
  return Math.max(0.05, 1 - d) ** 1.3;
}

function densidadTexto(r, c) {
  const gx0 = Math.max(0, Math.floor(c.x0 / r.cw)), gy0 = Math.max(0, Math.floor(c.y0 / r.ch));
  const gx1 = Math.min(r.gw, Math.ceil(c.x1 / r.cw)), gy1 = Math.min(r.gh, Math.ceil(c.y1 / r.ch));
  if (gx1 <= gx0 || gy1 <= gy0) return 0;
  const W = r.gw + 1, I = r.integral;
  const suma = I[gy1 * W + gx1] - I[gy0 * W + gx1] - I[gy1 * W + gx0] + I[gy0 * W + gx0];
  return suma / ((gx1 - gx0) * (gy1 - gy0));
}

/**
 * Quien apunta la cámara a una etiqueta la deja entera dentro de la foto:
 * lo que toca el borde suele ser estante, cartel o producto cortado.
 */
function factorBorde(c, w, h) {
  const m = 2;
  const lados = (c.x0 <= m) + (c.y0 <= m) + (c.x1 >= w - m) + (c.y1 >= h - m);
  return 0.7 ** lados;
}

/**
 * Texto negro sobre papel blanco, sin depender de dónde termina la etiqueta:
 * la imagen se divide en celdas; una celda es "texto en papel" si tiene tinta
 * (oscura y sin color) y papel (claro y sin color) en ella o a su alrededor.
 * Las celdas vecinas se agrupan y cada grupo es un candidato. Encuentra la
 * etiqueta aunque sea igual de blanca que el estante donde está pegada, e
 * ignora el texto impreso sobre latas o carteles de color.
 */
function rejillaTexto(lum, sat, w, h, o, color) {
  const cw = Math.max(2, Math.round(w * 0.025)), ch = Math.max(2, Math.round(h * 0.018));
  const gw = Math.ceil(w / cw), gh = Math.ceil(h / ch);
  const tinta = new Uint16Array(gw * gh), papel = new Uint16Array(gw * gh), total = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const fila = ((y / ch) | 0) * gw;
    for (let x = 0; x < w; x++) {
      const p = y * w + x, c = fila + ((x / cw) | 0);
      total[c]++;
      const l = lum[p], s2 = sat[p];
      if (l < 100 && (color || s2 < 110)) tinta[c]++;
      else if (l > 165 && (color || s2 < o.satBlanco)) papel[c]++;
    }
  }
  const esTexto = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const c = gy * gw + gx;
    if (tinta[c] < total[c] * 0.05) continue;
    // papel en la celda o alrededor (los trazos gruesos del precio llenan su celda)
    let pa = 0, to = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      pa += papel[ny * gw + nx]; to += total[ny * gw + nx];
    }
    if (pa >= to * 0.25) esTexto[c] = 1;
  }
  const W = gw + 1, integral = new Uint32Array(W * (gh + 1));
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    integral[(gy + 1) * W + gx + 1] = esTexto[gy * gw + gx] + integral[gy * W + gx + 1] + integral[(gy + 1) * W + gx] - integral[gy * W + gx];
  }
  return { cw, ch, gw, gh, tinta, papel, esTexto, integral };
}

/** Grupos de celdas de texto vecinas; los grupos del mismo renglón y cercanos se unen. */
function bloquesDeTinta(r, w, h, o) {
  const { cw, ch, gw, gh, tinta, papel, esTexto } = r;
  const n = w * h;
  const grupo = new Int32Array(gw * gh);
  const grupos = [];
  let g = 0;
  for (let i = 0; i < gw * gh; i++) {
    if (!esTexto[i] || grupo[i]) continue;
    g++;
    let gxa = gw, gya = gh, gxb = 0, gyb = 0, celdas = 0, nt = 0, np = 0;
    const pila = [i];
    grupo[i] = g;
    while (pila.length) {
      const c = pila.pop(), gx = c % gw, gy = (c / gw) | 0;
      celdas++; nt += tinta[c]; np += papel[c];
      if (gx < gxa) gxa = gx; if (gx > gxb) gxb = gx;
      if (gy < gya) gya = gy; if (gy > gyb) gyb = gy;
      // vecinas a distancia 2: une letras y renglones de la misma etiqueta
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const k = ny * gw + nx;
        if (esTexto[k] && !grupo[k]) { grupo[k] = g; pila.push(k); }
      }
    }
    if (celdas >= 3) grupos.push({ gxa, gya, gxb, gyb, celdas, nt, np });
  }

  // Bloques lado a lado del mismo renglón (nombre y QR a la izquierda, precio
  // a la derecha) son la misma etiqueta; que crezca en alto, no.
  let unido = true;
  while (unido) {
    unido = false;
    for (let i = 0; i < grupos.length && !unido; i++) for (let j = i + 1; j < grupos.length && !unido; j++) {
      const a = grupos[i], b = grupos[j];
      const altoA = a.gyb - a.gya + 1, altoB = b.gyb - b.gya + 1;
      const solape = Math.min(a.gyb, b.gyb) - Math.max(a.gya, b.gya) + 1;
      const hueco = Math.max(b.gxa - a.gxb - 1, a.gxa - b.gxb - 1, 0) * cw;
      const altoU = Math.max(a.gyb, b.gyb) - Math.min(a.gya, b.gya) + 1;
      if (solape >= 0.5 * Math.min(altoA, altoB) && hueco <= 0.8 * Math.max(altoA, altoB) * ch && altoU <= 1.2 * Math.max(altoA, altoB)) {
        a.gxa = Math.min(a.gxa, b.gxa); a.gxb = Math.max(a.gxb, b.gxb);
        a.gya = Math.min(a.gya, b.gya); a.gyb = Math.max(a.gyb, b.gyb);
        a.celdas += b.celdas; a.nt += b.nt; a.np += b.np;
        grupos.splice(j, 1);
        unido = true;
      }
    }
  }

  const salida = [];
  for (const q of grupos) {
    if (q.celdas < 6) continue;
    const x0 = Math.max(0, (q.gxa - 1) * cw), y0 = Math.max(0, (q.gya - 1) * ch);
    const x1 = Math.min(w, (q.gxb + 2) * cw), y1 = Math.min(h, (q.gyb + 2) * ch);
    const area = (x1 - x0) * (y1 - y0), fr = area / n;
    if (fr < o.areaMin || fr > o.areaMax) continue;
    const aspecto = (x1 - x0) / (y1 - y0);
    if (aspecto < 0.6 || aspecto > 6) continue;
    const texto = q.nt / area, blancura = Math.min(1, q.np / Math.max(1, area - q.nt));
    const caja = { x0, y0, x1, y1 };
    const densidad = densidadTexto(r, caja);
    salida.push({
      ...caja,
      esquinas: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      puntaje: 0.9 * (0.35 + 0.65 * blancura) * Math.sqrt(fr) * factorCentro(caja, w, h) * factorTexto(densidad) * factorBorde(caja, w, h),
      rectangularidad: 0.9, blancura, texto, densidad, blanco: true, refinado: true,
    });
  }
  return salida;
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
