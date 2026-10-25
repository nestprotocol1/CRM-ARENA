"use client";

/**
 * Panel de chat.
 *
 * - Las burbujas son AGNÓSTICAS del canal: no cambian entre WhatsApp,
 *   Instagram y Messenger.
 * - El encabezado SÍ cambia: @usuario en redes sociales, teléfono en WhatsApp.
 * - Marca como leída al abrir (unread_count es una columna).
 * - Se refrescula solo para que aparezcan las respuestas del agente.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelIcon, channelLabel } from "@/components/channel-icon";
import { MessageInput } from "./message-input";
import { ConversationDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

interface LocalMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  sentAt: string;
  optimistic?: boolean;
}

export function ChatPanel({ detail }: { detail: ConversationDetail }) {
  const router = useRouter();
  const { conversation, window: windowState } = detail;
  const [messages, setMessages] = useState<LocalMessage[]>(
    detail.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status as LocalMessage["status"],
      sentAt: m.sentAt,
    })),
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  // Marcar como leída al abrir.
  useEffect(() => {
    if (detail.conversation.unreadCount === 0) return;
    fetch(`/api/conversations/${conversation.id}/read`, { method: "POST" }).catch(() => {});
  }, [conversation.id, detail.conversation.unreadCount]);

  // Refresco: Realtime si está configurado; si no, polling de 5s.
  // El agente responde en segundo plano (after()), así que el aviso tiene que
  // llegar solo: sin realtime ni polling, la respuesta aparecería recién al
  // recargar.
  const realtime = useRealtimeRefresh(
    conversation.id
      ? [
          { table: "messages", filter: `conversation_id=eq.${conversation.id}` },
          { table: "conversations", filter: `id=eq.${conversation.id}` },
        ]
      : [{ table: "messages" }],
  );
  useEffect(() => {
    if (realtime) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router, realtime]);

  // Scroll al fondo cuando cambian los mensajes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const handleSent = useCallback(
    (optimisticId: string, result: { ok: boolean; messageId?: string; status?: string; error?: string }) => {
      setMessages((current) =>
        current.map((m) =>
          m.id === optimisticId
            ? result.ok
              ? { ...m, id: result.messageId ?? m.id, status: (result.status as LocalMessage["status"]) ?? "sent", optimistic: false }
              : { ...m, status: "failed", optimistic: false }
            : m,
        ),
      );
      if (!result.ok) {
        // El servidor ya dijo por qué (ventana cerrada, etc.).
        console.warn("[chat] no se pudo enviar:", result.error);
      }
      router.refresh();
    },
    [router],
  );

  const isWhatsApp = conversation.channel === "whatsapp";
  const headerSubtitle = isWhatsApp
    ? conversation.handle ?? conversation.name ?? "Sin teléfono"
    : `${conversation.handle ?? "sin usuario"} · ${channelLabel(conversation.channel)}`;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* Encabezado: cambia por canal */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => router.push("/inbox")}
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ChannelIcon channel={conversation.channel} className="h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{conversation.name ?? "Sin nombre"}</p>
          <p className="truncate text-xs text-muted-foreground">{headerSubtitle}</p>
        </div>
        {conversation.aiEnabled ? (
          <Badge variant="secondary" className="gap-1">
            <Bot className="h-3 w-3" /> IA activa
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            IA en pausa
          </Badge>
        )}
        {conversation.metadata?.referral ? (
          <Badge variant="warning" className="hidden sm:inline-flex">
            Lead de anuncio
          </Badge>
        ) : null}
      </header>

      {/* Burbujas: agnósticas de canal */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex", message.direction === "outbound" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                message.direction === "outbound"
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-secondary text-secondary-foreground",
              )}
            >
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p
                className={cn(
                  "mt-1 text-[10px]",
                  message.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground",
                )}
              >
                {new Date(message.sentAt).toLocaleTimeString("es-CO", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {message.direction === "outbound" && (
                  <span className="ml-1.5">
                    {message.status === "pending"
                      ? "· enviando…"
                      : message.status === "failed"
                        ? "· no salió"
                        : message.status === "read"
                          ? "· leído"
                          : message.status === "delivered"
                            ? "· entregado"
                            : ""}
                  </span>
                )}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Entrada: la ventana la decide el servidor */}
      <div className="shrink-0 border-t">
        {!windowState.open && windowState.mode === "blocked" && (
          <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <ShieldAlert className="h-3.5 w-3.5" />
            {windowState.message}
          </div>
        )}
        <MessageInput
          conversationId={conversation.id}
          contactName={conversation.name ?? conversation.handle ?? ""}
          window={windowState}
          onOptimistic={(local) => setMessages((current) => [...current, local])}
          onResult={handleSent}
        />
      </div>
    </div>
  );
}
