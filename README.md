# CRM Multicanal

Bandeja única donde entran y se responden **WhatsApp**, **Instagram DM** y
**Facebook Messenger**, con un agente de IA configurable por canal que contesta
solo.

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4
- **Base:** Supabase (Postgres + Auth) con Drizzle ORM. En local corre sobre
  [PGlite](https://pglite.dev) (Postgres real compilado a WASM, sin Docker).
- **Proveedor de mensajería:** Zernio (los tres canales por un solo cliente HTTP).
- **Agente:** un LLM vía OpenRouter, con prompt/herramientas/interruptor por canal.
- **Deploy:** Vercel con Fluid Compute.

Las reglas de arquitectura (canal vs proveedor, conversación como unidad,
identidad sin teléfono, idempotencia, un solo camino de salida, ventana de 24 h
decidida por el servidor) están en [CLAUDE.md](./CLAUDE.md). Léelo antes de
tocar el código.

## Arranque local

```bash
npm install
cp .env.example .env.local   # opcional: todo funciona sin credenciales
npm run db:migrate           # aplica migraciones (PGlite local)
npm run db:seed              # datos de demo (opcional)
npm run dev                  # http://localhost:3000
```

## Verificación

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # build de producción
```

## Scripts

| Script | Qué hace |
| --- | --- |
| `db:migrate` | Aplica `migrations/` contra PGlite (local) o Supabase (`DATABASE_URL`) |
| `db:counts` | Conteo de filas por tabla (verificación de la Fase 1) |
| `db:seed` | Datos de demo: conversaciones y mensajes de los tres canales |
| `db:reset` | Borra la base local y la vuelve a crear (PGlite corrupto o demo fresh) |
| `zernio` | CLI contra la API real: lista cuentas y conversaciones |
| `webhook:register` | Registra/actualiza el webhook por API (busca por nombre) |
| `backfill` | Importa historial del proveedor (sin disparar el agente) |
| `test:webhook` | Prueba de idempotencia del webhook (requiere `npm run dev` corriendo) |

## Puesta en producción (Supabase + Vercel + Zernio)

```bash
npm run db:migrate                                  # crea las 7 tablas en Supabase
# Supabase Dashboard -> SQL Editor -> correr supabase/setup.sql   (Realtime + RLS)
git push                                            # Vercel deploya (migraciones en el build)
npm run webhook:register -- https://tu-app.vercel.app
```

Detalle completo, variables de entorno y tabla de fallos en
[DEPLOY.md](./DEPLOY.md).

## Fases

1. ✅ Modelo de datos y migración
2. Cliente de la API, tipado contra el OpenAPI
3. Webhook entrante y persistencia
4. Bandeja: listar, abrir y responder
5. Agente por canal
6. Deploy, conexión de cuentas y barridos

El detalle de reglas, trampas y decisiones de arquitectura está en
[CLAUDE.md](./CLAUDE.md); el paso a paso de producción en
[DEPLOY.md](./DEPLOY.md).
