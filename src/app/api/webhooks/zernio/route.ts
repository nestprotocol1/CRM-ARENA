/**
 * POST /api/webhooks/zernio — recepción de eventos del proveedor.
 *
 * Orden EXACTO (regla dura):
 *   1. body CRUDO + verificación de firma HMAC (header X-Zernio-Signature).
 *      Sin firma válida: 401.
 *   2. Reclamo del evento por id (ON CONFLICT DO NOTHING). Reintento: 200 y cortar.
 *   3. Ruteo por cuenta, resolución de contacto, persistencia.
 *   4. El trabajo del agente va DESPUÉS de responder, dentro de after(),
 *      con import DINÁMICO del grafo: si va arriba del archivo, el cold start
 *      se come los 5 segundos de presupuesto.
 *   5. 200.
 *
 * GET /api/webhooks/zernio — red de seguridad: eventos reclamados pero sin
 * procesar (por si el trabajo en segundo plano murió).
 */

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { processWebhookEvent, reprocessUnprocessedEvents } from "@/lib/webhooks/process-event";
import { verifyWebhookSignature } from "@/lib/zernio/webhooks";
import { parseWebhookEvent } from "@/lib/zernio/types";

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Body CRUDO: la firma se calcula sobre los bytes tal cual llegaron.
  const rawBody = await request.text();
  const signature = request.headers.get("x-zernio-signature");
  // Id estable del evento: header canónico, idéntico al del body.
  const headerEventId = request.headers.get("x-zernio-event-id");
  const headerEvent = request.headers.get("x-zernio-event");
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;

  const verification = verifyWebhookSignature(rawBody, signature, secret);
  if (!verification.valid) {
    console.warn(`[webhook] firma rechazada: ${verification.reason ?? "inválida"}`);
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  // Parseo y validación contra el contrato (trampa #1: nunca adivinar).
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "body no es JSON" }, { status: 400 });
  }
  const event = parseWebhookEvent(payload);
  if (!event) {
    // Payload que no matchea el contrato: log ALTO. La trampa #1 es que estos
    // se descartan en silencio.
    console.error("[webhook] payload no matchea el contrato de Zernio:", rawBody.slice(0, 500));
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }
  if (headerEventId && headerEventId !== event.id) {
    // No debería pasar (el proveedor manda el mismo id en ambos lados), pero
    // si pasa, el header es el canónico para deduplicar.
    console.warn(
      `[webhook] X-Zernio-Event-Id (${headerEventId}) != payload.id (${event.id}); se usa el del body`,
    );
  }
  if (headerEvent && headerEvent !== event.event) {
    console.warn(`[webhook] X-Zernio-Event (${headerEvent}) != payload.event (${event.event})`);
  }

  // 2-4. Reclamo + ruteo + persistencia. Todo inline: es un INSERT, entra en
  // el presupuesto de 5 segundos. El agente NO corre acá: corre en after().
  let outcome: Awaited<ReturnType<typeof processWebhookEvent>>;
  try {
    const db = await getDb();
    outcome = await processWebhookEvent(db, event, { fireAgent: false });
  } catch (error) {
    // Un error acá SÍ puede ser 500: el evento no quedó procesado y el
    // proveedor tiene que reintentar. (Los errores esperados ya están
    // capturados dentro de processWebhookEvent.)
    console.error("[webhook] error procesando evento:", error);
    return NextResponse.json({ error: "error interno" }, { status: 500 });
  }

  // 5. El agente va después de responder, con import dinámico.
  if (outcome.action === "processed" && outcome.conversationId) {
    const conversationId = outcome.conversationId;
    after(async () => {
      try {
        const { shouldAgentRespond, runAgentForConversation } = await import("@/lib/agent/graph");
        if (await shouldAgentRespond(conversationId)) {
          await runAgentForConversation(conversationId, { trigger: "webhook" });
        }
      } catch (error) {
        // El trabajo en segundo plano falló: la próxima pasada de la red de
        // seguridad (GET) lo levanta.
        console.error(`[webhook] trabajo en segundo plano falló para ${conversationId}:`, error);
      }
    });
  }

  return NextResponse.json({ ok: true, action: outcome.action }, { status: 200 });
}

/** Red de seguridad: eventos reclamados pero sin procesar. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = await getDb();
  const reprocess = request.nextUrl.searchParams.get("reprocess") === "1";
  const { listUnprocessedEvents } = await import("@/lib/webhooks/process-event");

  const events = await listUnprocessedEvents(db);
  if (!reprocess) {
    return NextResponse.json({ unprocessed: events.length, events });
  }

  const result = await reprocessUnprocessedEvents(db);
  return NextResponse.json({ unprocessed: events.length, reprocessed: result });
}
