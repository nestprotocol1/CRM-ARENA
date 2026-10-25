/**
 * Grafo del agente por canal.
 *
 * Reglas que implementa (guía, Fase 5):
 * - El historial se filtra por ESTA conversación, nunca por contacto: si no,
 *   el agente mezcla lo que la persona dijo por Instagram con lo que dijo por
 *   WhatsApp.
 * - Prompt, herramientas y modelo salen de agent_configs con cascada:
 *   config del canal -> config global -> default del código.
 * - DOBLE INTERRUPTOR: la conversación tiene ai_enabled y el canal tiene
 *   enabled. Los dos en true para que conteste.
 * - La salida va por deliverMessage. El agente no escribe en la base a mano
 *   (salvo notas internas, que nunca le llegan al cliente).
 * - Descarta mensajes viejos: si un trabajo quedó encolado y se procesa una
 *   hora más tarde, no le contestes al cliente como si acabara de escribir.
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, conversations, messages } from "@/db/schema";
import { deliverMessage } from "@/lib/messages/deliver";
import { createCompletion, type ChatMessage, type ToolCall } from "@/lib/openrouter/client";
import { executeTool, toolsForConfig } from "./tools";

export const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;

export const DEFAULT_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_SYSTEM_PROMPT =
  "Sos un asistente de atención al cliente. Respondés en español, de forma clara y breve.";
export const DEFAULT_TOOLS = ["handoff_human", "add_note"];

/** Un trabajo encolado más viejo que esto se descarta (el cliente ya se fue). */
export const STALE_AFTER_MINUTES = 5;

export interface AgentConfigRow {
  channel: string;
  enabled: boolean;
  systemPrompt: string;
  enabledTools: string[];
  model: string;
}

export interface ResolvedAgentConfig {
  enabled: boolean;
  systemPrompt: string;
  enabledTools: string[];
  model: string;
  source: "channel" | "global" | "default";
}

/** Cascada: config del canal -> config global -> default del código. */
export function resolveAgentConfig(
  channel: string,
  rows: AgentConfigRow[],
): ResolvedAgentConfig {
  const channelRow = rows.find((r) => r.channel === channel);
  const globalRow = rows.find((r) => r.channel === "global");
  const source = channelRow ?? globalRow;
  return {
    enabled: channelRow?.enabled ?? globalRow?.enabled ?? false,
    systemPrompt: source?.systemPrompt?.trim() ? source.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    enabledTools: source?.enabledTools?.length ? source.enabledTools : DEFAULT_TOOLS,
    model: source?.model ?? DEFAULT_MODEL,
    source: channelRow ? "channel" : globalRow ? "global" : "default",
  };
}

export async function loadAgentConfigRows(): Promise<AgentConfigRow[]> {
  const db = await getDb();
  const rows = await db.select().from(agentConfigs);
  return rows.map((r) => ({
    channel: r.channel,
    enabled: r.enabled,
    systemPrompt: r.systemPrompt,
    enabledTools: r.enabledTools,
    model: r.model,
  }));
}

/**
 * DOBLE INTERRUPTOR: ai_enabled de la conversación Y enabled del canal.
 */
export async function shouldAgentRespond(conversationId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .select({ aiEnabled: conversations.aiEnabled, channel: conversations.channel })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (row.length === 0) return false;
  if (!row[0].aiEnabled) return false; // un vendedor tomó el hilo a mano

  const config = resolveAgentConfig(row[0].channel, await loadAgentConfigRows());
  return config.enabled; // interruptor del canal
}

export interface RunAgentOptions {
  trigger: "webhook" | "manual";
}

export interface RunAgentResult {
  action: "answered" | "skipped" | "failed";
  detail: string;
}

/**
 * Corre el agente sobre una conversación. Se llama desde after() (webhook) o
 * a mano desde la API.
 */
export async function runAgentForConversation(
  conversationId: string,
  options: RunAgentOptions = { trigger: "webhook" },
): Promise<RunAgentResult> {
  const db = await getDb();

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) return { action: "skipped", detail: "conversación no encontrada" };

  // Interruptor 1: la conversación (un vendedor la tomó a mano).
  if (!conversation.aiEnabled) {
    return { action: "skipped", detail: "IA apagada en esta conversación" };
  }

  // Interruptor 2: el canal.
  const config = resolveAgentConfig(conversation.channel, await loadAgentConfigRows());
  if (!config.enabled) {
    return { action: "skipped", detail: `canal ${conversation.channel} apagado` };
  }

  // DESCARTAR MENSAJES VIEJOS: si el último entrante es viejo, no contestar
  // como si el cliente acabara de escribir.
  if (!conversation.lastInboundAt) {
    return { action: "skipped", detail: "sin mensajes entrantes" };
  }
  const minutesSinceInbound = (Date.now() - conversation.lastInboundAt.getTime()) / 60_000;
  if (minutesSinceInbound > STALE_AFTER_MINUTES) {
    return {
      action: "skipped",
      detail: `mensaje viejo (${Math.round(minutesSinceInbound)} min): no se contesta`,
    };
  }

  // Si lo último es saliente, ya está contestado.
  const [lastMessage] = await db
    .select({ direction: messages.direction })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  if (lastMessage?.direction === "outbound") {
    return { action: "skipped", detail: "ya contestado" };
  }

  // Historial de ESTA conversación (nunca por contacto).
  const history = await db
    .select({
      direction: messages.direction,
      body: messages.body,
      type: messages.type,
      rawPayload: messages.rawPayload,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.sentAt);

  const chatMessages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
  ];
  for (const message of history.slice(-20)) {
    // Las notas internas no entran al prompt del cliente.
    if (message.rawPayload?.internal) continue;
    if (message.direction === "inbound") {
      chatMessages.push({ role: "user", content: message.body ?? "" });
    } else {
      chatMessages.push({ role: "assistant", content: message.body ?? "" });
    }
  }

  const tools = toolsForConfig(config.enabledTools);

  // Primera pasada: con herramientas.
  const first = await createCompletion({
    model: config.model,
    messages: chatMessages,
    tools,
  });
  if (!first.success) {
    console.error(`[agent] LLM falló para ${conversationId}:`, first.error);
    return { action: "failed", detail: first.error };
  }

  let finalText = first.data.content;
  const toolCalls: ToolCall[] = first.data.toolCalls;

  if (toolCalls.length > 0) {
    // Ejecutar herramientas y pedir la respuesta final.
    const toolResults: ChatMessage[] = [];
    for (const call of toolCalls) {
      const result = await executeTool(conversationId, call.name, call.arguments);
      toolResults.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
    const second = await createCompletion({
      model: config.model,
      messages: [...chatMessages, ...toolResults],
      tools: [],
    });
    if (second.success) finalText = second.data.content;
  }

  if (!finalText?.trim()) {
    return { action: "skipped", detail: "el modelo no devolvió texto" };
  }

  // La salida al cliente pasa por deliverMessage: un solo camino de salida.
  const delivered = await deliverMessage(conversationId, { text: finalText, author: "agent" });
  if (!delivered.success) {
    console.error(`[agent] no se pudo entregar la respuesta para ${conversationId}:`, delivered.error);
    return { action: "failed", detail: delivered.error };
  }

  console.log(
    `[agent] respondió en ${conversationId} (${conversation.channel}, trigger=${options.trigger}, config=${config.source})`,
  );
  return { action: "answered", detail: finalText.slice(0, 100) };
}
