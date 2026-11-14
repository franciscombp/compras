# Quanto — Precio justo, sin trucos

Guía personal de ahorro para el súper. Compara el precio real por 100 g o 100 ml, lleva tus listas con presupuesto y recuerda cada precio que ves o pagas para decirte si hoy conviene comprar, dónde sale más barato y qué te toca reponer.

**En vivo:** https://franciscombp.github.io/compras/

## Qué hace

- **Comparar**: a mano o con la cámara. En el iPhone, el modo *Barrido* detecta todas las etiquetas del estante a la vez y marca la mejor compra.
- **Listas**: precio por 100 g y semáforo (buen precio, habitual, caro) en cada item, presupuesto con barra en vivo, envío a Recordatorios y a Notas.
- **Ahorro**: gasto del mes, cuánto ahorraste comparando, dónde compras más barato, qué subió de precio y consejos concretos.
- **Sin cuenta ni servidor**: todo se guarda en el dispositivo. Funciona sin conexión.
- **Apple Intelligence** (app de iPhone): lee etiquetas, entiende productos dictados y explica cada veredicto, sin que nada salga del teléfono.

## Estructura del repositorio

```
compras/
├── web/          App web (PWA). Es lo que se publica en GitHub Pages.
│   ├── index.html, manifest.json
│   ├── assets/   Interfaz (app.js), lector de etiquetas (ocr.js), barrido (vivo.js), estilos, service worker
│   ├── data/     Datos y lógica: store.js, ahorro.js, api.js, nativo.js, catalogo.json
│   └── lab/      Herramienta interna para probar el lector con fotos (etiquetas.html)
├── native/       App de iPhone: Capacitor + Swift (Vision, Apple Intelligence, cámara SwiftUI)
├── worker/       Opcional: Cloudflare Worker que lee etiquetas con Claude
├── tests/        Pruebas de la lógica en Node (parser, barrido, motor de ahorro)
├── scripts/      Catálogo semanal y servidor HTTPS de desarrollo
├── docs/         Arquitectura, desarrollo, despliegue y contrato de API
└── .github/      Publicación en Pages y bot del catálogo
```

## Empezar en local

Necesitas Git, Python 3 y Node 22 o superior.

```bash
git clone https://github.com/franciscombp/compras.git
cd compras
npm run serve     # http://localhost:8000
npm test          # pruebas de la lógica
```

No hay que instalar nada para la web: es HTML y JavaScript sin build.

- **Probar la cámara desde el teléfono**: hace falta HTTPS. Ver `docs/desarrollo.md`.
- **App de iPhone** (en un Mac con Xcode): `npm run ios`. Detalles en `native/README.md`.
- **Lector con Claude** (opcional): `worker/README.md`.

## Documentación

- `docs/desarrollo.md`: cómo trabajar en el proyecto, ramas, pruebas.
- `docs/despliegue.md`: cómo se publica la web y el catálogo semanal.
- `docs/arquitectura.md`: capas, flujos y datos.
- `docs/api-contract.md`: contrato del backend futuro.
- `CLAUDE.md`: guía técnica detallada para trabajar con Claude Code.
