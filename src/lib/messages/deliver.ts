/**
 * UN SOLO CAMINO DE SALIDA.
 *
 * deliverMessage envía por el proveedor Y persiste. Si cada lugar inserta por
 * su cuenta (la UI por un lado, el agente por otro), se desincronizan y
 * aparecen mensajes enviados que no figuran, o al revés.
 *
 * La ventana de 24h se decide ACÁ (servidor), no en la interfaz.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import type { Channel } from "@/lib/zernio/types";
import { sendProviderMessage } from "@/lib/zernio";
import { computeWindow, type WindowMode } from "@/lib/window";

/** Estados de un mensaje saliente (iguales al enum message_status). */
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface DeliverInput {
  type?: "text" | "template";
  text?: string | null;
  templateName?: string | null;
  /** Etiqueta de agente humano (Instagram/Messenger fuera de 24h). */
  humanAgentTag?: boolean;
  /** Quién envía: la UI (humano) o el agente. */
  author?: "agent" | "human";
}

export type DeliverResult =
  | { success: true; messageId: string; status: MessageStatus }
  | { success: false; error: string; windowMode?: WindowMode };

export async function deliverMessage(
  conversationId: string,
  input: DeliverInput,
): Promise<DeliverResult> {
  const db = await getDb();

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) return { success: false, error: "conversación no encontrada" };

  // --- La ventana la decide el servidor ---
  const window = computeWindow(conversation.lastInboundAt, conversation.channel as Channel);
  const type = input.type ?? "text";
  let humanAgentTag = input.humanAgentTag ?? false;

  if (!window.open) {
    if (window.mode === "template_only") {
      // WhatsApp fuera de 24h: SOLO plantilla aprobada. El texto rebota;
      // la plantilla pasa.
      if (type !== "template") {
        return {
          success: false,
          error: "Ventana de 24 h cerrada: en WhatsApp solo se admite plantilla aprobada.",
          windowMode: window.mode,
        };
      }
    } else {
      // blocked: ni texto ni plantilla (la etiqueta de agente humano venció).
      return {
        success: false,
        error: window.message,
        windowMode: window.mode,
      };
    }
  } else if (window.mode === "human_tag") {
    // Instagram/Messenger fuera de 24h: el texto libre va CON etiqueta de
    // agente humano. Lo fuerza el servidor; la UI no puede omitirlo.
    humanAgentTag = true;
  }

  if (type === "text" && !input.text?.trim()) {
    return { success: false, error: "el mensaje de texto está vacío" };
  }
  if (type === "template" && !input.templateName) {
    return { success: false, error: "falta el nombre de la plantilla" };
  }

  // --- Envío por el proveedor ---
  const sent = await sendProviderMessage(conversation.externalId, {
    type,
    text: input.text ?? null,
    template_name: input.templateName ?? null,
    human_agent_tag: humanAgentTag,
  });
  if (!sent.success) {
    // Persistir el fallo SÍ: el historial tiene que mostrar que no salió.
    await persistOutbound(db, {
      conversation,
      externalId: null,
      type,
      body: input.text ?? null,
      status: "failed",
      rawPayload: { error: sent.error, author: input.author ?? "human" },
    });
    return { success: false, error: `no se pudo enviar: ${sent.error}` };
  }

  // --- Persistencia ---
  await persistOutbound(db, {
    conversation,
    externalId: sent.data.id,
    type,
    body: input.text ?? (input.templateName ? `[plantilla: ${input.templateName}]` : null),
    status: sent.data.status,
    rawPayload: { author: input.author ?? "human", human_agent_tag: humanAgentTag },
  });

  return { success: true, messageId: sent.data.id, status: sent.data.status };
}

async function persistOutbound(
  db: Awaited<ReturnType<typeof getDb>>,
  args: {
    conversation: {
      id: string;
      channel: Channel;
      provider: string;
    };
    externalId: string | null;
    type: "text" | "template";
    body: string | null;
    status: MessageStatus;
    rawPayload: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(messages).values({
    conversationId: args.conversation.id,
    channel: args.conversation.channel,
    provider: args.conversation.provider,
    externalId: args.externalId,
    direction: "outbound",
    type: args.type,
    body: args.body,
    status: args.status,
    rawPayload: args.rawPayload,
    sentAt: new Date(),
  })
    // Idempotencia defensiva: si el proveedor repite un external_id (eco,
    // reintento), no se duplica la fila ni se rompe el envío.
    .onConflictDoNothing();
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(and(eq(conversations.id, args.conversation.id)));
}
