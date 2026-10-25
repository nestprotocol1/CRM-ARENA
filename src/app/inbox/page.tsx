/**
 * Bandeja: listado de conversaciones.
 *
 * - Ícono por canal en cada fila
 * - Filtro por canal y búsqueda por nombre y por usuario (por URL: compartible)
 * - Contador de no leídos desde la columna unread_count
 * - Filas ordenadas por último mensaje
 */

import { Suspense } from "react";
import { InboxShell } from "./inbox-shell";
import { countConnectedAccounts, listConversations } from "@/lib/queries";
import { isChannel } from "@/lib/zernio/types";

// cacheComponents: esta ruta lee de la base en cada request; no se prerenderiza.
export const instant = false;

interface PageProps {
  searchParams: Promise<{ q?: string; channel?: string }>;
}

export default async function InboxPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const channel = params.channel && isChannel(params.channel) ? params.channel : undefined;
  const [conversations, connectedAccounts] = await Promise.all([
    listConversations({ q: params.q, channel }),
    countConnectedAccounts(),
  ]);

  return (
    <Suspense>
      <InboxShell
        conversations={conversations}
        connectedAccounts={connectedAccounts}
        activeQ={params.q ?? ""}
        activeChannel={params.channel ?? ""}
      />
    </Suspense>
  );
}
