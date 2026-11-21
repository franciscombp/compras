/**
 * Lectura de etiquetas: preprocesado de imagen + parser del texto OCR.
 * Módulo compartido entre la app (assets/app.js) y el laboratorio de
 * pruebas (web/lab/etiquetas.html) para que ambos usen exactamente la misma
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

const MAPA_DIGITOS = { O: "0", o: "0", Q: "0", D: "0", U: "0", u: "0", I: "1", l: "1", "|": "1", i: "1", Z: "2", z: "2", S: "5", s: "5", B: "8", G: "6" };

/**
 * El OCR confunde letras con dígitos dentro de los precios ($O.99, 1.5O).
 * Solo corrige tokens con pinta de número (contienen al menos un dígito y
 * un separador decimal) para no tocar palabras reales.
 */
function corregirDigitos(t) {
  return t.replace(/[$]?\s?[0-9OoQDUuIl|iZzSsBG]{1,4}[.,][0-9OoQDUuIl|iZzSsBG]{2}(?![\d.,])/g, (tok) => {
    if (!/\d/.test(tok)) return tok;               // sin ningún dígito real: es palabra
    if (!/[OoQDUuIl|iZzSsBG]/.test(tok)) return tok; // ya está limpio
    return tok.replace(/[OoQDUuIl|iZzSsBG]/g, (c) => MAPA_DIGITOS[c]);
  });
}

/**
 * Las góndolas imprimen los centavos pequeños y elevados ("1 99"): el OCR
 * los separa con espacio. Solo se une cuando hay una pista de precio antes
 * ($ o palabra clave) para no romper medidas como "6 x 80".
 */
function unirCentavosSueltos(t) {
  return t
    .replace(/(\$\s*|(?:pvp|precio|ahora|oferta|lleva|afiliado)\s*[:.]?\s*)(\d{1,3})\s+(\d{2})(?!\d)/gi,
      (_, pre, ent, cent) => `${pre}${ent}.${cent}`)
    // "0. 79" / "0 .79": el punto quedó pegado a un lado y los centavos al otro
    .replace(/(^|[^\d.,])(\d{1,3})\s*[.,]\s+(\d{2})(?![\d.,])/g, (_, a, ent, cent) => `${a}${ent}.${cent}`)
    .replace(/(^|[^\d.,])(\d{1,3})\s+[.,]\s*(\d{2})(?![\d.,])/g, (_, a, ent, cent) => `${a}${ent}.${cent}`);
}

/**
 * Una línea que es solo "1 39" (entero grande y centavos elevados) es un
 * precio: en las etiquetas de góndola nada más se imprime así.
 */
function unirPrecioDeLinea(lineas) {
  return lineas.map((l) => l.replace(/^\s*\$?\s*(\d{1,3})\s+(\d{2})\s*$/, "$1.$2"));
}

/**
 * Supermaxi y otras cadenas escriben "US.$" antes del precio. El OCR suele
 * leer ese "$" como 5, 8 o S ("US.80.95", "US 51.93") o perderlo y también
 * el punto decimal ("US 149"). Se normaliza a "US.$ 0.95" / "US.$ 1.49".
 */
function normalizarMoneda(t) {
  return t
    .replace(/\bU\.?\s?S\b\.?\s*(?:\$|[58S](?=\d[.,]\d{2}(?!\d)))?\s*(?=\d)/g, "US.$ ")
    .replace(/\bU\.?\s?S\b\.?\s*\$(?!\s*\d)/g, "US.$ ")
    .replace(/US\.\$\s*(\d)(\d{2})(?![\d.,])/g, "US.$ $1.$2");
}

/** EAN-13 a partir de los 12 dígitos impresos (les falta el de control). */
export function completarEAN(digitos) {
  const d = String(digitos || "").replace(/\D/g, "");
  if (d.length === 13) return d;
  if (d.length !== 12) return null;
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(d[i]) * (i % 2 ? 3 : 1);
  return d + ((10 - (suma % 10)) % 10);
}

// Marcas del formato de etiqueta de Supermaxi (y parecidos)
const RE_FORMATO_GONDOLA = /afiliad|exento\s*de\s*iva|de\s+iva\b|grava\s*iva|us\.?\s?\$/i;
const RE_LINEA_PARADA = /exento|\bde\s*iva\b|grava|afiliad|us\.?\s?\$|\d{7,}|participante/i;

/**
 * Nombre en las etiquetas de góndola tipo Supermaxi: las 1-2 líneas que hay
 * justo antes de "EXENTO DE IVA" (si no se leyó, las primeras del texto),
 * limpiando la basura que deja el OCR. Así no se cuela el texto de la lata o
 * del cartel que quedó en la foto.
 */
function nombreDeGondola(lineas) {
  const limpiar = (l) => l
    .replace(/[“”"'|\[\]{}_—–·•*]+/g, " ")
    .split(/\s+/)
    .filter((tok) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(tok) || /^\d+(?:[.,]\d+)?(?:g|gr|grs|kg|ml|l|lt|lts|cc|lb|oz)$/i.test(tok))
    .join(" ")
    .trim();
  const esNombre = (l) => l && !RE_LINEA_PARADA.test(l) && (l.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length >= 3;
  const mayusCorta = (l) => l === l.toUpperCase() && l.length <= 24;

  const parada = lineas.findIndex((l) => /exento|\bde\s*iva\b|grava/i.test(l));
  if (parada > 0) {
    const previas = [];
    for (let i = parada - 1; i >= 0 && previas.length < 2; i--) {
      const l = limpiar(lineas[i]);
      if (!l) continue;
      if (!esNombre(l)) break;
      if (previas.length && !mayusCorta(l)) break;   // la 2.ª línea solo si parece parte del nombre
      previas.unshift(l);
    }
    if (previas.length) return previas.join(" ");
  }
  const nombre = [];
  for (const crudo of lineas) {
    const l = limpiar(crudo);
    if (!l) continue;
    if (!esNombre(l)) { if (nombre.length) break; continue; }
    if (nombre.length && !mayusCorta(l)) break;
    nombre.push(l);
    if (nombre.length === 2) break;
  }
  return nombre.join(" ");
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
export function parseEtiqueta(texto, pistas = {}) {
  const lineas = unirPrecioDeLinea(String(texto || "").split("\n"));
  let t = lineas.join("\n").replace(/\s+/g, " ");
  t = normalizarMoneda(t);
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
    // Supermaxi: el precio grande es el de afiliado (con tarjeta); el de
    // "NO AFILIADO" va chico debajo. Se guarda aparte.
    const noAfiliado = /no\s*afiliad/.test(antesDe);
    if (noAfiliado) peso -= 2;
    else if (/afiliad/.test(antesDe)) peso += 3;
    const valor = parseNumero(m[2]);
    // En góndola el precio es el texto más grande: si coincide con la
    // palabra más alta que vio el OCR, es casi seguro el bueno.
    if (pistas.precioGrande !== undefined && Math.abs(valor - pistas.precioGrande) < 0.005) peso += 5;
    candidatos.push({ valor, peso, index: m.index, noAfiliado });
  }
  // El número más grande de la foto con centavos (armado con los centavos
  // elevados) es el precio aunque el texto lo haya partido.
  if (pistas.precioGrande !== undefined && !Number.isInteger(pistas.precioGrande) &&
      !candidatos.some((c) => Math.abs(c.valor - pistas.precioGrande) < 0.005)) {
    candidatos.push({ valor: pistas.precioGrande, peso: 5, index: -1, noAfiliado: false });
  }
  const precioNoAfiliado = candidatos.find((c) => c.noAfiliado)?.valor ?? null;
  // Entero con símbolo ("$3") como último recurso
  const entero = t.match(/\$\s*(\d{1,4})(?![\d.,])/);
  if (entero && !candidatos.length) candidatos.push({ valor: Number(entero[1]), peso: 0, index: entero.index });
  candidatos.sort((a, b) => b.peso - a.peso || a.index - b.index);
  let precio = promo ? promo.precio : (candidatos[0]?.valor ?? pistas.precioGrande ?? null);
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

  // --- Código impreso en la etiqueta (EAN sin dígito de control) ------------
  const codImpreso = texto.match(/(?<!\d)(\d{12,13})(?!\d)/);
  const codigo = codImpreso ? completarEAN(codImpreso[1]) : null;

  // --- Nombre ----------------------------------------------------------------
  const formatoGondola = RE_FORMATO_GONDOLA.test(texto) || /US\.\$/.test(t);
  const nombreGondola = formatoGondola ? nombreDeGondola(lineas) : "";

  // Si no, la línea "más de producto" del texto
  const RUIDO = /pvp|precio|oferta|ahora|antes|lleva|gratis|paga|ahorr|promo|desc|unid|total|caja|cod|sku|cont\.?\s|neto|escurr|afiliad|exento|\biva\b|participante/i;
  const nombre = nombreGondola || texto.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-záéíóúñ]{4,}/i.test(l) && !RUIDO.test(l))
    .sort((a, b) => {
      // prefiere líneas sin dígitos; entre iguales, la más larga
      const da = /\d/.test(a) ? 1 : 0, db = /\d/.test(b) ? 1 : 0;
      return da - db || b.length - a.length;
    })[0] || "";

  const salida = { precio, contenido, unidad, unidades, nombre };
  if (precioNoAfiliado !== null && precioNoAfiliado !== precio) salida.precioNoAfiliado = precioNoAfiliado;
  if (codigo) salida.codigo = codigo;
  return salida;
}

/**
 * Recorre las palabras que devuelve Tesseract (con sus cajas) y busca el
 * número "más alto" de la imagen. En una etiqueta de góndola ese casi
 * siempre es el precio. Solo cuenta si destaca sobre el tamaño mediano,
 * para no confundir una foto de texto parejo.
 */
export function extraerPistas(data) {
  const words = [];
  const push = (w) => { if (w?.text && w?.bbox) words.push(w); };
  if (Array.isArray(data?.words)) data.words.forEach(push);
  else if (Array.isArray(data?.blocks)) {
    for (const b of data.blocks)
      for (const p of b.paragraphs || [])
        for (const l of p.lines || [])
          for (const w of l.words || []) push(w);
  }
  if (!words.length) return {};

  const altoDe = (w) => (w.bbox.y1 ?? 0) - (w.bbox.y0 ?? 0);
  let mejor = null;
  for (const w of words) {
    const m = w.text.match(/^\$?(\d{1,4}(?:[.,]\d{1,2})?)[.,]?\$?$/);
    if (!m) continue;
    let valor = parseNumero(m[1]);
    const alto = altoDe(w);
    // Centavos elevados: el precio grande ("0." o "1") y, a su derecha y
    // arriba, dos dígitos más chicos ("79").
    if (!/[.,]\d/.test(w.text) && valor < 1000) {
      const cent = words.find((c) => c !== w && /^[0-9OoUu]{2}$/.test(c.text) &&
        c.bbox.x0 >= w.bbox.x1 - alto * 0.2 && c.bbox.x0 - w.bbox.x1 < alto * 0.9 &&
        altoDe(c) < alto * 0.85 && altoDe(c) > alto * 0.25 && c.bbox.y0 < w.bbox.y0 + alto * 0.35);
      if (cent) valor = Math.round((Math.floor(valor) + Number(cent.text.replace(/[OoUu]/g, "0")) / 100) * 100) / 100;
    }
    if (valor <= 0 || valor > 5000) continue;
    if (alto > 0 && (!mejor || alto > mejor.alto)) mejor = { valor, alto };
  }
  if (!mejor) return {};

  const altos = words.map((w) => (w.bbox.y1 ?? 0) - (w.bbox.y0 ?? 0)).filter((x) => x > 0).sort((a, b) => a - b);
  const mediana = altos[Math.floor(altos.length / 2)] || 0;
  return mejor.alto >= mediana * 1.6 ? { precioGrande: mejor.valor } : {};
}

/** Parsea una lectura completa de Tesseract: texto + pista del texto grande. */
export function parseLectura(data) {
  return parseEtiqueta(data?.text || "", extraerPistas(data));
}

/**
 * Extrae contenido/unidad/pack del NOMBRE de un producto de catálogo
 * ("Atún lomitos 3 x 170 g", "Leche entera 1L"). Lo usa el catálogo de
 * súper para normalizar productos descargados.
 */
export function extraerMedidaDeNombre(nombre) {
  const t = String(nombre || "");
  let unidades = 1, contenido = null, unidad = null;
  const pack = t.match(new RegExp(`(\\d{1,2})\\s*(?:x|×)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${RE_UNIDAD})\\b`, "i"));
  const solo = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${RE_UNIDAD})\\b`, "i"));
  const m = pack ? { n: pack[1], v: pack[2], u: pack[3] } : solo ? { n: 1, v: solo[1], u: solo[2] } : null;
  if (m) {
    const conv = UNIDADES_MEDIDA[m.u.toLowerCase()];
    if (conv) {
      unidades = Math.max(1, Number(m.n) || 1);
      contenido = Math.round(parseNumero(m.v) * conv[1]);
      unidad = conv[0];
      if (contenido <= 0) { contenido = null; unidad = null; unidades = 1; }
    }
  } else {
    // "15 unidades", "12 und": productos que se cuentan, no se pesan.
    const porUnidades = t.match(/(\d{1,3})\s*(?:unidades|unid|und|un|u)\.?\b/i);
    if (porUnidades) {
      const n = Number(porUnidades[1]);
      if (n > 0 && n <= 500) { contenido = n; unidad = "unidad"; unidades = 1; }
    }
  }
  return { contenido, unidad, unidades };
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
