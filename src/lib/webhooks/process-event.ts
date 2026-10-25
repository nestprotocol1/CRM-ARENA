/**
 * Procesamiento de eventos del webhook de Zernio.
 *
 * Orden obligatorio (regla dura de la guía):
 *   1. reclamar el evento por id (INSERT ... ON CONFLICT DO NOTHING RETURNING)
 *   2. si no insertó -> es reintento -> no procesar
 *   3. rutear por account_id contra channel_accounts
 *   4. resolver contacto por contact_identities, upsert de conversación, insert de mensaje
 *
 * La entrega es at-least-once: el reclamo por event_id es lo que hace que dos
 * reintentos simultáneos no contesten dos veces.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  channelAccounts,
  contactIdentities,
  contacts,
  conversations,
  messages,
  webhookEvents,
} from "@/db/schema";
import { parseWebhookEvent } from "@/lib/zernio/types";
import type { Channel, WebhookEvent, WebhookEventParsed } from "@/lib/zernio/types";

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
export async function claimEvent(
  db: Database,
  event: WebhookEventParsed,
): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({
      eventId: event.id,
      eventType: event.type,
      accountId: event.account_id ?? null,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ eventId: webhookEvents.eventId });
  return inserted.length > 0;
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
  switch (event.type) {
    case "incoming_message":
      return handleIncomingMessage(db, event);
    case "message_status":
      return handleMessageStatus(db, event);
    case "account_connected":
    case "account_disconnected":
      return handleAccountEvent(db, event);
    default:
      // Evento desconocido: loguear y marcar como procesado. Nunca 500: a los
      // diez fallos seguidos el proveedor apaga la suscripción.
      console.warn(`[webhook] evento desconocido: ${event.type} (${event.id})`);
      return { action: "ignored", detail: `tipo desconocido: ${event.type}` };
  }
}

/* ---------------- mensaje entrante ---------------- */

async function handleIncomingMessage(
  db: Database,
  event: WebhookEventParsed,
): Promise<ProcessOutcome> {
  const message = event.message;
  const conversationExternalId = event.conversation_id;
  if (!message || !event.account_id || !conversationExternalId) {
    return { action: "ignored", detail: "evento incompleto (message/account_id/conversation_id)" };
  }

  // 3. Ruteo por cuenta: sin match, ignorar (el evento queda marcado).
  const account = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.externalId, event.account_id))
    .limit(1);
  if (account.length === 0) {
    console.warn(`[webhook] evento ${event.id}: cuenta ${event.account_id} no está conectada`);
    return { action: "unrouted", detail: `cuenta ${event.account_id} desconocida` };
  }
  const channel = account[0].channel as Channel;

  // 4a. Contacto por identidad (la identidad NO es el teléfono).
  const contactId = await resolveContact(db, channel, message);

  // 4b. Conversación: única por (provider, external_id).
  // El contacto resuelto se guarda en metadata: no es una cola de la
  // conversación (la unidad es el hilo), pero permite enlazar los hilos de
  // una misma persona entre canales.
  const conversationId = await upsertConversation(db, {
    channel,
    provider: "zernio",
    externalId: conversationExternalId,
    accountId: event.account_id,
    participantId: message.from.id,
    name: message.from.name ?? null,
    handle: channel === "whatsapp" ? (message.from.phone ?? null) : (message.from.username ?? null),
    picture: message.from.picture ?? null,
    referral: event.referral,
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
      type: message.type,
      body: message.text ?? null,
      status: "delivered",
      rawPayload: event as unknown as Record<string, unknown>,
      sentAt: new Date(message.timestamp),
    })
    .onConflictDoNothing();

  // 4d. Contadores de la conversación (columna, no COUNT por fila).
  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(message.timestamp),
      lastInboundAt: new Date(),
      unreadCount: sql`${conversations.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  return { action: "processed", conversationId };
}

async function resolveContact(
  db: Database,
  channel: Channel,
  message: WebhookEventParsed["message"],
): Promise<string> {
  if (!message) throw new Error("mensaje inexistente al resolver contacto");
  const externalId = message.from.id;
  const handle = channel === "whatsapp" ? (message.from.phone ?? null) : (message.from.username ?? null);

  const existing = await db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channel, channel), eq(contactIdentities.externalId, externalId)))
    .limit(1);
  if (existing.length > 0) return existing[0].contactId;

  const [contact] = await db
    .insert(contacts)
    .values({
      name: message.from.name ?? handle ?? null,
      picture: message.from.picture ?? null,
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
  participantId: string;
  name: string | null;
  handle: string | null;
  picture: string | null;
  referral?: WebhookEventParsed["referral"];
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

/* ---------------- eventos de estado ---------------- */

async function handleMessageStatus(
  db: Database,
  event: WebhookEventParsed,
): Promise<ProcessOutcome> {
  if (!event.message || !event.status) {
    return { action: "ignored", detail: "evento de estado incompleto" };
  }
  const updated = await db
    .update(messages)
    .set({ status: event.status })
    .where(eq(messages.externalId, event.message.id))
    .returning({ id: messages.id });
  if (updated.length === 0) {
    // Puede llegar el estado antes que el mensaje (raro pero posible).
    console.warn(`[webhook] estado para mensaje desconocido ${event.message.id}`);
  }
  return { action: "processed", detail: `status ${event.status}` };
}

/* ---------------- eventos de cuenta ---------------- */

async function handleAccountEvent(
  db: Database,
  event: WebhookEventParsed,
): Promise<ProcessOutcome> {
  const account = event.account;
  const accountId = account?.id ?? event.account_id;
  if (!accountId) return { action: "ignored", detail: "evento de cuenta sin id" };
  const status = event.type === "account_connected" ? "connected" : "disconnected";

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
  } else if (account) {
    await db
      .insert(channelAccounts)
      .values({
        provider: "zernio",
        channel: account.channel,
        externalId: account.id,
        name: account.name ?? null,
        status,
      })
      .onConflictDoNothing();
  }
  return { action: "processed", detail: `cuenta ${accountId} ${status}` };
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
    const payload = full[0]?.payload as unknown as WebhookEvent | undefined;
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
