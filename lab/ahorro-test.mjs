// Pruebas del motor de ahorro: node lab/ahorro-test.mjs [ruta-semilla.json]
// Simula localStorage, construye tres meses de compras en dos tiendas y
// comprueba memoria de precios, semáforo, frecuentes, tiendas y consejos.
// Si se pasa una ruta, vuelca el localStorage resultante como semilla para
// las pruebas de navegador.
import { writeFileSync } from "node:fs";

const memoria = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
};
const store = await import("../data/store.js");
const ahorro = await import("../data/ahorro.js");
const { crearLista, guardarProducto, verificarEnTienda, facturarItem, cerrarLista, actualizarLista, setPresupuesto, guardarComparacion, setAjustes, exportarDatos, importarDatos, getPrecios } = store;
const { claveProducto, estadisticasProducto, semaforoPrecio, productosFrecuentes, sugerenciasRecompra, comparativaTiendas, resumenAhorro, consejos, resumenParaCoach } = ahorro;

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fallos++; };
const AHORA = new Date("2026-11-11T15:00:00").getTime();
const ts = (s) => new Date(`${s}T11:00:00`).getTime();
const realNow = Date.now;
function enFecha(t, fn) { Date.now = () => t; try { return fn(); } finally { Date.now = realNow; } }

/** Compra cerrada: crea lista, items verificados al precio, factura y cierra. */
function compra(fecha, tienda, items, { dif = 0 } = {}) {
  return enFecha(ts(fecha), () => {
    const lista = crearLista(`Compra ${fecha}`, tienda);
    let total = 0;
    for (const it of items) {
      const item = guardarProducto({ nombre: it.n, cantidad: it.c || 1, contenido: it.g ?? null, unidad_medida: it.u ?? null, precio_estimado: it.p, lista_id: lista.id });
      verificarEnTienda(item.id, it.p);
      facturarItem(item.id, it.p);
      total += it.p * (it.c || 1);
    }
    cerrarLista(lista.id, total + dif, total);
    actualizarLista(lista.id, { creada_en: ts(fecha), cerrada_en: ts(fecha) });
    return lista;
  });
}

setAjustes({ tienda_habitual: "Supermaxi", presupuesto_defecto: 25 });
compra("2026-08-20", "Supermaxi", [{ n: "Leche entera Vita 1 L", c: 2, g: 1000, u: "ml", p: 1.25 }, { n: "Atún Real lomitos 170 g", g: 170, u: "g", p: 1.89 }, { n: "Arroz Gustadina 2 kg", g: 2000, u: "g", p: 2.60 }, { n: "Pan integral", p: 1.50 }], { dif: -0.30 });
compra("2026-09-05", "Tía", [{ n: "Leche entera Vita 1 L", c: 2, g: 1000, u: "ml", p: 1.19 }, { n: "Atún Real lomitos 170 g", g: 170, u: "g", p: 1.75 }, { n: "Papel higiénico Familia 12 u", g: 12, u: "unidad", p: 4.99 }]);
compra("2026-09-22", "Supermaxi", [{ n: "Leche entera Vita 1 L", g: 1000, u: "ml", p: 1.29 }, { n: "Arroz Gustadina 2 kg", g: 2000, u: "g", p: 2.75 }, { n: "Atún Van Camps 3 x 170 g", g: 510, u: "g", p: 4.99 }, { n: "Pan integral", p: 1.50 }]);
compra("2026-10-10", "Tía", [{ n: "Leche entera Vita 1 L", g: 1000, u: "ml", p: 1.19 }, { n: "Atún Real lomitos 170 g", g: 170, u: "g", p: 1.79 }, { n: "Papel higiénico Familia 12 u", g: 12, u: "unidad", p: 5.10 }, { n: "Detergente Deja 1 kg", g: 1000, u: "g", p: 3.20 }]);
compra("2026-10-28", "Supermaxi", [{ n: "Leche entera Vita 1 L", g: 1000, u: "ml", p: 1.35 }, { n: "Arroz Gustadina 2 kg", g: 2000, u: "g", p: 2.80 }, { n: "Pan integral", p: 1.60 }, { n: "Yogur Toni 1 L", g: 1000, u: "ml", p: 2.10 }], { dif: 0.45 });
compra("2026-11-03", "Supermaxi", [{ n: "Leche entera Vita 1 L", g: 1000, u: "ml", p: 1.35 }, { n: "Atún Real lomitos 170 g", g: 170, u: "g", p: 1.99 }, { n: "Pan integral", p: 1.60 }]);

enFecha(ts("2026-10-15"), () => guardarComparacion({ origen: "comparador", items: [
  { nombre: "Atún lata suelta", precio: 1.20, totalContenido: 80, unidad: "g", normalizado: 1.5 },
  { nombre: "Atún pack ×6", precio: 6.00, totalContenido: 480, unidad: "g", normalizado: 1.25 },
] }));

// Lista activa de hoy
const activa = enFecha(AHORA, () => crearLista("Mercado semanal", "Supermaxi"));
setPresupuesto(activa.id, 25);
enFecha(AHORA, () => {
  guardarProducto({ nombre: "Leche entera Vita 1 L", cantidad: 2, contenido: 1000, unidad_medida: "ml", precio_estimado: 1.35, lista_id: activa.id });
  guardarProducto({ nombre: "Atún Real lomitos 170 g", cantidad: 1, contenido: 170, unidad_medida: "g", precio_estimado: 1.99, lista_id: activa.id });
  guardarProducto({ nombre: "Huevos 15 unidades", cantidad: 1, precio_estimado: 3.50, lista_id: activa.id });
});

// ---- claves ----
ok(claveProducto("Leche entera Vita 1 L") === claveProducto("leche Vita entera") && claveProducto("Leche entera Vita 1 L") === "entera leche vita", `clave estable: "${claveProducto("Leche entera Vita 1 L")}"`);
ok(claveProducto("Atún Real lomitos 170 g") !== claveProducto("Atún Van Camps 3 x 170 g"), "marcas distintas, claves distintas");

// ---- memoria ----
const leche = estadisticasProducto("Leche Vita 1 L", { ahora: AHORA });
ok(leche && leche.n === 6 && leche.baseNormalizada, `leche: ${leche?.n} precios por 100 ml`);
ok(leche.minimo.tienda === "Tía" && Math.abs(leche.minimo.valor - 0.119) < 1e-6, `mínimo de leche en ${leche.minimo.tienda} a $${leche.minimo.valor.toFixed(3)}/100 ml`);
ok(leche.tiendas[0].tienda === "Tía" && leche.tiendas.length === 2, "tiendas ordenadas de barata a cara");
ok(getPrecios().filter((p) => p.clave === leche.clave).length === 6, "verificar + facturar al mismo precio cuentan una sola vez");

// ---- semáforo ----
const caro = semaforoPrecio({ nombre: "Atún Real lomitos 170 g", precio: 1.99, contenido: 170, unidad: "g" }, { ahora: AHORA });
ok(caro.nivel === "caro" && /Tía/.test(caro.texto), `atún a $1.99 -> ${caro.nivel}: ${caro.texto}`);
const bueno = semaforoPrecio({ nombre: "Atún Real 170 g", precio: 1.75, contenido: 170, unidad: "g" }, { ahora: AHORA });
ok(bueno.nivel === "bueno", `atún a $1.75 -> ${bueno.nivel}: ${bueno.texto}`);
const normal = semaforoPrecio({ nombre: "Atún Real 170 g", precio: 1.85, contenido: 170, unidad: "g" }, { ahora: AHORA });
ok(normal.nivel === "normal", `atún a $1.85 -> ${normal.nivel}`);
ok(semaforoPrecio({ nombre: "Huevos 15 unidades", precio: 3.5 }, { ahora: AHORA }).nivel === "sin_datos", "sin memoria -> sin_datos");
const pan = semaforoPrecio({ nombre: "Pan integral", precio: 1.80 }, { ahora: AHORA });
ok(pan.nivel === "caro", `sin gramaje compara por envase: pan a $1.80 -> ${pan.nivel}`);

// ---- frecuentes y recompra ----
const frec = productosFrecuentes({ ahora: AHORA });
const papel = frec.find((f) => /papel/i.test(f.nombre));
ok(frec[0] && /leche/i.test(frec[0].nombre) && frec[0].veces === 6, `más frecuente: ${frec[0]?.nombre} (${frec[0]?.veces} compras, cada ${frec[0]?.intervaloDias} días)`);
ok(papel && papel.toca && papel.intervaloDias === 35, `papel higiénico toca reponer (cada ${papel?.intervaloDias} días, hace ${papel?.diasDesde})`);
const sug = sugerenciasRecompra(activa.id, { ahora: AHORA });
ok(sug[0] && /papel/i.test(sug[0].nombre) && !sug.some((s) => /leche|atún real/i.test(s.nombre)), `sugerencias: ${sug.map((s) => s.nombre).join(" · ")}`);
ok(sug[0].precioRef === 5.10, `precio de referencia de la sugerencia: $${sug[0].precioRef}`);

// ---- tiendas ----
const tiendas = comparativaTiendas({ ahora: AHORA });
ok(tiendas[0]?.tienda === "Tía" && tiendas[0].gana === 2 && tiendas[0].compara === 2, `tienda ganadora: ${tiendas[0]?.tienda} ${tiendas[0]?.gana}/${tiendas[0]?.compara}`);

// ---- resumen ----
const r = resumenAhorro({ ahora: AHORA });
ok(r.compras === 6 && r.comprasMes === 1 && Math.abs(r.gastoMes - 4.94) < 0.01, `este mes: $${r.gastoMes.toFixed(2)} en ${r.comprasMes} compra`);
ok(Math.abs(r.gastoAnterior - (11.28 + 8.30)) < 0.01, `mes anterior: $${r.gastoAnterior.toFixed(2)} (incluye los $0.45 de más en caja)`);
ok(Math.abs(r.ahorroComparando - 1.2) < 0.01 && r.comparacionesConAhorro === 1, `ahorro comparando: $${r.ahorroComparando.toFixed(2)}`);
ok(Math.abs(r.menosQueVerificado - 0.30) < 0.01 && Math.abs(r.masQueVerificado - 0.45) < 0.01, "diferencias de caja acumuladas");
ok(r.topGasto[0] && /leche|papel/i.test(r.topGasto[0].nombre) && r.topGasto[0].pct > 0.15, `mayor gasto: ${r.topGasto[0]?.nombre} (${Math.round(r.topGasto[0]?.pct * 100)}%)`);

// ---- consejos ----
const cs = consejos({ ahora: AHORA, listaId: activa.id });
const tipos = cs.map((c) => c.tipo);
ok(tipos.includes("caro") && tipos.includes("tienda") && tipos.includes("recompra"), `consejos: ${tipos.join(", ")}`);
ok(/Atún Real/.test(cs.find((c) => c.tipo === "caro").titulo) && /Tía.*12% menos/.test(cs.find((c) => c.tipo === "caro").texto), `consejo caro: ${cs.find((c) => c.tipo === "caro").texto}`);
ok(cs.find((c) => c.tipo === "recompra")?.accion?.agregar, "el consejo de recompra trae acción de agregar");
ok(resumenParaCoach({ ahora: AHORA, listaId: activa.id }).split("\n").length >= 6, "resumen para el coach tiene varias líneas");

// ---- copia de seguridad ----
const copia = exportarDatos();
const antes = { listas: copia.listas.length, items: copia.items.length, precios: copia.precios.length };
const res = importarDatos(JSON.stringify(copia), "reemplazar");
ok(res.listas === antes.listas && res.items === antes.items && res.precios === antes.precios, `export/import ida y vuelta: ${JSON.stringify(res)}`);
const res2 = importarDatos(copia, "fusionar");
ok(res2.items === antes.items, "fusionar no duplica");
let error = null; try { importarDatos("{\"x\":1}"); } catch (e) { error = e.message; }
ok(error === "formato", "rechaza un JSON que no es de Quanto");

if (process.argv[2]) {
  writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(memoria)), "utf8");
  console.log("semilla escrita en", process.argv[2]);
}
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas del motor de ahorro pasan");
process.exit(fallos ? 1 : 0);
