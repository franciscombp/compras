/**
 * Lector de etiquetas de Quanto (Cloudflare Worker).
 *
 * La PWA manda la foto de la etiqueta (JPEG en base64) y este Worker se la
 * pasa a Claude con salida estructurada. Devuelve el mismo objeto que el
 * parser local (assets/ocr.js): { precio, contenido, unidad, unidades, nombre }
 * más una `confianza` para que la app decida si confía en la lectura.
 *
 * La API key vive aquí como secreto, nunca en la app ni en el repositorio.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MAX_IMAGEN_BYTES = 3 * 1024 * 1024; // ~3 MB en base64
const TIPOS_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp"]);

const Etiqueta = z.object({
  precio: z.number().nullable().describe("Precio actual de venta en dólares que paga el cliente por lo que cubre `unidades`. null si no se ve."),
  contenido: z.number().nullable().describe("Contenido neto de UN envase, ya convertido a g o ml (o número de piezas si `unidad` es 'unidad'). null si no se ve."),
  unidad: z.enum(["g", "ml", "unidad"]).nullable().describe("Base del contenido: g para peso, ml para volumen, unidad para productos que se cuentan."),
  unidades: z.number().int().describe("Cuántos envases cubre el precio. 1 salvo packs ('6 x 80 g' => 6) o promos ('2 x $5' => 2)."),
  nombre: z.string().describe("Nombre corto del producto con marca si se ve. Cadena vacía si no se lee."),
  confianza: z.enum(["alta", "media", "baja"]).describe("alta: precio y contenido se leen con claridad. baja: hubo que adivinar algo."),
});

const INSTRUCCIONES = `Eres el lector de etiquetas de Quanto, una app que compara precios de supermercado en Ecuador (precios en dólares).
Recibes la foto de una etiqueta de góndola o de un empaque. Extrae solo lo que se ve; cuando un dato no aparece devuelve null, no lo inventes.

Reglas:
- precio: el precio vigente que paga el cliente. Si hay "antes/ahora" o un precio tachado, usa el vigente. Si la promo es "2 x $5.00", precio = 5.00 y unidades = 2. Los centavos a veces van pequeños y elevados ("1 99" es 1.99).
- Ignora precios de referencia impresos "por kg", "por 100 g" o "c/u", salvo que sean lo único que hay: entonces deduce precio y contenido del envase a partir de ellos solo si es inequívoco.
- contenido: el contenido neto de un envase convertido a g o ml (kg -> g, l -> ml, cl -> ml, lb -> 453.6 g, oz -> 28.35 g). Prefiere el peso neto sobre el escurrido o drenado. Para packs ("6 x 80 g") contenido = 80 y unidades = 6.
- Productos que se venden por piezas sin peso (huevos, pañales, rollos): unidad = "unidad" y contenido = número de piezas.
- nombre: corto y legible, en español, con la marca si aparece. Sin precios ni promos dentro del nombre.`;

function cors(origen, extra = {}) {
  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    ...extra,
  };
}

function json(body, status, origen) {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(origen, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

function origenPermitido(request, env) {
  const origen = request.headers.get("Origin") || "";
  const lista = String(env.ORIGENES_PERMITIDOS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista.includes(origen) ? origen : null;
}

function tokenValido(request, env) {
  if (!env.LECTOR_TOKEN) return true;
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.LECTOR_TOKEN}`;
}

async function leerEtiqueta(env, imagen, tipo) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.parse({
    model: env.MODELO || "claude-opus-5-5",
    max_tokens: 4096,
    system: INSTRUCCIONES,
    output_config: {
      effort: "low",
      format: zodOutputFormat(Etiqueta),
    },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: tipo, data: imagen } },
        { type: "text", text: "Lee esta etiqueta." },
      ],
    }],
  });

  if (response.stop_reason === "refusal") throw Object.assign(new Error("rechazado"), { codigo: "rechazado" });
  if (response.stop_reason === "max_tokens") throw Object.assign(new Error("respuesta_cortada"), { codigo: "respuesta_cortada" });
  if (!response.parsed_output) throw Object.assign(new Error("sin_salida"), { codigo: "sin_salida" });

  const d = response.parsed_output;
  return {
    precio: d.precio !== null && d.precio > 0 && d.precio <= 5000 ? Math.round(d.precio * 100) / 100 : null,
    contenido: d.contenido !== null && d.contenido > 0 ? Math.round(d.contenido) : null,
    unidad: d.contenido !== null && d.contenido > 0 ? d.unidad : null,
    unidades: Math.min(48, Math.max(1, Math.round(d.unidades || 1))),
    nombre: (d.nombre || "").trim().slice(0, 80),
    confianza: d.confianza,
    modelo: response.model,
    uso: { entrada: response.usage.input_tokens, salida: response.usage.output_tokens },
  };
}

export default {
  async fetch(request, env) {
    const origen = origenPermitido(request, env);
    if (!origen) return new Response("origen no permitido", { status: 403 });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origen) });
    if (request.method !== "POST") return json({ error: "metodo" }, 405, origen);
    if (!tokenValido(request, env)) return json({ error: "clave" }, 401, origen);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "sin_api_key" }, 500, origen);

    let body;
    try { body = await request.json(); } catch { return json({ error: "json" }, 400, origen); }
    const imagen = typeof body?.imagen === "string" ? body.imagen : "";
    const tipo = TIPOS_IMAGEN.has(body?.tipo) ? body.tipo : "image/jpeg";
    if (!imagen) return json({ error: "sin_imagen" }, 400, origen);
    if (imagen.length > MAX_IMAGEN_BYTES * 1.37) return json({ error: "imagen_grande" }, 413, origen);

    try {
      const datos = await leerEtiqueta(env, imagen, tipo);
      return json(datos, 200, origen);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "limite" }, 429, origen);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "api_key" }, 500, origen);
      if (e instanceof Anthropic.APIConnectionError) return json({ error: "conexion" }, 502, origen);
      return json({ error: e.codigo || "lectura" }, 502, origen);
    }
  },
};
