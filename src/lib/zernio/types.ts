/**
 * Tipos del cliente de Zernio — espejo de openapi/zernio.yaml.
 *
 * REGLA DURA: estos tipos se ajustan al contrato REAL, nunca al revés.
 * La fuente de verdad es el SDK oficial `@zernio/node` (v0.2.1321), generado
 * del OpenAPI interno de Zernio. Este archivo transcribe esas definiciones.
 *
 * La forma que llega por WEBHOOK y la que devuelve el REST casi nunca
 * coinciden en los nombres de los campos (trampa #1). Por eso hay dos
 * familias de tipos: Rest* y Webhook*. No unificarlas.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Canal / plataforma: dos ejes distintos                              */
/* ------------------------------------------------------------------ */

/** Canales que el CRM atiende. Los demás arrancan APAGADOS (regla dura). */
export const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Todas las plataformas que Zernio emite en eventos de inbox. */
export const ZERNIO_PLATFORMS = [
  "instagram",
  "facebook",
  "telegram",
  "whatsapp",
  "sms",
  "rcs",
  "twitter",
  "bluesky",
  "reddit",
  "slack",
  "tiktok",
  "imessage",
] as const;
export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * Mapea plataforma del proveedor -> canal del CRM.
 * Devuelve null para plataformas que este CRM no atiende: el evento se
 * ignora (los canales nuevos arrancan apagados, no se atienden a medias).
 */
export function platformToChannel(platform: string | undefined): Channel | null {
  if (!platform) return null;
  return isChannel(platform) ? platform : null;
}

/* ------------------------------------------------------------------ */
/* Tipos REST (respuestas de la API) — camelCase, como la API real      */
/* ------------------------------------------------------------------ */

/** GET /v1/accounts -> { accounts: [...] } */
export interface RestAccount {
  /** ObjectId de Mongo de Zernio (campo `_id` en la respuesta). */
  id: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive: boolean;
  needsReconnection?: boolean;
  profilePicture?: string | null;
}

/**
 * GET /v1/inbox/conversations -> { data: [...], pagination: {hasMore, nextCursor} }
 *
 * OJO: `id` de esta lista es el `platformConversationId` del webhook
 * (en Instagram/Messenger, el IGSID/PSID del participante). Es la clave con
 * la que se matchean filas de lista con eventos.
 */
export interface RestConversation {
  id: string;
  platform: string;
  accountId?: string;
  accountUsername?: string;
  participantId?: string;
  participantName?: string;
  participantPicture?: string | null;
  lastMessage?: string;
  updatedTime?: string;
  status?: "active" | "archived";
  unreadCount?: number | null;
  /** 'app' | 'ai_agent' | 'other' — quién tiene el control del hilo. */
  threadControl?: "app" | "ai_agent" | "other";
  businessScopedUserId?: string;
  whatsappUsername?: string;
}

export interface PageOfConversations {
  data?: RestConversation[];
  pagination?: { hasMore?: boolean; nextCursor?: string | null } | null;
}

/** GET /v1/inbox/conversations/{id}/messages -> { messages: [...], pagination } */
export interface RestMessage {
  id?: string;
  conversationId?: string;
  accountId?: string;
  platform?: string;
  message?: string | null;
  senderId?: string;
  senderName?: string | null;
  direction?: "incoming" | "outgoing";
  createdAt?: string;
  attachments?: Array<{ id?: string; type?: string; url?: string }>;
}

export interface PageOfMessages {
  messages?: RestMessage[];
  pagination?: { hasMore?: boolean; nextCursor?: string | null } | null;
}

/**
 * POST /v1/inbox/conversations/{conversationId}/messages
 * Responder en hilo abierto. `accountId` es OBLIGATORIO en el body.
 */
export interface SendMessageRequest {
  accountId: string;
  message?: string;
  attachmentUrl?: string;
  attachmentType?: "image" | "video" | "audio" | "file";
  attachmentName?: string;
  /** Plantilla de WhatsApp: obligatoria fuera de la ventana de 24h. */
  template?: {
    name: string;
    language?: string;
    components?: unknown[];
  };
}

/** POST /v1/inbox/conversations/{id}/messages -> { success, data: {messageId, conversationId} } */
export interface SendMessageResponse {
  success?: boolean;
  data?: { messageId?: string; conversationId?: string };
  warnings?: Array<{ code: string; param?: string; message?: string }>;
}

/**
 * POST /v1/inbox/conversations
 * Abre un hilo NUEVO (endpoint distinto al de responder). En WhatsApp fuera
 * de la ventana de 24h la plantilla es obligatoria.
 */
export interface OpenConversationRequest {
  accountId: string;
  participantId?: string;
  participantUsername?: string;
  message?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}

/** GET /v1/profiles -> { profiles: [...] } */
export interface RestProfile {
  id?: string;
  _id?: string;
  name?: string;
}

/**
 * GET /v1/webhooks/settings -> { webhooks: [...] }
 */
export interface RestWebhook {
  _id?: string;
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
  isActive?: boolean;
  lastFiredAt?: string;
  failureCount?: number;
}

/* ------------------------------------------------------------------ */
/* Tipos WEBHOOK (payload que empuja el proveedor)                     */
/* Nombres distintos a REST a propósito: message/conversation/account. */
/* ------------------------------------------------------------------ */

/**
 * Eventos de inbox que el CRM CONSUMA (los que parsea el schema de abajo).
 * Son los nombres REALES de Zernio y se mandan tal cual en `events` al crear
 * el webhook. OJO: suscribir un evento que no está acá haría que cada entrega
 * rebotara con 400 (el parser no lo reconoce).
 */
export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "message.edited",
  "message.deleted",
  "message.delivered",
  "message.read",
  "message.played",
  "message.failed",
  "conversation.started",
  "conversation.control_changed",
  "account.connected",
  "account.disconnected",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** Bloque `account` presente en todos los eventos de inbox. */
export const webhookAccountSchema = z.object({
  id: z.string(),
  /** Mismo valor que id; campo canónico para filtrar. */
  accountId: z.string().optional(),
  profileId: z.string().optional(),
  platform: z.string(),
  username: z.string(),
  displayName: z.string().optional(),
});
export type WebhookAccount = z.infer<typeof webhookAccountSchema>;

/**
 * Bloque `conversation` en eventos de mensaje.
 * `id` es el id INTERNO de Zernio; `platformConversationId` es el de la
 * plataforma (y el que devuelve GET /v1/inbox/conversations). El CRM clavea
 * sus conversaciones por `platformConversationId` para poder matchear
 * webhooks con filas de la API.
 */
export const webhookConversationSchema = z.object({
  id: z.string(),
  platformConversationId: z.string(),
  participantId: z.string().optional(),
  participantName: z.string().optional(),
  participantUsername: z.string().optional(),
  participantPicture: z.string().optional(),
  status: z.enum(["active", "archived"]),
  contactId: z.string().optional(),
});
export type WebhookConversation = z.infer<typeof webhookConversationSchema>;

/**
 * Bloque `conversation` en eventos de ciclo de vida (conversation.started,
 * conversation.control_changed): acá `id` SÍ es el id de plataforma.
 */
export const webhookConversationDetailSchema = z.object({
  id: z.string(),
  platform: z.string(),
  platformConversationId: z.string(),
  participantId: z.string().optional(),
  participantName: z.string(),
  participantUsername: z.string().optional(),
  status: z.enum(["active", "archived"]),
  contactId: z.string().optional(),
});
export type WebhookConversationDetail = z.infer<typeof webhookConversationDetailSchema>;

const webhookAttachmentSchema = z.object({
  type: z.string(),
  url: z.string(),
  originalType: z.string().optional(),
  mimeType: z.string().optional(),
});

const webhookSenderSchema = z.object({
  id: z.string(),
  contactId: z.string().optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  picture: z.string().optional(),
  /** WhatsApp: E.164 con +. Puede faltar (BSUID rollout). */
  phoneNumber: z.string().nullish(),
  /** WhatsApp: identificador canónico del usuario (ancla de identidad). */
  businessScopedUserId: z.string().optional(),
});

/** Bloque `message` en eventos message.* */
export const webhookMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  platform: z.string(),
  platformMessageId: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  text: z.string().nullish(),
  attachments: z.array(webhookAttachmentSchema).default([]),
  sender: webhookSenderSchema,
  sentAt: z.string(),
  isRead: z.boolean().optional(),
});
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;

const webhookReferralSchema = z
  .object({
    source: z.string().optional(),
    type: z.string().optional(),
    campaignId: z.string().optional(),
    adsetId: z.string().optional(),
    adId: z.string().optional(),
    headline: z.string().optional(),
    body: z.string().optional(),
    imageUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    ctwaClid: z.string().optional(),
  })
  .passthrough();

const webhookMetadataSchema = z
  .object({
    platformMessageId: z.string().optional(),
    text: z.string().optional(),
    referral: webhookReferralSchema.optional(),
  })
  .passthrough();

/* ---------------- sobres por tipo de evento ---------------- */

/**
 * Un esquema base por familia, extendido con un literal por evento: así el
 * sindicato queda discriminado por evento de literal SINGLE y el narrowing
 * (Extract<WebhookEvent, { event: "message.received" }>) funciona de verdad.
 * Con z.enum multi-literal, Extract da never y los handlers no tipan.
 */
const messageEventBase = z.object({
  id: z.string().min(1),
  /** Solo en envíos de prueba (POST /v1/webhooks/test). */
  test: z.boolean().optional(),
  message: webhookMessageSchema,
  conversation: webhookConversationSchema,
  account: webhookAccountSchema,
  metadata: webhookMetadataSchema.optional(),
  timestamp: z.string().optional(),
});

const deliveryStatusEventBase = z.object({
  id: z.string().min(1),
  test: z.boolean().optional(),
  message: webhookMessageSchema,
  statusAt: z.string(),
  error: z
    .object({
      code: z.number().optional(),
      title: z.string().optional(),
      message: z.string().optional(),
      details: z.string().optional(),
    })
    .nullish(),
  conversation: webhookConversationSchema,
  account: webhookAccountSchema,
  timestamp: z.string().optional(),
});

const conversationEventBase = z.object({
  id: z.string().min(1),
  test: z.boolean().optional(),
  conversation: webhookConversationDetailSchema,
  account: webhookAccountSchema,
  /**
   * Solo en conversation.control_changed: quién tiene ahora el hilo.
   * 'app' | 'other' = lo tomó un humano -> el agente se apaga en ese hilo.
   */
  control: z
    .object({
      owner: z.enum(["app", "ai_agent", "other"]),
      previousOwner: z.enum(["app", "ai_agent", "other"]).nullish(),
    })
    .optional(),
  timestamp: z.string().optional(),
});

const accountEventBase = z.object({
  id: z.string().min(1),
  test: z.boolean().optional(),
  account: webhookAccountSchema,
  timestamp: z.string().optional(),
});

export const webhookEventSchema = z.discriminatedUnion("event", [
  // message.received / message.sent / message.edited / message.deleted
  messageEventBase.extend({ event: z.literal("message.received") }),
  messageEventBase.extend({ event: z.literal("message.sent") }),
  messageEventBase.extend({ event: z.literal("message.edited") }),
  messageEventBase.extend({ event: z.literal("message.deleted") }),
  // message.delivered / message.read / message.played / message.failed
  deliveryStatusEventBase.extend({ event: z.literal("message.delivered") }),
  deliveryStatusEventBase.extend({ event: z.literal("message.read") }),
  deliveryStatusEventBase.extend({ event: z.literal("message.played") }),
  deliveryStatusEventBase.extend({ event: z.literal("message.failed") }),
  // conversation.started / conversation.control_changed
  conversationEventBase.extend({ event: z.literal("conversation.started") }),
  conversationEventBase.extend({ event: z.literal("conversation.control_changed") }),
  // account.connected / account.disconnected
  accountEventBase.extend({ event: z.literal("account.connected") }),
  accountEventBase.extend({ event: z.literal("account.disconnected") }),
]);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type WebhookEventParsed = WebhookEvent;

/** Tipos por evento concreto (narrowing real sobre el sindicato). */
export type MessageReceivedEvent = Extract<WebhookEvent, { event: "message.received" }>;
export type MessageSentEvent = Extract<WebhookEvent, { event: "message.sent" }>;
export type MessageEditedEvent = Extract<WebhookEvent, { event: "message.edited" }>;
export type MessageDeletedEvent = Extract<WebhookEvent, { event: "message.deleted" }>;
export type DeliveryStatusEvent = Extract<
  WebhookEvent,
  { event: "message.delivered" | "message.read" | "message.played" | "message.failed" }
>;
export type ConversationStartedEvent = Extract<WebhookEvent, { event: "conversation.started" }>;
export type ConversationControlChangedEvent = Extract<
  WebhookEvent,
  { event: "conversation.control_changed" }
>;
export type AccountConnectedEvent = Extract<WebhookEvent, { event: "account.connected" }>;
export type AccountDisconnectedEvent = Extract<WebhookEvent, { event: "account.disconnected" }>;

/**
 * Parsea el body del webhook contra el contrato. Un payload que no valida se
 * descarta CON LOG ALTO: la trampa #1 es que se descarte en silencio.
 */
export function parseWebhookEvent(payload: unknown): WebhookEvent | null {
  const result = webhookEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}

/** True si el evento es de tipo mensaje (received/sent/edited/deleted). */
export function isMessageEvent(
  event: WebhookEvent,
): event is MessageReceivedEvent | MessageSentEvent | MessageEditedEvent | MessageDeletedEvent {
  return (
    event.event === "message.received" ||
    event.event === "message.sent" ||
    event.event === "message.edited" ||
    event.event === "message.deleted"
  );
}

/** True si es evento de estado de entrega (delivered/read/played/failed). */
export function isDeliveryStatusEvent(event: WebhookEvent): event is DeliveryStatusEvent {
  return (
    event.event === "message.delivered" ||
    event.event === "message.read" ||
    event.event === "message.played" ||
    event.event === "message.failed"
  );
}

/** Mapea evento de estado -> status de la columna messages.status. */
export function deliveryEventToStatus(event: DeliveryStatusEvent["event"]): "delivered" | "read" | "failed" {
  switch (event) {
    case "message.delivered":
      return "delivered";
    case "message.read":
    case "message.played":
      return "read";
    case "message.failed":
      return "failed";
  }
}
