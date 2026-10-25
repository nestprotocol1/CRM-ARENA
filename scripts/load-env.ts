/**
 * Carga .env.local en process.env para scripts de tsx (Next lo hace solo en
 * el servidor; los scripts necesitan esta ayuda). Las variables ya presentes
 * en el entorno real tienen prioridad.
 *
 * OJO con las comillas: un secreto como el del webhook contiene `/`, `+` y
 * `=`, y se escribe entre comillas en el .env. Si NO se las saca, el script
 * firma con las comillas incluidas y el webhook responde 401 en producción
 * (el servidor de Next sí las saca, así que el bug solo se ve en los scripts:
 * firma mal, se registra mal, y no falla hasta que llega el primer evento).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Saca las comillas envolventes si están balanceadas. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Soportar `export KEY=value` (forma habitual de los .env de shell).
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    const value = unquote(withoutExport.slice(eq + 1).trim());
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();
