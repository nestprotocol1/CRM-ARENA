/**
 * Cliente de Supabase SOLO para el navegador (Realtime).
 *
 * La base la maneja Drizzle (postgres-js en el servidor); acá no se consulta
 * nada por REST. Lo único que se usa es el canal de Realtime, para que la
 * bandeja se actualice sola cuando entra un mensaje, sin polling.
 *
 * Las dos variables son NEXT_PUBLIC (van al bundle del navegador): la llave
 * publishable ES pública por diseño. Lo que protege los datos es RLS — ver
 * supabase/setup.sql.
 *
 * Si no están configuradas, todo degrada a polling: la app funciona igual.
 */

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/** true si el deploy tiene Supabase Realtime configurado. */
export function realtimeEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Devuelve el cliente, o null si no hay credenciales públicas.
 * Se cachea: createClient abre un WebSocket y no debe llamarse por render.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return cached;
}
