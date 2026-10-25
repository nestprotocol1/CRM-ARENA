/**
 * GET /api/accounts/callback?code=...&state=... — vuelta del OAuth del
 * proveedor. Intercambia el código, sincroniza la cuenta a channel_accounts
 * y muestra el resultado en una ventana que se puede cerrar.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { usingMockProvider } from "@/lib/zernio";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return htmlPage("No se pudo conectar la cuenta", error ?? "falta el código");
  }

  // En modo mock no hay intercambio real: se sintetiza una cuenta para poder
  // probar el flujo completo. Con el proveedor real, acá va el POST al
  // endpoint de token y después el GET /accounts para sincronizar.
  if (usingMockProvider()) {
    const db = await getDb();
    const channel = request.nextUrl.searchParams.get("channel") ?? "whatsapp";
    const externalId = `acc_oauth_${channel}_${Date.now()}`;
    await db
      .insert(channelAccounts)
      .values({
        provider: "zernio",
        channel: channel as "whatsapp" | "instagram" | "facebook",
        externalId,
        name: `Cuenta ${channel} (OAuth mock)`,
        status: "connected",
      })
      .onConflictDoNothing();
    return htmlPage("Cuenta conectada", `${externalId}. Ya podés cerrar esta ventana.`);
  }

  // Proveedor real: el intercambio de código vive en el cliente HTTP
  // (src/lib/zernio). Al conectar una cuenta real, agregar acá:
  //   1. POST /v1/oauth/token con el code -> access token
  //   2. GET /v1/accounts con el token -> cuenta conectada
  //   3. upsert en channel_accounts
  return htmlPage(
    "OAuth real pendiente",
    "Conectá el intercambio de código contra la API de Zernio en esta ruta.",
  );
}

function htmlPage(title: string, message: string): NextResponse {
  const html = `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
    <h2>${title}</h2><p>${message}</p>
    <script>setTimeout(() => window.close(), 1500)</script>
  </body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}
