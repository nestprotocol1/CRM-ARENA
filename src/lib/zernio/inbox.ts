/**
 * Operaciones de bandeja contra la API REAL de Zernio.
 *
 * Ojo con los endpoints (trampa de la guía): responder en un hilo abierto
 * (POST /v1/inbox/conversations/{id}/messages) y abrir un hilo nuevo
 * (POST /v1/inbox/conversations) son endpoints DISTINTOS.
 *
 * Los ids de conversación que aceptan estos endpoints son tanto el id interno
 * de Zernio como el platformConversationId: el CRM clavea por
 * platformConversationId, que es además el `id` que devuelve el listado.
 */

import type {
  Channel,
  OpenConversationRequest,
  PageOfConversations,
  PageOfMessages,
  RestConversation,
  RestMessage,
  SendMessageRequest,
  SendMessageResponse,
} from "./types";
import type { ZernioClient } from "./client";
import { err, ok, type Result } from "./client";

export interface ListConversationsOptions {
  channel?: Channel;
  accountId?: string;
  limit?: number;
}

/**
 * Paginación por generador: el llamador itera sin sostener el cursor.
 * La paginación real es `pagination.nextCursor`.
 */
export async function* iterateConversations(
  client: ZernioClient,
  options: ListConversationsOptions = {},
): AsyncGenerator<RestConversation, void, void> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page: Result<PageOfConversations> = await client.get<PageOfConversations>(
      "/v1/inbox/conversations",
      {
        cursor,
        limit: options.limit ?? 100,
        platform: options.channel,
        accountId: options.accountId,
      },
    );
    if (!page.success) {
      // Un canal caído no voltea el barrido: se loguea y se corta la página.
      console.error("[zernio:inbox] error listando conversaciones:", page.error);
      return;
    }
    for (const conversation of page.data.data ?? []) {
      if (!conversation.id || seen.has(conversation.id)) continue;
      seen.add(conversation.id);
      yield conversation;
    }
    cursor = page.data.pagination?.nextCursor ?? undefined;
  } while (cursor);
}

export async function listMessages(
  client: ZernioClient,
  conversationId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<Result<PageOfMessages>> {
  return client.get<PageOfMessages>(
    `/v1/inbox/conversations/${conversationId}/messages`,
    {
      cursor: options.cursor,
      limit: options.limit ?? 100,
    },
  );
}

/** Itera todos los mensajes de un hilo (para backfill). */
export async function* iterateMessages(
  client: ZernioClient,
  conversationId: string,
): AsyncGenerator<RestMessage, void, void> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await listMessages(client, conversationId, { cursor, limit: 100 });
    if (!page.success) {
      console.error("[zernio:inbox] error listando mensajes:", page.error);
      return;
    }
    for (const message of page.data.messages ?? []) {
      if (!message.id || seen.has(message.id)) continue;
      seen.add(message.id);
      yield message;
    }
    cursor = page.data.pagination?.nextCursor ?? undefined;
  } while (cursor);
}

/** Responde en un hilo ABIERTO. */
export async function sendMessage(
  client: ZernioClient,
  conversationId: string,
  request: SendMessageRequest,
): Promise<Result<SendMessageResponse>> {
  const result = await client.post<SendMessageResponse>(
    `/v1/inbox/conversations/${conversationId}/messages`,
    request,
  );
  if (!result.success) return result;
  // La respuesta real envuelve en data: {success, data: {messageId, ...}}.
  if (result.data?.success === false) {
    return err("la API rechazó el envío");
  }
  return ok(result.data);
}

/** Marca el hilo como leído. */
export async function markConversationRead(
  client: ZernioClient,
  conversationId: string,
): Promise<Result<unknown>> {
  return client.post(`/v1/inbox/conversations/${conversationId}/read`);
}

/**
 * Abre un hilo NUEVO (endpoint distinto al de responder).
 * En WhatsApp fuera de ventana de 24h la plantilla es obligatoria.
 */
export async function openConversation(
  client: ZernioClient,
  request: OpenConversationRequest,
): Promise<Result<RestConversation>> {
  const result = await client.post<RestConversation>("/v1/inbox/conversations", request);
  if (!result.success) return result;
  if (!result.data?.id) return err("respuesta sin id de conversación");
  return ok(result.data);
}
