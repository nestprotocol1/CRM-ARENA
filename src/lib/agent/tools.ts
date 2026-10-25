/**
 * Herramientas del agente. Las que estén en agent_configs.enabled_tools se
 * ofrecen al modelo; las demás no.
 *
 * OJO con la regla de un solo camino de salida: lo que le llega al CLIENTE
 * pasa por deliverMessage. Las herramientas de acá son bookkeeping interno
 * (notas, derivación a humano) y NUNCA le escriben al cliente.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "handoff_human",
      description:
        "Deriva la conversación a un vendedor humano: apaga el agente en esta conversación y deja una nota interna.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "por qué se deriva" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_note",
      description: "Deja una nota interna para el equipo. No la ve el cliente.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string", description: "texto de la nota" },
        },
        required: ["note"],
      },
    },
  },
];

export type ToolName = "handoff_human" | "add_note";

export function toolsForConfig(enabledTools: string[]) {
  return TOOL_DEFINITIONS.filter((tool) => enabledTools.includes(tool.function.name));
}

/** Nota interna: se guarda en el historial pero NO se envía al cliente. */
async function postInternalNote(conversationId: string, note: string): Promise<void> {
  const db = await getDb();
  const [conversation] = await db
    .select({ channel: conversations.channel, provider: conversations.provider })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) return;
  await db.insert(messages).values({
    conversationId,
    channel: conversation.channel,
    provider: conversation.provider,
    externalId: null,
    direction: "outbound",
    type: "other",
    body: note,
    status: "read",
    rawPayload: { internal: true, author: "agent" },
    sentAt: new Date(),
  });
}

export async function executeTool(
  conversationId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "handoff_human": {
      const reason = typeof args.reason === "string" ? args.reason : "sin motivo";
      const db = await getDb();
      await db
        .update(conversations)
        .set({ aiEnabled: false, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
      await postInternalNote(conversationId, `[agente] Derivado a humano: ${reason}`);
      return `Conversación derivada a un humano (${reason}). El agente ya no responde en este hilo.`;
    }
    case "add_note": {
      const note = typeof args.note === "string" ? args.note : JSON.stringify(args);
      await postInternalNote(conversationId, `[agente] ${note}`);
      return "Nota interna guardada.";
    }
    default:
      return `Herramienta desconocida: ${name}`;
  }
}
