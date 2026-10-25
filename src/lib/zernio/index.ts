/**
 * Fachada del proveedor de mensajería.
 *
 * Toda la app habla con Zernio por acá. La implementación se elige por
 * entorno: mock local (ZERNIO_MOCK=1, sin red) o cliente real contra
 * https://zernio.com/api.
 */

import { fetchOAuthUrl, listAccounts, listProfiles } from "./accounts";
import { clientFromEnv } from "./client";
import type { Result } from "./client";
import {
  iterateConversations,
  listMessages,
  markConversationRead,
  openConversation,
  sendMessage,
} from "./inbox";
import * as mock from "./mock";
import type {
  Channel,
  OpenConversationRequest,
  PageOfConversations,
  PageOfMessages,
  RestAccount,
  RestConversation,
  RestProfile,
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
    return { success: true, data: { data, pagination: { hasMore: false, nextCursor: null } } };
  }
  return clientFromEnv().get<PageOfConversations>("/v1/inbox/conversations", {
    cursor: options.cursor,
    limit: options.limit ?? 50,
    platform: options.channel,
    accountId: options.accountId,
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

export async function markProviderConversationRead(
  conversationId: string,
): Promise<Result<unknown>> {
  if (usingMockProvider()) return { success: true, data: null };
  return markConversationRead(clientFromEnv(), conversationId);
}

export async function listProviderAccounts(): Promise<Result<RestAccount[]>> {
  if (usingMockProvider()) return mock.mockListAccounts();
  return listAccounts(clientFromEnv());
}

export async function listProviderProfiles(): Promise<Result<RestProfile[]>> {
  if (usingMockProvider()) {
    return { success: true, data: [{ id: "profile_mock", name: "Perfil mock" }] };
  }
  return listProfiles(clientFromEnv());
}

/**
 * Pide al proveedor la URL de OAuth. En mock no hay red: se devuelve una URL
 * local que el callback mock reconoce.
 */
export async function fetchProviderOAuthUrl(params: {
  channel: Channel;
  profileId: string;
  redirectUrl: string;
}): Promise<Result<{ authUrl: string; state?: string }>> {
  if (usingMockProvider()) {
    const url = new URL("http://mock.zernio.local/oauth");
    url.searchParams.set("platform", params.channel);
    url.searchParams.set("redirect_url", params.redirectUrl);
    return { success: true, data: { authUrl: url.toString(), state: "mock-state" } };
  }
  return fetchOAuthUrl(clientFromEnv(), params);
}

export async function listProviderWebhooks(): Promise<Result<RestWebhook[]>> {
  if (usingMockProvider()) return mock.mockListWebhooks();
  const r = await clientFromEnv().get<{ webhooks?: RestWebhook[] }>("/v1/webhooks/settings");
  return r.success ? { success: true as const, data: r.data.webhooks ?? [] } : r;
}

/**
 * Registra el webhook. El endpoint real es POST /v1/webhooks/settings con
 * {name, url, secret, events}; si ya existe uno con ese nombre, se actualiza
 * (PUT) para no duplicar endpoints.
 */
export async function registerProviderWebhook(
  name: string,
  url: string,
  events: string[],
  secret?: string,
): Promise<Result<RestWebhook>> {
  if (usingMockProvider()) return mock.mockRegisterWebhook(name, url, events, secret);
  const client = clientFromEnv();
  const body = { name, url, ...(secret ? { secret } : {}), events };
  const existing = await client.get<{ webhooks?: RestWebhook[] }>("/v1/webhooks/settings");
  if (existing.success) {
    const found = existing.data.webhooks?.find((w) => w.name === name);
    if (found?._id) {
      return client.put<RestWebhook>("/v1/webhooks/settings", { ...body, webhookId: found._id });
    }
  }
  return client.post<RestWebhook>("/v1/webhooks/settings", body);
}

export { clientFromEnv };
