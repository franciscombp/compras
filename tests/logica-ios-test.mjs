// La lógica que usa la app iOS (JavaScriptCore): node tests/logica-ios-test.mjs
//
// 1) ios/Quanto/Recursos/logica.js está al día con web/ (si no: npm run logica:ios).
// 2) Funciona en un contexto vacío, sin window, document, fetch ni console,
//    como el JSContext de la app, y solo a través de QuantoLlamar (JSON).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { generarLogica, DESTINO } from "../scripts/logica-ios.mjs";

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fallos++; };

const generado = generarLogica();
ok(readFileSync(DESTINO, "utf8") === generado, "logica.js está al día con web/ (si falla: npm run logica:ios)");

function motor(guardado = "") {
  const ctx = vm.createContext({});
  vm.runInContext(generado, ctx, { filename: "logica.js" });
  vm.runInContext(`QuantoAlmacen.cargar(${JSON.stringify(guardado)})`, ctx);
  const llamar = (nombre, ...args) => JSON.parse(ctx.QuantoLlamar(nombre, JSON.stringify(args))).r;
  return { ctx, llamar, volcar: () => vm.runInContext("QuantoAlmacen.volcar()", ctx), sucio: () => vm.runInContext("QuantoAlmacen.sucio()", ctx) };
}

const m = motor();
ok(typeof m.ctx.document === "undefined" && typeof m.ctx.window === "undefined", "carga sin DOM");

// Listas e items
const lista = m.llamar("crearLista", "Súper del sábado", "Supermaxi");
ok(lista?.id && lista.comercio_principal === "Supermaxi", "crearLista devuelve la lista");
ok(m.llamar("getListaActivaId") === lista.id, "la lista nueva queda activa");
const leche = m.llamar("guardarProducto", { nombre: "Leche entera Vita 1 L", cantidad: 2, contenido: 1000, unidad_medida: "ml", precio_estimado: 1.1, lista_id: lista.id });
m.llamar("verificarEnTienda", leche.id, 1.05);
const t = m.llamar("calcularTotales", lista.id);
ok(Math.abs(t.totalVerificado - 2.1) < 1e-9 && t.countVerificados === 1, "calcularTotales con precio verificado");
ok(m.llamar("getPrecios").length === 1, "verificar registra el precio en la memoria");
ok(m.sucio() === true, "el almacén queda marcado para guardar");

// Persistencia: volcar y volver a cargar en otro motor
const json = m.volcar();
const m2 = motor(json);
ok(m2.llamar("getLista", lista.id).length === 1, "los datos sobreviven a volcar/cargar");

// Parser de etiquetas desde Vision
const supermaxi = "ALIM HUM PERRO CAR/VEG PU 85G\nEXENTO DE IVA\nAFILIADO\nUS.$ 0.79\nNO AFILIADO US.$ 0.89";
const d = m2.llamar("leerVision", supermaxi, [], 0);
ok(d.precio === 0.79 && d.contenido === 85 && d.unidad === "g", `leerVision lee la etiqueta Supermaxi (${JSON.stringify(d)})`);
ok(m2.llamar("leerVision", "sin números", [], 2.5).precio === 2.5, "leerVision usa el precio de respaldo");

// Motor de ahorro
m2.llamar("registrarPrecio", { nombre: "Leche entera Vita 1 L", precio: 1.3, contenido: 1000, unidad: "ml", tienda: "Mi Comisariato" });
const sem = m2.llamar("semaforoPrecio", { nombre: "Leche Vita", precio: 1.4, contenido: 1000, unidad: "ml" });
ok(sem.nivel === "caro", `semaforoPrecio marca caro un precio alto (${sem.nivel})`);
ok(typeof m2.llamar("resumenParaCoach", { listaId: lista.id }) === "string", "resumenParaCoach devuelve texto");
ok(Array.isArray(m2.llamar("consejos", { listaId: lista.id })), "consejos devuelve una lista");
ok(m2.llamar("estadisticasProducto", "producto que no existe") === null, "null llega como null");

// Migración desde el localStorage del WebView anterior
const m3 = motor();
const crudo = JSON.parse(json);
const r = m3.llamar("importarDesdeWeb", crudo);
ok(!r.vacio && r.items === 1 && m3.llamar("getListaActivaId") === lista.id, "importarDesdeWeb trae listas, items y la lista activa");
ok(m3.llamar("importarDesdeWeb", {}).vacio === true, "importarDesdeWeb sin datos no toca nada");

let error = null;
try { m3.llamar("noExiste"); } catch (e) { error = e; }
ok(error && /noExiste/.test(error.message), "una función inexistente lanza un error claro");

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nLa lógica de la app iOS funciona sin DOM");
process.exit(fallos ? 1 : 0);
