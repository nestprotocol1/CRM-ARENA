/**
 * POST /api/auth/login — crea la cookie de sesión.
 *
 * Compara FIRMAS, no contraseñas: así el largo de entrada no filtra nada por
 * timing y no hace falta un compare especial para el caso "vacía".
 *
 * La firma se calcula en src/lib/auth/session.ts, compartida con el
 * middleware: si cada lado la calculara a su manera, la cookie que emite este
 * endpoint no la validaría el middleware.
 *
 * `from` viene del query y se valida: solo se aceptan paths relativos, para
 * que el login no se pueda usar como open redirect.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionCookieOptions, signPassword } from "@/lib/auth/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const password = process.env.CRM_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "la app no tiene CRM_PASSWORD configurada: no hay nada que validar" },
      { status: 400 },
    );
  }

  let provided: string;
  try {
    const body = (await request.json()) as { password?: unknown };
    provided = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const expected = await signPassword(password);
  const candidate = await signPassword(provided);
  if (!safeEqual(candidate, expected)) {
    return NextResponse.json({ error: "contraseña incorrecta" }, { status: 401 });
  }

  const from = request.nextUrl.searchParams.get("from") ?? "/inbox";
  const redirectTo = from.startsWith("/") && !from.startsWith("//") ? from : "/inbox";

  const response = NextResponse.json({ ok: true, redirectTo });
  response.cookies.set(SESSION_COOKIE, expected, sessionCookieOptions());
  return response;
}
