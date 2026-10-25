/**
 * Aplica las migraciones de ./migrations contra la base activa:
 * - DATABASE_URL presente -> Supabase (postgres-js)
 * - ausente                -> PGlite local (.data/pglite)
 *
 * Uso: npm run db:migrate
 */
import "./load-env";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb, usingSupabase } from "../src/db";

async function main() {
  const db = await getDb();
  if (usingSupabase()) {
    console.log("[db:migrate] Aplicando migraciones contra Supabase (DATABASE_URL)…");
    await migratePostgres(db as never, { migrationsFolder: "./migrations" });
  } else {
    console.log("[db:migrate] Aplicando migraciones contra PGlite local…");
    await migratePglite(db as never, { migrationsFolder: "./migrations" });
  }
  console.log("[db:migrate] Listo.");
  await closeDb();
}

main().catch((err) => {
  console.error("[db:migrate] ERROR:", err);
  process.exit(1);
});
