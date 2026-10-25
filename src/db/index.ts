import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Un solo módulo de base para todo el proyecto.
 *
 * - Con DATABASE_URL (Supabase/producción): postgres-js.
 * - Sin DATABASE_URL (desarrollo/local/pruebas): PGlite, Postgres real
 *   compilado a WASM, con datos en .data/pglite. Sin Docker, sin servidor.
 *
 * El schema y las migraciones son los mismos en los dos caminos.
 */

export type Database = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

type CloseableClient = { close?: () => Promise<void>; end?: () => Promise<void> };

declare global {
  var __crmDb: Database | undefined;
  var __crmDbClient: CloseableClient | undefined;
}

function getDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : undefined;
}

export function usingSupabase(): boolean {
  return Boolean(getDatabaseUrl());
}

async function createLocalDatabase(): Promise<Database> {
  const { mkdirSync } = await import("node:fs");
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
  // PGlite hace mkdir del dataDir pero asume que el padre existe.
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  globalThis.__crmDbClient = client as unknown as CloseableClient;
  return drizzlePglite(client, { schema }) as unknown as Database;
}

async function createRemoteDatabase(): Promise<Database> {
  const url = getDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const postgres = (await import("postgres")).default;
  const client = postgres(url, { max: 5, prepare: false });
  globalThis.__crmDbClient = client as unknown as CloseableClient;
  return drizzlePostgres(client, { schema }) as unknown as Database;
}

/**
 * Singleton por proceso. En dev, Next recarga módulos: sin el cache en
 * globalThis se abriría una instancia de PGlite por recarga y el directorio
 * de datos quedaría bloqueado.
 */
export async function getDb(): Promise<Database> {
  if (globalThis.__crmDb) return globalThis.__crmDb;
  const db = usingSupabase() ? await createRemoteDatabase() : await createLocalDatabase();
  globalThis.__crmDb = db;
  return db;
}

/** Cierra el cliente subyacente (scripts de una sola pasada). */
export async function closeDb(): Promise<void> {
  const client = globalThis.__crmDbClient;
  if (client?.close) await client.close();
  else if (client?.end) await client.end();
  globalThis.__crmDb = undefined;
  globalThis.__crmDbClient = undefined;
}

export { schema };
