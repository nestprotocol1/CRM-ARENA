/**
 * GET /api/accounts/oauth-url?channel=whatsapp — devuelve la URL de
 * autorización del proveedor.
 *
 * El redirect_uri se arma con el host DEL REQUEST (regla: nunca URL fija).
 * El cliente llama este endpoint DESPUÉS de abrir el popup de forma
 * sincrónica con el click (ver settings: si se abriera cuando resuelve la
 * promesa, el navegador la bloquea como emergente no solicitada).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildProviderOAuthUrl } from "@/lib/zernio";
import { baseUrlFromRequest } from "@/lib/base-url";
import { isChannel } from "@/lib/zernio/types";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const channel = request.nextUrl.searchParams.get("channel");
  if (!channel || !isChannel(channel)) {
    return NextResponse.json({ error: "channel inválido" }, { status: 400 });
  }

  const redirectUri = `${baseUrlFromRequest(request)}/api/accounts/callback`;
  const state = crypto.randomUUID();
  const url = buildProviderOAuthUrl({
    channel,
    redirectUri,
    state,
    scopes: ["messages", "conversations", "accounts"],
  });

  return NextResponse.json({ url, state });
}
