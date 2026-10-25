/**
 * Sesión por cookie firmada — UN solo lugar donde se calcula la firma.
 *
 * La firma la tienen que producir dos lados: el endpoint de login (runtime
 * Node) y el middleware (runtime Edge). Si cada uno la calcula a su manera, la
 * cookie que emite uno no la valida el otro y el login "funciona" pero no
 * deja entrar. Por eso vive acá y se usa en los dos.
 *
 * Web Crypto (crypto.subtle) y NO node:crypto: node:crypto no existe en el
 * Edge Runtime, donde corre el middleware. El build no lo detecta —pasa igual—
 * y revienta al primer request. Se comprobó en el dev server.
 */

export const SESSION_COOKIE = "crm_session";
/** Payload fijo: la firma depende solo de la contraseña, no del contenido. */
const SIGNING_PAYLOAD = "crm-arena-v1";
const encoder = new TextEncoder();

/** HMAC-SHA256 de la contraseña, en hex minúscula (igual que node:crypto). */
export async function signPassword(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(SIGNING_PAYLOAD));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Comparación de largo constante. El largo se verifica antes: sin eso, dos
 * strings de distinto largo harían diferir el resultado por longitud.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** true si el valor de la cookie es la firma de esta contraseña. */
export async function cookieValida(cookie: string | undefined, password: string): Promise<boolean> {
  if (!cookie) return false;
  return safeEqual(cookie, await signPassword(password));
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // En producción la cookie va solo por HTTPS; en HTTP de desarrollo la rompería.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
