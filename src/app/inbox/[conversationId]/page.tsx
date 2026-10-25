/**
 * Chat de una conversación. Ruta por conversationId — nunca por contactId:
 * si una persona puede tener dos hilos, una ruta por contacto los colapsa en
 * uno y se pierde información.
 *
 * El estado de la ventana de 24h lo calcula el SERVIDOR (computeWindow sobre
 * last_inbound_at) y se manda al cliente calculado.
 */

import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ChatPanel } from "./chat-panel";
import { getConversationDetail } from "@/lib/queries";

// cacheComponents: esta ruta lee de la base en cada request; no se prerenderiza.
export const instant = false;

interface PageProps {
  params: Promise<{ conversationId: string }>;
}

export default async function ConversationPage({ params }: PageProps) {
  const { conversationId } = await params;
  await connection(); // la ventana de 24h depende de la hora actual: ruta dinámica
  const detail = await getConversationDetail(conversationId);
  if (!detail) notFound();

  return <ChatPanel detail={detail} />;
}
