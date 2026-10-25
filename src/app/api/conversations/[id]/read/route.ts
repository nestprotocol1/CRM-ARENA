/**
 * POST /api/conversations/[id]/read — marca la conversación como leída.
 * El contador de no leídos sale de la columna unread_count de la tabla, no de
 * un COUNT por cada fila.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations } from "@/db/schema";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = await getDb();
  await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(conversations.id, id));
  return NextResponse.json({ ok: true });
}
