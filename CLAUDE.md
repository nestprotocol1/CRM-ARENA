# CLAUDE.md — CRM Multicanal (WhatsApp · Instagram · Messenger)

> Archivo vivo. Cada decisión que no se deduce del código se anota acá.
> Si una regla de abajo se contradice con algo del código, gana este archivo
> hasta que se cambie conscientemente.

## Qué es

Una bandeja única donde entran y se responden WhatsApp, Instagram DM y Facebook
Messenger, con un agente de IA configurable por canal que contesta solo.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn-style UI (Radix)
- Supabase (Postgres + Auth) con Drizzle ORM
- Zernio como proveedor único de los tres canales — docs.zernio.com
- Un LLM vía OpenRouter para el agente
- Deploy en Vercel (Fluid Compute activo)
- Base local sin Docker: PGlite (Postgres real compilado a WASM). Con
  `DATABASE_URL` presente se usa postgres-js contra Supabase. Mismo schema,
  mismas migraciones.

## El modelo conceptual (no negociable)

1. **CANAL y PROVEEDOR son dos ejes distintos.**
   `channel` = la red que ve la persona (`whatsapp | instagram | facebook`).
   `provider` = por dónde viaja el mensaje (`zernio | meta | ...`).
   Columnas separadas siempre. Van a convivir combinaciones distintas.

2. **La unidad NO es el contacto: es la CONVERSACIÓN.**
   La misma persona puede tener un hilo de WhatsApp y otro de Instagram y no se
   mezclan. Rutas e historial del agente van por `conversationId`, nunca por
   `contactId`.

3. **La identidad NO es el teléfono.**
   Instagram y Messenger no tienen número. `contact_identities` con
   `(channel, external_id)` único resuelve el contacto. En WhatsApp el teléfono
   puede venir nulo: se ancla en el id que da el proveedor.

## Reglas duras

Romper cualquiera de estas no produce un error: produce mensajes que se pierden
en silencio, que es mucho peor.

- **Antes de escribir el cliente HTTP, tipar contra el OpenAPI real**
  (`openapi/zernio.yaml`). No adivinar nombres de campos en el código. La forma
  que llega por webhook y la que devuelve el REST casi nunca coinciden: son dos
  tipos distintos, no uno.
- **El webhook tiene 5 segundos para devolver 2xx.** Persistir inline (es un
  INSERT) y hacer el trabajo pesado después de responder, con `after()`. El
  grafo del agente se importa de forma DINÁMICA dentro del `after()`: arriba
  del archivo, el cold start se come el presupuesto.
- **La entrega es at-least-once.** Reclamar cada evento por su id en
  `webhook_events` con `INSERT ... ON CONFLICT DO NOTHING RETURNING` antes de
  procesarlo. Si no insertó, es reintento: 200 y cortar.
- **El índice único de idempotencia de mensajes va sobre `external_id` SOLO**,
  no sobre `(provider, external_id)`. Si algún día se migra de proveedor, el
  mismo id entra por dos webhooks y con clave compuesta se duplica. El índice es
  PARCIAL (`where external_id is not null`): si no, los mensajes salientes
  propios chocan entre sí antes de tener id.
- **UN SOLO camino de salida:** `deliverMessage(conversationId, ...)` envía Y
  persiste. Si cada lugar inserta por su cuenta, se desincronizan.
- **Un agente por canal**, con su prompt, sus herramientas y su interruptor, en
  `agent_configs`. Los canales nuevos arrancan APAGADOS.
- **La ventana de 24 horas de Meta la decide el SERVIDOR** desde
  `last_inbound_at`. Fuera de ventana: WhatsApp solo admite plantilla aprobada;
  Instagram y Messenger admiten texto libre con etiqueta de agente humano
  durante 7 días.
- **Verificar la firma HMAC del webhook sobre el body CRUDO.** Parsear y
  volver a serializar rompe la firma. Sin secreto configurado: fail-closed
  (rechazar todo).

## Cómo se trabaja

- Por fases. Al terminar cada una: typecheck + lint + build de producción
  limpios antes de seguir. No avanzar si la anterior no compila.
- Rutas por `conversationId`, nunca por `contactId`.
- Iconos de marca (WhatsApp/Instagram/Messenger): SVG inline. Las librerías de
  iconos ya no los incluyen por licencia.
- `APP_BASE_URL` NO se setea en producción: el host sale del request.
- Verificación contra la API real, no contra supuestos. Un webhook que responde
  200 no prueba nada; lo que prueba es la fila en la base.

## Fases

1. Modelo de datos y migración ✅
2. Cliente de la API, tipado contra el OpenAPI
3. Webhook entrante y persistencia
4. Bandeja: listar, abrir y responder
5. Agente por canal
6. Deploy, conexión de cuentas y barridos

## Las cinco trampas (ninguna da error)

1. Adivinar nombres de campos del proveedor → cada mensaje entrante se descarta.
2. Índice de idempotencia compuesto `(provider, external_id)` → duplicados al migrar de proveedor.
3. Dos caminos de salida (agente inserta por un lado, UI por otro) → respuestas que no figuran en el historial.
4. URL base fija (`localhost:3000` copiada a prod) → el agente no contesta jamás, sin errores.
5. Cron cada 10 min en GitHub Actions → USD 18,56/mes (factura por minuto redondeado hacia arriba). Cada 30 min entra gratis y alcanza.

## Entorno (.env.local, nunca en git)

```
# Base: vacío = PGlite local en .data/pglite. Con URL = Supabase.
DATABASE_URL=
# Proveedor
ZERNIO_API_KEY=
ZERNIO_BASE_URL=https://api.zernio.com
ZERNIO_WEBHOOK_SECRET=
ZERNIO_MOCK=1            # 1 = adaptador mock local (sin red)
# Agente
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# Barridos (Bearer o X-Backfill-Token)
BACKFILL_TOKEN=
# Gate simple de la app (placeholder de Supabase Auth). Vacío = abierto en dev.
CRM_PASSWORD=
```
