/**
 * POST /api/auth/logout — borra la cookie de sesión.
 *
 * Es un POST con formulario (sin JS) desde el header, así que responde con
 * redirect y no con JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
