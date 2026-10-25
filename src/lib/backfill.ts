/**
 * Barrido de recuperación / importación de historial.
 *
 * REGLA DURA (la más importante de la Fase 6): en la importación el agente
 * NO se dispara. Contestarle a cientos de clientes viejos de golpe es un
 * desastre difícil de explicar.
 *
 * El historial que el proveedor ya replicó NO llega por webhook: se importa
 * por la API REST (mismos dos endpoints que la bandeja).
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  channelAccounts,
  contactIdentities,
  contacts,
  conversations,
  messages,
} from "@/db/schema";
import { listProviderAccounts, iterateProviderConversations, listProviderMessages } from "@/lib/zernio";
import type { Channel } from "@/lib/zernio/types";

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
        result.conversations += await importConversation(db, conversation, account.channel);
        result.messages += await importMessages(db, conversation.id);
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
  providerConversation: {
    id: string;
    channel: Channel;
    account_id: string;
    participant: { id: string; name?: string | null; handle?: string | null; picture?: string | null };
    last_message_at?: string | null;
    unread_count: number;
  },
  channel: Channel,
): Promise<number> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.provider, "zernio"),
        eq(conversations.externalId, providerConversation.id),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(conversations)
      .set({
        accountId: providerConversation.account_id,
        participantId: providerConversation.participant.id,
        name: providerConversation.participant.name ?? null,
        handle: providerConversation.participant.handle ?? null,
        picture: providerConversation.participant.picture ?? null,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, existing[0].id));
    return 0;
  }

  // Contacto por identidad (la identidad NO es el teléfono).
  const identity = await db
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.channel, channel),
        eq(contactIdentities.externalId, providerConversation.participant.id),
      ),
    )
    .limit(1);
  let contactId = identity[0]?.contactId;
  if (!contactId) {
    const [contact] = await db
      .insert(contacts)
      .values({ name: providerConversation.participant.name ?? null })
      .returning();
    contactId = contact.id;
    await db
      .insert(contactIdentities)
      .values({
        contactId,
        channel,
        externalId: providerConversation.participant.id,
        handle: providerConversation.participant.handle ?? null,
      })
      .onConflictDoNothing();
  }

  await db.insert(conversations).values({
    channel,
    provider: "zernio",
    externalId: providerConversation.id,
    accountId: providerConversation.account_id,
    participantId: providerConversation.participant.id,
    name: providerConversation.participant.name ?? null,
    handle: providerConversation.participant.handle ?? null,
    picture: providerConversation.participant.picture ?? null,
    lastMessageAt: providerConversation.last_message_at
      ? new Date(providerConversation.last_message_at)
      : null,
    metadata: { contact_id: contactId, imported: true },
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
  for (const message of page.data.data) {
    const inserted = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channel: conversation.channel,
        provider: conversation.provider,
        externalId: message.id,
        direction: message.direction,
        type: message.type,
        body: message.text ?? null,
        status: message.status,
        sentAt: new Date(message.sent_at),
        rawPayload: { imported: true },
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (inserted.length > 0) imported += 1;
  }
  return imported;
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
