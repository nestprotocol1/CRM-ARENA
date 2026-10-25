/**
 * Instrumentación de Next: al arrancar el servidor, prepara la base LOCAL
 * (migraciones + datos de demo). En producción con Supabase no hace nada.
 *
 * Además avisa en voz ALTA si el arranque en producción está mal configurado:
 * un mock silencioso en producción es el peor modo de fallo (parece que todo
 * funciona, pero ningún mensaje sale al proveedor real).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureDevData } = await import("./scripts/ensure-dev-data");
    await ensureDevData();
  } catch (error) {
    console.error("[instrumentation] no se pudo preparar la base local:", error);
  }

  if (process.env.VERCEL) {
    if (process.env.ZERNIO_MOCK === "1") {
      console.warn(
        "[arranque] ¡ZERNIO_MOCK=1 en producción! Los mensajes NO salen al proveedor real. " +
          "Borrá la variable en Vercel si querés la API de Zernio de verdad.",
      );
    }
    if (!process.env.ZERNIO_API_KEY) {
      console.warn("[arranque] falta ZERNIO_API_KEY: el proveedor real no va a responder.");
    }
    if (!process.env.ZERNIO_WEBHOOK_SECRET) {
      console.warn(
        "[arranque] falta ZERNIO_WEBHOOK_SECRET: el webhook rechaza TODO por fail-closed.",
      );
    }
    if (!process.env.DATABASE_URL) {
      console.warn(
        "[arranque] falta DATABASE_URL: la app corre sobre PGlite en memoria. " +
          "En Vercel eso significa datos que se pierden en cada request.",
      );
    }
  }
}
