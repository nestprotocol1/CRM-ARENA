/**
 * Proveedor MOCK de Zernio — mismo contrato que el real, sin red.
 *
 * Para qué sirve: probar el flujo completo (webhook -> base -> bandeja ->
 * agente) sin credenciales ni salida a internet. Se activa con ZERNIO_MOCK=1.
 * En producción (Vercel) va el cliente real contra https://zernio.com/api.
 *
 * Las formas son las REALES (camelCase, message/conversation/account): el
 * mock existe para no necesitar red, no para inventar un contrato.
 */

import { DEMO_ACCOUNTS, DEMO_CONVERSATIONS } from "../demo-data";
import { ok, type Result } from "./client";
import type {
  Channel,
  MessageReceivedEvent,
  OpenConversationRequest,
  PageOfMessages,
  RestAccount,
  RestConversation,
  RestMessage,
  RestWebhook,
  SendMessageRequest,
  SendMessageResponse,
  WebhookEvent,
} from "./types";

interface MockAccount extends RestAccount {
  id: string;
}

type MockMessage = RestMessage;

interface MockConversation extends RestConversation {
  messages: MockMessage[];
}

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/** Proyección a la forma REST (sin el array interno de mensajes). */
function toRestConversation(c: MockConversation): RestConversation {
  return {
    id: c.id,
    platform: c.platform,
    accountId: c.accountId,
    participantId: c.participantId,
    participantName: c.participantName,
    participantPicture: c.participantPicture,
    lastMessage: c.lastMessage,
    updatedTime: c.updatedTime,
    status: c.status,
    unreadCount: c.unreadCount,
    threadControl: c.threadControl,
  };
}

function seedConversations(): MockConversation[] {
  return DEMO_CONVERSATIONS.map((c) => {
    const messages: MockMessage[] = c.messages.map((m) => ({
      id: m.id,
      conversationId: c.id,
      platform: c.channel,
      message: m.text,
      senderId: m.inbound ? c.participantId : "me",
      senderName: m.inbound ? c.name : null,
      direction: m.inbound ? "incoming" : "outgoing",
      createdAt: iso(m.minutesAgo),
      attachments: [],
    }));
    const lastInbound = [...c.messages].reverse().find((m) => m.inbound);
    const lastMessage = c.messages[c.messages.length - 1];
    return {
      id: c.id,
      platform: c.channel,
      accountId: c.accountId,
      participantId: c.participantId,
      participantName: c.name,
      participantPicture: null,
      lastMessage: lastMessage.text,
      updatedTime: iso(lastMessage.minutesAgo),
      status: "active" as const,
      unreadCount: lastInbound && lastInbound.minutesAgo < 60 ? 1 : 0,
      threadControl: c.aiDisabled ? ("other" as const) : ("ai_agent" as const),
      messages,
    };
  });
}

/**
 * Prefijo único por instancia de proceso. La base persiste entre reinicios
 * pero el mock arranca su contador de cero: sin el prefijo, los ids se
 * repetirían y chocarían con el índice único de idempotencia.
 */
const INSTANCE = Math.random().toString(36).slice(2, 8);

class MockZernioState {
  accounts: MockAccount[] = DEMO_ACCOUNTS.map((a) => ({
    id: a.id,
    platform: a.channel,
    username: a.id,
    displayName: a.name,
    isActive: true,
  }));
  conversations: MockConversation[] = seedConversations();
  webhooks: RestWebhook[] = [];
  private counter = 1000;

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${INSTANCE}_${this.counter}`;
  }
}

const globalState = globalThis as unknown as { __zernioMock?: MockZernioState };
function state(): MockZernioState {
  if (!globalState.__zernioMock) globalState.__zernioMock = new MockZernioState();
  return globalState.__zernioMock;
}

/* ------------------------------------------------------------------ */
/* Operaciones (mismo contrato que el cliente real)                    */
/* ------------------------------------------------------------------ */

export function mockListAccounts(): Promise<Result<RestAccount[]>> {
  return Promise.resolve(ok(state().accounts));
}

export async function* mockIterateConversations(
  options: { channel?: Channel; accountId?: string } = {},
): AsyncGenerator<RestConversation, void, void> {
  for (const c of state().conversations) {
    if (options.channel && c.platform !== options.channel) continue;
    if (options.accountId && c.accountId !== options.accountId) continue;
    yield toRestConversation(c);
  }
}

export function mockListMessages(conversationId: string): Promise<Result<PageOfMessages>> {
  const conversation = state().conversations.find((c) => c.id === conversationId);
  if (!conversation) {
    return Promise.resolve({ success: false, error: `conversación ${conversationId} no existe` });
  }
  const data = [...conversation.messages].sort((a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
  return Promise.resolve(ok({ messages: data, pagination: { hasMore: false, nextCursor: null } }));
}

export function mockSendMessage(
  conversationId: string,
  request: SendMessageRequest,
): Promise<Result<SendMessageResponse>> {
  const conversation = state().conversations.find((c) => c.id === conversationId);
  if (!conversation) {
    return Promise.resolve({ success: false, error: `conversación ${conversationId} no existe` });
  }
  const message: MockMessage = {
    id: state().nextId("msg"),
    conversationId,
    platform: conversation.platform,
    message: request.template ? `[plantilla: ${request.template.name}]` : (request.message ?? null),
    senderId: "me",
    senderName: null,
    direction: "outgoing",
    createdAt: new Date().toISOString(),
    attachments: [],
  };
  conversation.messages.push(message);
  conversation.lastMessage = message.message ?? undefined;
  conversation.updatedTime = message.createdAt;
  return Promise.resolve(
    ok({ success: true, data: { messageId: message.id, conversationId } }),
  );
}

export function mockOpenConversation(
  request: OpenConversationRequest,
): Promise<Result<RestConversation>> {
  const conversation: MockConversation = {
    id: state().nextId("conv"),
    platform: "whatsapp",
    accountId: request.accountId,
    participantId: request.participantId ?? request.participantUsername ?? undefined,
    participantName: undefined,
    participantPicture: null,
    lastMessage: request.message ?? undefined,
    updatedTime: new Date().toISOString(),
    status: "active",
    unreadCount: 0,
    threadControl: "ai_agent",
    messages: [
      {
        id: state().nextId("msg"),
        conversationId: state().nextId("conv_x"),
        platform: "whatsapp",
        message: request.message ?? null,
        senderId: "me",
        senderName: null,
        direction: "outgoing",
        createdAt: new Date().toISOString(),
        attachments: [],
      },
    ],
  };
  state().conversations.push(conversation);
  return Promise.resolve(ok(toRestConversation(conversation)));
}

export function mockListWebhooks(): Promise<Result<RestWebhook[]>> {
  return Promise.resolve(ok(state().webhooks));
}

export function mockRegisterWebhook(
  name: string,
  url: string,
  events: string[],
  secret?: string,
): Promise<Result<RestWebhook>> {
  const existing = state().webhooks.find((w) => w.name === name);
  if (existing) {
    existing.url = url;
    existing.events = events;
    return Promise.resolve(ok(existing));
  }
  const created: RestWebhook = { _id: state().nextId("wh"), name, url, secret, events, isActive: true };
  state().webhooks.push(created);
  return Promise.resolve(ok(created));
}

/* ------------------------------------------------------------------ */
/* Constructor de eventos de webhook (formas REALES del proveedor)     */
/* ------------------------------------------------------------------ */

/**
 * Construye un evento `message.received` realista para inyectarlo por el
 * simulador local. Los nombres de campo son los del webhook real
 * (message/conversation/account), NO los del REST.
 */
export function mockBuildIncomingEvent(conversationId: string, text: string): MessageReceivedEvent {
  const conversation = state().conversations.find((c) => c.id === conversationId);
  if (!conversation) throw new Error(`conversación ${conversationId} no existe`);
  const isWhatsapp = conversation.platform === "whatsapp";
  const participantId = conversation.participantId ?? "unknown";
  const handle = participantId.replace(/[^0-9]/g, "");
  return {
    id: state().nextId("evt"),
    event: "message.received",
    timestamp: new Date().toISOString(),
    message: {
      id: state().nextId("msg"),
      conversationId,
      platform: conversation.platform,
      platformMessageId: state().nextId("pmsg"),
      direction: "incoming",
      text,
      attachments: [],
      sender: {
        id: participantId,
        name: conversation.participantName ?? undefined,
        username: isWhatsapp ? undefined : participantId,
        picture: undefined,
        phoneNumber: isWhatsapp && handle ? `+${handle}` : null,
        businessScopedUserId: isWhatsapp ? participantId : undefined,
      },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
    conversation: {
      id: conversationId,
      platformConversationId: conversationId,
      participantId,
      participantName: conversation.participantName ?? undefined,
      participantUsername: isWhatsapp ? undefined : participantId,
      participantPicture: undefined,
      status: "active",
    },
    account: {
      id: conversation.accountId ?? "acc_desconocida",
      platform: conversation.platform,
      username: conversation.accountId ?? "acc_desconocida",
    },
  };
}

/** Evento de estado de entrega (message.delivered / message.read / message.failed). */
export function mockBuildStatusEvent(
  messageId: string,
  event: "message.delivered" | "message.read" | "message.failed",
): WebhookEvent {
  const conversation = state().conversations.find((c) => c.messages.some((m) => m.id === messageId));
  return {
    id: state().nextId("evt"),
    event,
    statusAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    message: {
      id: messageId,
      conversationId: conversation?.id ?? "conv_desconocida",
      platform: conversation?.platform ?? "whatsapp",
      platformMessageId: messageId,
      direction: "outgoing",
      text: null,
      attachments: [],
      sender: { id: "me" },
      sentAt: new Date().toISOString(),
    },
    conversation: {
      id: conversation?.id ?? "conv_desconocida",
      platformConversationId: conversation?.id ?? "conv_desconocida",
      participantId: conversation?.participantId ?? undefined,
      status: "active",
    },
    account: {
      id: conversation?.accountId ?? "acc_desconocida",
      platform: conversation?.platform ?? "whatsapp",
      username: conversation?.accountId ?? "acc_desconocida",
    },
  };
}

/** Evento de cuenta (account.connected / account.disconnected). */
export function mockBuildAccountEvent(
  event: "account.connected" | "account.disconnected",
  accountId: string,
): WebhookEvent {
  const account = state().accounts.find((a) => a.id === accountId);
  return {
    id: state().nextId("evt"),
    event,
    timestamp: new Date().toISOString(),
    account: {
      id: accountId,
      platform: account?.platform ?? "whatsapp",
      username: account?.username ?? accountId,
      displayName: account?.displayName ?? undefined,
    },
  };
}
