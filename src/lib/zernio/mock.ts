/**
 * Proveedor MOCK de Zernio — mismo contrato que el real, sin red.
 *
 * Para qué sirve: probar el flujo completo (webhook -> base -> bandeja ->
 * agente) sin credenciales ni salida a internet. Se activa con ZERNIO_MOCK=1.
 * En producción (Vercel) va el cliente real contra api.zernio.com.
 */

import { ok, type Result } from "./client";
import type {
  Channel,
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

/** Proyección a la forma REST (sin el array interno de mensajes). */
function toRestConversation(c: MockConversation): RestConversation {
  return {
    id: c.id,
    channel: c.channel,
    account_id: c.account_id,
    participant: c.participant,
    last_message_at: c.last_message_at,
    unread_count: c.unread_count,
  };
}

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function seedConversations(): MockConversation[] {
  const base: Array<{
    id: string;
    channel: Channel;
    account_id: string;
    participant: { id: string; name: string; handle: string; picture: null };
    messages: Array<{ inbound: boolean; text: string; minutesAgo: number }>;
  }> = [
    {
      id: "conv_wa_1001",
      channel: "whatsapp",
      account_id: "acc_wa_ventas",
      participant: { id: "wa_573001112233", name: "María Fernández", handle: "+57 300 111 2233", picture: null },
      messages: [
        { inbound: true, text: "Hola, vi el anuncio de las llantas. ¿Tienen 205/55 R16?", minutesAgo: 46 },
        { inbound: false, text: "¡Hola María! Sí, tenemos ese medida. ¿Para qué vehículo?", minutesAgo: 44 },
        { inbound: true, text: "Para un Mazda 3 2019. ¿Precio por las cuatro?", minutesAgo: 3 },
      ],
    },
    {
      id: "conv_wa_1002",
      channel: "whatsapp",
      account_id: "acc_wa_ventas",
      participant: { id: "wa_573015554444", name: "Carlos Ruiz", handle: "+57 301 555 4444", picture: null },
      messages: [
        { inbound: true, text: "Buenos días, quiero agendar una instalación", minutesAgo: 60 * 30 },
        { inbound: false, text: "Con gusto. ¿Le sirve el sábado a las 9am?", minutesAgo: 60 * 29 },
      ],
    },
    {
      id: "conv_ig_2001",
      channel: "instagram",
      account_id: "acc_ig_tienda",
      participant: { id: "ig_998877", name: "lau.ramirez", handle: "@lau.ramirez", picture: null },
      messages: [
        { inbound: true, text: "Hola! Me llegó el pedido pero falta un artículo 😕", minutesAgo: 12 },
        { inbound: false, text: "Hola Lau, qué pena. ¿Me pasás el número de pedido?", minutesAgo: 11 },
        { inbound: true, text: "Es el #4521", minutesAgo: 1 },
      ],
    },
    {
      id: "conv_ig_2002",
      channel: "instagram",
      account_id: "acc_ig_tienda",
      participant: { id: "ig_112233", name: "andres.io", handle: "@andres.io", picture: null },
      messages: [{ inbound: true, text: "Hacen envíos a Medellín?", minutesAgo: 90 }],
    },
    {
      id: "conv_fb_3001",
      channel: "facebook",
      account_id: "acc_fb_soporte",
      participant: { id: "fb_554433", name: "Diana Gómez", handle: "diana.gomez", picture: null },
      messages: [
        { inbound: true, text: "Necesito ayuda con una factura", minutesAgo: 7 },
        { inbound: false, text: "Hola Diana, te ayudo. ¿Cuál es el número de factura?", minutesAgo: 6 },
      ],
    },
    {
      id: "conv_fb_3002",
      channel: "facebook",
      account_id: "acc_fb_soporte",
      participant: { id: "fb_667788", name: "Pedro Ángel", handle: "pedro.angel", picture: null },
      messages: [{ inbound: true, text: "El enlace de pago no funciona", minutesAgo: 240 }],
    },
  ];

  return base.map((c) => {
    const messages: MockMessage[] = c.messages.map((m, i) => ({
      id: `${c.id}_m${i}`,
      direction: m.inbound ? "inbound" : "outbound",
      type: "text",
      text: m.text,
      status: m.inbound ? "delivered" : "read",
      sent_at: iso(m.minutesAgo),
    }));
    const lastInbound = [...c.messages].reverse().find((m) => m.inbound);
    return {
      id: c.id,
      channel: c.channel,
      account_id: c.account_id,
      participant: c.participant,
      last_message_at: iso(c.messages[c.messages.length - 1].minutesAgo),
      unread_count: lastInbound && lastInbound.minutesAgo < 60 ? 1 : 0,
      messages,
    };
  });
}

class MockZernioState {
  accounts: MockAccount[] = [
    { id: "acc_wa_ventas", channel: "whatsapp", name: "Ventas WhatsApp", status: "connected", connected_at: iso(60 * 24 * 30) },
    { id: "acc_ig_tienda", channel: "instagram", name: "Tienda Instagram", status: "connected", connected_at: iso(60 * 24 * 20) },
    { id: "acc_fb_soporte", channel: "facebook", name: "Soporte Messenger", status: "connected", connected_at: iso(60 * 24 * 10) },
  ];
  conversations: MockConversation[] = seedConversations();
  webhooks: RestWebhook[] = [];
  private counter = 1000;

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
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
  return Promise.resolve(ok(state().accounts.map(({ id, channel, name, status, connected_at }) => ({ id, channel, name, status, connected_at }))));
}

export async function* mockIterateConversations(options: { channel?: Channel; accountId?: string } = {}): AsyncGenerator<RestConversation, void, void> {
  for (const c of state().conversations) {
    if (options.channel && c.channel !== options.channel) continue;
    if (options.accountId && c.account_id !== options.accountId) continue;
    yield toRestConversation(c);
  }
}

export function mockListMessages(conversationId: string): Promise<Result<PageOfMessages>> {
  const conversation = state().conversations.find((c) => c.id === conversationId);
  if (!conversation) return Promise.resolve({ success: false, error: `conversación ${conversationId} no existe` });
  const data = [...conversation.messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  return Promise.resolve(ok({ data, next_cursor: null } satisfies PageOfMessages));
}

export function mockSendMessage(conversationId: string, request: SendMessageRequest): Promise<Result<SendMessageResponse>> {
  const conversation = state().conversations.find((c) => c.id === conversationId);
  if (!conversation) return Promise.resolve({ success: false, error: `conversación ${conversationId} no existe` });
  const message: MockMessage = {
    id: state().nextId("msg"),
    direction: "outbound",
    type: request.type === "template" ? "template" : "text",
    text: request.type === "template" ? `[plantilla: ${request.template_name}]` : (request.text ?? null),
    status: "sent",
    sent_at: new Date().toISOString(),
  };
  conversation.messages.push(message);
  conversation.last_message_at = message.sent_at;
  return Promise.resolve(ok({ id: message.id, status: "sent" }));
}

export function mockOpenConversation(request: OpenConversationRequest): Promise<Result<RestConversation>> {
  const conversation: MockConversation = {
    id: state().nextId("conv"),
    channel: request.channel,
    account_id: request.account_id,
    participant: { id: request.to, name: null, handle: request.to, picture: null },
    last_message_at: new Date().toISOString(),
    unread_count: 0,
    messages: [
      {
        id: state().nextId("msg"),
        direction: "outbound",
        type: request.type === "template" ? "template" : "text",
        text: request.text ?? null,
        status: "sent",
        sent_at: new Date().toISOString(),
      },
    ],
  };
  state().conversations.push(conversation);
  return Promise.resolve(ok(toRestConversation(conversation)));
}

export function mockListWebhooks(): Promise<Result<RestWebhook[]>> {
  return Promise.resolve(ok(state().webhooks));
}

export function mockRegisterWebhook(name: string, url: string, events: string[]): Promise<Result<RestWebhook>> {
  const existing = state().webhooks.find((w) => w.name === name);
  if (existing) {
    existing.url = url;
    existing.events = events;
    return Promise.resolve(ok(existing));
  }
  const created: RestWebhook = { id: state().nextId("wh"), name, url, events };
  state().webhooks.push(created);
  return Promise.resolve(ok(created));
}

/**
 * Construye un evento de webhook REALISTA (nombres del contrato webhook, no
 * del REST) para inyectarlo por el simulador local. Firman con el secreto
 * configurado, igual que el proveedor.
 */
export function mockBuildIncomingEvent(conversationId: string, text: string): WebhookEvent {
  const conversation = state().conversations.find((c) => c.id === conversationId);
  if (!conversation) throw new Error(`conversación ${conversationId} no existe`);
  return {
    id: state().nextId("evt"),
    type: "incoming_message",
    created_at: new Date().toISOString(),
    account_id: conversation.account_id,
    message: {
      id: state().nextId("msg"),
      incoming: true,
      from: {
        id: conversation.participant.id,
        phone: conversation.channel === "whatsapp" ? conversation.participant.handle : null,
        username: conversation.channel !== "whatsapp" ? conversation.participant.handle : null,
        name: conversation.participant.name,
        picture: null,
      },
      type: "text",
      text,
      timestamp: new Date().toISOString(),
    },
  };
}

export function mockBuildStatusEvent(messageId: string, status: "delivered" | "read" | "failed"): WebhookEvent {
  const conversation = state().conversations.find((c) => c.messages.some((m) => m.id === messageId));
  return {
    id: state().nextId("evt"),
    type: "message_status",
    created_at: new Date().toISOString(),
    account_id: conversation?.account_id ?? null,
    message: {
      id: messageId,
      incoming: false,
      from: { id: "system" },
      type: "text",
      timestamp: new Date().toISOString(),
    },
    status,
  };
}

export function mockBuildAccountEvent(type: "account_connected" | "account_disconnected", accountId: string): WebhookEvent {
  return {
    id: state().nextId("evt"),
    type,
    created_at: new Date().toISOString(),
    account_id: accountId,
  };
}
