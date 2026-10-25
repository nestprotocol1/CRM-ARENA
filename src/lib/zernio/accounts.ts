/**
 * Cuentas conectadas del proveedor: listado, URL de OAuth y perfiles.
 *
 * Endpoints REALES de Zernio:
 *   GET /v1/accounts
 *   GET /v1/profiles
 *   GET /v1/connect/{platform}?profileId=...&redirect_url=... -> {authUrl}
 *
 * OJO: la URL de OAuth NO se construye a mano. La da el proveedor en la
 * respuesta de /v1/connect/{platform}; si la armáramos nosotros, un cambio
 * de su lado rompe el flujo sin un solo error visible.
 */

import type { Channel, RestAccount, RestProfile } from "./types";
import type { ZernioClient } from "./client";
import { err, ok, type Result } from "./client";

export interface ListAccountsResponse {
  accounts?: RestAccount[];
  statusCounts?: { all?: number; disconnected?: number };
}

export async function listAccounts(client: ZernioClient): Promise<Result<RestAccount[]>> {
  const result = await client.get<ListAccountsResponse>("/v1/accounts");
  if (!result.success) return result;
  return ok(result.data.accounts ?? []);
}

/** GET /v1/profiles -> { profiles: [...] } */
export async function listProfiles(client: ZernioClient): Promise<Result<RestProfile[]>> {
  const result = await client.get<{ profiles?: RestProfile[] }>("/v1/profiles");
  if (!result.success) return result;
  return ok(result.data.profiles ?? []);
}

/**
 * Pide al proveedor la URL de autorización para conectar una plataforma.
 * `redirect_url` sale del REQUEST en runtime (ver getBaseUrl en base-url.ts),
 * nunca de una variable de entorno fija.
 */
export async function fetchOAuthUrl(
  client: ZernioClient,
  params: { channel: Channel; profileId: string; redirectUrl: string },
): Promise<Result<{ authUrl: string; state?: string }>> {
  const query: Record<string, string> = { profileId: params.profileId };
  if (params.redirectUrl) query.redirect_url = params.redirectUrl;
  const result = await client.get<{ authUrl?: string; state?: string }>(
    `/v1/connect/${params.channel}`,
    query,
  );
  if (!result.success) return result;
  if (!result.data.authUrl) return err("respuesta sin authUrl");
  return ok({ authUrl: result.data.authUrl, state: result.data.state });
}

export interface SyncAccountsResult {
  created: number;
  updated: number;
  total: number;
}
