/**
 * Instrumentación de Next: al arrancar el servidor, prepara la base LOCAL
 * (migraciones + datos de demo). En producción con Supabase no hace nada.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureDevData } = await import("./scripts/ensure-dev-data");
    await ensureDevData();
  } catch (error) {
    console.error("[instrumentation] no se pudo preparar la base local:", error);
  }
}
