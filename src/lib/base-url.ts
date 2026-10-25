/**
 * El host base sale del REQUEST, nunca de una variable de entorno.
 *
 * REGLA DURA: NO setear APP_BASE_URL en producción. Una URL fija mal puesta
 * (el .env local con localhost:3000 copiado a prod) hace que el agente no
 * conteste nunca, sin un solo error visible en ningún lado.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";

/** Para route handlers: el host sale del request. */
export function baseUrlFromRequest(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/** Para server components / acciones: el host sale de los headers. */
export async function baseUrlFromHeaders(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}
