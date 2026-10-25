/**
 * Prueba de idempotencia del webhook (Fase 3).
 *
 * Envía EL MISMO evento dos veces al webhook y verifica que no se duplique
 * nada: la segunda entrega tiene que cortar en el reclamo (action=duplicate)
 * y los conteos de la base tienen que quedar iguales.
 *
 * Los conteos se leen por /api/dev/db-stats: PGlite no comparte estado entre
 * procesos, así que la base "de verdad" es la del servidor.
 *
 * Requiere el servidor corriendo: npm run dev (en otra terminal).
 * Uso: npm run test:webhook
 */
import { createHmac } from "node:crypto";
import "./load-env";
import { mockBuildIncomingEvent } from "../src/lib/zernio/mock";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const CONVERSATION_ID = process.argv.includes("--conversation")
  ? process.argv[process.argv.indexOf("--conversation") + 1]
  : "conv_wa_1001";

async function dbStats(): Promise<Record<string, number>> {
  const response = await fetch(`${BASE_URL}/api/dev/db-stats`);
  if (!response.ok) throw new Error(`db-stats respondió ${response.status}`);
  return response.json();
}

async function deliver(event: unknown): Promise<{ status: number; body: { ok?: boolean; action?: string } }> {
  const rawBody = JSON.stringify(event);
  const secret = process.env.ZERNIO_WEBHOOK_SECRET ?? "";
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const response = await fetch(`${BASE_URL}/api/webhooks/zernio`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-zernio-signature": signature },
    body: rawBody,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function main() {
  console.log(`Probando idempotencia contra ${BASE_URL} (conversación ${CONVERSATION_ID})`);

  const before = await dbStats();
  console.log("Antes:    ", before);

  // Un solo evento, entregado dos veces. Los ids se hacen únicos por corrida:
  // el mock arranca su contador en cada proceso.
  const run = Date.now();
  const event = {
    ...mockBuildIncomingEvent(CONVERSATION_ID, "Mensaje de prueba de idempotencia"),
    id: `evt_test_${run}`,
  };
  if (event.message) event.message.id = `msg_test_${run}`;
  const first = await deliver(event);
  console.log("1ra entrega:", first.status, first.body);

  const afterFirst = await dbStats();
  console.log("Después 1ra:", afterFirst);

  const second = await deliver(event);
  console.log("2da entrega:", second.status, second.body);

  const afterSecond = await dbStats();
  console.log("Después 2da:", afterSecond);

  const checks = {
    "1ra entrega 200 y procesada": first.status === 200 && first.body.action === "processed",
    "2da entrega 200 y duplicada": second.status === 200 && second.body.action === "duplicate",
    // El mensaje entra y, si el agente del canal está prendido, también
    // contesta: por eso es >= 1 y no exactamente 1.
    "mensajes nuevos tras la 1ra entrega": afterFirst.messages >= before.messages + 1,
    // La conversación del evento ya existe (está sembrada): no debe crearse otra.
    "conversaciones sin cambios": afterFirst.conversations === before.conversations,
    "1 evento reclamado": afterFirst.webhook_events === before.webhook_events + 1,
    "sin duplicados tras reintento":
      afterSecond.messages === afterFirst.messages &&
      afterSecond.conversations === afterFirst.conversations &&
      afterSecond.webhook_events === afterFirst.webhook_events,
  };

  console.log("");
  let allOk = true;
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`${ok ? "OK  " : "FALLA"} ${name}`);
    if (!ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
