# Deploy y puesta en producción

## 1. Vercel

1. Importar el repo en Vercel.
2. **Verificar que Fluid Compute esté activo** en Settings -> Functions.
   Sin eso las funciones cortan a los 60 segundos y el backfill devuelve 504.
3. Variables de entorno (Settings -> Environment Variables):

   | Variable | Valor |
   | --- | --- |
   | `DATABASE_URL` | connection string de Supabase (pooler, puerto 6543) |
   | `ZERNIO_API_KEY` | key del proveedor |
   | `ZERNIO_BASE_URL` | `https://zernio.com/api` (base real; el default del código ya es esta) |
   | `ZERNIO_WEBHOOK_SECRET` | secreto para la firma HMAC |
   | `OPENROUTER_API_KEY` | key de OpenRouter |
   | `BACKFILL_TOKEN` | token del barrido (Bearer o `X-Backfill-Token`) |

4. **NO setear `APP_BASE_URL`.** El host sale del request
   (`src/lib/base-url.ts`). Una URL fija mal puesta hace que el agente no
   conteste nunca, sin un solo error visible.

5. Migraciones: con `DATABASE_URL` presente, `npm run db:migrate` corre
   contra Supabase. El flujo es: correr la migración UNA vez (local con la
   URL de Supabase, o desde el shell de Vercel) antes de recibir tráfico.

## 2. Registrar el webhook POR API (no a mano en el panel)

```bash
npm run webhook:register -- https://tu-app.vercel.app
```

Busca por nombre y actualiza si ya existe: los proveedores no suelen validar
URLs duplicadas y terminarías recibiendo cada evento dos o tres veces.

## 3. Conectar cuentas

Ajustes -> pestaña del canal -> "Conectar cuenta". El popup se abre de forma
SINCRÓNA con el click (si se abriera cuando resuelve la promesa, el navegador
lo bloquea como emergente no solicitada).

## 4. Importar el historial

Después de conectar cada cuenta, importar el historial que el proveedor ya
replicó (no llega por webhook):

```bash
# a mano:
curl -X POST https://tu-app.vercel.app/api/backfill \
  -H "Authorization: Bearer $BACKFILL_TOKEN"
```

**En la importación el agente NO se dispara.** Contestarle a cientos de
clientes viejos de golpe es un desastre difícil de explicar.

## 5. Barrido de recuperación (red de seguridad)

`.github/workflows/backfill.yml` corre cada 30 minutos contra
`POST /api/backfill`. Configurar en el repo los secrets `APP_URL` y
`BACKFILL_TOKEN`.

El cron es cada 30 minutos a propósito: GitHub Actions factura por minuto
redondeado hacia arriba por ejecución. Cada 10 minutos costaría USD 18,56/mes;
cada 30 minutos entra en el tramo gratis y alcanza, porque esto es una red de
seguridad y no el camino normal.

## Verificación después de deployar

1. `GET /api/webhooks/zernio` tiene que responder 401 sin firma (fail-closed).
2. Enviar un mensaje real por WhatsApp a la cuenta conectada: tiene que
   aparecer en la bandeja en segundos.
3. Si el agente está prendido en ese canal, contesta solo.
4. `GET /api/webhooks/zernio` no debería listar eventos sin procesar.
