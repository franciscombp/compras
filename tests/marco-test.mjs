// Pruebas del detector de etiquetas: node tests/marco-test.mjs
// Genera escenas sintéticas (riel oscuro con ruido, etiquetas claras con
// texto oscuro, distractores) y comprueba que se encuentre la etiqueta.
import { detectarEtiquetas, mejorEtiqueta, escalarCaja, iouCajas } from "../web/assets/marco.js";

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fallos++; };

let semilla = 7;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function escena(w, h, fondo = [70, 72, 68], ruido = 30) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const r = (azar() - 0.5) * ruido;
    data[p * 4] = fondo[0] + r; data[p * 4 + 1] = fondo[1] + r; data[p * 4 + 2] = fondo[2] + r; data[p * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function pintar(img, dentro, color) {
  const { data, width: w, height: h } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!dentro(x, y)) continue;
    const i = (y * w + x) * 4;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
}

/** Etiqueta: rectángulo (opcionalmente girado) con "texto" oscuro dentro. */
function etiqueta(img, { cx, cy, w, h, grados = 0, color = [242, 240, 232], tinta = [25, 25, 25] }) {
  const a = (grados * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const local = (x, y) => { const dx = x - cx, dy = y - cy; return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos }; };
  pintar(img, (x, y) => { const { u, v } = local(x, y); return Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2; }, color);
  // nombre (línea fina), gramaje y precio grande
  const bloques = [
    { u0: -0.4, u1: 0.3, v0: -0.38, v1: -0.28 },
    { u0: -0.4, u1: -0.1, v0: -0.2, v1: -0.12 },
    { u0: -0.25, u1: 0.35, v0: 0.0, v1: 0.32 },
  ];
  pintar(img, (x, y) => {
    const { u, v } = local(x, y);
    return bloques.some((b) => u >= b.u0 * w && u <= b.u1 * w && v >= b.v0 * h && v <= b.v1 * h && (Math.floor(u / 3) % 3 !== 0));
  }, tinta);
}

const centro = (c) => ({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 });

// 1) Una etiqueta en el centro de un riel con ruido
let img = escena(320, 420);
etiqueta(img, { cx: 160, cy: 210, w: 170, h: 95 });
let m = mejorEtiqueta(img);
ok(m && Math.abs(centro(m).x - 160) < 6 && Math.abs(centro(m).y - 210) < 6 && Math.abs((m.x1 - m.x0) - 170) < 8, `etiqueta centrada: ${m ? `${m.x0},${m.y0}-${m.x1},${m.y1}` : "nada"}`);

// 2) Distractores: reflejo claro sin texto, banda clara a lo ancho y un círculo claro
img = escena(320, 420);
pintar(img, (x, y) => (x - 60) ** 2 + (y - 80) ** 2 < 35 ** 2, [235, 235, 235]);           // círculo sin texto
pintar(img, (x, y) => y > 390, [250, 250, 250]);                                              // borde inferior claro
pintar(img, (x, y) => x > 250 && x < 300 && y > 40 && y < 120, [230, 230, 230]);             // reflejo sin texto
etiqueta(img, { cx: 170, cy: 250, w: 160, h: 90 });
m = mejorEtiqueta(img);
ok(m && Math.abs(centro(m).x - 170) < 8 && Math.abs(centro(m).y - 250) < 8, `ignora reflejos y bandas sin texto: ${m ? `${Math.round(centro(m).x)},${Math.round(centro(m).y)}` : "nada"}`);

// 3) Etiqueta girada 12° (foto torcida)
img = escena(320, 420);
etiqueta(img, { cx: 160, cy: 200, w: 160, h: 90, grados: 12 });
m = mejorEtiqueta(img);
ok(m && Math.abs(centro(m).x - 160) < 8 && Math.abs(centro(m).y - 200) < 8 && m.rectangularidad > 0.85, `etiqueta girada 12°: rectangularidad ${m?.rectangularidad.toFixed(2)}`);
ok(m && m.esquinas.length === 4 && m.esquinas[0].y < m.esquinas[2].y, "devuelve cuatro esquinas en orden");

// 4) Etiqueta amarilla de oferta
img = escena(320, 420, [60, 58, 55]);
etiqueta(img, { cx: 150, cy: 220, w: 180, h: 100, color: [250, 214, 40], tinta: [190, 20, 20] });
m = mejorEtiqueta(img);
ok(m && Math.abs(centro(m).x - 150) < 8, `etiqueta amarilla con precio rojo: ${m ? "encontrada" : "nada"}`);

// 5) Varias etiquetas en el riel: todas aparecen, la del centro primero
img = escena(480, 360);
etiqueta(img, { cx: 85, cy: 180, w: 140, h: 80 });
etiqueta(img, { cx: 240, cy: 180, w: 140, h: 80 });
etiqueta(img, { cx: 395, cy: 180, w: 140, h: 80 });
const todas = detectarEtiquetas(img);
ok(todas.length === 3, `tres etiquetas en el riel: ${todas.length}`);
ok(todas[0] && Math.abs(centro(todas[0]).x - 240) < 8, "la del centro va primero");

// 6) Escena sin etiqueta: fondo claro uniforme o riel vacío
ok(detectarEtiquetas(escena(320, 420, [235, 235, 235], 10)).length === 0, "fondo claro sin etiqueta: nada");
ok(detectarEtiquetas(escena(320, 420)).length === 0, "riel vacío: nada");

// 7) Escalado a la imagen original con margen
img = escena(320, 420);
etiqueta(img, { cx: 160, cy: 210, w: 170, h: 95 });
m = mejorEtiqueta(img);
const grande = escalarCaja(m, 4, 1280, 1680, 0.06);
ok(grande.x0 >= 0 && grande.x1 <= 1280 && grande.x1 - grande.x0 > (m.x1 - m.x0) * 4, `escala a la foto original con margen: ${grande.x0},${grande.y0}-${grande.x1},${grande.y1}`);
ok(iouCajas(m, { x0: m.x0 + 2, y0: m.y0 + 2, x1: m.x1 + 2, y1: m.y1 + 2 }) > 0.9, "IoU de cajas casi iguales > 0.9");

// 8) Luz desigual: mitad izquierda muy clara (ventana) y etiqueta en el centro-derecha
img = escena(320, 420);
pintar(img, (x) => x < 120, [215, 215, 210]);
etiqueta(img, { cx: 210, cy: 210, w: 150, h: 85, color: [200, 198, 190] });
m = mejorEtiqueta(img);
ok(m && Math.abs(centro(m).x - 210) < 10 && Math.abs(centro(m).y - 210) < 10, `luz desigual: ${m ? `${Math.round(centro(m).x)},${Math.round(centro(m).y)}` : "nada"}`);

// 9) Rendimiento: 320 x 427
img = escena(320, 427);
etiqueta(img, { cx: 160, cy: 210, w: 170, h: 95 });
const t0 = performance.now();
for (let i = 0; i < 20; i++) detectarEtiquetas(img);
const ms = (performance.now() - t0) / 20;
ok(ms < 25, `detección en ${ms.toFixed(1)} ms por fotograma`);

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas del detector de etiquetas pasan");
process.exit(fallos ? 1 : 0);
