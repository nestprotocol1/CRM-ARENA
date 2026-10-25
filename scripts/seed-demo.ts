/**
 * Siembra datos de demo en la base local: cuentas conectadas, conversaciones
 * y mensajes de los tres canales (una fuera de ventana de 24h, una con el
 * agente apagado a mano, una con atribución de anuncio).
 *
 * Idempotente: si la conversación ya existe, no la duplica.
 * Uso: npm run db:seed
 */
import "./load-env";
import { and, eq } from "drizzle-orm";
import { DEMO_ACCOUNTS, DEMO_CONVERSATIONS } from "../src/lib/demo-data";
import { closeDb, getDb } from "../src/db";
import {
  channelAccounts,
  contactIdentities,
  contacts,
  conversations,
  messages,
} from "../src/db/schema";

function isoMinutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function seed(): Promise<void> {
  const db = await getDb();

  // 1. Cuentas conectadas (la clave con la que se rutea todo lo que entra).
  for (const account of DEMO_ACCOUNTS) {
    const existing = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(eq(channelAccounts.externalId, account.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(channelAccounts).values({
        provider: "zernio",
        channel: account.channel,
        externalId: account.id,
        name: account.name,
        status: "connected",
      });
    }
  }

  // 2. Conversaciones con sus contactos, identidades y mensajes.
  let created = 0;
  for (const demo of DEMO_CONVERSATIONS) {
    const existing = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.provider, "zernio"), eq(conversations.externalId, demo.id)))
      .limit(1);
    if (existing.length > 0) continue;

    // Contacto + identidad (la identidad NO es el teléfono).
    const [contact] = await db.insert(contacts).values({ name: demo.name }).returning();
    await db.insert(contactIdentities).values({
      contactId: contact.id,
      channel: demo.channel,
      externalId: demo.participantId,
      handle: demo.handle,
    });

    const lastInbound = [...demo.messages].reverse().find((m) => m.inbound);
    const lastMessage = demo.messages[demo.messages.length - 1];

    const [conversation] = await db
      .insert(conversations)
      .values({
        channel: demo.channel,
        provider: "zernio",
        externalId: demo.id,
        accountId: demo.accountId,
        participantId: demo.participantId,
        name: demo.name,
        handle: demo.handle,
        lastMessageAt: isoMinutesAgo(lastMessage.minutesAgo),
        lastInboundAt: isoMinutesAgo(lastInbound?.minutesAgo ?? lastMessage.minutesAgo),
        unreadCount: lastInbound && lastInbound.minutesAgo < 60 ? 1 : 0,
        aiEnabled: !demo.aiDisabled,
        metadata: {
          contact_id: contact.id,
          ...(demo.referral ? { referral: demo.referral } : {}),
        },
      })
      .returning();

    for (const message of demo.messages) {
      await db.insert(messages).values({
        conversationId: conversation.id,
        channel: demo.channel,
        provider: "zernio",
        externalId: message.id,
        direction: message.inbound ? "inbound" : "outbound",
        type: "text",
        body: message.text,
        status: message.inbound ? "delivered" : "read",
        sentAt: isoMinutesAgo(message.minutesAgo),
      });
    }
    created += 1;
  }

  console.log(`[db:seed] listo. ${created} conversaciones creadas (de ${DEMO_CONVERSATIONS.length}).`);
  await closeDb();
}

seed().catch((err) => {
  console.error("[db:seed] ERROR:", err);
  process.exit(1);
});
