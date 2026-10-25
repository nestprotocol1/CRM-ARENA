/**
 * Registra el webhook de Zernio POR API, no a mano en el panel.
 *
 * Endpoint REAL: POST /v1/webhooks/settings con {name, url, secret, events}.
 * El secreto lo elige el CLIENTE y se manda en el body: es el mismo valor que
 * va en ZERNIO_WEBHOOK_SECRET del entorno. Busca por nombre y actualiza (PUT)
 * si ya existe: si quedaran dos endpoints con la misma URL, cada evento
 * llegaría duplicado.
 *
 * Uso: npm run webhook:register -- https://tu-app.vercel.app
 *      (sin argumento, usa el host de NEXT_PUBLIC_APP_URL o localhost:3000)
 */
import "./load-env";
import { registerProviderWebhook, usingMockProvider } from "../src/lib/zernio";
import { WEBHOOK_EVENTS } from "../src/lib/zernio/types";

const WEBHOOK_NAME = "crm-arena-zernio";

/** Eventos REALES de Zernio que consume el CRM ( fuente única: types.ts). */
const EVENTS: string[] = [...WEBHOOK_EVENTS];

async function main() {
  const baseUrl = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/webhooks/zernio`;

  if (!usingMockProvider() && !process.env.ZERNIO_API_KEY) {
    console.error("Falta ZERNIO_API_KEY (o usá ZERNIO_MOCK=1 para el mock local).");
    process.exit(1);
  }

  // El secreto lo manda el cliente: tiene que coincidir con el del entorno.
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!usingMockProvider() && !secret) {
    console.error("Falta ZERNIO_WEBHOOK_SECRET: es el secreto que se envía al crear el webhook.");
    process.exit(1);
  }

  console.log(`Registrando webhook "${WEBHOOK_NAME}" -> ${url}`);
  console.log(`Eventos: ${EVENTS.join(", ")}`);
  const result = await registerProviderWebhook(WEBHOOK_NAME, url, EVENTS, secret);
  if (!result.success) {
    console.error("Error registrando el webhook:", result.error);
    process.exit(1);
  }
  const id = result.data._id ?? result.data.name ?? WEBHOOK_NAME;
  console.log(`Webhook listo: ${id} (${result.data.url ?? url})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
