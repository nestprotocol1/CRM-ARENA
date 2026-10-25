/**
 * POST /api/backfill — barrido de recuperación.
 *
 * Acepta tanto Authorization: Bearer como un header propio (X-Backfill-Token).
 * Lo llama el cron de GitHub Actions cada 30 minutos (ver .github/workflows).
 *
 * En el barrido el agente NO se dispara: esto es una red de seguridad, no el
 * camino normal.
 */

import { NextRequest, NextResponse } from "next/server";
import { runBackfill } from "@/lib/backfill";

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const token = process.env.BACKFILL_TOKEN;
  if (!token) return false; // sin token configurado, nadie pasa
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const custom = request.headers.get("x-backfill-token");
  return bearer === token || custom === token;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  const result = await runBackfill();
  return NextResponse.json({ ok: true, ...result });
}

/** GET con el mismo auth, para probar el barrido a mano desde el navegador. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  const result = await runBackfill({ maxConversations: 5 });
  return NextResponse.json({ ok: true, ...result });
}
