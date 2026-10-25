/**
 * Tipos del cliente de Zernio — espejo de openapi/zernio.yaml.
 *
 * REGLA DURA: estos tipos se ajustan al OpenAPI, nunca al revés. Si el
 * archivo openapi/ se reemplaza por la descarga real de docs.zernio.com,
 * este archivo se ajusta a él.
 *
 * La forma que llega por WEBHOOK y la que devuelve el REST casi nunca
 * coinciden en los nombres de los campos (trampa #1). Por eso hay dos
 * familias de tipos: RestX y WebhookX. No unificarlas.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Canal / proveedor: dos ejes distintos                               */
/* ------------------------------------------------------------------ */

export const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Tipos REST (respuestas de la API)                                   */
/* ------------------------------------------------------------------ */

export interface RestParticipant {
  id: string;
  name?: string | null;
  handle?: string | null;
  picture?: string | null;
}

export interface RestConversation {
  id: string;
  channel: Channel;
  account_id: string;
  participant: RestParticipant;
  last_message_at?: string | null;
  unread_count: number;
}

export interface RestMessage {
  id: string;
  direction: "inbound" | "outbound";
  type:
    | "text"
    | "template"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "sticker"
    | "location"
    | "reaction"
    | "other";
  text?: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  sent_at: string;
}

export interface PageOfConversations {
  data: RestConversation[];
  next_cursor: string | null;
}

export interface PageOfMessages {
  data: RestMessage[];
  next_cursor: string | null;
}

export interface RestAccount {
  id: string;
  channel: Channel;
  name?: string | null;
  status: "connected" | "disconnected";
  connected_at: string;
}

export interface SendMessageRequest {
  type: "text" | "template";
  text?: string | null;
  template_name?: string | null;
  human_agent_tag?: boolean;
}

export interface SendMessageResponse {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export interface OpenConversationRequest {
  account_id: string;
  channel: Channel;
  to: string;
  type: "text" | "template";
  text?: string | null;
  template_name?: string | null;
}

export interface RestWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
}

/* ------------------------------------------------------------------ */
/* Tipos WEBHOOK (payload que empuja el proveedor)                     */
/* Nombres distintos a REST a propósito: incoming/from/timestamp.      */
/* ------------------------------------------------------------------ */

export const WEBHOOK_EVENT_TYPES = [
  "incoming_message",
  "message_status",
  "account_connected",
  "account_disconnected",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookSender {
  id: string;
  phone?: string | null;
  username?: string | null;
  name?: string | null;
  picture?: string | null;
}

export interface WebhookIncomingMessage {
  id: string;
  incoming: boolean;
  from: WebhookSender;
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "reaction" | "other";
  text?: string | null;
  timestamp: string;
  reply_to?: string | null;
}

export interface WebhookReferral {
  source: "ad" | "post" | "direct" | "other";
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
}

export interface WebhookAccountInfo {
  id: string;
  channel: Channel;
  name?: string | null;
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  created_at: string;
  account_id?: string | null;
  /** external_id del hilo en el proveedor (la clave de conversations). */
  conversation_id?: string | null;
  message?: WebhookIncomingMessage;
  status?: "sent" | "delivered" | "read" | "failed" | null;
  referral?: WebhookReferral;
  /** Solo en account_connected: la cuenta que se conectó. */
  account?: WebhookAccountInfo;
}

/* ------------------------------------------------------------------ */
/* Validadores zod del webhook                                         */
/* Un payload que no valida se descarta CON LOG ALTO: la trampa #1 es   */
/* que se descarta en silencio.                                        */
/* ------------------------------------------------------------------ */

const webhookSenderSchema = z.object({
  id: z.string(),
  phone: z.string().nullish(),
  username: z.string().nullish(),
  name: z.string().nullish(),
  picture: z.string().nullish(),
});

const webhookMessageSchema = z.object({
  id: z.string(),
  incoming: z.boolean(),
  from: webhookSenderSchema,
  type: z.enum([
    "text",
    "image",
    "audio",
    "video",
    "document",
    "sticker",
    "location",
    "reaction",
    "other",
  ]),
  text: z.string().nullish(),
  timestamp: z.string(),
  reply_to: z.string().nullish(),
});

const webhookReferralSchema = z.object({
  source: z.enum(["ad", "post", "direct", "other"]),
  campaign_id: z.string().nullish(),
  adset_id: z.string().nullish(),
  ad_id: z.string().nullish(),
});

export const webhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["incoming_message", "message_status", "account_connected", "account_disconnected"]),
  created_at: z.string(),
  account_id: z.string().nullish(),
  conversation_id: z.string().nullish(),
  message: webhookMessageSchema.optional(),
  status: z.enum(["sent", "delivered", "read", "failed"]).nullish(),
  referral: webhookReferralSchema.optional(),
  account: z
    .object({
      id: z.string(),
      channel: z.enum(["whatsapp", "instagram", "facebook"]),
      name: z.string().nullish(),
    })
    .optional(),
});

export type WebhookEventParsed = z.infer<typeof webhookEventSchema>;

export function parseWebhookEvent(payload: unknown): WebhookEventParsed | null {
  const result = webhookEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}
