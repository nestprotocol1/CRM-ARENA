/**
 * Fachada del proveedor de mensajería.
 *
 * Toda la app habla con Zernio por acá. La implementación se elige por
 * entorno: mock local (ZERNIO_MOCK=1, sin red) o cliente real.
 */

import { buildOAuthUrl, listAccounts } from "./accounts";
import { clientFromEnv } from "./client";
import type { Result } from "./client";
import { iterateConversations, listMessages, openConversation, sendMessage } from "./inbox";
import * as mock from "./mock";
import type {
  Channel,
  OpenConversationRequest,
  PageOfConversations,
  PageOfMessages,
  RestAccount,
  RestConversation,
  RestWebhook,
  SendMessageRequest,
  SendMessageResponse,
} from "./types";

export interface ListConversationsOptions {
  channel?: Channel;
  accountId?: string;
}

export function usingMockProvider(): boolean {
  return process.env.ZERNIO_MOCK === "1";
}

export function providerName(): string {
  return usingMockProvider() ? "zernio (mock)" : "zernio";
}

/* ---------------- operaciones ---------------- */

export async function* iterateProviderConversations(
  options: ListConversationsOptions = {},
): AsyncGenerator<RestConversation, void, void> {
  if (usingMockProvider()) {
    yield* mock.mockIterateConversations(options);
    return;
  }
  yield* iterateConversations(clientFromEnv(), options);
}

export async function listProviderMessages(
  conversationId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<Result<PageOfMessages>> {
  if (usingMockProvider()) return mock.mockListMessages(conversationId);
  return listMessages(clientFromEnv(), conversationId, options);
}

export async function listProviderConversationsPage(
  options: ListConversationsOptions & { cursor?: string; limit?: number } = {},
): Promise<Result<PageOfConversations>> {
  if (usingMockProvider()) {
    const data: RestConversation[] = [];
    for await (const c of mock.mockIterateConversations(options)) data.push(c);
    return { success: true, data: { data, next_cursor: null } };
  }
  return clientFromEnv().get<PageOfConversations>("/v1/conversations", {
    cursor: options.cursor,
    limit: options.limit ?? 50,
    channel: options.channel,
    account_id: options.accountId,
  });
}

export async function sendProviderMessage(
  conversationId: string,
  request: SendMessageRequest,
): Promise<Result<SendMessageResponse>> {
  if (usingMockProvider()) return mock.mockSendMessage(conversationId, request);
  return sendMessage(clientFromEnv(), conversationId, request);
}

export async function openProviderConversation(
  request: OpenConversationRequest,
): Promise<Result<RestConversation>> {
  if (usingMockProvider()) return mock.mockOpenConversation(request);
  return openConversation(clientFromEnv(), request);
}

export async function listProviderAccounts(): Promise<Result<RestAccount[]>> {
  if (usingMockProvider()) return mock.mockListAccounts();
  return listAccounts(clientFromEnv());
}

export function buildProviderOAuthUrl(params: {
  channel: Channel;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  // buildOAuthUrl solo arma la URL: no hay red, así que el mock y el real
  // comparten implementación.
  return buildOAuthUrl(clientFromEnv(), params);
}

export async function listProviderWebhooks(): Promise<Result<RestWebhook[]>> {
  if (usingMockProvider()) return mock.mockListWebhooks();
  const r = await clientFromEnv().get<{ data: RestWebhook[] }>("/v1/webhooks");
  return r.success ? { success: true as const, data: r.data.data ?? [] } : r;
}

/** Registra el webhook buscando por nombre: si existe, actualiza. */
export async function registerProviderWebhook(
  name: string,
  url: string,
  events: string[],
): Promise<Result<RestWebhook>> {
  if (usingMockProvider()) return mock.mockRegisterWebhook(name, url, events);
  const client = clientFromEnv();
  const existing = await client.get<{ data: RestWebhook[] }>("/v1/webhooks");
  if (existing.success) {
    const found = existing.data.data?.find((w) => w.name === name);
    if (found) {
      return client.put<RestWebhook>(`/v1/webhooks/${found.id}`, { name, url, events });
    }
  }
  return client.post<RestWebhook>("/v1/webhooks", { name, url, events });
}

export { clientFromEnv };
