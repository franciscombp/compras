# Desarrollo

## Requisitos

- Git, Python 3 y Node 22 o superior.
- Para la app de iPhone: un Mac con Xcode 16 o superior (Xcode 26 para Apple Intelligence) y XcodeGen (`brew install xcodegen`).
- Para el Worker opcional: una cuenta de Cloudflare y una API key de Anthropic.

## Comandos

Todos se ejecutan desde la raíz del repositorio.

| Comando | Qué hace |
|---|---|
| `npm run serve` | Sirve `web/` en http://localhost:8000 |
| `npm run serve:https` | Sirve `web/` en https://localhost:4443 (cámara y dictado desde el teléfono) |
| `npm test` | Pruebas de la lógica: parser de etiquetas, barrido en vivo y motor de ahorro |
| `npm run catalogo` | Descarga el catálogo de productos (lo mismo que hace el bot cada lunes) |
| `npm run ios` | Regenera `ios/Quanto/Recursos/logica.js`, genera el proyecto con XcodeGen y abre Xcode |
| `npm run logica:ios` | Solo regenera `logica.js` (la lógica de la web para la app de iPhone) |
| `npm run worker:dev` | Levanta el Worker de Cloudflare en local |

La raíz no tiene dependencias: `package.json` solo guarda estos atajos.

## Probar la cámara desde el teléfono

El navegador solo deja usar la cámara y el dictado en HTTPS o en `localhost`. Para abrir la app desde el teléfono en tu red local:

```bash
brew install mkcert            # o el gestor de tu sistema
mkcert -install
mkcert localhost 127.0.0.1 ::1 <IP-de-tu-computador>
mv localhost+3.pem localhost.pem
mv localhost+3-key.pem localhost-key.pem
npm run serve:https
```

Los certificados quedan en la raíz del repositorio y Git los ignora. El servidor imprime la dirección para abrir desde el teléfono.

## Pruebas

```bash
npm test
```

- `tests/parser-test.mjs`: lectura de etiquetas (precios, packs, promos, unidades).
- `tests/vivo-test.mjs`: agrupación de etiquetas y seguimiento entre fotogramas del barrido.
- `tests/marco-test.mjs`: detector del marco de la etiqueta con estantes sintéticos (girada, amarilla, varias, reflejos, luz desigual, etiqueta sobre cartel de promoción, etiqueta tan blanca como el estante, velocidad).
- `tests/parser-test.mjs` incluye etiquetas de Supermaxi tal como las lee Vision y como las leyó Tesseract en fotos reales (afiliado / no afiliado, centavos elevados, «US.80.95», «1.8U», nombre antes de «EXENTO DE IVA», código impreso).
- `tests/ahorro-test.mjs`: memoria de precios, semáforo, recompra, tiendas, consejos y copia de seguridad, con tres meses de compras simuladas en cuatro tiendas. Si le pasas una ruta (`node tests/ahorro-test.mjs semilla.json`), guarda el `localStorage` resultante para cargarlo en el navegador.
- `tests/compat-test.mjs`: revisa que `web/` no use JavaScript ni CSS que rompa en iPhone con iOS 15 o Android con Chrome 90 (lookbehind, `color-mix`, `dvh` sin alternativa, campos con letra chica que hacen zoom, etc.).
- `tests/logica-ios-test.mjs`: comprueba que `ios/Quanto/Recursos/logica.js` esté al día con la web y que funcione sin DOM, como en JavaScriptCore dentro de la app de iPhone. Si falla por desactualizado: `npm run logica:ios`.

Para probar el lector con fotos o capturas reales, abre `/lab/etiquetas.html` con el servidor local (o en https://franciscombp.github.io/compras/lab/etiquetas.html). Muestra qué etiqueta detecta (en verde), el recorte que lee y lo que extrae.

## Antes de subir cambios a la web

- Revisa la sintaxis: `node -c web/assets/app.js`.
- Cambia `CACHE_VERSION` en `web/assets/sw.js` para que los teléfonos descarguen la versión nueva.
- Usa comillas rectas en el código: las comillas tipográficas rompen el JavaScript.
- Pon `autocomplete="off"` en cada campo de texto nuevo.

## Ramas y commits

Nombres de rama: `<tipo>/<descripción-corta>`, por ejemplo `feature/barrido-nativo` o `fix/ocr-precio-unitario`.

| Tipo | Para qué |
|---|---|
| `feature/` | Característica nueva |
| `fix/` | Corrección de un error |
| `design/` | Cambios visuales o de experiencia |
| `refactor/` | Limpieza sin cambiar el comportamiento |
| `docs/` | Documentación |

Commits pequeños, en español, con un título que diga qué cambia y un cuerpo que diga por qué. Los cambios entran a `main` por pull request; al mergear, la web se publica sola (ver `docs/despliegue.md`).
