/**
 * Auto-preparación de la base LOCAL al arrancar el servidor de desarrollo.
 *
 * - Aplica migraciones pendientes (idempotente: drizzle lleva el journal).
 * - Siembra datos de demo si la base está vacía.
 *
 * Solo corre sin DATABASE_URL (PGlite local). Con Supabase, las migraciones
 * corren en el pipeline de deploy (npm run db:migrate).
 *
 * Lo llama instrumentation.ts al arrancar Next.
 */
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DEMO_ACCOUNTS, DEMO_CONVERSATIONS } from "../src/lib/demo-data";
import {
  channelAccounts,
  contactIdentities,
  contacts,
  conversations,
  messages,
} from "../src/db/schema";
import * as schema from "../src/db/schema";

export async function ensureDevData(): Promise<void> {
  if (process.env.DATABASE_URL) return; // producción: migraciones por pipeline

  const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[ensure-dev-data] migraciones al día");

  const existingAccounts = await db.select().from(channelAccounts).limit(1);
  if (existingAccounts.length > 0) {
    await client.close();
    return; // ya hay data
  }

  for (const account of DEMO_ACCOUNTS) {
    await db.insert(channelAccounts).values({
      provider: "zernio",
      channel: account.channel,
      externalId: account.id,
      name: account.name,
      status: "connected",
    });
  }

  for (const demo of DEMO_CONVERSATIONS) {
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
        lastMessageAt: new Date(Date.now() - lastMessage.minutesAgo * 60_000),
        lastInboundAt: new Date(
          Date.now() - (lastInbound?.minutesAgo ?? lastMessage.minutesAgo) * 60_000,
        ),
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
        sentAt: new Date(Date.now() - message.minutesAgo * 60_000),
      });
    }
  }

  console.log(
    `[ensure-dev-data] base local sembrada: ${DEMO_ACCOUNTS.length} cuentas, ${DEMO_CONVERSATIONS.length} conversaciones`,
  );
  await client.close();
}
