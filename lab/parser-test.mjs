/**
 * Test rápido del parser de etiquetas (sin OCR, texto directo).
 * Correr con: node lab/parser-test.mjs
 */
import { parseEtiqueta } from "../assets/ocr.js";

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

let fallos = 0;
for (const c of casos) {
  const r = parseEtiqueta(c.texto);
  const errores = [];
  for (const [k, v] of Object.entries(c.espera)) {
    const got = r[k];
    const ok = typeof v === "number" ? Math.abs(got - v) < 0.001 : got === v;
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

console.log(fallos ? `\n${fallos} caso(s) fallando` : "\nTodos los casos pasan");
process.exit(fallos ? 1 : 0);
