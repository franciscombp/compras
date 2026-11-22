// GENERADO por scripts/logica-ios.mjs desde web/ (ocr.js, store.js, ahorro.js).
// No lo edites a mano: cambia la web y corre `npm run logica:ios`.
(function (g) {
  if (typeof g.console === "undefined") g.console = { log() {}, warn() {}, error() {} };
  if (typeof g.localStorage !== "undefined") return;
  var datos = {};
  var sucio = false;
  var tiene = function (k) { return Object.prototype.hasOwnProperty.call(datos, k); };
  g.localStorage = {
    getItem: function (k) { return tiene(k) ? datos[k] : null; },
    setItem: function (k, v) { datos[k] = String(v); sucio = true; },
    removeItem: function (k) { if (tiene(k)) { delete datos[k]; sucio = true; } },
    clear: function () { datos = {}; sucio = true; },
    key: function (i) { var ks = Object.keys(datos); return i < ks.length ? ks[i] : null; },
    get length() { return Object.keys(datos).length; },
  };
  g.QuantoAlmacen = {
    cargar: function (json) { try { datos = json ? JSON.parse(json) : {}; } catch (e) { datos = {}; } sucio = false; },
    volcar: function () { sucio = false; return JSON.stringify(datos); },
    sucio: function () { return sucio; },
  };
})(globalThis);
var __m = {};

// ---- web/assets/ocr.js ----
__m.ocr = (function () {
/**
 * Lectura de etiquetas: preprocesado de imagen + parser del texto OCR.
 * Módulo compartido entre la app (assets/app.js) y el laboratorio de
 * pruebas (web/lab/etiquetas.html) para que ambos usen exactamente la misma
 * lógica.
 */

function parseNumero(s) {
  return Number(String(s).replace(",", "."));
}

const UNIDADES_MEDIDA = {
  kg: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000], kgs: ["g", 1000],
  g: ["g", 1], gr: ["g", 1], grs: ["g", 1], gramo: ["g", 1], gramos: ["g", 1],
  mg: ["g", 0.001],
  lb: ["g", 453.6], lbs: ["g", 453.6], libra: ["g", 453.6], libras: ["g", 453.6],
  oz: ["g", 28.35],
  ml: ["ml", 1], cc: ["ml", 1], cl: ["ml", 10],
  l: ["ml", 1000], lt: ["ml", 1000], lts: ["ml", 1000], litro: ["ml", 1000], litros: ["ml", 1000],
};
const RE_UNIDAD = "kgs?|kilos?|grs?|gramos?|mg|lbs?|libras?|oz|ml|cc|cl|lts?|litros?|g|l";

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
function completarEAN(digitos) {
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
function parseEtiqueta(texto, pistas = {}) {
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
  // (sin lookbehind: Safari anterior a 16.4 no lo entiende y tumbaría el módulo)
  const codImpreso = texto.match(/(?:^|\D)(\d{12,13})(?!\d)/);
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
function extraerPistas(data) {
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
function parseLectura(data) {
  return parseEtiqueta(data?.text || "", extraerPistas(data));
}

/**
 * Extrae contenido/unidad/pack del NOMBRE de un producto de catálogo
 * ("Atún lomitos 3 x 170 g", "Leche entera 1L"). Lo usa el catálogo de
 * súper para normalizar productos descargados.
 */
function extraerMedidaDeNombre(nombre) {
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
function preprocesarEtiqueta(fuente) {
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

return { parseNumero, UNIDADES_MEDIDA, RE_UNIDAD, completarEAN, parseEtiqueta, extraerPistas, parseLectura, extraerMedidaDeNombre, preprocesarEtiqueta };
})();

// ---- web/data/store.js ----
__m.store = (function () {
/**
 * Capa de datos de Justo — offline-first, preparada para backend futuro.
 * V3: modelo de 3 estados de precio + listas múltiples.
 *
 * PLAN DE MIGRACIÓN:
 * Fase 1 (actual)  -> localStorage + syncQueue en localStorage.
 * Fase 2 (futura)  -> Mismos métodos, pero sincronizarPendientes() hace fetch
 *                     real contra los endpoints de docs/api-contract.md.
 * Fase 3 (futura)  -> Multiusuario con reconciliación por timestamp o CRDT.
 *
 * REGLA: la UI NUNCA debe tocar localStorage directamente.
 * Siempre pasa por las funciones exportadas aquí.
 *
 * MODELO DE PRECIO (3 estados, no 2):
 *   "estimado"            -> precio de referencia, sin verificar. Badge gris, prefijo "~".
 *   "verificado_en_tienda"-> visto en góndola/etiqueta (OCR, manual, voz). Badge secundario.
 *                            AÚN puede cambiar en caja por promos, error de etiqueta, etc.
 *   "facturado"            -> precio real del recibo al cerrar la compra. Único estado
 *                            considerado definitivo. Badge de acento.
 *
 * MODELO DE LISTAS:
 *   Lista { id, nombre, creada_en, estado: "activa"|"cerrada", comercio_principal,
 *           total_facturado_final, diferencia_vs_verificado }
 *   Cada ItemLista pertenece a una lista_id.
 */

const LS_KEY_LISTAS = "justo:listas";           // catálogo de listas
const LS_KEY_ITEMS = "justo:items";             // todos los items, de todas las listas
const LS_KEY_ACTIVE_LIST = "justo:activeListId";
const LS_KEY_QUEUE = "justo:syncQueue";
const LS_KEY_COMPARACIONES = "justo:comparaciones";
const LS_KEY_PRECIOS = "justo:precios";          // memoria de precios observados
const LS_KEY_AJUSTES = "justo:ajustes";
const MAX_PRECIOS = 3000;

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function leer(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn("justo:store leer()", key, e);
    return fallback;
  }
}

function escribir(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("justo:store escribir()", key, e);
  }
}

function encolarCambio(tipo_operacion, payload) {
  const queue = leer(LS_KEY_QUEUE, []);
  queue.push({
    id: uuid(),
    tipo_operacion,
    payload,
    timestamp: Date.now(),
    estado: "pendiente",
  });
  escribir(LS_KEY_QUEUE, queue);
}

// ---------------------------------------------------------------------------
// Reglas de negocio centralizadas
// ---------------------------------------------------------------------------

const NIVEL_PRECIO = {
  estimado: 0,
  verificado_en_tienda: 1,
  facturado: 2,
};

/** Solo puede ir "en_carrito" si el precio fue al menos verificado en tienda. */
function puedeMarcarEnCarrito(item) {
  return item && NIVEL_PRECIO[item.estado_precio] >= NIVEL_PRECIO.verificado_en_tienda;
}

/** Solo se puede facturar (cerrar compra) si el item fue al menos verificado. */
function puedeFacturar(item) {
  return item && NIVEL_PRECIO[item.estado_precio] >= NIVEL_PRECIO.verificado_en_tienda;
}

// ---------------------------------------------------------------------------
// Listas (gestión de múltiples listas)
// ---------------------------------------------------------------------------

function getListas() {
  return leer(LS_KEY_LISTAS, []);
}

function getListaActivaId() {
  let id = leer(LS_KEY_ACTIVE_LIST, null);
  const listas = getListas();
  if (!id || !listas.find((l) => l.id === id && l.estado === "activa")) {
    const primeraActiva = listas.find((l) => l.estado === "activa");
    if (primeraActiva) {
      id = primeraActiva.id;
      escribir(LS_KEY_ACTIVE_LIST, id);
    } else {
      const nueva = crearLista("Mi lista");
      id = nueva.id;
    }
  }
  return id;
}

function setListaActiva(id) {
  escribir(LS_KEY_ACTIVE_LIST, id);
  encolarCambio("set_lista_activa", { id });
}

function crearLista(nombre, comercioPrincipal = null) {
  const listas = getListas();
  const nueva = {
    id: uuid(),
    nombre: nombre || "Nueva lista",
    creada_en: Date.now(),
    estado: "activa",
    comercio_principal: comercioPrincipal || getAjustes().tienda_habitual || null,
    presupuesto: getAjustes().presupuesto_defecto || null,
    total_facturado_final: null,
    diferencia_vs_verificado: null,
  };
  listas.push(nueva);
  escribir(LS_KEY_LISTAS, listas);
  escribir(LS_KEY_ACTIVE_LIST, nueva.id);
  encolarCambio("crear_lista", nueva);
  return nueva;
}

function renombrarLista(id, nombre) {
  const listas = getListas();
  const idx = listas.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  listas[idx] = { ...listas[idx], nombre };
  escribir(LS_KEY_LISTAS, listas);
  encolarCambio("renombrar_lista", { id, nombre });
  return listas[idx];
}

function actualizarLista(id, cambios) {
  const listas = getListas();
  const idx = listas.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  listas[idx] = { ...listas[idx], ...cambios };
  escribir(LS_KEY_LISTAS, listas);
  encolarCambio("renombrar_lista", { id, ...cambios });
  return listas[idx];
}

/** Presupuesto de la lista (null = sin presupuesto). */
function setPresupuesto(id, monto) {
  const valor = Number(monto);
  return actualizarLista(id, { presupuesto: valor > 0 ? valor : null });
}

function duplicarLista(id, nuevoNombre) {
  const listas = getListas();
  const original = listas.find((l) => l.id === id);
  if (!original) return null;
  const nueva = crearLista(nuevoNombre || `${original.nombre} (copia)`, original.comercio_principal);
  const items = getTodosLosItems().filter((i) => i.lista_id === id);
  items.forEach((item) => {
    guardarProducto({
      ...item,
      lista_id: nueva.id,
      estado_precio: "estimado",
      estado_compra: "activo",
      precio_verificado: null,
      precio_facturado: null,
    });
  });
  return nueva;
}

/**
 * Cierra una lista: registra el total realmente pagado (del recibo) y
 * calcula la diferencia vs. lo que se había verificado en tienda.
 * totalFacturado puede venir de un solo número (recibo completo) o de la
 * suma de precios facturados por item, según cómo lo use la UI.
 *
 * baseVerificado: total verificado ANTES de facturar los items. Si la UI ya
 * facturó item por item, calcularTotales() aquí devolvería los precios
 * facturados (diferencia siempre 0), así que la UI debe capturar la base
 * antes de facturar y pasarla.
 */
function cerrarLista(id, totalFacturado, baseVerificado = null) {
  const listas = getListas();
  const idx = listas.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const base = baseVerificado ?? calcularTotales(id).totalVerificado;
  const diferencia = totalFacturado - base;
  listas[idx] = {
    ...listas[idx],
    estado: "cerrada",
    cerrada_en: Date.now(),
    total_facturado_final: totalFacturado,
    diferencia_vs_verificado: diferencia,
  };
  escribir(LS_KEY_LISTAS, listas);
  encolarCambio("cerrar_lista", { id, totalFacturado, diferencia });
  return listas[idx];
}

function getHistorialListasCerradas() {
  return getListas()
    .filter((l) => l.estado === "cerrada")
    .sort((a, b) => (b.cerrada_en ?? b.creada_en) - (a.cerrada_en ?? a.creada_en));
}

// ---------------------------------------------------------------------------
// Items de lista
// ---------------------------------------------------------------------------

function getTodosLosItems() {
  return leer(LS_KEY_ITEMS, []);
}

function guardarTodosLosItems(items) {
  escribir(LS_KEY_ITEMS, items);
}

/** Devuelve los items de la lista activa (o de listaId si se especifica). */
function getLista(listaId) {
  const id = listaId || getListaActivaId();
  return getTodosLosItems().filter((i) => i.lista_id === id);
}

/**
 * item esperado (parcial, se completan defaults):
 * { nombre, comercio, cantidad, contenido, unidad_medida, precio_estimado,
 *   precio_verificado, precio_facturado, estado_precio, estado_compra, fuente, lista_id }
 */
function guardarProducto(item) {
  const items = getTodosLosItems();
  const listaId = item.lista_id || getListaActivaId();
  const nuevo = {
    id: uuid(),
    lista_id: listaId,
    nombre: item.nombre || "Producto sin nombre",
    comercio: item.comercio || null,
    cantidad: item.cantidad ?? 1,
    contenido: item.contenido ?? null, // gramaje/volumen por envase (ej. 170)
    unidad_medida: item.unidad_medida || null, // "g" | "ml" | "unidad"
    estado_precio: item.estado_precio || "estimado", // estimado | verificado_en_tienda | facturado
    estado_compra: item.estado_compra || "activo", // activo | en_carrito | aplazado
    precio_estimado: item.precio_estimado ?? item.precio_referencia ?? 0,
    precio_verificado: item.precio_verificado ?? null,
    precio_facturado: item.precio_facturado ?? null,
    motivo_aplazado: item.motivo_aplazado || null,
    fuente: item.fuente || "manual", // manual | ocr | voz
    creado_en: Date.now(),
  };
  items.push(nuevo);
  guardarTodosLosItems(items);
  encolarCambio("crear_item", nuevo);
  if (nuevo.estado_precio === "facturado" && nuevo.precio_facturado > 0) registrarPrecioDeItem(nuevo, nuevo.precio_facturado, "facturado");
  else if (nuevo.estado_precio === "verificado_en_tienda" && nuevo.precio_verificado > 0) registrarPrecioDeItem(nuevo, nuevo.precio_verificado, "verificado");
  return nuevo;
}

function actualizarItem(id, cambios) {
  const items = getTodosLosItems();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...cambios };
  guardarTodosLosItems(items);
  encolarCambio("actualizar_item", { id, cambios });
  return items[idx];
}

function eliminarItem(id) {
  const items = getTodosLosItems().filter((i) => i.id !== id);
  guardarTodosLosItems(items);
  encolarCambio("eliminar_item", { id });
}

/** Estimado -> Verificado en tienda (se vio en góndola/etiqueta/OCR/voz). */
function verificarEnTienda(id, precioVisto) {
  const item = actualizarItem(id, {
    estado_precio: "verificado_en_tienda",
    precio_verificado: precioVisto,
  });
  if (item && precioVisto > 0) registrarPrecioDeItem(item, precioVisto, "verificado");
  return item;
}

/** Verificado -> Facturado (precio real del recibo, vía cierre de compra). */
function facturarItem(id, precioReal) {
  const item = actualizarItem(id, {
    estado_precio: "facturado",
    precio_facturado: precioReal,
  });
  if (item && precioReal > 0) registrarPrecioDeItem(item, precioReal, "facturado");
  return item;
}

function marcarEnCarrito(id, enCarrito) {
  const items = getTodosLosItems();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  if (enCarrito && !puedeMarcarEnCarrito(item)) {
    // La UI debe interceptar esto y abrir el sheet de "verificar precio en tienda".
    return null;
  }
  return actualizarItem(id, {
    estado_compra: enCarrito ? "en_carrito" : "activo",
  });
}

function aplazarItem(id, motivo) {
  return actualizarItem(id, {
    estado_compra: "aplazado",
    motivo_aplazado: motivo || null,
  });
}

function reactivarItem(id) {
  return actualizarItem(id, {
    estado_compra: "activo",
    motivo_aplazado: null,
  });
}

// ---------------------------------------------------------------------------
// Totales derivados (usar en el header de la lista) — SIEMPRE por lista
// ---------------------------------------------------------------------------

function precioEfectivo(item) {
  if (item.estado_precio === "facturado") return item.precio_facturado ?? 0;
  if (item.estado_precio === "verificado_en_tienda") return item.precio_verificado ?? 0;
  return item.precio_estimado ?? 0;
}

function calcularTotales(listaId) {
  const items = getLista(listaId);
  const activos = items.filter((i) => i.estado_compra !== "aplazado");
  const aplazados = items.filter((i) => i.estado_compra === "aplazado");

  const totalEstimado = activos.reduce(
    (sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1),
    0
  );

  const verificadosOMas = activos.filter(
    (i) => NIVEL_PRECIO[i.estado_precio] >= NIVEL_PRECIO.verificado_en_tienda
  );
  const totalVerificado = verificadosOMas.reduce(
    (sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1),
    0
  );

  const facturados = activos.filter((i) => i.estado_precio === "facturado");
  const totalFacturado = facturados.length
    ? facturados.reduce((sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1), 0)
    : null; // null = "aún no se ha cerrado la compra"

  const totalAplazado = aplazados.reduce(
    (sum, i) => sum + precioEfectivo(i) * (i.cantidad || 1),
    0
  );

  return {
    totalEstimado,
    totalVerificado,
    totalFacturado,
    totalAplazado,
    countActivos: activos.length,
    countVerificados: verificadosOMas.length,
    countFacturados: facturados.length,
    countAplazados: aplazados.length,
    countEnCarrito: activos.filter((i) => i.estado_compra === "en_carrito").length,
  };
}

// ---------------------------------------------------------------------------
// Comparaciones (motor comparador) — guardado ligero para analítica futura
// ---------------------------------------------------------------------------

function getComparaciones() {
  return leer(LS_KEY_COMPARACIONES, []);
}

function guardarComparacion(payload) {
  const comparaciones = getComparaciones();
  const registro = { id: uuid(), ...payload, creado_en: Date.now() };
  comparaciones.push(registro);
  escribir(LS_KEY_COMPARACIONES, comparaciones);
  encolarCambio("crear_comparacion", registro);
  // Cada producto comparado es un precio visto en góndola: va a la memoria.
  for (const it of registro.items || []) {
    if (it.precio > 0 && it.totalContenido > 0) {
      registrarPrecio({ nombre: it.nombre, precio: it.precio, contenido: it.totalContenido, unidad: it.unidad, unidades: 1, fuente: registro.origen || "comparador", tienda: it.tienda || null });
    }
  }
  return registro;
}

// ---------------------------------------------------------------------------
// Memoria de precios — cada precio visto o pagado, por producto y tienda
// ---------------------------------------------------------------------------
// Es la base de la guía de ahorro: con ella la app sabe si un precio es bueno
// para ti (vs. lo que sueles pagar), dónde lo viste más barato y cómo cambia.

const STOP_CLAVE = new Set(["de", "la", "el", "los", "las", "en", "con", "sin", "y", "para", "por", "un", "una", "al", "del"]);
const RE_UNIDAD_CLAVE = /^(g|gr|grs|kg|kgs|mg|ml|cc|cl|l|lt|lts|oz|lb|lbs|u|un|und|unid|unidades|pack|x|c\/u|cu)$/;

/**
 * Clave estable de producto a partir del nombre: minúsculas sin tildes, sin
 * números ni unidades ni palabras vacías, tokens ordenados. "Leche entera
 * Vita 1 L" y "leche Vita entera" comparten clave.
 */
function claveProducto(nombre) {
  const tokens = String(nombre || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^\d/.test(t) && !RE_UNIDAD_CLAVE.test(t) && !STOP_CLAVE.has(t) && t.length > 1);
  return [...new Set(tokens)].sort().slice(0, 4).join(" ");
}

/** Precio por 100 g/ml o por unidad; null si no hay contenido. */
function precioNormalizado({ precio, contenido, unidad, unidades = 1 }) {
  if (!(precio > 0) || !(contenido > 0)) return null;
  const total = contenido * (unidades || 1);
  return unidad === "unidad" ? precio / total : (precio / total) * 100;
}

function getPrecios() {
  return leer(LS_KEY_PRECIOS, []);
}

/**
 * Registra una observación de precio. `contenido` es el contenido total que
 * cubre el precio (si el item es "3 x 170 g", pasa contenido 170 y unidades 3).
 */
function registrarPrecio({ nombre, precio, contenido = null, unidad = null, unidades = 1, tienda = null, fuente = "manual", fecha = Date.now() }) {
  const clave = claveProducto(nombre);
  if (!clave || !(precio > 0)) return null;
  const obs = {
    id: uuid(),
    clave,
    nombre: String(nombre).trim(),
    tienda: tienda || getAjustes().tienda_habitual || null,
    precio: Math.round(precio * 100) / 100,
    contenido: contenido > 0 ? contenido : null,
    unidad: contenido > 0 ? unidad : null,
    unidades: unidades > 1 ? unidades : 1,
    normalizado: precioNormalizado({ precio, contenido, unidad, unidades }),
    fuente,
    fecha,
  };
  const precios = getPrecios();
  // Misma clave, misma tienda, mismo precio en las últimas 6 horas: es la misma observación.
  const repetida = precios.find((p) => p.clave === clave && p.tienda === obs.tienda && Math.abs(p.precio - obs.precio) < 0.005 && fecha - p.fecha < 6 * 3600e3);
  if (repetida) return repetida;
  precios.push(obs);
  if (precios.length > MAX_PRECIOS) precios.splice(0, precios.length - MAX_PRECIOS);
  escribir(LS_KEY_PRECIOS, precios);
  return obs;
}

function tiendaDeItem(item) {
  if (item.comercio) return item.comercio;
  const lista = getListas().find((l) => l.id === item.lista_id);
  return lista?.comercio_principal || null;
}

function registrarPrecioDeItem(item, precio, fuente) {
  registrarPrecio({
    nombre: item.nombre,
    precio,
    contenido: item.contenido,
    unidad: item.unidad_medida,
    unidades: 1,
    tienda: tiendaDeItem(item),
    fuente,
  });
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

const AJUSTES_DEFECTO = { tienda_habitual: "", presupuesto_defecto: null };

function getAjustes() {
  return { ...AJUSTES_DEFECTO, ...leer(LS_KEY_AJUSTES, {}) };
}

function setAjustes(parcial) {
  const nuevos = { ...getAjustes(), ...parcial };
  escribir(LS_KEY_AJUSTES, nuevos);
  return nuevos;
}

// ---------------------------------------------------------------------------
// Copia de seguridad — todo lo local en un JSON y vuelta
// ---------------------------------------------------------------------------

function exportarDatos() {
  return {
    app: "quanto",
    version: 1,
    exportado_en: new Date().toISOString(),
    listas: getListas(),
    items: getTodosLosItems(),
    comparaciones: getComparaciones(),
    precios: getPrecios(),
    ajustes: getAjustes(),
    lista_activa: leer(LS_KEY_ACTIVE_LIST, null),
  };
}

/**
 * Restaura una copia. `modo` "reemplazar" borra lo local; "fusionar" añade lo
 * que no exista (por id). Devuelve cuántos registros quedaron.
 */
function importarDatos(datos, modo = "fusionar") {
  const d = typeof datos === "string" ? JSON.parse(datos) : datos;
  if (!d || d.app !== "quanto" || !Array.isArray(d.listas) || !Array.isArray(d.items)) throw new Error("formato");
  const fusionar = (actuales, nuevos) => {
    if (modo === "reemplazar") return nuevos;
    const ids = new Set(actuales.map((x) => x.id));
    return actuales.concat(nuevos.filter((x) => x && !ids.has(x.id)));
  };
  const listas = fusionar(getListas(), d.listas);
  const items = fusionar(getTodosLosItems(), d.items);
  const comparaciones = fusionar(getComparaciones(), d.comparaciones || []);
  const precios = fusionar(getPrecios(), d.precios || []).sort((a, b) => a.fecha - b.fecha).slice(-MAX_PRECIOS);
  escribir(LS_KEY_LISTAS, listas);
  escribir(LS_KEY_ITEMS, items);
  escribir(LS_KEY_COMPARACIONES, comparaciones);
  escribir(LS_KEY_PRECIOS, precios);
  if (d.ajustes) setAjustes(d.ajustes);
  if (modo === "reemplazar" && d.lista_activa) escribir(LS_KEY_ACTIVE_LIST, d.lista_activa);
  return { listas: listas.length, items: items.length, precios: precios.length };
}

// ---------------------------------------------------------------------------
// Sincronización — fetch real contra docs/api-contract.md, offline-first
// ---------------------------------------------------------------------------
// localStorage sigue siendo la fuente de verdad local: si el fetch falla,
// el cambio queda "pendiente" y se reintenta con backoff. Tras MAX_REINTENTOS
// pasa a "error" y solo se reintenta cuando vuelve la conexión (evento online).

const API_BASE =
  (typeof window !== "undefined" && window.JUSTO_API_BASE) || "/api";
const MAX_REINTENTOS = 3;
const RETRY_DELAYS_MS = [2000, 8000, 30000];
const FETCH_TIMEOUT_MS = 6000;

function getSyncQueue() {
  return leer(LS_KEY_QUEUE, []);
}

/** Traduce una operación de la cola al request del contrato REST. */
function requestParaCambio(cambio) {
  const { tipo_operacion, payload } = cambio;
  switch (tipo_operacion) {
    case "crear_lista":
      return { method: "POST", url: `${API_BASE}/listas`, body: payload };
    case "renombrar_lista":
    case "cerrar_lista":
    case "set_lista_activa":
      return {
        method: "PATCH",
        url: `${API_BASE}/listas/${payload.id}`,
        body: { tipo_operacion, ...payload },
      };
    case "crear_item":
    case "actualizar_item":
    case "eliminar_item": {
      const listaId =
        payload.lista_id || payload.cambios?.lista_id || getListaActivaId();
      return {
        method: "PATCH",
        url: `${API_BASE}/listas/${listaId}`,
        body: { tipo_operacion, item: payload },
      };
    }
    case "crear_comparacion":
      return { method: "POST", url: `${API_BASE}/comparaciones`, body: payload };
    default:
      return null;
  }
}

async function enviarCambio(cambio) {
  const req = requestParaCambio(cambio);
  if (!req) throw new Error(`Operación desconocida: ${cambio.tipo_operacion}`);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

let syncEnCurso = false;
let reintentoProgramado = null;

/**
 * Intenta enviar todos los cambios pendientes al backend.
 * Devuelve { sincronizados, fallidos } y programa un reintento con backoff
 * si algo falló. Nunca borra datos locales: localStorage es el fallback.
 */
async function sincronizarPendientes() {
  if (syncEnCurso) return { sincronizados: 0, fallidos: 0, motivo: "en_curso" };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sincronizados: 0, fallidos: 0, motivo: "offline" };
  }

  const queue = getSyncQueue();
  const pendientes = queue.filter((q) => q.estado === "pendiente");
  if (pendientes.length === 0) return { sincronizados: 0, fallidos: 0 };

  syncEnCurso = true;
  let sincronizados = 0;
  let fallidos = 0;
  try {
    for (const cambio of pendientes) {
      try {
        await enviarCambio(cambio);
        cambio.estado = "sincronizado";
        sincronizados++;
      } catch (e) {
        cambio.reintentos = (cambio.reintentos || 0) + 1;
        if (cambio.reintentos >= MAX_REINTENTOS) cambio.estado = "error";
        fallidos++;
      }
    }
    // Merge por id: conserva operaciones encoladas mientras corría el sync.
    const porId = new Map(queue.map((q) => [q.id, q]));
    const actualizada = getSyncQueue().map((q) => porId.get(q.id) || q);
    escribir(LS_KEY_QUEUE, actualizada);
  } finally {
    syncEnCurso = false;
  }

  if (fallidos > 0) programarReintento();
  return { sincronizados, fallidos };
}

function programarReintento() {
  if (reintentoProgramado) return;
  const pendiente = getSyncQueue().find((q) => q.estado === "pendiente");
  if (!pendiente) return;
  const nivel = Math.min(pendiente.reintentos || 0, RETRY_DELAYS_MS.length - 1);
  reintentoProgramado = setTimeout(() => {
    reintentoProgramado = null;
    sincronizarPendientes();
  }, RETRY_DELAYS_MS[nivel]);
}

/** Al recuperar conexión, los cambios en "error" vuelven a ser candidatos. */
function reactivarErroresDeSync() {
  const queue = getSyncQueue();
  let cambio = false;
  queue.forEach((q) => {
    if (q.estado === "error") {
      q.estado = "pendiente";
      q.reintentos = 0;
      cambio = true;
    }
  });
  if (cambio) escribir(LS_KEY_QUEUE, queue);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    reactivarErroresDeSync();
    sincronizarPendientes().then((r) => console.log("justo:sync", r));
  });
}

return { puedeMarcarEnCarrito, puedeFacturar, getListas, getListaActivaId, setListaActiva, crearLista, renombrarLista, actualizarLista, setPresupuesto, duplicarLista, cerrarLista, getHistorialListasCerradas, getLista, guardarProducto, actualizarItem, eliminarItem, verificarEnTienda, facturarItem, marcarEnCarrito, aplazarItem, reactivarItem, calcularTotales, getComparaciones, guardarComparacion, claveProducto, precioNormalizado, getPrecios, registrarPrecio, getAjustes, setAjustes, exportarDatos, importarDatos, getSyncQueue, sincronizarPendientes };
})();

// ---- web/data/ahorro.js ----
__m.ahorro = (function () {
/**
 * Motor de ahorro: convierte la memoria de precios, las listas cerradas y las
 * comparaciones en guía para comprar mejor. Solo lee del store; no toca el
 * DOM, así que se prueba en Node (tests/ahorro-test.mjs).
 *
 *  - estadisticasProducto(nombre): lo que sabes de un producto (último, mínimo,
 *    habitual, tiendas, tendencia).
 *  - semaforoPrecio(obs): ¿este precio es bueno, normal o caro para ti?
 *  - resumenAhorro(): números del mes, ahorro logrado, frecuentes, tiendas.
 *  - sugerenciasRecompra(listaId): lo que sueles comprar y toca reponer.
 *  - consejos(): reglas que detectan oportunidades concretas de ahorro.
 */

const {
  getPrecios, getListas, getLista, getComparaciones, getHistorialListasCerradas,
  claveProducto, precioNormalizado,
} = __m.store;



const DIA = 86400e3;

function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Valor comparable de una observación: normalizado si lo hay, si no el precio. */
function valorDe(o) {
  return o.normalizado ?? o.precio;
}

function etiquetaBase(o) {
  if (!o.normalizado) return "c/u";
  return o.unidad === "unidad" ? "por unidad" : `por 100 ${o.unidad}`;
}

/**
 * Todo lo que la memoria sabe de un producto. Compara en la misma base: si
 * hay observaciones con gramaje usa el precio por 100 g/ml, si no, el precio
 * del envase.
 */
/**
 * Claves de la memoria que corresponden al mismo producto que `nombre`:
 * la exacta y las que comparten la mayoría de palabras ("Leche Vita" encaja
 * con "Leche entera Vita"; "Atún Real" no encaja con "Atún Van Camps").
 */
function clavesCompatibles(nombre, precios = getPrecios()) {
  const clave = claveProducto(nombre);
  if (!clave) return [];
  const mios = new Set(clave.split(" "));
  const out = new Set();
  for (const p of precios) {
    if (p.clave === clave) { out.add(p.clave); continue; }
    const suyos = p.clave.split(" ");
    const comunes = suyos.filter((t) => mios.has(t)).length;
    const union = new Set([...mios, ...suyos]).size;
    if (comunes >= 1 && comunes / union >= 0.5) out.add(p.clave);
  }
  return [...out];
}

function estadisticasProducto(nombre, { ahora = Date.now(), diasMax = 365 } = {}) {
  const precios = getPrecios();
  const claves = new Set(clavesCompatibles(nombre, precios));
  const clave = claveProducto(nombre);
  if (!claves.size) return null;
  const todas = precios.filter((p) => claves.has(p.clave) && ahora - p.fecha <= diasMax * DIA);
  if (!todas.length) return null;
  const conNorm = todas.filter((p) => p.normalizado);
  const base = conNorm.length >= Math.ceil(todas.length / 2) ? conNorm : todas.filter((p) => !p.normalizado);
  const serie = [...base].sort((a, b) => a.fecha - b.fecha);
  const valores = serie.map(valorDe);
  const ultimo = serie[serie.length - 1];
  const minimo = serie.reduce((m, o) => (valorDe(o) < valorDe(m) ? o : m), serie[0]);
  const previo = serie.length > 1 ? serie[serie.length - 2] : null;
  const tendencia = previo ? Math.sign(Math.round((valorDe(ultimo) - valorDe(previo)) * 1000)) : 0;

  const porTienda = new Map();
  for (const o of serie) {
    if (!o.tienda) continue;
    const t = porTienda.get(o.tienda) || { tienda: o.tienda, valores: [], ultima: 0 };
    t.valores.push(valorDe(o));
    t.ultima = Math.max(t.ultima, o.fecha);
    porTienda.set(o.tienda, t);
  }
  const tiendas = [...porTienda.values()]
    .map((t) => ({ tienda: t.tienda, mediana: mediana(t.valores), n: t.valores.length, ultima: t.ultima }))
    .sort((a, b) => a.mediana - b.mediana);

  return {
    clave: claves.has(clave) ? clave : [...claves][0],
    nombre: ultimo.nombre,
    n: serie.length,
    baseNormalizada: Boolean(ultimo.normalizado),
    base: etiquetaBase(ultimo),
    unidad: ultimo.unidad,
    ultimo: { valor: valorDe(ultimo), precio: ultimo.precio, fecha: ultimo.fecha, tienda: ultimo.tienda },
    minimo: { valor: valorDe(minimo), precio: minimo.precio, fecha: minimo.fecha, tienda: minimo.tienda },
    habitual: mediana(valores),
    tendencia, // -1 bajó, 0 igual, 1 subió (último vs. anterior)
    tiendas,
    serie: serie.map((o) => ({ fecha: o.fecha, valor: valorDe(o), precio: o.precio, tienda: o.tienda, fuente: o.fuente })),
  };
}

/**
 * Semáforo de un precio frente a tu memoria.
 * Devuelve { nivel: "bueno"|"normal"|"caro"|"sin_datos", texto, delta, stats }.
 */
function semaforoPrecio({ nombre, precio, contenido = null, unidad = null, unidades = 1 }, opciones = {}) {
  const stats = estadisticasProducto(nombre, opciones);
  if (!stats || !(precio > 0)) return { nivel: "sin_datos", texto: "", delta: null, stats };
  const norm = precioNormalizado({ precio, contenido, unidad, unidades });
  const valor = stats.baseNormalizada ? norm : (norm ? null : precio);
  if (valor === null || valor === undefined) return { nivel: "sin_datos", texto: "", delta: null, stats };

  const res = (nivel, texto, delta) => ({ nivel, texto, delta, valor, stats });
  const delta = stats.habitual ? (valor - stats.habitual) / stats.habitual : 0;
  const pct = Math.round(Math.abs(delta) * 100);
  const fmt = (v) => `$${v.toFixed(v < 1 ? 3 : 2)}`;
  const donde = stats.minimo.tienda ? ` en ${stats.minimo.tienda}` : "";

  if (valor <= stats.minimo.valor * 1.01) return res("bueno", stats.n > 1 ? "Tu mejor precio hasta ahora" : "Igual que la última vez", delta);
  if (delta <= -0.05) return res("bueno", `${pct}% bajo tu precio habitual`, delta);
  if (delta >= 0.08) return res("caro", `${pct}% sobre tu habitual · lo viste a ${fmt(stats.minimo.valor)} ${stats.base}${donde}`, delta);
  return res("normal", "En tu rango habitual", delta);
}

/** Productos agrupados por clave, para la pestaña Precios. */
function productosConMemoria({ ahora = Date.now() } = {}) {
  const claves = new Map();
  for (const o of getPrecios()) {
    const c = claves.get(o.clave);
    if (!c || o.fecha > c.fecha) claves.set(o.clave, { nombre: o.nombre, fecha: o.fecha });
  }
  return [...claves.entries()]
    .map(([clave, { nombre }]) => ({ clave, ...estadisticasProducto(nombre, { ahora }) }))
    .filter((s) => s && s.n)
    .sort((a, b) => b.ultimo.fecha - a.ultimo.fecha);
}

function inicioMes(d) {
  const f = new Date(d);
  return new Date(f.getFullYear(), f.getMonth(), 1).getTime();
}

function mesAnterior(d) {
  const f = new Date(d);
  return new Date(f.getFullYear(), f.getMonth() - 1, 1).getTime();
}

/** Ahorro que te dieron las comparaciones: lo que habrías pagado con la 2ª opción. */
function ahorroPorComparaciones(comparaciones) {
  let total = 0, n = 0;
  for (const c of comparaciones) {
    const items = (c.items || []).filter((i) => i.normalizado > 0 && i.totalContenido > 0).sort((a, b) => a.normalizado - b.normalizado);
    if (items.length < 2) continue;
    const mejor = items[0], segundo = items[1];
    const factor = mejor.unidad === "unidad" ? mejor.totalContenido : mejor.totalContenido / 100;
    const dif = (segundo.normalizado - mejor.normalizado) * factor;
    if (dif > 0) { total += dif; n++; }
  }
  return { total, n };
}

/** Productos que compras con regularidad, con su intervalo típico. */
function productosFrecuentes({ ahora = Date.now(), minimo = 2 } = {}) {
  const cerradas = getHistorialListasCerradas();
  const porClave = new Map();
  for (const l of cerradas) {
    const fecha = l.cerrada_en ?? l.creada_en;
    for (const it of getLista(l.id)) {
      if (it.estado_compra === "aplazado") continue;
      const clave = claveProducto(it.nombre);
      if (!clave) continue;
      const e = porClave.get(clave) || { clave, nombre: it.nombre, fechas: [], gasto: 0, cantidad: 0, contenido: it.contenido, unidad: it.unidad_medida };
      e.fechas.push(fecha);
      const precio = it.precio_facturado ?? it.precio_verificado ?? it.precio_estimado ?? 0;
      e.gasto += precio * (it.cantidad || 1);
      e.cantidad += it.cantidad || 1;
      e.nombre = it.nombre;
      porClave.set(clave, e);
    }
  }
  return [...porClave.values()]
    .filter((e) => new Set(e.fechas.map((f) => Math.floor(f / DIA))).size >= minimo)
    .map((e) => {
      const fechas = [...new Set(e.fechas.map((f) => Math.floor(f / DIA)))].sort((a, b) => a - b);
      const gaps = fechas.slice(1).map((f, i) => f - fechas[i]).filter((g) => g > 0);
      const intervalo = gaps.length ? Math.round(mediana(gaps)) : null;
      const ultima = fechas[fechas.length - 1] * DIA;
      const diasDesde = Math.floor((ahora - ultima) / DIA);
      return { ...e, veces: fechas.length, intervaloDias: intervalo, ultimaCompra: ultima, diasDesde, toca: intervalo ? diasDesde >= intervalo * 0.9 : false };
    })
    .sort((a, b) => b.veces - a.veces || b.gasto - a.gasto);
}

/** Lo que sueles comprar, toca reponer y no está en la lista. */
function sugerenciasRecompra(listaId, { ahora = Date.now(), limite = 6 } = {}) {
  const enLista = new Set(getLista(listaId).map((i) => claveProducto(i.nombre)));
  return productosFrecuentes({ ahora })
    .filter((p) => !enLista.has(p.clave))
    .sort((a, b) => Number(b.toca) - Number(a.toca) || b.veces - a.veces)
    .slice(0, limite)
    .map((p) => {
      const stats = estadisticasProducto(p.nombre, { ahora });
      return { ...p, precioRef: stats?.ultimo.precio ?? null, motivo: p.toca && p.intervaloDias ? `sueles comprarlo cada ${p.intervaloDias} días · hace ${p.diasDesde}` : `lo llevas en ${p.veces} compras` };
    });
}

/** Comparativa de tiendas sobre productos vistos en 2 o más. */
function comparativaTiendas({ ahora = Date.now() } = {}) {
  const porTienda = new Map(); // tienda -> { gana, pierde, productos }
  for (const s of productosConMemoria({ ahora })) {
    if (s.tiendas.length < 2) continue;
    const barata = s.tiendas[0], cara = s.tiendas[s.tiendas.length - 1];
    const pct = cara.mediana > 0 ? Math.round(((cara.mediana - barata.mediana) / cara.mediana) * 100) : 0;
    for (const t of s.tiendas) {
      const e = porTienda.get(t.tienda) || { tienda: t.tienda, gana: 0, compara: 0, ejemplos: [] };
      e.compara++;
      if (t.tienda === barata.tienda) { e.gana++; if (pct >= 3) e.ejemplos.push({ nombre: s.nombre, pct, vs: cara.tienda }); }
      porTienda.set(t.tienda, e);
    }
  }
  return [...porTienda.values()]
    .map((t) => ({ ...t, ratio: t.compara ? t.gana / t.compara : 0, ejemplos: t.ejemplos.sort((a, b) => b.pct - a.pct).slice(0, 3) }))
    .sort((a, b) => b.ratio - a.ratio || b.compara - a.compara);
}

/** Números del panel Ahorro. */
function resumenAhorro({ ahora = Date.now() } = {}) {
  const cerradas = getHistorialListasCerradas();
  const desdeMes = inicioMes(ahora), desdeAnterior = mesAnterior(ahora);
  const fechaDe = (l) => l.cerrada_en ?? l.creada_en;
  const esteMes = cerradas.filter((l) => fechaDe(l) >= desdeMes);
  const anterior = cerradas.filter((l) => fechaDe(l) >= desdeAnterior && fechaDe(l) < desdeMes);
  const suma = (ls) => ls.reduce((s, l) => s + (l.total_facturado_final || 0), 0);
  const gastoMes = suma(esteMes), gastoAnterior = suma(anterior);
  const menosQueVerificado = cerradas.reduce((s, l) => s + Math.max(0, -(l.diferencia_vs_verificado || 0)), 0);
  const masQueVerificado = cerradas.reduce((s, l) => s + Math.max(0, l.diferencia_vs_verificado || 0), 0);
  const comp = ahorroPorComparaciones(getComparaciones());
  const precios = getPrecios();
  const ticket = cerradas.length ? suma(cerradas) / cerradas.length : 0;

  // Gasto por producto (últimos 90 días) para "en qué se te va".
  const gastoPorProducto = new Map();
  for (const l of cerradas.filter((x) => ahora - fechaDe(x) <= 90 * DIA)) {
    for (const it of getLista(l.id)) {
      if (it.estado_compra === "aplazado") continue;
      const clave = claveProducto(it.nombre);
      const precio = it.precio_facturado ?? it.precio_verificado ?? it.precio_estimado ?? 0;
      const e = gastoPorProducto.get(clave) || { clave, nombre: it.nombre, gasto: 0 };
      e.gasto += precio * (it.cantidad || 1);
      gastoPorProducto.set(clave, e);
    }
  }
  const topGasto = [...gastoPorProducto.values()].sort((a, b) => b.gasto - a.gasto).slice(0, 5);
  const gasto90 = [...gastoPorProducto.values()].reduce((s, e) => s + e.gasto, 0);

  return {
    compras: cerradas.length,
    gastoMes, gastoAnterior,
    variacionMes: gastoAnterior > 0 ? (gastoMes - gastoAnterior) / gastoAnterior : null,
    comprasMes: esteMes.length,
    ticketPromedio: ticket,
    ahorroComparando: comp.total, comparacionesConAhorro: comp.n,
    menosQueVerificado, masQueVerificado,
    productosEnMemoria: new Set(precios.map((p) => p.clave)).size,
    observaciones: precios.length,
    topGasto: topGasto.map((e) => ({ ...e, pct: gasto90 ? e.gasto / gasto90 : 0 })),
    frecuentes: productosFrecuentes({ ahora }).slice(0, 5),
    tiendas: comparativaTiendas({ ahora }),
  };
}

/**
 * Consejos accionables, de más a menos valiosos. Cada uno: { tipo, titulo,
 * texto, accion? } donde accion es { goto } o { agregar: nombre }.
 */
function consejos({ ahora = Date.now(), listaId = null, limite = 5 } = {}) {
  const out = [];
  const r = resumenAhorro({ ahora });
  const fmt = (v) => `$${(v || 0).toFixed(2)}`;

  // 1) Productos de tu lista activa que hoy están caros frente a tu memoria.
  if (listaId) {
    for (const it of getLista(listaId)) {
      if (it.estado_compra !== "activo") continue;
      const precio = it.precio_verificado ?? it.precio_estimado;
      const sem = semaforoPrecio({ nombre: it.nombre, precio, contenido: it.contenido, unidad: it.unidad_medida }, { ahora });
      if (sem.nivel === "caro" && sem.stats?.minimo.tienda) {
        const pctMin = Math.round((1 - sem.stats.minimo.valor / sem.valor) * 100);
        out.push({ tipo: "caro", titulo: `${it.nombre} está caro`, texto: `Lo tienes a ${fmt(precio)}; en ${sem.stats.minimo.tienda} lo viste a ${fmt(sem.stats.minimo.precio)} (${pctMin}% menos).`, accion: { goto: "listas" } });
      }
    }
  }

  // 2) Tiendas: dónde ganas más veces.
  const t0 = r.tiendas[0];
  if (t0 && t0.compara >= 2 && t0.ratio >= 0.6 && t0.ejemplos.length) {
    const e = t0.ejemplos[0];
    out.push({ tipo: "tienda", titulo: `${t0.tienda} te sale más barato`, texto: `Gana en ${t0.gana} de ${t0.compara} productos que viste en varias tiendas. Ej.: ${e.nombre} ${e.pct}% menos que en ${e.vs}.`, accion: { goto: "ahorro" } });
  }

  // 3) Recompra que toca.
  const toca = productosFrecuentes({ ahora }).filter((p) => p.toca && (!listaId || !getLista(listaId).some((i) => claveProducto(i.nombre) === p.clave)));
  if (toca.length) {
    const p = toca[0];
    out.push({ tipo: "recompra", titulo: `Te toca reponer ${p.nombre}`, texto: `Lo compras cada ${p.intervaloDias} días y la última vez fue hace ${p.diasDesde}. Agrégalo antes de ir para no comprarlo de apuro.`, accion: { agregar: p.nombre } });
  }

  // 4) Productos que subieron de precio.
  const subieron = productosConMemoria({ ahora }).filter((s) => s.tendencia > 0 && s.n >= 2 && s.habitual && s.ultimo.valor > s.habitual * 1.08).slice(0, 2);
  for (const s of subieron) {
    out.push({ tipo: "subida", titulo: `${s.nombre} subió`, texto: `Último ${fmt(s.ultimo.valor)} ${s.base}, tu habitual ${fmt(s.habitual)}. Si no urge, espera o cambia de marca.`, accion: { goto: "ahorro" } });
  }

  // 5) Lo que pagas de más en caja frente a góndola.
  if (r.compras >= 3 && r.masQueVerificado > r.menosQueVerificado + 1) {
    out.push({ tipo: "caja", titulo: "En caja pagas más de lo verificado", texto: `Llevas ${fmt(r.masQueVerificado - r.menosQueVerificado)} de diferencia acumulada. Revisa el recibo antes de salir: las promos de góndola no siempre se aplican.`, accion: { goto: "ahorro" } });
  }

  // 6) Concentración del gasto.
  const top = r.topGasto[0];
  if (top && top.pct >= 0.25 && r.compras >= 2) {
    out.push({ tipo: "gasto", titulo: `${top.nombre} es ${Math.round(top.pct * 100)}% de tu gasto`, texto: "Compáralo por 100 g/ml con otras marcas y formatos: ahí está tu mayor margen de ahorro.", accion: { goto: "comparar" } });
  }

  // 7) Variación mensual.
  if (r.variacionMes !== null && Math.abs(r.variacionMes) >= 0.15 && r.comprasMes >= 1) {
    const sube = r.variacionMes > 0;
    out.push({ tipo: "mes", titulo: sube ? `Este mes llevas ${Math.round(r.variacionMes * 100)}% más` : `Este mes gastas ${Math.round(-r.variacionMes * 100)}% menos`, texto: sube ? `${fmt(r.gastoMes)} frente a ${fmt(r.gastoAnterior)} el mes pasado.` : `${fmt(r.gastoMes)} frente a ${fmt(r.gastoAnterior)} el mes pasado. Vas bien.`, accion: { goto: "ahorro" } });
  }

  // 8) Sin datos todavía: cómo empezar.
  if (!out.length && r.observaciones < 3) {
    out.push({ tipo: "inicio", titulo: "Empieza a construir tu memoria de precios", texto: "Escanea etiquetas o verifica precios en tienda: a partir de la segunda vez Quanto te dirá si un precio es bueno para ti.", accion: { goto: "escanear" } });
  }
  return out.slice(0, limite);
}

/** Texto plano con los datos del resumen, para que Apple Intelligence redacte el consejo semanal. */
function resumenParaCoach({ ahora = Date.now(), listaId = null } = {}) {
  const r = resumenAhorro({ ahora });
  const fmt = (v) => `$${(v || 0).toFixed(2)}`;
  const lineas = [
    `Compras cerradas: ${r.compras}. Este mes: ${fmt(r.gastoMes)} en ${r.comprasMes} compras; mes anterior: ${fmt(r.gastoAnterior)}.`,
    `Ticket promedio: ${fmt(r.ticketPromedio)}. Ahorro por elegir la mejor opción al comparar: ${fmt(r.ahorroComparando)} en ${r.comparacionesConAhorro} comparaciones.`,
    `Pagado de menos vs. góndola: ${fmt(r.menosQueVerificado)}; de más: ${fmt(r.masQueVerificado)}.`,
    `Productos con memoria de precio: ${r.productosEnMemoria} (${r.observaciones} precios vistos).`,
  ];
  if (r.topGasto.length) lineas.push(`Mayor gasto (90 días): ${r.topGasto.slice(0, 3).map((t) => `${t.nombre} ${Math.round(t.pct * 100)}%`).join(", ")}.`);
  if (r.frecuentes.length) lineas.push(`Frecuentes: ${r.frecuentes.slice(0, 3).map((f) => `${f.nombre} cada ${f.intervaloDias ?? "?"} días`).join(", ")}.`);
  if (r.tiendas[0]?.compara >= 2) lineas.push(`Tienda que más gana: ${r.tiendas[0].tienda} (${r.tiendas[0].gana}/${r.tiendas[0].compara}).`);
  for (const c of consejos({ ahora, listaId, limite: 3 })) lineas.push(`Hallazgo: ${c.titulo}. ${c.texto}`);
  return lineas.join("\n");
}

return { claveProducto, precioNormalizado, clavesCompatibles, estadisticasProducto, semaforoPrecio, productosConMemoria, productosFrecuentes, sugerenciasRecompra, comparativaTiendas, resumenAhorro, consejos, resumenParaCoach };
})();

var Quanto = Object.assign({}, __m.ocr, __m.store, __m.ahorro);

/** Lectura de Vision (texto + palabras con caja) -> datos de la etiqueta. */
Quanto.leerVision = function (texto, palabras, precioRespaldo) {
  var d = __m.ocr.parseEtiqueta(texto || "", __m.ocr.extraerPistas({ words: palabras || [] }));
  if (d.precio === null && precioRespaldo > 0) d.precio = precioRespaldo;
  return d;
};

/**
 * Datos de la versión anterior de la app (claves "justo:*" del localStorage
 * del WebView) -> se fusionan por id con lo que ya hay.
 */
Quanto.importarDesdeWeb = function (crudo) {
  var leer = function (k, def) { try { return crudo[k] ? JSON.parse(crudo[k]) : def; } catch (e) { return def; } };
  var copia = {
    app: "quanto", version: 1,
    listas: leer("justo:listas", []), items: leer("justo:items", []),
    comparaciones: leer("justo:comparaciones", []), precios: leer("justo:precios", []),
    ajustes: leer("justo:ajustes", null),
  };
  if (!copia.listas.length && !copia.items.length && !copia.precios.length) return { listas: 0, items: 0, precios: 0, vacio: true };
  var r = __m.store.importarDatos(copia, "fusionar");
  var activa = leer("justo:activeListId", null);
  if (activa && copia.listas.some(function (l) { return l.id === activa && l.estado === "activa"; })) __m.store.setListaActiva(activa);
  return { listas: copia.listas.length, items: copia.items.length, precios: copia.precios.length, vacio: false };
};

globalThis.Quanto = Quanto;
globalThis.QuantoLlamar = function (nombre, argsJSON) {
  var f = Quanto[nombre];
  if (typeof f !== "function") throw new Error("Quanto no tiene la función " + nombre);
  var r = f.apply(null, JSON.parse(argsJSON || "[]"));
  return JSON.stringify({ r: r === undefined ? null : r });
};
