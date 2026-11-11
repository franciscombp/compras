/**
 * Motor de ahorro: convierte la memoria de precios, las listas cerradas y las
 * comparaciones en guía para comprar mejor. Solo lee del store; no toca el
 * DOM, así que se prueba en Node (lab/ahorro-test.mjs).
 *
 *  - estadisticasProducto(nombre): lo que sabes de un producto (último, mínimo,
 *    habitual, tiendas, tendencia).
 *  - semaforoPrecio(obs): ¿este precio es bueno, normal o caro para ti?
 *  - resumenAhorro(): números del mes, ahorro logrado, frecuentes, tiendas.
 *  - sugerenciasRecompra(listaId): lo que sueles comprar y toca reponer.
 *  - consejos(): reglas que detectan oportunidades concretas de ahorro.
 */

import {
  getPrecios, getListas, getLista, getComparaciones, getHistorialListasCerradas,
  claveProducto, precioNormalizado,
} from "./store.js";

export { claveProducto, precioNormalizado };

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
export function clavesCompatibles(nombre, precios = getPrecios()) {
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

export function estadisticasProducto(nombre, { ahora = Date.now(), diasMax = 365 } = {}) {
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
export function semaforoPrecio({ nombre, precio, contenido = null, unidad = null, unidades = 1 }, opciones = {}) {
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
export function productosConMemoria({ ahora = Date.now() } = {}) {
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
export function productosFrecuentes({ ahora = Date.now(), minimo = 2 } = {}) {
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
export function sugerenciasRecompra(listaId, { ahora = Date.now(), limite = 6 } = {}) {
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
export function comparativaTiendas({ ahora = Date.now() } = {}) {
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
export function resumenAhorro({ ahora = Date.now() } = {}) {
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
export function consejos({ ahora = Date.now(), listaId = null, limite = 5 } = {}) {
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
export function resumenParaCoach({ ahora = Date.now(), listaId = null } = {}) {
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
