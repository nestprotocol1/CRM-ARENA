"use client";

/**
 * Entrada de mensaje.
 *
 * - Un solo endpoint: POST /api/messages/send { conversationId, text }
 * - Fila OPTIMISTA con estado pendiente mientras viaja
 * - La ventana de 24h la decidió el SERVIDOR (prop window): la interfaz solo
 *   muestra lo que corresponde. Fuera de ventana, WhatsApp ofrece plantilla;
 *   los otros canales avisan. No se deja mandar algo que va a rebotar: es la
 *   peor experiencia posible, el vendedor cree que contestó.
 */

import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { APPROVED_TEMPLATES, type WindowState } from "@/lib/window";

interface LocalMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  sentAt: string;
  optimistic?: boolean;
}

export function MessageInput({
  conversationId,
  contactName,
  window: windowState,
  onOptimistic,
  onResult,
}: {
  conversationId: string;
  contactName: string;
  window: WindowState;
  onOptimistic: (message: LocalMessage) => void;
  onResult: (
    optimisticId: string,
    result: { ok: boolean; messageId?: string; status?: string; error?: string },
  ) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const optimisticCounter = useRef(0);

  const templateOnly = windowState.mode === "template_only";
  const humanTag = windowState.mode === "human_tag";

  async function send(payload: {
    text?: string;
    type?: "text" | "template";
    templateName?: string;
  }) {
    const body = payload.text ?? "";
    optimisticCounter.current += 1;
    const optimisticId = `optimistic-${optimisticCounter.current}`;
    onOptimistic({
      id: optimisticId,
      direction: "outbound",
      body,
      status: "pending",
      sentAt: new Date().toISOString(),
      optimistic: true,
    });
    setText("");
    setSending(true);
    try {
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, ...payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        onResult(optimisticId, { ok: false, error: result.error ?? `error ${response.status}` });
        if (payload.text) setText(payload.text); // devolver el texto para que no se pierda
      } else {
        onResult(optimisticId, { ok: true, messageId: result.messageId, status: result.status });
      }
    } catch (error) {
      onResult(optimisticId, { ok: false, error: String(error) });
      if (payload.text) setText(payload.text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-3">
      {humanTag && (
        <p className="mb-2 rounded-md bg-amber-100 px-3 py-1.5 text-xs text-amber-800">
          Ventana de 24 h cerrada: tu mensaje se envía con etiqueta de agente humano
          (válida por 7 días desde el último mensaje del cliente).
        </p>
      )}

      {templateOnly ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {windowState.message} Elegí una plantilla aprobada:
          </p>
          <div className="flex flex-wrap gap-2">
            {APPROVED_TEMPLATES.map((template) => (
              <Button
                key={template.name}
                size="sm"
                variant="outline"
                disabled={sending}
                onClick={() =>
                  send({
                    type: "template",
                    templateName: template.name,
                    text: template.text
                      .replace("{{1}}", contactName || "cliente")
                      .replace("{{2}}", "su consulta"),
                  })
                }
              >
                {template.name.replace(/_/g, " ")}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || sending) return;
            send({ text });
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              windowState.open
                ? "Escribí un mensaje… (Enter envía, Shift+Enter salto de línea)"
                : windowState.message
            }
            className="min-h-10 max-h-32 resize-none"
            rows={1}
            disabled={sending || windowState.mode === "blocked"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim() && !sending) send({ text });
              }
            }}
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim() || windowState.mode === "blocked"}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
