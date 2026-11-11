/**
 * Copia la PWA (raíz del repositorio) a native/dist para que Capacitor la
 * empaquete. No hay build: es la misma web que sirve GitHub Pages, sin el
 * Service Worker (dentro de la app nativa no aplica y WKWebView no lo soporta
 * en el esquema capacitor://).
 */
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..", "..");
const dist = join(aqui, "..", "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const d of ["assets", "data"]) cpSync(join(raiz, d), join(dist, d), { recursive: true });
cpSync(join(raiz, "manifest.json"), join(dist, "manifest.json"));

let html = readFileSync(join(raiz, "index.html"), "utf8");
html = html.replace(/<script>\s*if \('serviceWorker' in navigator\) \{[\s\S]*?<\/script>/, "<!-- Service Worker omitido en la app nativa -->");
writeFileSync(join(dist, "index.html"), html);
rmSync(join(dist, "assets", "sw.js"), { force: true });

console.log("dist listo:", dist);
