/**
 * Operaciones de bandeja contra la API de Zernio.
 *
 * Ojo con los endpoints: responder en un hilo abierto
 * (POST /conversations/{id}/messages) y abrir un hilo nuevo
 * (POST /conversations) son endpoints DISTINTOS.
 */

import type { Channel, OpenConversationRequest, PageOfConversations, PageOfMessages, RestConversation, RestMessage, SendMessageRequest, SendMessageResponse } from "./types";
import type { ZernioClient } from "./client";
import { err, ok, type Result } from "./client";

export interface ListConversationsOptions {
  channel?: Channel;
  accountId?: string;
  limit?: number;
}

/**
 * Paginación por generador: el llamador itera sin sostener el cursor.
 */
export async function* iterateConversations(
  client: ZernioClient,
  options: ListConversationsOptions = {},
): AsyncGenerator<RestConversation, void, void> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page: Result<PageOfConversations> = await client.get<PageOfConversations>("/v1/conversations", {
      cursor,
      limit: options.limit ?? 100,
      channel: options.channel,
      account_id: options.accountId,
    });
    if (!page.success) {
      // Un canal caído no voltea el barrido: se loguea y se corta la página.
      console.error("[zernio:inbox] error listando conversaciones:", page.error);
      return;
    }
    for (const conversation of page.data.data) {
      if (seen.has(conversation.id)) continue;
      seen.add(conversation.id);
      yield conversation;
    }
    cursor = page.data.next_cursor ?? undefined;
  } while (cursor);
}

export async function listMessages(
  client: ZernioClient,
  conversationId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<Result<PageOfMessages>> {
  return client.get<PageOfMessages>(`/v1/conversations/${conversationId}/messages`, {
    cursor: options.cursor,
    limit: options.limit ?? 100,
  });
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
    for (const message of page.data.data) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      yield message;
    }
    cursor = page.data.next_cursor ?? undefined;
  } while (cursor);
}

/** Responde en un hilo ABIERTO. */
export async function sendMessage(
  client: ZernioClient,
  conversationId: string,
  request: SendMessageRequest,
): Promise<Result<SendMessageResponse>> {
  return client.post<SendMessageResponse>(`/v1/conversations/${conversationId}/messages`, request);
}

/** Abre un hilo NUEVO (endpoint distinto al de responder). */
export async function openConversation(
  client: ZernioClient,
  request: OpenConversationRequest,
): Promise<Result<RestConversation>> {
  const result = await client.post<RestConversation>("/v1/conversations", request);
  if (!result.success) return result;
  if (!result.data?.id) return err("respuesta sin id de conversación");
  return ok(result.data);
}
