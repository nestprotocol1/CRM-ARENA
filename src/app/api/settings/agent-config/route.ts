/**
 * GET  /api/settings/agent-config — configs de agente por canal + global
 * PATCH /api/settings/agent-config — actualiza una config (una pestaña = un canal)
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs } from "@/db/schema";
import { loadAgentConfigRows } from "@/lib/agent/graph";

export async function GET(): Promise<NextResponse> {
  const configs = await loadAgentConfigRows();
  return NextResponse.json({ configs });
}

interface PatchBody {
  channel?: string;
  enabled?: boolean;
  systemPrompt?: string;
  enabledTools?: string[];
  model?: string;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const channel = body.channel?.trim();
  if (!channel) {
    return NextResponse.json({ error: "falta channel" }, { status: 400 });
  }

  const db = await getDb();
  const existing = await db
    .select({ channel: agentConfigs.channel })
    .from(agentConfigs)
    .where(eq(agentConfigs.channel, channel))
    .limit(1);

  const values = {
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
    ...(body.enabledTools !== undefined ? { enabledTools: body.enabledTools } : {}),
    ...(body.model !== undefined ? { model: body.model } : {}),
    updatedAt: new Date(),
  };

  if (existing.length === 0) {
    await db.insert(agentConfigs).values({ channel, ...values });
  } else {
    await db.update(agentConfigs).set(values).where(eq(agentConfigs.channel, channel));
  }

  const configs = await loadAgentConfigRows();
  return NextResponse.json({ ok: true, configs });
}
