/**
 * GET /api/dev/db-stats — conteos de la base DEL SERVIDOR.
 *
 * Existe porque PGlite (Postgres WASM local) no comparte estado entre
 * procesos: un script externo no ve lo que escribe el servidor. Los tests y
 * la verificación leen la base por acá.
 *
 * Solo en desarrollo o con ZERNIO_MOCK=1.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { usingMockProvider } from "@/lib/zernio";

export async function GET(): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production" && !usingMockProvider()) {
    return NextResponse.json({ error: "no disponible en producción" }, { status: 403 });
  }
  const db = await getDb();
  const tables = [
    "conversations",
    "messages",
    "contacts",
    "contact_identities",
    "channel_accounts",
    "webhook_events",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const res = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
    const rows = (res as unknown as { rows: { n: number }[] }).rows;
    counts[table] = rows[0]?.n ?? 0;
  }
  return NextResponse.json(counts);
}
