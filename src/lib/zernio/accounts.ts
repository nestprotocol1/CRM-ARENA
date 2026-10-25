/**
 * Cuentas conectadas del proveedor: listado, URL de OAuth y sincronización
 * a la tabla channel_accounts.
 */

import type { Channel, RestAccount } from "./types";
import type { ZernioClient } from "./client";
import { ok, type Result } from "./client";

export interface ListAccountsResponse {
  data: RestAccount[];
}

export async function listAccounts(client: ZernioClient): Promise<Result<RestAccount[]>> {
  const result = await client.get<ListAccountsResponse>("/v1/accounts");
  if (!result.success) return result;
  return ok(result.data.data ?? []);
}

export interface OAuthUrlParams {
  channel: Channel;
  redirectUri: string;
  state: string;
  scopes?: string[];
}

/**
 * Construye la URL de autorización OAuth del proveedor.
 * El host de redirect sale del REQUEST en runtime (ver getBaseUrl), nunca de
 * una variable de entorno fija: una URL fija mal puesta hace que el agente no
 * conteste nunca, sin un solo error visible.
 */
export function buildOAuthUrl(client: ZernioClient, params: OAuthUrlParams): string {
  const url = new URL(client.getBaseUrl() + "/v1/oauth/authorize");
  url.searchParams.set("channel", params.channel);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("response_type", "code");
  if (params.scopes?.length) url.searchParams.set("scope", params.scopes.join(" "));
  return url.toString();
}

export interface SyncAccountsResult {
  created: number;
  updated: number;
  total: number;
}
