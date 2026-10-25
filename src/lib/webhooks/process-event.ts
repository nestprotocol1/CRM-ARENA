/**
 * Procesamiento de eventos del webhook de Zernio (contrato REAL).
 *
 * Orden obligatorio (regla dura de la guía):
 *   1. reclamar el evento por id (INSERT ... ON CONFLICT DO NOTHING RETURNING)
 *      — el id es `payload.id`, que coincide con el header X-Zernio-Event-Id
 *   2. si no insertó -> es reintento -> no procesar
 *   3. rutear por account.id contra channel_accounts
 *   4. resolver contacto por contact_identities, upsert de conversación, insert de mensaje
 *
 * La entrega es at-least-once: el reclamo por event_id es lo que hace que dos
 * reintentos simultáneos no contesten dos veces.
 *
 * Mapa de eventos reales -> acciones:
 *   message.received            -> mensaje entrante + dispara agente (en after())
 *   message.sent                -> eco de saliente (propio o del panel): persiste
 *   message.edited/deleted      -> actualiza/borra el cuerpo por external_id
 *   message.delivered/read/played/failed -> status del mensaje
 *   conversation.started        -> resuelve contacto (no crea hilo vacío)
 *   conversation.control_changed-> handover: enciende/apaga el agente del hilo
 *   account.connected/disconnected -> estado de channel_accounts
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { channelAccounts, contactIdentities, contacts, conversations, messages, webhookEvents } from "@/db/schema";
import { parseWebhookEvent } from "@/lib/zernio/types";
import type {
  Channel,
  WebhookEvent,
  WebhookEventParsed,
} from "@/lib/zernio/types";
import { deliveryEventToStatus, platformToChannel } from "@/lib/zernio/types";

export interface ProcessOutcome {
  action: "processed" | "duplicate" | "ignored" | "unrouted" | "invalid";
  conversationId?: string;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* 1. Reclamo idempotente del evento                                   */
/* ------------------------------------------------------------------ */

/**
 * Intenta insertar el evento. Devuelve true si SOMOS el procesador (insertó),
 * false si ya existía (reintento de otro request).
 */
export async function claimEvent(db: Database, event: WebhookEventParsed): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({
      eventId: event.id,
      eventType: event.event,
      accountId: accountExternalId(event),
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ eventId: webhookEvents.eventId });
  return inserted.length > 0;
}

/** id externo de la cuenta en CUALQUIER evento (bloque account). */
function accountExternalId(event: WebhookEvent): string | null {
  return event.account?.accountId ?? event.account?.id ?? null;
}

async function markEvent(
  db: Database,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  error?: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status,
      processedAt: new Date(),
      ...(error ? { error } : {}),
    })
    .where(eq(webhookEvents.eventId, eventId));
}

async function markFailed(db: Database, eventId: string, error: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: "failed",
      error,
      attempts: sql`${webhookEvents.attempts} + 1`,
    })
    .where(eq(webhookEvents.eventId, eventId));
}

/* ------------------------------------------------------------------ */
/* 2-4. Procesamiento                                                 */
/* ------------------------------------------------------------------ */

export async function processWebhookEvent(
  db: Database,
  event: WebhookEvent,
  options: { fireAgent?: boolean } = {},
): Promise<ProcessOutcome> {
  // El evento llega validado por zod desde la ruta.
  const parsed = event as WebhookEventParsed;

  // Reclamo idempotente: si no inserta, es reintento.
  const claimed = await claimEvent(db, parsed);
  if (!claimed) return { action: "duplicate", detail: "evento ya reclamado (reintento)" };

  return processClaimedEvent(db, parsed, options);
}

/**
 * Procesa un evento YA reclamado. Lo usa la ruta (recién clamado) y la red de
 * seguridad de reproceso (reclamado en su momento, procesamiento muerto).
 */
async function processClaimedEvent(
  db: Database,
  parsed: WebhookEventParsed,
  options: { fireAgent?: boolean } = {},
): Promise<ProcessOutcome> {
  try {
    const outcome = await routeAndPersist(db, parsed);
    await markEvent(
      db,
      parsed.id,
      outcome.action === "processed" ? "processed" : "ignored",
      outcome.detail,
    );

    // El agente se dispara SOLO si se pide explícitamente. En el camino del
    // webhook no: ahí corre dentro de after(), después de responder.
    if (outcome.action === "processed" && outcome.conversationId && options.fireAgent === true) {
      const { shouldAgentRespond } = await import("@/lib/agent/graph");
      if (await shouldAgentRespond(outcome.conversationId)) {
        const { runAgentForConversation } = await import("@/lib/agent/graph");
        await runAgentForConversation(outcome.conversationId, { trigger: "webhook" });
      }
    }
    return outcome;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await markFailed(db, parsed.id, detail);
    console.error(`[webhook] evento ${parsed.id} falló:`, detail);
    return { action: "ignored", detail: `error: ${detail}` };
  }
}

async function routeAndPersist(db: Database, event: WebhookEventParsed): Promise<ProcessOutcome> {
  switch (event.event) {
    case "message.received":
      return handleIncomingMessage(db, event);
    case "message.sent":
      return handleOutgoingMessage(db, event);
    case "message.edited":
      return handleEditedMessage(db, event);
    case "message.deleted":
      return handleDeletedMessage(db, event);
    case "message.delivered":
    case "message.read":
    case "message.played":
    case "message.failed":
      return handleDeliveryStatus(db, event);
    case "conversation.started":
      return handleConversationStarted(db, event);
    case "conversation.control_changed":
      return handleControlChanged(db, event);
    case "account.connected":
    case "account.disconnected":
      return handleAccountEvent(db, event);
    default:
      // Evento desconocido: loguear y marcar como procesado. Nunca 500: a los
      // diez fallos seguidos el proveedor apaga la suscripción.
      const unknown = event as { event: string; id: string };
      console.warn(`[webhook] evento desconocido: ${unknown.event} (${unknown.id})`);
      return { action: "ignored", detail: `tipo desconocido: ${unknown.event}` };
  }
}

/* ---------------- mensaje entrante ---------------- */

async function handleIncomingMessage(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "message.received" }>,
): Promise<ProcessOutcome> {
  const message = event.message;
  // Clave de la conversación: platformConversationId (el id que también
  // devuelve GET /v1/inbox/conversations; conversation.id es el interno).
  const conversationExternalId = event.conversation.platformConversationId;
  const accountId = event.account.accountId ?? event.account.id;
  if (!message || !accountId || !conversationExternalId) {
    return { action: "ignored", detail: "evento incompleto (message/account/conversation)" };
  }

  // 3. Ruteo por cuenta: sin match, ignorar (el evento queda marcado).
  const account = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.externalId, accountId))
    .limit(1);
  if (account.length === 0) {
    console.warn(`[webhook] evento ${event.id}: cuenta ${accountId} no está conectada`);
    return { action: "unrouted", detail: `cuenta ${accountId} desconocida` };
  }
  // El canal lo dice la CUENTA (platform), no el mensaje: es la fuente estable.
  const channel = platformToChannel(account[0].channel) ?? platformToChannel(event.account.platform);
  if (!channel) {
    return { action: "ignored", detail: `canal no soportado: ${event.account.platform}` };
  }

  // 4a. Contacto por identidad (la identidad NO es el teléfono).
  const contactId = await resolveContact(db, channel, event);

  // 4b. Conversación: única por (provider, external_id).
  const conversationId = await upsertConversation(db, {
    channel,
    provider: "zernio",
    externalId: conversationExternalId,
    accountId,
    participantId: event.conversation.participantId ?? message.sender.id,
    name: event.conversation.participantName ?? message.sender.name ?? null,
    handle: handleForChannel(channel, message.sender),
    picture: event.conversation.participantPicture ?? message.sender.picture ?? null,
    referral: event.metadata?.referral,
    contactId,
  });

  // 4c. Mensaje. El índice parcial único sobre external_id es la última red:
  // si el evento se coló dos veces, el insert no duplica.
  await db
    .insert(messages)
    .values({
      conversationId,
      channel,
      provider: "zernio",
      externalId: message.id,
      direction: "inbound",
      type: messageTypeFromEvent(message),
      body: message.text ?? null,
      status: "delivered",
      rawPayload: event as unknown as Record<string, unknown>,
      sentAt: new Date(message.sentAt),
    })
    .onConflictDoNothing();

  // 4d. Contadores de la conversación (columna, no COUNT por fila).
  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(message.sentAt),
      lastInboundAt: new Date(),
      unreadCount: sql`${conversations.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  return { action: "processed", conversationId };
}

/** Tipo de mensaje según los attachments que manda el proveedor. */
function messageTypeFromEvent(message: {
  text?: string | null;
  attachments: Array<{ type: string }>;
}): "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "reaction" | "other" {
  if (message.text) return "text";
  const type = message.attachments[0]?.type ?? "";
  switch (type) {
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "file":
      return "document";
    case "sticker":
      return "sticker";
    case "location":
      return "location";
    case "reaction":
      return "reaction";
    default:
      return "other";
  }
}

/** Handle mostrado por canal: en WhatsApp el teléfono; en el resto, el usuario. */
function handleForChannel(
  channel: Channel,
  sender: { username?: string; phoneNumber?: string | null; businessScopedUserId?: string },
): string | null {
  if (channel === "whatsapp") return sender.phoneNumber ?? sender.businessScopedUserId ?? null;
  return sender.username ?? null;
}

/* ---------------- mensaje saliente (eco) ---------------- */

async function handleOutgoingMessage(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "message.sent" }>,
): Promise<ProcessOutcome> {
  const accountId = event.account.accountId ?? event.account.id;
  const conversationExternalId = event.conversation.platformConversationId;

  const existing = await db
    .select({ id: conversations.id, channel: conversations.channel })
    .from(conversations)
    .where(and(eq(conversations.provider, "zernio"), eq(conversations.externalId, conversationExternalId)))
    .limit(1);

  if (existing.length > 0) {
    // Eco de un saliente nuestro (o enviado desde el panel): el ON CONFLICT
    // sobre external_id evita el duplicado con lo que persistió
    // deliverMessage.
    await insertOutbound(db, existing[0].id, existing[0].channel as Channel, event);
    return { action: "processed", conversationId: existing[0].id };
  }

  // Un saliente de un hilo que nunca entró por webhook (abierto desde el
  // panel del proveedor): se registra la conversación sin tocar unread.
  const channel = await resolveChannelForAccount(db, accountId);
  if (!channel) return { action: "ignored", detail: "cuenta o canal desconocido" };
  const conversationId = await upsertConversation(db, {
    channel,
    provider: "zernio",
    externalId: conversationExternalId,
    accountId,
    participantId: event.conversation.participantId ?? null,
    name: event.conversation.participantName ?? null,
    handle: event.conversation.participantUsername ?? null,
    picture: event.conversation.participantPicture ?? null,
    referral: event.metadata?.referral,
  });
  await insertOutbound(db, conversationId, channel, event);
  return { action: "processed", conversationId };
}

async function resolveChannelForAccount(db: Database, accountId: string): Promise<Channel | null> {
  const account = await db
    .select({ channel: channelAccounts.channel })
    .from(channelAccounts)
    .where(eq(channelAccounts.externalId, accountId))
    .limit(1);
  return platformToChannel(account[0]?.channel ?? "");
}

async function insertOutbound(
  db: Database,
  conversationId: string,
  channel: Channel,
  event: Extract<WebhookEventParsed, { event: "message.sent" }>,
): Promise<void> {
  await db
    .insert(messages)
    .values({
      conversationId,
      channel,
      provider: "zernio",
      // Mismo external_id que persistió deliverMessage: el ON CONFLICT evita
      // el duplicado del eco.
      externalId: event.message.id,
      direction: "outbound",
      type: messageTypeFromEvent(event.message),
      body: event.message.text ?? null,
      status: "sent",
      rawPayload: event as unknown as Record<string, unknown>,
      sentAt: new Date(event.message.sentAt),
    })
    .onConflictDoNothing();
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(event.message.sentAt), updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/* ---------------- mensaje editado / borrado ---------------- */

async function handleEditedMessage(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "message.edited" }>,
): Promise<ProcessOutcome> {
  const updated = await db
    .update(messages)
    .set({ body: event.message.text ?? null })
    .where(eq(messages.externalId, event.message.id))
    .returning({ id: messages.id });
  if (updated.length === 0) {
    console.warn(`[webhook] edición para mensaje desconocido ${event.message.id}`);
  }
  return { action: "processed", detail: `editado ${event.message.id}` };
}

async function handleDeletedMessage(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "message.deleted" }>,
): Promise<ProcessOutcome> {
  const updated = await db
    .update(messages)
    .set({ body: null })
    .where(eq(messages.externalId, event.message.id))
    .returning({ id: messages.id });
  if (updated.length === 0) {
    console.warn(`[webhook] borrado para mensaje desconocido ${event.message.id}`);
  }
  return { action: "processed", detail: `borrado ${event.message.id}` };
}

/* ---------------- eventos de estado ---------------- */

async function handleDeliveryStatus(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "message.delivered" | "message.read" | "message.played" | "message.failed" }>,
): Promise<ProcessOutcome> {
  const status = deliveryEventToStatus(event.event);
  const updated = await db
    .update(messages)
    .set({ status })
    .where(eq(messages.externalId, event.message.id))
    .returning({ id: messages.id });
  if (updated.length === 0) {
    // Puede llegar el estado antes que el mensaje (raro pero posible).
    console.warn(`[webhook] estado para mensaje desconocido ${event.message.id}`);
  }
  return { action: "processed", detail: `status ${status}` };
}

/* ---------------- ciclo de vida de la conversación ---------------- */

async function handleConversationStarted(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "conversation.started" }>,
): Promise<ProcessOutcome> {
  // No se crea el hilo acá: los hilos vacíos ensucian la bandeja. El hilo se
  // crea con el primer mensaje. Sí se resuelve el contacto si viene el id.
  const channel = platformToChannel(event.conversation.platform);
  if (channel && event.conversation.participantId) {
    const existing = await db
      .select()
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.channel, channel),
          eq(contactIdentities.externalId, event.conversation.participantId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      const [contact] = await db
        .insert(contacts)
        .values({
          name: event.conversation.participantName ?? null,
        })
        .returning();
      await db
        .insert(contactIdentities)
        .values({
          contactId: contact.id,
          channel,
          externalId: event.conversation.participantId,
          handle: event.conversation.participantUsername ?? null,
        })
        .onConflictDoNothing();
    }
  }
  return { action: "processed", detail: `conversación iniciada ${event.conversation.id}` };
}

async function handleControlChanged(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "conversation.control_changed" }>,
): Promise<ProcessOutcome> {
  // Handover de Meta Business Agent: si el hilo pasa a 'app' u 'other', un
  // humano lo tomó -> el agente se apaga en ESE hilo (no en todo el canal).
  const owner = event.control?.owner ?? "other";
  const aiEnabled = owner === "ai_agent";
  const updated = await db
    .update(conversations)
    .set({ aiEnabled, updatedAt: new Date() })
    .where(
      and(eq(conversations.provider, "zernio"), eq(conversations.externalId, event.conversation.id)),
    )
    .returning({ id: conversations.id });
  if (updated.length === 0) {
    // El hilo puede no existir todavía (control antes del primer mensaje).
    return { action: "ignored", detail: `hilo ${event.conversation.id} sin registro local` };
  }
  return { action: "processed", detail: `control -> ${owner} (agente ${aiEnabled ? "activo" : "pausado"})` };
}

/* ---------------- eventos de cuenta ---------------- */

async function handleAccountEvent(
  db: Database,
  event: Extract<WebhookEventParsed, { event: "account.connected" | "account.disconnected" }>,
): Promise<ProcessOutcome> {
  const accountId = event.account.accountId ?? event.account.id;
  const status = event.event === "account.connected" ? "connected" : "disconnected";

  const existing = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(eq(channelAccounts.externalId, accountId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(channelAccounts)
      .set({ status, updatedAt: new Date() })
      .where(eq(channelAccounts.id, existing[0].id));
  } else if (status === "connected") {
    // Cuenta nueva: se registra SOLO si el canal es uno de los atendidos.
    const channel = platformToChannel(event.account.platform);
    if (channel) {
      await db
        .insert(channelAccounts)
        .values({
          provider: "zernio",
          channel,
          externalId: accountId,
          name: event.account.displayName ?? event.account.username ?? null,
          status,
        })
        .onConflictDoNothing();
    }
  }
  return { action: "processed", detail: `cuenta ${accountId} ${status}` };
}

/* ---------------- contacto ---------------- */

async function resolveContact(
  db: Database,
  channel: Channel,
  event: Extract<WebhookEventParsed, { event: "message.received" }>,
): Promise<string> {
  const sender = event.message.sender;
  // Identidad estable: para WhatsApp, phoneNumber si existe (si no, BSUID);
  // para el resto, el id de plataforma.
  const externalId = sender.id;
  const handle = handleForChannel(channel, sender);

  const existing = await db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channel, channel), eq(contactIdentities.externalId, externalId)))
    .limit(1);
  if (existing.length > 0) return existing[0].contactId;

  const [contact] = await db
    .insert(contacts)
    .values({
      name: event.conversation.participantName ?? sender.name ?? handle ?? null,
      picture: event.conversation.participantPicture ?? sender.picture ?? null,
    })
    .returning();

  await db
    .insert(contactIdentities)
    .values({ contactId: contact.id, channel, externalId, handle })
    .onConflictDoNothing();

  return contact.id;
}

interface UpsertConversationInput {
  channel: Channel;
  provider: string;
  externalId: string;
  accountId: string;
  participantId: string | null;
  name: string | null;
  handle: string | null;
  picture: string | null;
  referral?: unknown;
  contactId?: string;
}

async function upsertConversation(db: Database, input: UpsertConversationInput): Promise<string> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.provider, input.provider), eq(conversations.externalId, input.externalId)),
    )
    .limit(1);

  if (existing.length > 0) {
    // La atribución del anuncio se guarda si viene: después no se recupera.
    const patch: Record<string, unknown> = {};
    if (input.referral) patch.referral = input.referral;
    if (input.contactId) patch.contact_id = input.contactId;
    const metadataPatch =
      Object.keys(patch).length > 0
        ? sql`coalesce(${conversations.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`
        : undefined;
    await db
      .update(conversations)
      .set({
        accountId: input.accountId,
        participantId: input.participantId,
        name: input.name,
        handle: input.handle,
        picture: input.picture,
        ...(metadataPatch ? { metadata: metadataPatch } : {}),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, existing[0].id));
    return existing[0].id;
  }

  try {
    const [created] = await db
      .insert(conversations)
      .values({
        channel: input.channel,
        provider: input.provider,
        externalId: input.externalId,
        accountId: input.accountId,
        participantId: input.participantId,
        name: input.name,
        handle: input.handle,
        picture: input.picture,
        metadata: {
          ...(input.referral ? { referral: input.referral } : {}),
          ...(input.contactId ? { contact_id: input.contactId } : {}),
        },
      })
      .returning({ id: conversations.id });
    return created.id;
  } catch {
    // Carrera con otro request simultáneo: el índice único nos protege.
    const retry = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.provider, input.provider),
          eq(conversations.externalId, input.externalId),
        ),
      )
      .limit(1);
    if (retry.length === 0) throw new Error("no se pudo crear la conversación");
    return retry[0].id;
  }
}

/* ------------------------------------------------------------------ */
/* Red de seguridad: eventos reclamados pero sin procesar              */
/* ------------------------------------------------------------------ */

export async function listUnprocessedEvents(
  db: Database,
  limit = 50,
): Promise<Array<{ eventId: string; eventType: string; status: string; receivedAt: Date; error: string | null }>> {
  const rows = await db
    .select({
      eventId: webhookEvents.eventId,
      eventType: webhookEvents.eventType,
      status: webhookEvents.status,
      receivedAt: webhookEvents.receivedAt,
      error: webhookEvents.error,
    })
    .from(webhookEvents)
    .where(inArray(webhookEvents.status, ["claimed", "failed"]))
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(limit);
  return rows;
}

/** Reprocesa eventos reclamados y no procesados (o fallidos). */
export async function reprocessUnprocessedEvents(db: Database, limit = 20): Promise<{
  processed: number;
  duplicates: number;
  errors: number;
}> {
  const pending = await listUnprocessedEvents(db, limit);
  let processed = 0;
  let duplicates = 0;
  let errors = 0;
  for (const row of pending) {
    const full = await db
      .select({ payload: webhookEvents.payload })
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, row.eventId))
      .limit(1);
    const payload = full[0]?.payload as unknown;
    if (!payload) continue;
    // Re-validar: el payload viene de la base, no del proveedor.
    const parsed = parseWebhookEvent(payload);
    if (!parsed) {
      errors += 1;
      continue;
    }
    // fireAgent=false: el reproceso NO dispara el agente en masa.
    const outcome = await processClaimedEvent(db, parsed, { fireAgent: false });
    if (outcome.action === "processed") processed += 1;
    else if (outcome.action === "duplicate") duplicates += 1;
    else errors += 1;
  }
  return { processed, duplicates, errors };
}
