/**
 * Verificación de la Fase 1: corre contra la base activa y muestra el conteo
 * de filas por tabla. Prueba de que la migración realmente se aplicó.
 *
 * Uso: npm run db:counts
 */
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/db";

const TABLES = [
  "contacts",
  "contact_identities",
  "conversations",
  "messages",
  "channel_accounts",
  "agent_configs",
  "webhook_events",
] as const;

async function main() {
  const db = await getDb();
  console.log("tabla               | filas");
  console.log("--------------------+-------");
  for (const table of TABLES) {
    const res = await db.execute<{ n: string }>(
      sql.raw(`select count(*)::int as n from ${table}`),
    );
    const rows = (res as unknown as { rows: { n: number }[] }).rows;
    console.log(`${table.padEnd(19)} | ${rows[0]?.n ?? "?"}`);
  }
  await closeDb();
}

main().catch((err) => {
  console.error("[db:counts] ERROR:", err);
  process.exit(1);
});
