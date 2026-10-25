/**
 * Datos de demo compartidos: los usa el proveedor mock (para simular la API)
 * y el seed de la base local. Una sola fuente para que los ids externos
 * coincidan entre el mock y la base sembrada.
 */

import type { Channel } from "./zernio/types";

export interface DemoAccount {
  id: string;
  channel: Channel;
  name: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: "acc_wa_ventas", channel: "whatsapp", name: "Ventas WhatsApp" },
  { id: "acc_ig_tienda", channel: "instagram", name: "Tienda Instagram" },
  { id: "acc_fb_soporte", channel: "facebook", name: "Soporte Messenger" },
];

export interface DemoMessage {
  id: string;
  inbound: boolean;
  text: string;
  minutesAgo: number;
}

export interface DemoConversation {
  id: string;
  channel: Channel;
  accountId: string;
  participantId: string;
  name: string;
  handle: string;
  /** Atribución de anuncio, si el proveedor la manda (shape real: camelCase). */
  referral?: { source?: string; campaignId?: string; adsetId?: string; adId?: string };
  /** Un vendedor tomó este hilo a mano: el agente no contesta. */
  aiDisabled?: boolean;
  /** Para probar la ventana de 24h fuera de horario. */
  outOfWindow?: boolean;
  messages: DemoMessage[];
}

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    id: "conv_wa_1001",
    channel: "whatsapp",
    accountId: "acc_wa_ventas",
    participantId: "wa_573001112233",
    name: "María Fernández",
    handle: "+57 300 111 2233",
    referral: { source: "ad", campaignId: "cmp_llantas_2026", adsetId: "aset_ruedas", adId: "ad_205_55" },
    messages: [
      { id: "conv_wa_1001_m0", inbound: true, text: "Hola, vi el anuncio de las llantas. ¿Tienen 205/55 R16?", minutesAgo: 46 },
      { id: "conv_wa_1001_m1", inbound: false, text: "¡Hola María! Sí, tenemos esa medida. ¿Para qué vehículo?", minutesAgo: 44 },
      { id: "conv_wa_1001_m2", inbound: true, text: "Para un Mazda 3 2019. ¿Precio por las cuatro?", minutesAgo: 3 },
    ],
  },
  {
    id: "conv_wa_1002",
    channel: "whatsapp",
    accountId: "acc_wa_ventas",
    participantId: "wa_573015554444",
    name: "Carlos Ruiz",
    handle: "+57 301 555 4444",
    outOfWindow: true,
    messages: [
      { id: "conv_wa_1002_m0", inbound: true, text: "Buenos días, quiero agendar una instalación", minutesAgo: 60 * 30 },
      { id: "conv_wa_1002_m1", inbound: false, text: "Con gusto. ¿Le sirve el sábado a las 9am?", minutesAgo: 60 * 29 },
    ],
  },
  {
    id: "conv_wa_1003",
    channel: "whatsapp",
    accountId: "acc_wa_ventas",
    participantId: "wa_573209998887",
    name: "Ana Torres",
    handle: "+57 320 999 8887",
    aiDisabled: true,
    messages: [
      { id: "conv_wa_1003_m0", inbound: true, text: "Necesito una cotización formal para mi empresa", minutesAgo: 20 },
    ],
  },
  {
    id: "conv_ig_2001",
    channel: "instagram",
    accountId: "acc_ig_tienda",
    participantId: "ig_998877",
    name: "lau.ramirez",
    handle: "@lau.ramirez",
    messages: [
      { id: "conv_ig_2001_m0", inbound: true, text: "Hola! Me llegó el pedido pero falta un artículo 😕", minutesAgo: 12 },
      { id: "conv_ig_2001_m1", inbound: false, text: "Hola Lau, qué pena. ¿Me pasás el número de pedido?", minutesAgo: 11 },
      { id: "conv_ig_2001_m2", inbound: true, text: "Es el #4521", minutesAgo: 1 },
    ],
  },
  {
    id: "conv_ig_2002",
    channel: "instagram",
    accountId: "acc_ig_tienda",
    participantId: "ig_112233",
    name: "andres.io",
    handle: "@andres.io",
    messages: [
      { id: "conv_ig_2002_m0", inbound: true, text: "Hacen envíos a Medellín?", minutesAgo: 90 },
    ],
  },
  {
    id: "conv_fb_3001",
    channel: "facebook",
    accountId: "acc_fb_soporte",
    participantId: "fb_554433",
    name: "Diana Gómez",
    handle: "diana.gomez",
    messages: [
      { id: "conv_fb_3001_m0", inbound: true, text: "Necesito ayuda con una factura", minutesAgo: 7 },
      { id: "conv_fb_3001_m1", inbound: false, text: "Hola Diana, te ayudo. ¿Cuál es el número de factura?", minutesAgo: 6 },
    ],
  },
  {
    id: "conv_fb_3002",
    channel: "facebook",
    accountId: "acc_fb_soporte",
    participantId: "fb_667788",
    name: "Pedro Ángel",
    handle: "pedro.angel",
    outOfWindow: true,
    messages: [
      { id: "conv_fb_3002_m0", inbound: true, text: "El enlace de pago no funciona", minutesAgo: 60 * 40 },
    ],
  },
];

export function demoConversation(id: string): DemoConversation | undefined {
  return DEMO_CONVERSATIONS.find((c) => c.id === id);
}
