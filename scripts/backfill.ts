/**
 * Barrido de recuperación por CLI (para correr a mano o desde un cron
 * externo). Misma lógica que POST /api/backfill; el agente NO se dispara.
 *
 * Uso: npm run backfill
 */
import "./load-env";
import { runBackfill } from "../src/lib/backfill";

async function main() {
  const result = await runBackfill();
  console.log(
    `[backfill] cuentas: ${result.accounts}, conversaciones nuevas: ${result.conversations}, mensajes nuevos: ${result.messages}`,
  );
  if (result.skippedAccounts.length > 0) {
    console.log(`[backfill] cuentas salteadas (no conectadas en la base): ${result.skippedAccounts.join(", ")}`);
  }
  for (const error of result.errors) console.error(`[backfill] error: ${error}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
