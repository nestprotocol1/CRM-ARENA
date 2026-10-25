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
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (provided.length !== expected.length) {
    return { valid: false, reason: "longitud de firma inválida" };
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  const valid = timingSafeEqual(a, b); // comparación de tiempo constante
  return valid ? { valid: true } : { valid: false, reason: "firma no coincide" };
}
