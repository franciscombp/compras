// Compatibilidad con teléfonos no tan nuevos: node tests/compat-test.mjs
//
// Objetivo mínimo: Safari de iOS 15 y Chrome 90 en Android. Un solo error de
// sintaxis en un módulo (por ejemplo un lookbehind en una regex en Safari
// anterior a 16.4) deja la app entera sin responder, así que se revisa el
// código de web/ en busca de lo que esos navegadores no entienden.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const raiz = new URL("../web/", import.meta.url).pathname;
const archivos = [];
(function recorrer(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.(js|mjs|css|html)$/.test(f)) archivos.push(p);
  }
})(raiz);

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fallos++; };

// Sintaxis y APIs de JavaScript que rompen o no existen en iOS 15 / Chrome 90
const JS_PROHIBIDO = [
  [/\(\?<[=!]/, "lookbehind en regex (Safari < 16.4: error de sintaxis que tumba el módulo)"],
  [/\.at\(-?\d/, "Array/String.prototype.at (Safari < 15.4)"],
  [/AbortSignal\.timeout\(/, "AbortSignal.timeout sin alternativa (Safari < 16, Chrome < 103)", (linea) => !/typeof AbortSignal\.timeout/.test(linea)],
  [/\bstructuredClone\(/, "structuredClone (Safari < 15.4)"],
  [/\.findLast(Index)?\(/, "findLast (Safari < 15.4, Chrome < 97)"],
  [/\.to(Sorted|Reversed|Spliced)\(/, "toSorted/toReversed (Safari < 16, Chrome < 110)"],
  [/Object\.groupBy|Map\.groupBy/, "groupBy (muy reciente)"],
  [/Object\.hasOwn\(/, "Object.hasOwn (Safari < 15.4)"],
  [/^\s*static\s*\{/, "bloques static de clase (Safari < 16.4)"],
];
// CSS que esos navegadores no entienden (y que no tiene alternativa en la regla)
const CSS_PROHIBIDO = [
  [/color-mix\(/, "color-mix() (Safari < 16.2, Chrome < 111): los colores desaparecen"],
  [/:has\(/, ":has() (Safari < 15.4, Chrome < 105)"],
  [/@container/, "@container (Safari < 16, Chrome < 105)"],
];

for (const f of archivos) {
  const rel = relative(raiz, f);
  const texto = readFileSync(f, "utf8");
  const lineas = texto.split("\n");
  const esJS = /\.(m?js)$/.test(f), esCSS = /\.css$/.test(f), esHTML = /\.html$/.test(f);
  const reglas = [...(esJS || esHTML ? JS_PROHIBIDO : []), ...(esCSS || esHTML || esJS ? CSS_PROHIBIDO : [])];
  for (const [re, que, excepcion] of reglas) {
    const malas = lineas.map((l, i) => [l, i + 1]).filter(([l]) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && (!excepcion || excepcion(l)));
    if (malas.length) ok(false, `${rel}:${malas.map(([, n]) => n).join(",")} usa ${que}`);
  }
  if (esCSS) {
    // Cada regla con dvh/svh debe traer antes una alternativa en vh (o px) para Safari < 15.4 / Chrome < 108
    for (const bloque of texto.split("}")) {
      for (const prop of ["height", "min-height", "max-height"]) {
        const con = new RegExp(`(?:^|[;{\\s])${prop}:[^;]*\\b\\d+(dvh|svh|lvh)`).test(bloque);
        if (!con) continue;
        const declaraciones = bloque.split(";").filter((d) => new RegExp(`(^|\\s|\\{)${prop}:`).test(d));
        ok(declaraciones.length >= 2 && !/dvh|svh|lvh/.test(declaraciones[0]), `${rel}: "${prop}" con dvh tiene alternativa antes (${bloque.trim().split("\n")[0].slice(0, 50)})`);
      }
    }
    // backdrop-filter necesita también el prefijo -webkit- (Safari < 18)
    for (const bloque of texto.split("}")) {
      if (/(^|[;{\s])backdrop-filter:/.test(bloque) && !/-webkit-backdrop-filter:/.test(bloque)) {
        ok(false, `${rel}: backdrop-filter sin -webkit-backdrop-filter (${bloque.trim().split("\n")[0].slice(0, 50)})`);
      }
    }
    // En iPhone, un campo con letra menor a 16 px hace zoom al tocarlo y descuadra la página
    ok(/input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*(16px|max\(16px)/.test(texto) || /@media[^{]*pointer:\s*coarse[^{]*\{[^}]*input[^}]*font-size:\s*16px/.test(texto),
      `${rel}: los campos de texto tienen al menos 16 px (sin zoom al tocarlos en iPhone)`);
    ok(/-webkit-text-size-adjust:\s*100%/.test(texto), `${rel}: -webkit-text-size-adjust fijo (iPhone no agranda la letra al girar)`);
  }
}

// El viewport deja usar las áreas seguras y no bloquea el zoom de accesibilidad
const index = readFileSync(join(raiz, "index.html"), "utf8");
const viewport = index.match(/<meta name="viewport" content="([^"]+)"/)?.[1] || "";
ok(/viewport-fit=cover/.test(viewport), "viewport con viewport-fit=cover (áreas seguras del iPhone)");
ok(!/user-scalable=no|maximum-scale=1(\D|$)/.test(viewport), "el viewport no bloquea el zoom (accesibilidad)");

console.log(fallos ? `\n${fallos} problema(s) de compatibilidad` : `\nSin problemas de compatibilidad en ${archivos.length} archivos de web/`);
process.exit(fallos ? 1 : 0);
