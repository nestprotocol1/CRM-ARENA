# Deploy y puesta en producción

Guía completa: **Supabase -> Vercel -> Zernio**. El orden importa: las tablas
tienen que existir antes de que la app reciba tráfico.

---

## 1. Supabase: crear las tablas

Las migraciones de Drizzle (`migrations/`) crean las 7 tablas. Se aplican con
la connection string del **transaction-mode pooler** (puerto 6543, IPv4-only):

```bash
# desde la raíz del repo, con DATABASE_URL en .env.local (ya está)
npm run db:migrate
```

Idempotente: drizzle lleva el journal y aplica solo lo pendiente. Se puede
correr en cada deploy sin romper nada.

**Datos de demo (opcional):** `npm run db:seed` siembra 3 cuentas y 7
conversaciones para que la bandeja no arranque vacía. En producción real NO
correr: ensucia los conteos.

### 1.1 Realtime + RLS (una sola vez)

`npm run db:migrate` crea las tablas pero **no** publica Realtime ni toca RLS.
Eso vive en `supabase/setup.sql`:

```
Supabase Dashboard -> SQL Editor -> New query -> pegar supabase/setup.sql -> Run
```

Hace tres cosas, todas idempotentes:

1. Publica las 7 tablas en `supabase_realtime` (la bandeja se actualiza sola,
   sin polling de 5s).
2. `replica identity full` en `conversations` y `messages` para que los DELETE
   lleguen completos por Realtime.
3. Habilita RLS en todas las tablas y crea UNA política permisiva por tabla.

> **Las políticas son permisivas a propósito.** Realtime con la llave
> publishable exige que `anon` pueda leer las filas, y la auth de la app hoy es
> un gate por contraseña (`CRM_PASSWORD`), no Supabase Auth. Es aceptable para
> el proyecto de prueba. Para un proyecto real: Supabase Auth + políticas con
> `auth.uid()`.

---

## 2. Vercel

1. Importar el repo en Vercel.
2. **Verificar que Fluid Compute esté activo** en Settings -> Functions.
   Sin eso las funciones cortan a los 60 segundos y el backfill devuelve 504.
3. Variables de entorno (Settings -> Environment Variables):

   | Variable | Valor |
   | --- | --- |
   | `DATABASE_URL` | `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | llave **publishable** (`sb_publishable_…`) |
   | `ZERNIO_API_KEY` | key del proveedor (`sk_…`) |
   | `ZERNIO_WEBHOOK_SECRET` | el secreto que elegiste para el webhook |
   | `ZERNIO_BASE_URL` | `https://zernio.com/api` (o vacío: es el default) |
   | `OPENROUTER_API_KEY` | key de OpenRouter (el LLM del agente) |
   | `BACKFILL_TOKEN` | token del barrido (Bearer o `X-Backfill-Token`) |
   | `CRM_PASSWORD` | contraseña del candado de la app. **Vacío = app abierta** (ver 2.1) |

4. **NO setear `ZERNIO_MOCK` en producción.** Vacío = API real de Zernio.
   Con `ZERNIO_MOCK=1` la app arranca con un log de advertencia: los mensajes
   no salen al proveedor.

5. **NO setear `APP_BASE_URL`.** El host sale del request
   (`src/lib/base-url.ts`). Una URL fija mal puesta hace que el agente no
   conteste nunca, sin un solo error visible.

6. Migraciones en el build: `vercel.json` corre `npm run db:migrate` antes de
   `npm run build`, solo si `DATABASE_URL` está definida. Si preferés correrlas
   a mano, borrá la clave `buildCommand` de `vercel.json`.

### 2.1 El candado: `CRM_PASSWORD`

`src/proxy.ts` corre en cada request. **Si `CRM_PASSWORD` está definida, todo
lo que no sea público pide cookie de sesión; si está vacía, la app queda
abierta** (por eso en desarrollo no molesta).

Públicas siempre (las necesita el mundo exterior, no el navegador):

| Ruta | Por qué |
| --- | --- |
| `/login` | la pantalla que entrega la cookie |
| `/api/auth/login`, `/api/auth/logout` | el endpoint que firma la cookie y el que la borra |
| `/api/webhooks/*` | Zernio manda server-to-server: no tiene cookie. Si se la pidiéramos cada evento daría 401 y **el CRM no recibiría nada**, sin un error visible en la app |
| `/api/backfill` | lo llama GitHub Actions con su propio `Bearer` |

Detalles que importan:

- La cookie es un **HMAC de la contraseña** (`src/lib/auth/session.ts`, Web
  Crypto). No hay tabla de sesiones que invalidar: cambiar `CRM_PASSWORD`
  invalida todas las cookies de golpe.
- **No se comparan contraseñas, se comparan firmas** (largo constante), así el
  tiempo de respuesta no filtra el largo ni el contenido.
- Las APIs responden `401` en JSON; las páginas redirigen a
  `/login?from=<ruta>` y al entrar vuelven a esa ruta.
- Para entrar: `/login`. Para salir: botón **Salir** del header.
- Si olvidás la contraseña, se cambia la variable en Vercel y se redespliega:
  a los usuarios logueados les va a pedir entrar de nuevo.

---

## 3. Registrar el webhook

**Por API (recomendado):**

```bash
npm run webhook:register -- https://crmarena.vercel.app
```

Hace `POST /v1/webhooks/settings` con `{name, url, secret, events}` y actualiza
por nombre si ya existe.

**A mano en el panel de Zernio** ("New Webhook"):

| Campo | Valor |
| --- | --- |
| Name | `crm-arena-zernio` |
| URL | `https://crmarena.vercel.app/api/webhooks/zernio` |
| Secret | el mismo valor de `ZERNIO_WEBHOOK_SECRET` |
| Events | `message.received`, `message.sent`, `message.delivered`, `message.read`, `message.failed`, `conversation.started`, `conversation.control_changed`, `account.connected`, `account.disconnected` |

La URL tiene que ser pública **antes** de crear el webhook: Zernio hace una
entrega de prueba al guardar y apuntar a localhost falla.

---

## 4. Conectar cuentas

Ajustes -> pestaña del canal -> "Conectar cuenta". El popup se abre de forma
SINCRÓNA con el click (si se abriera cuando resuelve la promesa, el navegador
lo bloquea como emergente no solicitada).

---

## 5. Importar el historial

Después de conectar cada cuenta, importar el historial que el proveedor ya
replicó (no llega por webhook):

```bash
curl -X POST https://crmarena.vercel.app/api/backfill \
  -H "Authorization: Bearer $BACKFILL_TOKEN"
```

**En la importación el agente NO se dispara.** Contestarle a cientos de
clientes viejos de golpe es un desastre difícil de explicar.

## 6. Barrido de recuperación (red de seguridad)

`.github/workflows/backfill.yml` corre cada 30 minutos contra
`POST /api/backfill`. Configurar en el repo los secrets `APP_URL` y
`BACKFILL_TOKEN`.

El cron es cada 30 minutos a propósito: GitHub Actions factura por minuto
redondeado hacia arriba por ejecución. Cada 10 minutos costaría USD 18,56/mes;
cada 30 minutos entra en el tramo gratis y alcanza, porque esto es una red de
seguridad y no el camino normal.

---

## Verificación después de deployar

**El candado** (si seteaste `CRM_PASSWORD`; si la dejaste vacía, saltá este bloque):

1. `https://<tu-dominio>/inbox` **sin** entrar redirige a `/login?from=/inbox`.
2. `https://<tu-dominio>/api/webhooks/zernio` responde **401** sin firma
   (fail-closed). **Ojo:** esto tiene que ser `401 {"error":"firma inválida"}`,
   no un redirect a `/login` — si redirige, el gate se está comiendo al webhook
   y Zernio nunca podría entregar nada.
3. Entrar con la contraseña correcta: vuelve a `/inbox` y aparece el header
   con **Bandeja**, **Ajustes** y **Salir**. Con la contraseña incorrecta,
   `401` y no pasa nada.

**La app:**

4. `/inbox` muestra las conversaciones (si sembraste demo, las 7).
5. Con la bandeja vacía, el empty state explica el siguiente paso en vez de
   quedar en blanco: distingue "no hay cuentas conectadas" (manda a Ajustes)
   de "hay cuentas pero todavía no llegó nada".
6. Enviar un mensaje real por WhatsApp a la cuenta conectada: aparece en la
   bandeja en segundos (Realtime, sin recargar).
7. Si el agente está prendido en ese canal, contesta solo.
8. `GET /api/webhooks/zernio` no lista eventos sin procesar.
9. En los logs de Vercel NO debe aparecer el aviso de `ZERNIO_MOCK=1`.

## Si algo falla

| Síntoma | Causa probable |
| --- | --- |
| `insufficient_permissions` + `required_group: "messages"` al crear el webhook | la key no tiene el grupo de mensajería; se pide en el panel de Zernio |
| `/v1/inbox/*` da error de addon | falta habilitar el addon de inbox en la cuenta de Zernio |
| Error de contraseña al migrar | la contraseña del pooler puede incluir corchetes literales |
| `relation "conversations" does not exist` | no corrió `db:migrate` (o `supabase/setup.sql` antes) |
| Rate limit `131056` en WhatsApp | ~10 msg/min por destinatario; fuera de 24h va plantilla obligatoria |
| La bandeja no se actualiza sola | faltó correr `supabase/setup.sql` (publicación de Realtime) |
