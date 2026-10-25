/**
 * POST /api/messages/send — un único endpoint de salida para la UI.
 *
 * Body: { conversationId, text } (o { conversationId, type: "template", templateName })
 * Pasa SIEMPRE por deliverMessage: un solo camino de salida.
 *
 * La ventana de 24h la decide el servidor (deliverMessage): si está cerrada,
 * acá se devuelve 422 con el motivo para que la interfaz no mande algo que va
 * a rebotar.
 */

import { NextRequest, NextResponse } from "next/server";
import { deliverMessage } from "@/lib/messages/deliver";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    conversationId?: string;
    text?: string;
    type?: "text" | "template";
    templateName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const conversationId = body.conversationId?.trim();
  if (!conversationId) {
    return NextResponse.json({ error: "falta conversationId" }, { status: 400 });
  }

  const result = await deliverMessage(conversationId, {
    type: body.type ?? "text",
    text: body.text ?? null,
    templateName: body.templateName ?? null,
    author: "human",
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, windowMode: result.windowMode },
      { status: result.windowMode && result.windowMode !== "free" ? 422 : 400 },
    );
  }
  return NextResponse.json({ ok: true, messageId: result.messageId, status: result.status });
}
