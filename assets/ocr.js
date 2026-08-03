/**
 * Lectura de etiquetas: preprocesado de imagen + parser del texto OCR.
 * Módulo compartido entre la app (assets/app.js) y el laboratorio de
 * pruebas (lab/etiquetas.html) para que ambos usen exactamente la misma
 * lógica.
 */

export function parseNumero(s) {
  return Number(String(s).replace(",", "."));
}

export const UNIDADES_MEDIDA = {
  kg: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000], kgs: ["g", 1000],
  g: ["g", 1], gr: ["g", 1], grs: ["g", 1], gramo: ["g", 1], gramos: ["g", 1],
  mg: ["g", 0.001],
  lb: ["g", 453.6], lbs: ["g", 453.6], libra: ["g", 453.6], libras: ["g", 453.6],
  oz: ["g", 28.35],
  ml: ["ml", 1], cc: ["ml", 1], cl: ["ml", 10],
  l: ["ml", 1000], lt: ["ml", 1000], lts: ["ml", 1000], litro: ["ml", 1000], litros: ["ml", 1000],
};
export const RE_UNIDAD = "kgs?|kilos?|grs?|gramos?|mg|lbs?|libras?|oz|ml|cc|cl|lts?|litros?|g|l";

const MAPA_DIGITOS = { O: "0", o: "0", Q: "0", D: "0", I: "1", l: "1", "|": "1", i: "1", Z: "2", z: "2", S: "5", s: "5", B: "8", G: "6" };

/**
 * El OCR confunde letras con dígitos dentro de los precios ($O.99, 1.5O).
 * Solo corrige tokens con pinta de número (contienen al menos un dígito y
 * un separador decimal) para no tocar palabras reales.
 */
function corregirDigitos(t) {
  return t.replace(/[$]?\s?[0-9OoQDIl|iZzSsBG]{1,4}[.,][0-9OoQDIl|iZzSsBG]{2}(?![\d.,])/g, (tok) => {
    if (!/\d/.test(tok)) return tok;             // sin ningún dígito real: es palabra
    if (!/[OoQDIl|iZzSsBG]/.test(tok)) return tok; // ya está limpio
    return tok.replace(/[OoQDIl|iZzSsBG]/g, (c) => MAPA_DIGITOS[c]);
  });
}

/**
 * Las góndolas imprimen los centavos pequeños y elevados ("1 99"): el OCR
 * los separa con espacio. Solo se une cuando hay una pista de precio antes
 * ($ o palabra clave) para no romper medidas como "6 x 80".
 */
function unirCentavosSueltos(t) {
  return t.replace(/(\$\s*|(?:pvp|precio|ahora|oferta|lleva)\s*[:.]?\s*)(\d{1,3})\s+(\d{2})(?!\d)/gi,
    (_, pre, ent, cent) => `${pre}${ent}.${cent}`);
}

/**
 * Extrae precio, contenido, nº de envases y candidato a nombre del texto OCR.
 * Entiende los formatos habituales de góndola:
 *  - precio con o sin símbolo, cerca de palabras clave (PVP, precio, ahora, oferta)
 *  - "antes / ahora": se queda con el precio de oferta, no con el tachado
 *  - dígitos mal leídos por el OCR ($O.99 -> $0.99) y centavos elevados ("1 99")
 *  - promos "2 x $5.00" (precio total del combo, unidades = 2)
 *  - packs: "6 x 80 g", "pack 6 unidades", "3 un x 170g"
 *  - medidas en g, kg, mg, ml, cc, cl, l, lb, oz (convierte a g / ml);
 *    prefiere el peso neto sobre el escurrido/drenado
 *  - precio unitario ya impreso ("$3.99/kg", "1.25 por 100 g") - si la etiqueta
 *    no trae gramaje, el contenido se deduce de ahí
 */
export function parseEtiqueta(texto) {
  let t = texto.replace(/\s+/g, " ");
  t = corregirDigitos(t);
  t = unirCentavosSueltos(t);

  // --- Precio unitario impreso ("$3.99/kg", "0.85 por 100 g", "1.10 c/u") --
  // Se detecta primero y se retira del texto: su número no es el precio total
  // ni su medida ("100 g") es el contenido del envase.
  let unitarioImpreso = null; // { base, porCien } o { base: "unidad", porUno }
  const unit = t.match(new RegExp(`(?:\\$|usd)?\\s*(\\d{1,4}[.,]\\d{1,2})\\s*(?:\\/|por\\s+)(?:cada\\s+)?(100\\s*)?(${RE_UNIDAD})\\b`, "i"));
  if (unit) {
    const conv = UNIDADES_MEDIDA[unit[3].toLowerCase()];
    if (conv) {
      const cantidadRef = (unit[2] ? 100 : 1) * conv[1]; // en g o ml
      unitarioImpreso = { base: conv[0], porCien: (parseNumero(unit[1]) / cantidadRef) * 100 };
      t = t.replace(unit[0], " ");
    }
  }
  const cu = t.match(/(?:\$\s*)?(\d{1,4}[.,]\d{2})\s*c\s*\/?\s*u\b/i);
  if (cu) { unitarioImpreso = { base: "unidad", porUno: parseNumero(cu[1]) }; }

  // --- Promo "2 x $5.00" / "3 x 2.10": precio total del combo ---------------
  let promo = null;
  const promoM = t.match(new RegExp(`(\\d{1,2})\\s*[x×]\\s*\\$\\s*(\\d{1,4}(?:[.,]\\d{1,2})?)`, "i"))
    || t.match(new RegExp(`(\\d{1,2})\\s*[x×]\\s*(\\d{1,4}[.,]\\d{2})\\b(?!\\s*(?:${RE_UNIDAD})\\b)`, "i"));
  if (promoM) {
    const n = Number(promoM[1]), v = parseNumero(promoM[2]);
    if (n >= 2 && n <= 12 && v > 0 && v <= 5000) {
      promo = { unidades: n, precio: v };
      t = t.replace(promoM[0], " ");
    }
  }

  // --- Precio: junta candidatos y elige el más creíble ---------------------
  const candidatos = [];
  for (const m of t.matchAll(/(\$|usd\s*)?\s*(\d{1,4}[.,]\d{2})(?![\d])/gi)) {
    const antesDe = t.slice(Math.max(0, m.index - 18), m.index).toLowerCase();
    let peso = 0;
    if (m[1]) peso += 2;                                             // trae símbolo
    if (/pvp|precio|ahora|oferta|lleva|paga/.test(antesDe)) peso += 3; // palabra clave
    if (/antes|normal|regular|tachado/.test(antesDe)) peso -= 4;      // precio viejo
    if (/\/|por\s*$/.test(antesDe)) peso -= 2;                        // es unitario, no total
    candidatos.push({ valor: parseNumero(m[2]), peso, index: m.index });
  }
  // Entero con símbolo ("$3") como último recurso
  const entero = t.match(/\$\s*(\d{1,4})(?![\d.,])/);
  if (entero && !candidatos.length) candidatos.push({ valor: Number(entero[1]), peso: 0, index: entero.index });
  candidatos.sort((a, b) => b.peso - a.peso || a.index - b.index);
  let precio = promo ? promo.precio : (candidatos[0]?.valor ?? null);
  if (precio !== null && (precio <= 0 || precio > 5000)) precio = null;

  // --- Pack: "6 x 80 g", "pack de 6", "x6", "6 unid" -----------------------
  let unidades = 1;
  const packMedida = t.match(new RegExp(`(\\d{1,2})\\s*(?:x|×)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${RE_UNIDAD})\\b`, "i"));
  const packSolo = t.match(/(?:pack\s*(?:de\s*)?|x\s?)(\d{1,2})\s*(?:un(?:id(?:ades)?)?\.?\b|$)/i)
    || t.match(/(\d{1,2})\s*un(?:id(?:ades)?)?\.?\b/i);
  if (packMedida) unidades = Number(packMedida[1]);
  else if (packSolo) unidades = Number(packSolo[1]);
  else if (promo) unidades = promo.unidades;
  if (unidades < 1 || unidades > 48) unidades = 1;

  // --- Contenido por envase ------------------------------------------------
  // Junta todas las medidas y pondera el contexto: "cont. neto 170 g" gana,
  // "escurrido 120 g" pierde.
  let contenido = null, unidad = null;
  if (packMedida) {
    const conv = UNIDADES_MEDIDA[packMedida[3].toLowerCase()];
    if (conv) {
      unidad = conv[0];
      contenido = Math.round(parseNumero(packMedida[2]) * conv[1]);
    }
  } else {
    const medidas = [];
    for (const m of t.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${RE_UNIDAD})\\b`, "gi"))) {
      const conv = UNIDADES_MEDIDA[m[2].toLowerCase()];
      if (!conv) continue;
      const valor = Math.round(parseNumero(m[1]) * conv[1]);
      if (valor <= 0) continue;
      const antesDe = t.slice(Math.max(0, m.index - 16), m.index).toLowerCase();
      let peso = 0;
      if (/cont|neto|peso/.test(antesDe)) peso += 3;   // peso declarado
      if (/escurr|drenad/.test(antesDe)) peso -= 3;    // peso escurrido
      medidas.push({ valor, base: conv[0], peso, index: m.index });
    }
    medidas.sort((a, b) => b.peso - a.peso || a.index - b.index);
    if (medidas[0]) { contenido = medidas[0].valor; unidad = medidas[0].base; }
  }
  if (contenido !== null && contenido <= 0) { contenido = null; unidad = null; }

  // Sin gramaje pero con precio total y unitario impreso => deducir contenido
  if (!contenido && precio && unitarioImpreso?.porCien) {
    contenido = Math.round((precio / unitarioImpreso.porCien) * 100 / unidades);
    unidad = unitarioImpreso.base;
  }

  // --- Nombre: la línea "más de producto" del texto ------------------------
  const RUIDO = /pvp|precio|oferta|ahora|antes|lleva|gratis|paga|ahorr|promo|desc|unid|total|caja|cod|sku|cont\.?\s|neto|escurr/i;
  const nombre = texto.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-záéíóúñ]{4,}/i.test(l) && !RUIDO.test(l))
    .sort((a, b) => {
      // prefiere líneas sin dígitos; entre iguales, la más larga
      const da = /\d/.test(a) ? 1 : 0, db = /\d/.test(b) ? 1 : 0;
      return da - db || b.length - a.length;
    })[0] || "";

  return { precio, contenido, unidad, unidades, nombre };
}

/**
 * Prepara la imagen para el OCR: escala a un tamaño legible, convierte a
 * gris y estira el contraste (percentiles 2-98). Con etiquetas de góndola
 * esto reduce bastante los errores de lectura.
 */
export function preprocesarEtiqueta(fuente) {
  const w0 = fuente.videoWidth || fuente.naturalWidth || fuente.width;
  const h0 = fuente.videoHeight || fuente.naturalHeight || fuente.height;
  if (!w0 || !h0) return fuente;

  // Escala: lado menor ~900px (Tesseract lee mejor texto grande), tope 2.5x
  // y tope de área para no reventar memoria en fotos de cámara.
  let escala = Math.min(2.5, Math.max(1, 900 / Math.min(w0, h0)));
  if (w0 * h0 * escala * escala > 2.6e6) escala = Math.sqrt(2.6e6 / (w0 * h0));

  const w = Math.max(1, Math.round(w0 * escala));
  const h = Math.max(1, Math.round(h0 * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fuente, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const total = w * h;
  const gris = new Uint8ClampedArray(total);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    gris[p] = g;
    hist[g]++;
  }
  // Percentiles 2% y 98% del histograma -> rango real de la foto
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const rango = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = Math.min(255, Math.max(0, ((gris[p] - lo) * 255) / rango));
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
