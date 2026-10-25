"use client";

/**
 * Estructura de la bandeja: lista a la izquierda, chat a la derecha.
 * La lista es client para el filtrado instantáneo por URL; los datos vienen
 * del servidor.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChannelIcon, channelLabel } from "@/components/channel-icon";
import { ConversationRow } from "@/lib/queries";
import type { Channel } from "@/lib/zernio/types";
import { cn } from "@/lib/utils";

const CHANNEL_FILTERS: Array<{ value: Channel | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Messenger" },
];

export function InboxShell({
  conversations,
  activeQ,
  activeChannel,
}: {
  conversations: ConversationRow[];
  activeQ: string;
  activeChannel: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(activeQ);

  const applyFilters = useCallback(
    (next: { q?: string; channel?: string }) => {
      const params = new URLSearchParams();
      if (next.q?.trim()) params.set("q", next.q.trim());
      if (next.channel && next.channel !== "all") params.set("channel", next.channel);
      router.push(`/inbox${params.toString() ? `?${params}` : ""}`);
    },
    [router],
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-lg font-semibold">Bandeja</h1>
        <span className="text-sm text-muted-foreground">
          {conversations.length} conversaciones
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Lista */}
        <div className="flex w-full max-w-sm flex-col border-r md:w-80">
          <div className="space-y-3 border-b p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                applyFilters({ q, channel: activeChannel });
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nombre o @usuario"
                  className="pl-8"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary">
                Buscar
              </Button>
            </form>
            <div className="flex gap-1">
              {CHANNEL_FILTERS.map((filter) => (
                <Button
                  key={filter.value}
                  size="sm"
                  variant={activeChannel === filter.value || (!activeChannel && filter.value === "all") ? "default" : "ghost"}
                  onClick={() => applyFilters({ q, channel: filter.value })}
                  className="h-7 px-2 text-xs"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No hay conversaciones para este filtro.
              </p>
            )}
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                data-conversation-id={conversation.id}
                onClick={() => router.push(`/inbox/${conversation.id}`)}
                className={cn(
                  "flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-accent",
                  "bg-background",
                )}
              >
                <span className="relative mt-0.5">
                  <ChannelIcon
                    channel={conversation.channel}
                    className="h-5 w-5 text-muted-foreground"
                  />
                  {conversation.unreadCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {conversation.unreadCount}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">
                      {conversation.name ?? conversation.handle ?? "Sin nombre"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {conversation.lastMessageAt
                        ? new Date(conversation.lastMessageAt).toLocaleDateString("es-CO", {
                            day: "2-digit",
                            month: "2-digit",
                          })
                        : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">
                      {conversation.channel === "whatsapp"
                        ? conversation.handle
                        : conversation.handle}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {conversation.lastMessage
                      ? `${conversation.lastMessage.direction === "outbound" ? "Vos: " : ""}${conversation.lastMessage.body ?? ""}`
                      : "Sin mensajes"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat (se llena en /inbox/[id]; acá va el panel vacío) */}
        <div className="hidden flex-1 flex-col md:flex">
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <p className="font-medium">Elegí una conversación</p>
              <p className="mt-1">
                {channelLabel("whatsapp")}, Instagram y Messenger en una sola bandeja.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
