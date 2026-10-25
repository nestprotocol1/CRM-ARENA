/**
 * GET /api/accounts/oauth-url?channel=whatsapp — devuelve la URL de
 * autorización del proveedor.
 *
 * El redirect_uri se arma con el host DEL REQUEST (regla: nunca URL fija).
 * El cliente llama este endpoint DESPUÉS de abrir el popup de forma
 * sincrónica con el click (ver settings: si se abriera cuando resuelve la
 * promesa, el navegador la bloquea como emergente no solicitada).
 *
 * La URL NO se construye a mano: la pide a GET /v1/connect/{platform}, que
 * exige un profileId.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchProviderOAuthUrl, listProviderProfiles } from "@/lib/zernio";
import { baseUrlFromRequest } from "@/lib/base-url";
import { isChannel } from "@/lib/zernio/types";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const channel = request.nextUrl.searchParams.get("channel");
  if (!channel || !isChannel(channel)) {
    return NextResponse.json({ error: "channel inválido" }, { status: 400 });
  }

  // profileId es obligatorio para /v1/connect/{platform}. Se puede fijar por
  // entorno (cuentas multi-perfil); si no, se usa el primero disponible.
  let profileId = process.env.ZERNIO_PROFILE_ID ?? "";
  if (!profileId) {
    const profiles = await listProviderProfiles();
    if (!profiles.success) {
      return NextResponse.json({ error: `no se pudieron listar perfiles: ${profiles.error}` }, { status: 502 });
    }
    profileId = profiles.data[0]?.id ?? profiles.data[0]?._id ?? "";
    if (!profileId) {
      return NextResponse.json({ error: "el proveedor no devolvió perfiles" }, { status: 502 });
    }
  }

  const redirectUrl = `${baseUrlFromRequest(request)}/api/accounts/callback`;
  const result = await fetchProviderOAuthUrl({ channel, profileId, redirectUrl });
  if (!result.success) {
    return NextResponse.json({ error: `no se pudo armar la URL de OAuth: ${result.error}` }, { status: 502 });
  }

  return NextResponse.json({ url: result.data.authUrl, state: result.data.state ?? null });
}
