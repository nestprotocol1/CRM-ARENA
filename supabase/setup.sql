-- ============================================================================
--  CRM ARENA — setup de Supabase (idempotente: se puede correr varias veces)
-- ============================================================================
--  Este archivo hace lo que drizzle-kit NO hace y que el CRM necesita para
--  producción:
--
--    1. PUBLICAR las tablas en `supabase_realtime` para que la bandeja se
--       actualice sola (sin polling de 5s).
--    2. Activar RLS y dejar políticas explícitas.
--    3. `replica identity full` para que los DELETE lleguen completos por
--       realtime.
--
--  CÓMO SE CORRE (una sola vez, antes de recibir tráfico):
--    Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run
--  o:  psql "$DATABASE_URL" -f supabase/setup.sql
--
--  ORDEN con las migraciones:
--    1) npm run db:migrate      (crea las 7 tablas)
--    2) este archivo            (realtime + RLS)
--    3) npm run db:seed         (datos de demo, opcional)
--
--  ---------------------------------------------------------------------------
--  DECISIÓN DE SEGURIDAD (leer antes de correr en un proyecto real)
--  ---------------------------------------------------------------------------
--  La autenticación de la app hoy es un gate simple por contraseña
--  (CRM_PASSWORD), NO Supabase Auth. Realtime con la llave publishable exige
--  que `anon` pueda leer las filas, así que las políticas de abajo son
--  PERMISIVAS a propósito: cualquiera con la llave publishable (que es pública
--  por diseño) puede leer y escribir.
--
--  Es aceptable para el proyecto de PRUEBA (que se borra). Para un proyecto
--  real hay que: (a) poner Supabase Auth, (b) cambiar las políticas para que
--  dependan de auth.uid(), y (c) dejar de exponer la publishable key.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Realtime: publicar las tablas
--    Idempotente: si la tabla ya está en la publicación, la excepción se
--    atrapa y se sigue.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'conversations', 'messages', 'contacts',
    'contact_identities', 'channel_accounts', 'agent_configs', 'webhook_events'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
      raise notice 'realtime: % publicada', t;
    exception
      when duplicate_object then
        raise notice 'realtime: % ya estaba publicada', t;
      when undefined_table then
        raise notice 'realtime: % no existe todavía (¿corriste db:migrate?)', t;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Replica identity FULL
--    Sin esto, los eventos DELETE por realtime llegan sin el registro viejo.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['conversations', 'messages']
  loop
    execute format('alter table %I replica identity full', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. RLS + políticas
--    Se habilita RLS en todas las tablas (nunca quedan "abiertas por
--    descuido") y se agrega UNA política permisiva explícita por tabla, con el
--    motivo escrito arriba. Si algún día llega Supabase Auth, se borran estas
--    políticas y se reemplazan por otras con auth.uid().
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'conversations', 'messages', 'contacts',
    'contact_identities', 'channel_accounts', 'agent_configs', 'webhook_events'
  ]
  loop
    -- RLS ON
    execute format('alter table %I enable row level security', t);
    -- Política permisiva única (idempotente por el drop previo)
    execute format('drop policy if exists %I on %I', 'crm_arena_all_' || t, t);
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      'crm_arena_all_' || t, t
    );
    raise notice 'rls: % con política crm_arena_all_%', t, t;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Verificación (debe listar las 7 tablas)
-- ----------------------------------------------------------------------------
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
