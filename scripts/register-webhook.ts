/**
 * Registra el webhook de Zernio POR API, no a mano en el panel.
 *
 * Busca por nombre y actualiza si ya existe: los proveedores no suelen
 * validar URLs duplicadas y terminarías recibiendo cada evento dos o tres
 * veces.
 *
 * Uso: npm run webhook:register -- https://tu-app.vercel.app
 *      (sin argumento, usa el host de NEXT_PUBLIC_APP_URL o localhost:3000)
 */
import "./load-env";
import { registerProviderWebhook, usingMockProvider } from "../src/lib/zernio";

const WEBHOOK_NAME = "crm-arena-zernio";
const EVENTS = [
  "incoming_message",
  "message_status",
  "account_connected",
  "account_disconnected",
];

async function main() {
  const baseUrl = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/webhooks/zernio`;

  if (!usingMockProvider() && !process.env.ZERNIO_API_KEY) {
    console.error("Falta ZERNIO_API_KEY (o usá ZERNIO_MOCK=1 para el mock local).");
    process.exit(1);
  }

  console.log(`Registrando webhook "${WEBHOOK_NAME}" -> ${url}`);
  const result = await registerProviderWebhook(WEBHOOK_NAME, url, EVENTS);
  if (!result.success) {
    console.error("Error registrando el webhook:", result.error);
    process.exit(1);
  }
  console.log(`Webhook listo: ${result.data.id} (${result.data.url})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
