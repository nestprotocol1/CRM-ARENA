/**
 * Carga .env.local en process.env para scripts de tsx (Next lo hace solo en
 * el servidor; los scripts necesitan esta ayuda). Las variables ya presentes
 * en el entorno real tienen prioridad.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();
