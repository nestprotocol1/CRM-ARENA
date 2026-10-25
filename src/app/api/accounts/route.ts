/**
 * GET /api/accounts — cuentas conectadas en la base (channel_accounts).
 */

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";

export async function GET(): Promise<NextResponse> {
  const db = await getDb();
  const rows = await db
    .select({
      id: channelAccounts.id,
      provider: channelAccounts.provider,
      channel: channelAccounts.channel,
      externalId: channelAccounts.externalId,
      name: channelAccounts.name,
      status: channelAccounts.status,
      connectedAt: channelAccounts.connectedAt,
    })
    .from(channelAccounts)
    .orderBy(desc(channelAccounts.connectedAt));
  return NextResponse.json({
    accounts: rows.map((r) => ({ ...r, connectedAt: r.connectedAt.toISOString() })),
  });
}
