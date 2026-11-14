# Lector de etiquetas (Cloudflare Worker)

La PWA le manda la foto de la etiqueta y este Worker la pasa a Claude, que
devuelve precio, contenido, unidad, envases y nombre en JSON. La API key se
queda aquí como secreto: nunca va en la app ni en el repositorio.

Si el Worker no está configurado o falla, la app sigue leyendo con Tesseract
en el teléfono como hasta ahora.

## Desplegar (una sola vez)

Necesitas una cuenta de Cloudflare (el plan gratis alcanza: 100.000 peticiones al
día) y una API key de Anthropic con saldo (https://platform.claude.com).

```bash
cd worker
npm install
npx wrangler login                              # abre el navegador
npx wrangler secret put ANTHROPIC_API_KEY       # pega la key cuando la pida
npx wrangler secret put LECTOR_TOKEN            # opcional: una clave inventada
npx wrangler deploy
```

`deploy` imprime la URL del Worker, algo como
`https://quanto-lector.<tu-cuenta>.workers.dev`.

## Conectar la app

En Quanto entra a **Comparar con cámara** y toca **Lector IA: configurar**.
Pega la URL del Worker y, si pusiste `LECTOR_TOKEN`, la misma clave. Se guarda
en el teléfono (localStorage); hay que hacerlo una vez por dispositivo.

## Costo

Cloudflare: gratis. Anthropic cobra por tokens; una foto de etiqueta son unos
1.500 tokens de entrada más una respuesta corta.

| `MODELO` en `wrangler.toml` | Costo aproximado por etiqueta |
|---|---|
| `claude-opus-5-5` (por defecto, lee mejor) | ~1 centavo |
| `claude-haiku-5-5` | ~0,03 centavos (1.000 etiquetas ≈ 30 centavos) |

Cambia `MODELO`, vuelve a hacer `npx wrangler deploy` y listo.

## Seguridad

- Solo acepta peticiones desde los orígenes de `ORIGENES_PERMITIDOS`.
- Si existe el secreto `LECTOR_TOKEN`, exige `Authorization: Bearer <token>`.
  Como la app es pública en GitHub Pages, esto evita que cualquiera use tu
  Worker (y tu saldo) sin la clave.
- Rechaza imágenes de más de ~3 MB.

## Probar en local

```bash
npx wrangler dev          # http://localhost:8787
```

Con `.dev.vars` puedes definir `ANTHROPIC_API_KEY=...` para el entorno local
(ese archivo está en `.gitignore`).
