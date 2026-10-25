/**
 * useRealtimeRefresh — refresca la página cuando cambia la base.
 *
 * Reemplaza el polling de 5s: si Supabase Realtime está configurado, se
 * suscribe a los cambios (INSERT/UPDATE/DELETE) de las tablas que le pases y
 * llama router.refresh() para que los server components vuelvan a leer.
 *
 * Sin credenciales públicas de Supabase, no se suscribe a nada y el llamador
 * sigue con polling: la app funciona igual, solo que con delay.
 *
 * OJO con el filtro: `filter` es un string de PostgREST
 * (`columna=eq.valor`), NO de SQL.
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser, realtimeEnabled } from "@/lib/supabase/client";

export interface RealtimeTable {
  table: string;
  /** Filtro PostgREST, ej. `conversation_id=eq.<uuid>`. Sin él, todos los filas. */
  filter?: string;
}

export function useRealtimeRefresh(tables: RealtimeTable[]): boolean {
  const router = useRouter();

  useEffect(() => {
    if (!realtimeEnabled()) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    // Debounce: un cambio grande (backfill, siembra) llega como ráfaga de
    // eventos; un solo refresh alcanza y evita martillar el servidor.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 150);
    };

    const channel = supabase.channel(`crm-${tables.map((t) => t.table).join("-")}`);
    for (const t of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
        schedule,
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return realtimeEnabled();
}
