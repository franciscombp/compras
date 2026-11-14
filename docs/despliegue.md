# Despliegue

## La web en GitHub Pages

La app está en https://franciscombp.github.io/compras/ y se publica con GitHub Actions, no "desde una rama".

- El workflow `.github/workflows/static.yml` sube **solo la carpeta `web/`** a Pages. Lo demás (`native/`, `worker/`, `tests/`, `docs/`) queda en el repositorio pero no se publica.
- Se ejecuta en cada push a `main`, a mano desde la pestaña *Actions* y después de cada actualización del catálogo.
- En *Settings → Pages*, la opción *Source* debe estar en **GitHub Actions**. Si alguien la cambia a *Deploy from a branch*, la web deja de actualizarse.

Después de publicar, los teléfonos que ya tenían la app instalada reciben la versión nueva al abrirla, siempre que se haya cambiado `CACHE_VERSION` en `web/assets/sw.js`. A veces hay que abrirla dos veces.

## Catálogo semanal

El workflow `.github/workflows/actualizar-catalogo.yml` corre cada lunes a las 09:00 UTC (04:00 en Ecuador) y también a mano.

1. Ejecuta `scripts/fetch-catalogo.mjs`, que consulta Open Food Facts y sondea tiendas de Ecuador.
2. Si alguna fuente respondió, escribe `web/data/catalogo.json`. Si ninguna, conserva el catálogo anterior.
3. Guarda el detalle de cada fuente en `scripts/catalogo-report.json`.
4. Hace commit como `catalogo-bot` y, al terminar, se vuelve a publicar la web.

## App de iPhone

No se publica sola. Se compila en un Mac con Xcode desde `native/` (ver `native/README.md`). Para distribuirla hay que pasar por TestFlight o la App Store.

## Worker con Claude

Opcional y manual: `cd worker && npx wrangler deploy`. Ver `worker/README.md`.
