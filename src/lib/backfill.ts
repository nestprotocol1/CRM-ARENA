/**
 * Barrido de recuperación / importación de historial.
 *
 * REGLA DURA (la más importante de la Fase 6): en la importación el agente
 * NO se dispara. Contestarle a cientos de clientes viejos de golpe es un
 * desastre difícil de explicar.
 *
 * El historial que el proveedor ya replicó NO llega por webhook: se importa
 * por la API REST (mismos dos endpoints que la bandeja).
 *
 * Formas REALES: la lista de conversaciones trae participantName /
 * participantId / lastMessage / updatedTime; los mensajes traen message /
 * direction ('incoming'|'outgoing') / createdAt.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { channelAccounts, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import { listProviderAccounts, iterateProviderConversations, listProviderMessages } from "@/lib/zernio";
import type { RestConversation, RestMessage } from "@/lib/zernio/types";
import { platformToChannel } from "@/lib/zernio/types";

export interface BackfillResult {
  accounts: number;
  conversations: number;
  messages: number;
  skippedAccounts: string[];
  errors: string[];
}

/**
 * Importa conversaciones y mensajes de todas las cuentas conectadas.
 * Idempotente: los mensajes se insertan con ON CONFLICT DO NOTHING sobre
 * external_id, y las conversaciones se resuelven por (provider, external_id).
 */
export async function runBackfill(options: { maxConversations?: number } = {}): Promise<BackfillResult> {
  const db = await getDb();
  const result: BackfillResult = {
    accounts: 0,
    conversations: 0,
    messages: 0,
    skippedAccounts: [],
    errors: [],
  };

  const accounts = await listProviderAccounts();
  if (!accounts.success) {
    result.errors.push(accounts.error);
    return result;
  }

  for (const account of accounts.data) {
    // Solo cuentas conectadas Y conocidas por nuestra base (se sincronizaron
    // por OAuth o por eventos account_connected).
    const known = await db
      .select({ id: channelAccounts.id, status: channelAccounts.status })
      .from(channelAccounts)
      .where(eq(channelAccounts.externalId, account.id))
      .limit(1);
    if (known.length === 0 || known[0].status !== "connected") {
      result.skippedAccounts.push(account.id);
      continue;
    }
    result.accounts += 1;

    let count = 0;
    for await (const conversation of iterateProviderConversations({ accountId: account.id })) {
      if (options.maxConversations && count >= options.maxConversations) break;
      count += 1;
      try {
        result.conversations += await importConversation(db, conversation);
        result.messages += await importMessages(db, conversation.id ?? "");
      } catch (error) {
        result.errors.push(
          `${conversation.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return result;
}

async function importConversation(
  db: Awaited<ReturnType<typeof getDb>>,
  providerConversation: RestConversation,
): Promise<number> {
  const channel = platformToChannel(providerConversation.platform);
  const externalId = providerConversation.id;
  const participantId = providerConversation.participantId ?? null;
  if (!channel || !externalId) return 0;

  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.provider, "zernio"), eq(conversations.externalId, externalId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(conversations)
      .set({
        accountId: providerConversation.accountId ?? undefined,
        participantId,
        name: providerConversation.participantName ?? null,
        picture: providerConversation.participantPicture ?? null,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, existing[0].id));
    return 0;
  }

  // Contacto por identidad (la identidad NO es el teléfono).
  let contactId: string | undefined;
  if (participantId) {
    const identity = await db
      .select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(
        and(eq(contactIdentities.channel, channel), eq(contactIdentities.externalId, participantId)),
      )
      .limit(1);
    contactId = identity[0]?.contactId;
    if (!contactId) {
      const [contact] = await db
        .insert(contacts)
        .values({ name: providerConversation.participantName ?? null })
        .returning();
      contactId = contact.id;
      await db
        .insert(contactIdentities)
        .values({ contactId, channel, externalId: participantId, handle: participantId })
        .onConflictDoNothing();
    }
  }

  await db.insert(conversations).values({
    channel,
    provider: "zernio",
    externalId,
    accountId: providerConversation.accountId ?? "",
    participantId,
    name: providerConversation.participantName ?? null,
    handle: participantId,
    picture: providerConversation.participantPicture ?? null,
    lastMessageAt: providerConversation.updatedTime ? new Date(providerConversation.updatedTime) : null,
    metadata: { ...(contactId ? { contact_id: contactId } : {}), imported: true },
  });
  return 1;
}

async function importMessages(
  db: Awaited<ReturnType<typeof getDb>>,
  providerConversationId: string,
): Promise<number> {
  const [conversation] = await db
    .select({ id: conversations.id, channel: conversations.channel, provider: conversations.provider })
    .from(conversations)
    .where(
      and(
        eq(conversations.provider, "zernio"),
        eq(conversations.externalId, providerConversationId),
      ),
    )
    .limit(1);
  if (!conversation) return 0;

  const page = await listProviderMessages(providerConversationId, { limit: 100 });
  if (!page.success) return 0;

  let imported = 0;
  for (const message of page.data.messages ?? []) {
    const inserted = await insertBackfillMessage(db, conversation, message);
    if (inserted) imported += 1;
  }
  return imported;
}

async function insertBackfillMessage(
  db: Awaited<ReturnType<typeof getDb>>,
  conversation: { id: string; channel: string; provider: string },
  message: RestMessage,
): Promise<boolean> {
  if (!message.id) return false;
  const inserted = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      channel: conversation.channel as "whatsapp" | "instagram" | "facebook",
      provider: conversation.provider,
      externalId: message.id,
      // El proveedor dice incoming/outgoing; nuestra columna dice inbound/outbound.
      direction: message.direction === "incoming" ? "inbound" : "outbound",
      type: messageTypeFromAttachments(message),
      body: message.message ?? null,
      status: message.direction === "incoming" ? "delivered" : "sent",
      sentAt: message.createdAt ? new Date(message.createdAt) : new Date(),
      rawPayload: { imported: true },
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  return inserted.length > 0;
}

function messageTypeFromAttachments(
  message: RestMessage,
): "text" | "template" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "reaction" | "other" {
  if (message.message) return "text";
  const type = message.attachments?.[0]?.type ?? "";
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

/** Cuenta conversaciones importadas (para el log del barrido). */
export async function countImported(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(sql`${conversations.metadata} ->> 'imported' = 'true'`);
  return rows[0]?.n ?? 0;
}
