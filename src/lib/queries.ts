/**
 * Consultas de servidor para la bandeja.
 *
 * Todas las rutas van por conversationId, nunca por contactId. El contador de
 * no leídos sale de la columna unread_count (no de un COUNT por fila).
 */

import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import type { Channel } from "@/lib/zernio/types";
import { computeWindow, type WindowState } from "@/lib/window";

export interface ConversationRow {
  id: string;
  channel: Channel;
  provider: string;
  externalId: string;
  name: string | null;
  handle: string | null;
  picture: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  aiEnabled: boolean;
  lastMessage: { body: string | null; direction: "inbound" | "outbound"; sentAt: string } | null;
}

export interface ListFilters {
  q?: string;
  channel?: Channel;
  limit?: number;
}

export async function listConversations(filters: ListFilters = {}): Promise<ConversationRow[]> {
  const db = await getDb();
  const conditions = [];
  if (filters.channel) conditions.push(eq(conversations.channel, filters.channel));
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    // Búsqueda por nombre Y por usuario/handle.
    conditions.push(or(ilike(conversations.name, like), ilike(conversations.handle, like)));
  }

  const rows = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      provider: conversations.provider,
      externalId: conversations.externalId,
      name: conversations.name,
      handle: conversations.handle,
      picture: conversations.picture,
      lastMessageAt: conversations.lastMessageAt,
      lastInboundAt: conversations.lastInboundAt,
      unreadCount: conversations.unreadCount,
      aiEnabled: conversations.aiEnabled,
    })
    .from(conversations)
    .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` and `)}` : undefined)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(filters.limit ?? 100);

  if (rows.length === 0) return [];

  // Último mensaje de cada conversación (una consulta, no una por fila).
  const ids = rows.map((r) => r.id);
  const lastMessages = await db
    .select({
      conversationId: messages.conversationId,
      body: messages.body,
      direction: messages.direction,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .orderBy(desc(messages.sentAt));

  const lastByConversation = new Map<string, (typeof lastMessages)[number]>();
  for (const m of lastMessages) {
    if (!lastByConversation.has(m.conversationId)) lastByConversation.set(m.conversationId, m);
  }

  return rows.map((row) => {
    const last = lastByConversation.get(row.id);
    return {
      ...row,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      lastInboundAt: row.lastInboundAt ? row.lastInboundAt.toISOString() : null,
      lastMessage: last
        ? { body: last.body, direction: last.direction, sentAt: last.sentAt.toISOString() }
        : null,
    };
  });
}

export interface ConversationDetail {
  conversation: Omit<ConversationRow, "lastMessage"> & { metadata: Record<string, unknown> | null };
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    type: string;
    body: string | null;
    status: string;
    sentAt: string;
  }>;
  window: WindowState;
}

export async function getConversationDetail(conversationId: string): Promise<ConversationDetail | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return null;

  const messageRows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      status: messages.status,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.sentAt);

  return {
    conversation: {
      id: row.id,
      channel: row.channel,
      provider: row.provider,
      externalId: row.externalId,
      name: row.name,
      handle: row.handle,
      picture: row.picture,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      lastInboundAt: row.lastInboundAt ? row.lastInboundAt.toISOString() : null,
      unreadCount: row.unreadCount,
      aiEnabled: row.aiEnabled,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    },
    messages: messageRows.map((m) => ({
      ...m,
      sentAt: m.sentAt.toISOString(),
    })),
    window: computeWindow(row.lastInboundAt, row.channel as Channel),
  };
}
