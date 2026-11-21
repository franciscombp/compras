/**
 * Test rápido del parser de etiquetas (sin OCR, texto directo).
 * Correr con: node tests/parser-test.mjs
 */
import { parseEtiqueta, extraerPistas, extraerMedidaDeNombre } from "../web/assets/ocr.js";

const casos = [
  {
    nombre: "etiqueta simple con PVP y peso neto/escurrido",
    texto: "ATUN REAL LOMITOS\nPVP $1.99\nCont. Neto 170 g escurrido 120 g",
    espera: { precio: 1.99, contenido: 170, unidad: "g", unidades: 1 },
  },
  {
    nombre: "digitos mal leidos por OCR ($O.99) y litros",
    texto: "Leche Entera La Lechera\n$O.99\n1 L",
    espera: { precio: 0.99, contenido: 1000, unidad: "ml" },
  },
  {
    nombre: "promo 2 x $5.00 con contenido",
    texto: "PROMO 2 X $5.00\nCerveza Pilsener 330 ml",
    espera: { precio: 5.0, contenido: 330, unidad: "ml", unidades: 2 },
  },
  {
    nombre: "centavos elevados separados (PVP 1 99)",
    texto: "Galletas Amor 175 g\nPVP 1 99",
    espera: { precio: 1.99, contenido: 175, unidad: "g" },
  },
  {
    nombre: "pack 6 x 80 g con precio",
    texto: "Atun lomitos pack\n6 x 80 g\n$6.60",
    espera: { precio: 6.6, contenido: 80, unidad: "g", unidades: 6 },
  },
  {
    nombre: "antes/ahora se queda con la oferta",
    texto: "Yogurt Toni 200 g\nAntes $1.50 Ahora $1.20",
    espera: { precio: 1.2, contenido: 200, unidad: "g" },
  },
  {
    nombre: "precio unitario impreso deduce contenido",
    texto: "Queso fresco\nPVP $2.50\n$1.25 por 100 g",
    espera: { precio: 2.5, contenido: 200, unidad: "g" },
  },
  {
    nombre: "kg decimal a gramos",
    texto: "Arroz Gustadina 2.5 kg\n$3.80",
    espera: { precio: 3.8, contenido: 2500, unidad: "g" },
  },
  {
    nombre: "coma decimal",
    texto: "Aceite La Favorita 900 ml\nPVP 2,45",
    espera: { precio: 2.45, contenido: 900, unidad: "ml" },
  },
  {
    nombre: "sin precio legible no inventa nada",
    texto: "Manzana roja nacional\n$3.99/kg",
    espera: { precio: null },
  },
];

// La pista de "texto más grande" debe ganar sobre otros números plausibles.
casos.push({
  nombre: "pista de texto grande elige el precio correcto",
  texto: "Cod 4520.11\nGalletas 175 g\n2.35",
  pistas: { precioGrande: 2.35 },
  espera: { precio: 2.35, contenido: 175, unidad: "g" },
});

// ---- Etiquetas de góndola de Supermaxi (fotos reales) ----------------------
// Formato: nombre abreviado en 1-2 líneas, "EXENTO DE IVA", código impreso,
// precio de afiliado grande con centavos elevados ("0.⁷⁹") y debajo el precio
// "NO AFILIADO". Se prueban como las leería Vision (limpio) y como las leyó
// Tesseract sobre las fotos (con errores típicos).
const palabra = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
const comunes = [palabra("ALIM", 40, 40, 120, 80), palabra("HUM", 130, 40, 190, 80), palabra("PERRO", 200, 40, 300, 80),
  palabra("EXENTO", 40, 150, 110, 170), palabra("DE", 115, 150, 135, 170), palabra("IVA", 140, 150, 175, 170)];

casos.push(
  {
    nombre: "Supermaxi (Vision): afiliado grande, no afiliado, nombre, código",
    texto: "PRODUCTO PARTICIPANTE\nALIM HUM PERRO\nCAR/VEG PU 85G\nAFILIADO US.$\nEXENTO DE IVA\n786212044084 - 00B6\n0.79\nNO AFILIADO\nUS.$0.85",
    espera: { precio: 0.79, contenido: 85, unidad: "g", nombre: "ALIM HUM PERRO CAR/VEG PU 85G", precioNoAfiliado: 0.85, codigo: "7862120440844" },
  },
  {
    nombre: "Supermaxi (Vision): centavos elevados leídos como palabras aparte",
    texto: "ALIM HUM PERRO\nCAR/VEG PU 85G\nAFILIADO US.$\n79\nEXENTO DE IVA\n786212044084 - 00B6\n0.\nNO AFILIADO\nUS.$0.85",
    pistas: extraerPistas({ words: [...comunes, palabra("0.", 700, 90, 770, 230), palabra("79", 780, 80, 840, 150), palabra("NO", 690, 250, 720, 270), palabra("US.$0.85", 700, 290, 800, 320)] }),
    espera: { precio: 0.79, precioNoAfiliado: 0.85 },
  },
  {
    nombre: "Supermaxi (Vision): «1 39» en su propia línea, después del código",
    texto: "PURENATURE DOG\nPOLLO/VE 170GR\nAFILIADO US.$\nEXENTO DE IVA\n786212044038-00B6\n1 39\nNO AFILIADO\nUS.$1.49",
    espera: { precio: 1.39, contenido: 170, unidad: "g", nombre: "PURENATURE DOG POLLO/VE 170GR", precioNoAfiliado: 1.49 },
  },
  {
    nombre: "Supermaxi (Vision): «1» grande y «39» elevado, por las cajas de las palabras",
    texto: "PURENATURE DOG\nPOLLO/VE 170GR\nAFILIADO US.$\n39\nEXENTO DE IVA\n786212044038-00B6\n1\nNO AFILIADO\nUS.$1.49",
    pistas: extraerPistas({ words: [...comunes, palabra("1", 700, 120, 745, 320), palabra("39", 760, 110, 840, 230), palabra("US.$1.49", 700, 380, 800, 420)] }),
    espera: { precio: 1.39, precioNoAfiliado: 1.49 },
  },
  {
    nombre: "Supermaxi (Vision): «1.8U» (0 leído como U) y texto de la lata arriba",
    texto: "ALIMENTO COMPLETO\nPER CANI ADULTI\nCOMPLETE PET FOOD FOR ADULT DOGS\nSIMBA 415GR\nEXENTO DE IVA\n600947000902 - 00B6\n1.8U\nNO AFILIADO\nUS.$1.93",
    espera: { precio: 1.8, contenido: 415, unidad: "g", nombre: "SIMBA 415GR", precioNoAfiliado: 1.93, codigo: "6009470009029" },
  },
  {
    nombre: "Supermaxi (Tesseract): «US.80.95» es US.$0.95, no $80.95; nombre sin basura",
    texto: "ALIM HUM PERRO _n\n\nCARIVEG PU 856 0\n\n\"PEPE NO AFILIADO \" |\nesa US.80.95",
    espera: { precio: 0.95, nombre: /^ALIM HUM PERRO/ },
  },
  {
    nombre: "Supermaxi (Tesseract): «US 51.93» es US.$1.93 y el nombre es SIMBA 415GR",
    texto: "—\nSIMBA 415GR 1 3U\nLio NO AFILIADO -\nsu 1 US 51.93",
    espera: { precio: 1.93, contenido: 415, unidad: "g", nombre: "SIMBA 415GR" },
  },
  {
    nombre: "Supermaxi (Tesseract): «US 149» es US.$1.49; nombre de las líneas antes de IVA",
    texto: "ENATURE DOG 8\nLO/VE 170GR 1 0\nO DE IVA -\n2044038 — 0086 “ -\nLa] Le] NO AFILIADO\nES US 149",
    espera: { precio: 1.49, contenido: 170, unidad: "g", nombre: "ENATURE DOG LO/VE 170GR" },
  },
);

let fallos = 0;
for (const c of casos) {
  const r = parseEtiqueta(c.texto, c.pistas || {});
  const errores = [];
  for (const [k, v] of Object.entries(c.espera)) {
    const got = r[k];
    const ok = v instanceof RegExp ? v.test(got ?? "") : typeof v === "number" ? Math.abs(got - v) < 0.001 : got === v;
    if (!ok) errores.push(`${k}: esperaba ${JSON.stringify(v)}, salió ${JSON.stringify(got)}`);
  }
  if (errores.length) {
    fallos++;
    console.log(`✗ ${c.nombre}`);
    errores.forEach((e) => console.log(`    ${e}`));
    console.log(`    resultado completo: ${JSON.stringify(r)}`);
  } else {
    console.log(`✓ ${c.nombre}`);
  }
}

// --- extraerPistas: la palabra numérica más alta destaca sobre la mediana --
const dataFake = {
  blocks: [{ paragraphs: [{ lines: [{ words: [
    { text: "Galletas", bbox: { y0: 0, y1: 20 } },
    { text: "175", bbox: { y0: 0, y1: 20 } },
    { text: "$2.35", bbox: { y0: 40, y1: 120 } },
  ] }] }] }],
};
const pistas = extraerPistas(dataFake);
if (pistas.precioGrande !== 2.35) {
  fallos++;
  console.log(`✗ extraerPistas: esperaba 2.35, salió ${JSON.stringify(pistas)}`);
} else console.log("✓ extraerPistas detecta el número más grande");

// --- extraerMedidaDeNombre: para normalizar catálogos ----------------------
const medidas = [
  ["Atún lomitos 3 x 170 g", { contenido: 170, unidad: "g", unidades: 3 }],
  ["Leche entera 1L", { contenido: 1000, unidad: "ml", unidades: 1 }],
  ["Coca-Cola 1.35 lt", { contenido: 1350, unidad: "ml", unidades: 1 }],
  ["Jabón de tocador", { contenido: null, unidad: null, unidades: 1 }],
];
for (const [nombre, esp] of medidas) {
  const r = extraerMedidaDeNombre(nombre);
  const ok = r.contenido === esp.contenido && r.unidad === esp.unidad && r.unidades === esp.unidades;
  if (!ok) { fallos++; console.log(`✗ medida "${nombre}": ${JSON.stringify(r)}`); }
  else console.log(`✓ medida "${nombre}"`);
}

console.log(fallos ? `\n${fallos} caso(s) fallando` : "\nTodos los casos pasan");
process.exit(fallos ? 1 : 0);
