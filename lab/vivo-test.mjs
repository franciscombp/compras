// Pruebas del barrido en vivo: node lab/vivo-test.mjs
import { agruparEtiquetas, Seguimiento, mapearCaja, normalizadoDe } from "../assets/vivo.js";

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fallos++; };
const linea = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
const palabrasDe = (lineas) => lineas.flatMap((l) => {
  const ws = l.text.split(" "); const ancho = (l.bbox.x1 - l.bbox.x0) / ws.length;
  return ws.map((w, i) => ({ text: w, bbox: { x0: l.bbox.x0 + i * ancho, x1: l.bbox.x0 + (i + 1) * ancho, y0: l.bbox.y0, y1: l.bbox.y1 } }));
});

// Dos etiquetas una al lado de la otra en el riel, con un hueco claro.
const estante = [
  linea("Atún Real lomitos", 20, 20, 220, 40),
  linea("170 g", 20, 48, 90, 66),
  linea("$ 1.89", 20, 76, 160, 150),
  linea("Atún Van Camps", 420, 20, 620, 40),
  linea("3 x 170 g", 420, 48, 520, 66),
  linea("$ 4.99", 420, 76, 560, 150),
];
let regiones = agruparEtiquetas(estante, palabrasDe(estante));
ok(regiones.length === 2, `dos etiquetas separadas (${regiones.length})`);
ok(regiones[0]?.datos.precio === 1.89 && regiones[0]?.datos.contenido === 170, `primera: $1.89 · 170 g (${JSON.stringify(regiones[0]?.datos)})`);
ok(regiones[1]?.datos.precio === 4.99 && regiones[1]?.datos.unidades === 3, `segunda: $4.99 · 3 envases (${JSON.stringify(regiones[1]?.datos)})`);

// Etiquetas pegadas (sin hueco): se parten por sus dos precios.
const pegadas = [
  linea("Leche Vita 1 L", 20, 20, 200, 40), linea("$ 1.25", 20, 50, 150, 120),
  linea("Leche Toni 1 L", 215, 20, 400, 40), linea("$ 1.40", 215, 50, 345, 120),
];
regiones = agruparEtiquetas(pegadas, palabrasDe(pegadas));
ok(regiones.length === 2 && regiones.map((r) => r.datos.precio).join() === "1.25,1.4", `etiquetas pegadas se separan por precio (${regiones.map((r) => r.datos.precio)})`);

// Texto sin precio no genera etiqueta.
ok(agruparEtiquetas([linea("Ofertas de la semana", 0, 0, 300, 30)]).length === 0, "texto sin precio se ignora");

// Seguimiento: confirma a la segunda vista, no repite, olvida las que desaparecen.
const seg = new Seguimiento({ confirmarTras: 2, olvidarMs: 1000 });
let r1 = seg.actualizar(agruparEtiquetas(estante, palabrasDe(estante)), 1000);
ok(r1.visibles.length === 2 && r1.nuevasConfirmadas.length === 0, "primer fotograma: visibles pero sin confirmar");
const movido = estante.map((l) => linea(l.text, l.bbox.x0 + 12, l.bbox.y0 + 5, l.bbox.x1 + 12, l.bbox.y1 + 5));
let r2 = seg.actualizar(agruparEtiquetas(movido, palabrasDe(movido)), 1300);
ok(r2.nuevasConfirmadas.length === 2, `segundo fotograma (cámara movida): confirma ambas (${r2.nuevasConfirmadas.length})`);
ok(r2.visibles.every((p) => p.id.startsWith("t") && p.vistas === 2), "misma pista, dos vistas");
let r3 = seg.actualizar(agruparEtiquetas(movido, palabrasDe(movido)), 1600);
ok(r3.nuevasConfirmadas.length === 0, "tercer fotograma: no vuelve a entregar");
let r4 = seg.actualizar([], 3000);
ok(r4.visibles.length === 0, "sin lecturas durante 1 s: el overlay se vacía");
let r5 = seg.actualizar(agruparEtiquetas(estante, palabrasDe(estante)), 3100);
r5 = seg.actualizar(agruparEtiquetas(estante, palabrasDe(estante)), 3400);
ok(r5.nuevasConfirmadas.length === 0, "la misma etiqueta reaparece: no se duplica");

// Confirmación manual por toque.
const seg2 = new Seguimiento();
const v = seg2.actualizar(agruparEtiquetas(estante, palabrasDe(estante)), 1).visibles;
ok(seg2.confirmar(v[0].id)?.id === v[0].id && seg2.confirmar(v[0].id) === null, "toque confirma una vez");

// Mapeo a pantalla con object-fit: cover.
const m = mapearCaja({ x0: 0, y0: 0, x1: 512, y1: 384 }, { w: 1024, h: 768 }, { w: 1920, h: 1440 }, { w: 390, h: 520 });
ok(Math.round(m.x1 - m.x0) === 347 && Math.round(m.x0) === -152, `mapeo cover: ancho ${Math.round(m.x1 - m.x0)} px, x0 ${Math.round(m.x0)} (recorte lateral)`);

ok(Math.abs(normalizadoDe({ precio: 4.99, contenido: 170, unidades: 3, unidad: "g" }) - 0.978) < 0.001, "normalizado por 100 g con pack");

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas del barrido pasan");
process.exit(fallos ? 1 : 0);
