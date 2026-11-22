// Empaqueta la lógica de la web para la app iOS: node scripts/logica-ios.mjs
//
// La app SwiftUI no reescribe el parser de etiquetas, los datos ni el motor de
// ahorro: los ejecuta con JavaScriptCore. JavaScriptCore no carga módulos ES,
// así que este script junta web/assets/ocr.js, web/data/store.js y
// web/data/ahorro.js en un solo script clásico (cada módulo en su propia
// función, con sus imports resueltos) y lo deja en ios/Quanto/Recursos/logica.js.
//
// Además define:
//   - localStorage en memoria (QuantoAlmacen lo carga y lo vuelca a un archivo
//     desde Swift), porque JavaScriptCore no tiene almacenamiento propio;
//   - QuantoLlamar(nombre, argsJSON): la única puerta que usa Swift. Recibe y
//     devuelve JSON ({ r: resultado }).
//
// tests/logica-ios-test.mjs comprueba que el archivo esté al día y que funcione
// en un contexto sin DOM, como el de JavaScriptCore.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = new URL("../", import.meta.url);
export const DESTINO = fileURLToPath(new URL("ios/Quanto/Recursos/logica.js", raiz));

const MODULOS = [
  ["ocr", "web/assets/ocr.js"],
  ["store", "web/data/store.js"],
  ["ahorro", "web/data/ahorro.js"],
];

const CABECERA = `// GENERADO por scripts/logica-ios.mjs desde web/ (ocr.js, store.js, ahorro.js).
// No lo edites a mano: cambia la web y corre \`npm run logica:ios\`.
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
`;

const PIE = `
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
`;

/** Convierte un módulo ES en el cuerpo de una función que devuelve sus exports. */
function comoFuncion(nombre, codigo) {
  const exportados = [];
  let src = codigo.replace(/^import\s*\{([^}]*)\}\s*from\s*["']\.\/([\w-]+)\.js["'];?/gm,
    (_, nombres, mod) => `const {${nombres}} = __m.${mod};`);
  src = src.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_, nombres) => {
    exportados.push(...nombres.split(",").map((s) => s.trim()).filter(Boolean));
    return "";
  });
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (_, tipo, n) => {
    exportados.push(n);
    return `${tipo} ${n}`;
  });
  const sobrante = src.match(/^\s*(import|export)\b.*$/m);
  if (sobrante) throw new Error(`${nombre}: no sé convertir "${sobrante[0].trim()}"`);
  return `__m.${nombre} = (function () {\n${src.trimEnd()}\n\nreturn { ${[...new Set(exportados)].join(", ")} };\n})();\n`;
}

export function generarLogica() {
  let out = CABECERA;
  for (const [nombre, ruta] of MODULOS) {
    out += `\n// ---- ${ruta} ----\n` + comoFuncion(nombre, readFileSync(new URL(ruta, raiz), "utf8"));
  }
  return out + PIE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, generarLogica());
  console.log(`logica.js listo: ${DESTINO}`);
}
