import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/** La red que ve la persona. NO confundir con provider. */
export const channelEnum = pgEnum("channel", ["whatsapp", "instagram", "facebook"]);

/** Por dónde viaja el mensaje. Eje distinto de channel. */
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "template",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "reaction",
  "other",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const accountStatusEnum = pgEnum("account_status", ["connected", "disconnected"]);

/* ------------------------------------------------------------------ */
/* contacts — la persona real (una por ser humano/marca)               */
/* ------------------------------------------------------------------ */

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"),
  picture: text("picture"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* contact_identities — la identidad NO es el teléfono                 */
/* Único (channel, external_id): la misma persona por dos redes cae    */
/* en un solo contacto.                                                */
/* ------------------------------------------------------------------ */

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    handle: text("handle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_identities_channel_external_id_uq").on(t.channel, t.externalId),
    index("contact_identities_contact_id_idx").on(t.contactId),
  ],
);

/* ------------------------------------------------------------------ */
/* conversations — el hilo real. La unidad del CRM.                    */
/* Único (provider, external_id): el id del hilo según el proveedor.   */
/* ------------------------------------------------------------------ */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channel: channelEnum("channel").notNull(),
    provider: text("provider").notNull().default("zernio"),
    externalId: text("external_id").notNull(),
    /** id externo de channel_accounts: la clave con la que se rutea todo lo que entra. */
    accountId: text("account_id").notNull(),
    participantId: text("participant_id"),
    name: text("name"),
    handle: text("handle"),
    picture: text("picture"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    /** Lo que decide la ventana de 24h de Meta. Lo calcula el SERVIDOR. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    /** Columna, no un COUNT por fila. */
    unreadCount: integer("unread_count").notNull().default(0),
    /** Interruptor por conversación (un vendedor toma el hilo a mano). */
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    /** Atribución de anuncios y datos del proveedor: después no se recupera. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_provider_external_id_uq").on(t.provider, t.externalId),
    index("conversations_account_id_idx").on(t.accountId),
    index("conversations_channel_idx").on(t.channel),
    index("conversations_last_message_at_idx").on(t.lastMessageAt),
  ],
);

/* ------------------------------------------------------------------ */
/* messages — idempotencia por external_id SOLO (índice PARCIAL)       */
/* ------------------------------------------------------------------ */

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    provider: text("provider").notNull().default("zernio"),
    /** Puede ser null: los salientes propios aún no tienen id del proveedor. */
    externalId: text("external_id"),
    direction: messageDirectionEnum("direction").notNull(),
    type: messageTypeEnum("type").notNull().default("text"),
    body: text("body"),
    status: messageStatusEnum("status").notNull().default("sent"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // REGLA DURA: external_id SOLO, no (provider, external_id).
    // Índice PARCIAL: sin el where, los salientes propios chocan entre sí.
    uniqueIndex("messages_external_id_uq")
      .on(t.externalId)
      .where(sql`external_id is not null`),
    index("messages_conversation_id_sent_at_idx").on(t.conversationId, t.sentAt),
  ],
);

/* ------------------------------------------------------------------ */
/* channel_accounts — cuentas conectadas del proveedor                 */
/* external_id único: la clave con la que se rutea todo lo que entra.  */
/* ------------------------------------------------------------------ */

export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull().default("zernio"),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name"),
    status: accountStatusEnum("status").notNull().default("connected"),
    /** OAuth scopes, expiry, etc. Los tokens VAN cifrados aparte, no acá. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("channel_accounts_external_id_uq").on(t.externalId)],
);

/* ------------------------------------------------------------------ */
/* agent_configs — una fila por canal (+ una fila 'global' para la     */
/* cascada: config del canal -> global -> default del código).         */
/* ------------------------------------------------------------------ */

export const agentConfigs = pgTable("agent_configs", {
  channel: text("channel").primaryKey(),
  /** Interruptor por canal. Los canales nuevos arrancan APAGADOS. */
  enabled: boolean("enabled").notNull().default(false),
  systemPrompt: text("system_prompt").notNull().default(""),
  enabledTools: text("enabled_tools")
    .array()
    .notNull()
    .default(sql`'{handoff_human,add_note}'::text[]`),
  model: text("model").notNull().default("openai/gpt-4o-mini"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* webhook_events — idempotencia de la entrega at-least-once           */
/* ------------------------------------------------------------------ */

export const webhookEvents = pgTable("webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  accountId: text("account_id"),
  /** claimed = insertado, sin procesar. processed = ok. failed = dará reintento. */
  status: text("status").notNull().default("claimed"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Relaciones (para los joins de Drizzle)                              */
/* ------------------------------------------------------------------ */

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  identities: many(contactIdentities),
}));

export const contactIdentitiesRelations = relations(contactIdentities, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactIdentities.contactId],
    references: [contacts.id],
  }),
}));
