/**
 * Cliente HTTP base de Zernio — fetch nativo, sin SDK.
 *
 * REGLA DURA: nunca tirar excepciones. Un canal caído no puede voltear el
 * request entero. Todo devuelve Result.
 */

export type Result<T> = { success: true; data: T } | { success: false; error: string };

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function err<T = never>(error: string): Result<T> {
  return { success: false, error };
}

export interface ZernioClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Timeout por request. El webhook tiene 5s de presupuesto: esto es para
   *  barridos y CLI, no para el camino del webhook. */
  timeoutMs?: number;
}

export class ZernioClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: ZernioClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** GET que devuelve Result. No tira. */
  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<Result<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    return this.request<T>("GET", url.toString());
  }

  /** POST que devuelve Result. No tira. */
  async post<T>(path: string, body?: unknown): Promise<Result<T>> {
    return this.request<T>("POST", this.baseUrl + path, body);
  }

  /** PUT que devuelve Result. No tira. */
  async put<T>(path: string, body?: unknown): Promise<Result<T>> {
    return this.request<T>("PUT", this.baseUrl + path, body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      const json: unknown = text ? safeJsonParse(text) : null;
      if (!response.ok) {
        const detail =
          typeof json === "object" && json !== null && "message" in json
            ? String((json as { message: unknown }).message)
            : text.slice(0, 300);
        return err(`${method} ${url} -> ${response.status}: ${detail}`);
      }
      return ok(json as T);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return err(`${method} ${url} falló: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

/**
 * Construye el cliente desde el entorno. Mock mode se resuelve en index.ts.
 * Base REAL de Zernio: https://zernio.com/api (los recursos van con /v1/...).
 */
export function clientFromEnv(): ZernioClient {
  const baseUrl = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api";
  const apiKey = process.env.ZERNIO_API_KEY ?? "";
  return new ZernioClient({ baseUrl, apiKey });
}
