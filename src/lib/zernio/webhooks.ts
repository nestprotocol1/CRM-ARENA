/**
 * Verificación de la firma HMAC del webhook.
 *
 * REGLA DURA: la firma se verifica sobre el body CRUDO. Si se parsea el JSON
 * y se vuelve a serializar, la firma nunca valida. Sin secreto configurado:
 * FAIL-CLOSED (rechazar todo), nunca aceptar todo.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * @param rawBody  body crudo tal cual llegó (string o Buffer)
 * @param signature header de firma del proveedor (X-Zernio-Signature o similar)
 * @param secret   secreto del webhook. Vacío => rechaza.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  secret: string | undefined,
): VerifyResult {
  if (!secret) {
    // Fail-closed: sin secreto configurado se rechaza todo.
    return { valid: false, reason: "ZERNIO_WEBHOOK_SECRET no configurado (fail-closed)" };
  }
  if (!signature) {
    return { valid: false, reason: "header de firma ausente" };
  }

  // Chequeo de longitud previo: timingSafeEqual tira si los buffers difieren
  // de largo, y eso además filtra basura antes de comparar.
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expectedHex = createHmac("sha256", secret).update(body).digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;

  // Zernio manda la firma en X-Zernio-Signature. Aceptamos hex (lo más
  // habitual) y base64, porque no se pudo verificar el formato exacto contra
  // la API real desde el entorno de desarrollo.
  const candidates = [
    Buffer.from(expectedHex, "utf8"),
    Buffer.from(createHmac("sha256", secret).update(body).digest("base64"), "utf8"),
  ];
  const providedBuf = Buffer.from(provided, "utf8");
  for (const expected of candidates) {
    if (expected.length === providedBuf.length && timingSafeEqual(expected, providedBuf)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "firma no coincide" };
}
