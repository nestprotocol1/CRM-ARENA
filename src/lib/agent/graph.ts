/**
 * Grafo del agente por canal.
 *
 * Fase 3: esqueleto — doble interruptor y cascada de configuración.
 * Fase 5: bucle de LLM vía OpenRouter con herramientas.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, conversations } from "@/db/schema";
import type { Channel } from "@/lib/zernio/types";

export const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

export const DEFAULT_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_SYSTEM_PROMPT =
  "Sos un asistente de atención al cliente. Respondés en español, de forma clara y breve.";
export const DEFAULT_TOOLS = ["handoff_human", "add_note"];

export interface ResolvedAgentConfig {
  enabled: boolean;
  systemPrompt: string;
  enabledTools: string[];
  model: string;
}

/** Cascada: config del canal -> config global -> default del código. */
export function resolveAgentConfig(
  channel: string,
  rows: Array<{ channel: string; enabled: boolean; systemPrompt: string; enabledTools: string[]; model: string }>,
): ResolvedAgentConfig {
  const channelRow = rows.find((r) => r.channel === channel);
  const globalRow = rows.find((r) => r.channel === "global");
  const source = channelRow ?? globalRow;
  return {
    enabled: channelRow?.enabled ?? globalRow?.enabled ?? false,
    systemPrompt: source?.systemPrompt?.trim() ? source.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    enabledTools: source?.enabledTools?.length ? source.enabledTools : DEFAULT_TOOLS,
    model: source?.model ?? DEFAULT_MODEL,
  };
}

/**
 * DOBLE INTERRUPTOR: la conversación tiene ai_enabled y el canal tiene enabled.
 * Los dos tienen que estar en true para que el agente conteste.
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

  const configRows = await db.select().from(agentConfigs);
  const resolved = resolveAgentConfig(row[0].channel, configRows);
  return resolved.enabled; // interruptor del canal
}

export interface RunAgentOptions {
  trigger: "webhook" | "manual";
}

/**
 * Corre el agente sobre una conversación.
 * Stub en Fase 3: la implementación con LLM llega en la Fase 5.
 */
export async function runAgentForConversation(
  conversationId: string,
  options: RunAgentOptions = { trigger: "webhook" },
): Promise<void> {
  const db = await getDb();
  const row = await db
    .select({ channel: conversations.channel })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  console.log(
    `[agent] (stub Fase 3, trigger=${options.trigger}) se correría el agente para ${conversationId} (${row[0]?.channel ?? "?"})`,
  );
}
