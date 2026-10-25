/**
 * POST /api/dev/simulate — simulador local del proveedor.
 *
 * Construye un evento de webhook REALISTA (nombres del contrato webhook), lo
 * firma con el secreto configurado y lo entrega a NUESTRO webhook, igual que
 * hace Zernio. Sirve para probar el camino completo sin red ni credenciales.
 *
 * Solo disponible en desarrollo o con ZERNIO_MOCK=1.
 */

import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { usingMockProvider } from "@/lib/zernio";
import { mockBuildIncomingEvent } from "@/lib/zernio/mock";

interface SimulateBody {
  conversationId?: string;
  text?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production" && !usingMockProvider()) {
    return NextResponse.json({ error: "no disponible en producción" }, { status: 403 });
  }
  if (!usingMockProvider()) {
    return NextResponse.json(
      { error: "el simulador requiere ZERNIO_MOCK=1 (usa el CLI contra la API real si tenés credenciales)" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as SimulateBody;
  const conversationId = body.conversationId ?? "conv_wa_1001";
  const text = body.text ?? "Hola, esto es una prueba desde el simulador local";

  let event;
  try {
    event = mockBuildIncomingEvent(conversationId, text);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "no se pudo construir el evento" },
      { status: 400 },
    );
  }
  // Ids únicos por llamada: el mock arranca su contador en cada proceso y un
  // id repetido sería descartado por el reclamo de idempotencia.
  const suffix = Date.now();
  event.id = `evt_sim_${suffix}`;
  if (event.message) event.message.id = `msg_sim_${suffix}`;

  // Firmar como lo hace el proveedor: HMAC-SHA256 sobre el body crudo.
  const rawBody = JSON.stringify(event);
  const secret = process.env.ZERNIO_WEBHOOK_SECRET ?? "";
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Entregar a nuestro propio webhook por HTTP real (no llamar la función):
  // así se prueba también el parsing del body crudo y la firma.
  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") ?? "http";
  const response = await fetch(`${protocol}://${host}/api/webhooks/zernio`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": signature,
    },
    body: rawBody,
  });

  const result = await response.json().catch(() => ({}));
  return NextResponse.json(
    { delivered: response.status, eventId: event.id, result },
    { status: response.status },
  );
}
