/**
 * Cliente de OpenRouter (el LLM del agente).
 *
 * Mismo contrato Result que el resto: nunca tira. Sin API key (o con
 * OPENROUTER_MOCK=1) responde un mock determinista que deriva la respuesta
 * del prompt del canal — sirve para verificar que canales distintos con
 * prompts distintos contestan distinto, sin gastar créditos.
 */

import type { Result } from "@/lib/zernio/client";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResponse {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
}

export function usingMockLLM(): boolean {
  return process.env.OPENROUTER_MOCK === "1" || !process.env.OPENROUTER_API_KEY;
}

export async function createCompletion(
  request: CompletionRequest,
): Promise<Result<CompletionResponse>> {
  if (usingMockLLM()) {
    return { success: true, data: mockCompletion(request) };
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        ...(request.tools?.length ? { tools: request.tools } : {}),
        temperature: request.temperature ?? 0.4,
        max_tokens: request.maxTokens ?? 500,
      }),
      signal: controller.signal,
    });
    const json = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      }>;
      model?: string;
      error?: { message?: string };
    };
    if (!response.ok || json.error) {
      return { success: false, error: json.error?.message ?? `OpenRouter ${response.status}` };
    }
    const message = json.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeParseArgs(call.function.arguments),
    }));
    return {
      success: true,
      data: { content: message?.content ?? null, toolCalls, model: json.model ?? request.model },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Mock determinista: la respuesta deriva del prompt del sistema (o sea, del
 * canal). Dos canales con prompts distintos dan respuestas distintas — que es
 * exactamente lo que hay que verificar en la Fase 5.
 */
function mockCompletion(request: CompletionRequest): CompletionResponse {
  const system = request.messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const promptHead = system.split("\n")[0].slice(0, 80);
  return {
    content: `[mock-llm] (${promptHead}) Sobre tu mensaje "${lastUser.slice(0, 60)}": te respondo según la configuración de este canal.`,
    toolCalls: [],
    model: `mock:${request.model}`,
  };
}
