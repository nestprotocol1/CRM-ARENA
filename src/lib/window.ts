/**
 * Ventana de 24 horas de Meta — la decide el SERVIDOR, no la interfaz.
 *
 * Reglas:
 * - Dentro de las 24h del último mensaje ENTRANTE: texto libre.
 * - WhatsApp fuera de 24h: SOLO plantilla aprobada.
 * - Instagram/Messenger fuera de 24h: texto libre con etiqueta de agente
 *   humano durante 7 días desde el último mensaje entrante.
 *
 * El estado se calcula acá y se manda al cliente calculado: la interfaz no
 * adivina, muestra lo que el servidor decidió.
 */

import type { Channel } from "@/lib/zernio/types";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type WindowMode = "free" | "human_tag" | "template_only" | "blocked";

export interface WindowState {
  open: boolean;
  mode: WindowMode;
  expiresAt: string | null;
  hoursRemaining: number | null;
  message: string;
}

export function computeWindow(lastInboundAt: Date | null, channel: Channel | string): WindowState {
  if (!lastInboundAt) {
    return {
      open: false,
      mode: channel === "whatsapp" ? "template_only" : "blocked",
      expiresAt: null,
      hoursRemaining: null,
      message:
        channel === "whatsapp"
          ? "Sin mensajes entrantes: en WhatsApp solo se puede iniciar con una plantilla aprobada."
          : "Sin mensajes entrantes: la ventana de 24 h no está abierta.",
    };
  }

  const elapsed = Date.now() - lastInboundAt.getTime();
  const expiresAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  const hoursRemaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 3_600_000));

  if (elapsed < WINDOW_MS) {
    return {
      open: true,
      mode: "free",
      expiresAt: expiresAt.toISOString(),
      hoursRemaining,
      message: `Ventana abierta: quedan ${hoursRemaining} h para responder con texto libre.`,
    };
  }

  if (channel !== "whatsapp" && elapsed < HUMAN_AGENT_WINDOW_MS) {
    return {
      open: true,
      mode: "human_tag",
      expiresAt: expiresAt.toISOString(),
      hoursRemaining: 0,
      message:
        "Ventana de 24 h cerrada: se responde con etiqueta de agente humano (válida 7 días).",
    };
  }

  return {
    open: false,
    mode: channel === "whatsapp" ? "template_only" : "blocked",
    expiresAt: expiresAt.toISOString(),
    hoursRemaining: 0,
    message:
      channel === "whatsapp"
        ? "Ventana de 24 h cerrada: en WhatsApp solo se admite plantilla aprobada."
        : "Ventana cerrada: la etiqueta de agente humano venció (7 días). No se puede responder por acá.",
  };
}

/** Plantillas aprobadas de ejemplo (WhatsApp fuera de ventana). */
export const APPROVED_TEMPLATES = [
  { name: "seguimiento_lead", text: "Hola {{1}}, ¿seguís con interés en {{2}}? Quedamos atentos." },
  { name: "recordatorio_turno", text: "Hola {{1}}, te recordamos tu turno del {{2}}." },
  { name: "respuesta_fuera_de_horario", text: "Hola {{1}}, recibimos tu mensaje y te respondemos a la brevedad." },
];
