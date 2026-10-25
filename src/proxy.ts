/**
 * Candado de la app: proxy (antes "middleware") de sesión por cookie firmada.
 *
 * Se activa SOLO si `CRM_PASSWORD` está configurada. Sin ella, la app queda
 * abierta (modo desarrollo). No hay tabla de sesiones: la cookie es un HMAC de
 * la contraseña, así que no hay nada que guardar ni invalidar del lado del
 * servidor.
 *
 * REGLA DURA: fail-closed. Si la contraseña está configurada y la cookie no
 * valida, no pasa nada. Y las rutas que NO pueden tener cookie quedan
 * excluidas explícitamente, porque si no, se rompen en silencio:
 *
 *   - /api/webhooks/*   Zernio manda server-to-server. No tiene cookie.
 *                       Si se la pidiéramos, cada evento daría 401 y el CRM
 *                       no recibiría NADA, sin un error visible en la app.
 *   - /api/backfill     Lo llama GitHub Actions con su propio Bearer token.
 *   - /login, /api/auth  La pantalla y el endpoint que justamente crean la cookie.
 *
 * OJO: este archivo corre en el Edge Runtime. Nada de node:crypto — la firma
 * se calcula en src/lib/auth/session.ts con Web Crypto, compartida con el
 * endpoint de login.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, cookieValida } from "@/lib/auth/session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/webhooks/",
  "/api/backfill",
];

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const password = process.env.CRM_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Ya autenticado: el login no tiene nada que ofrecer. Se comprueba ANTES de
  // PUBLIC_PATHS porque /login está en esa lista (sin cookie debe dar 200).
  const signed = await cookieValida(request.cookies.get(SESSION_COOKIE)?.value, password);
  if (pathname === "/login" && signed) {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (signed) {
    return NextResponse.next();
  }

  // Las APIs responden 401 en JSON (el llamador no espera HTML); las páginas
  // redirigen al login guardando a dónde iba.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Pasa todo salvo los assets internos de Next.
  matcher: ["/((?!_next|favicon.ico).*)"],
};
