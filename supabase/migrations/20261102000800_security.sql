-- Inmo360 · 0008 · Roles, permisos y RLS
-- Principio: sin acceso anónimo; usuarios solo ven sus datos; el trabajador solo ejecuta su API.

-- Roles propios (sin contraseña: el propietario la define fuera de Git, ver docs/SUPABASE.md)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'inmo_worker') then
    create role inmo_worker nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'inmo_web') then
    create role inmo_web nologin noinherit;   -- solo puede hacer SET ROLE authenticated
  end if;
end $$;
grant authenticated to inmo_web;

-- ---------------------------------------------------------------------------
-- Permisos de tablas (RLS decide las filas)
-- ---------------------------------------------------------------------------
grant usage on schema ingest to authenticated;
grant select on all tables in schema catalog, geo, stats, market to authenticated;
grant select on all tables in schema ingest to authenticated;
grant select, insert, update, delete on all tables in schema invest, scoring, app to authenticated;
grant insert on market.attribute_corrections to authenticated;
grant update (revoked_at) on market.attribute_corrections to authenticated;
grant usage on all sequences in schema invest, scoring, app, market to authenticated;
grant all on all tables in schema catalog, geo, stats, market, ingest, invest, scoring, app to service_role;

-- ---------------------------------------------------------------------------
-- Funciones: nada ejecutable por PUBLIC salvo lo listado
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema ingest, market, stats from public;
do $$ begin
  -- En Supabase anon/authenticated pueden tener privilegios por defecto: se retiran explícitamente.
  execute 'revoke execute on all functions in schema ingest, market, stats from anon, authenticated';
end $$;

grant usage on schema ingest to inmo_worker;
grant execute on function
  ingest.worker_register(text, text, text, text[]),
  ingest.worker_heartbeat(uuid),
  ingest.worker_claim(uuid, text[], int),
  ingest.worker_renew(uuid, uuid, int, jsonb),
  ingest.worker_save_checkpoint(uuid, uuid, text, jsonb),
  ingest.worker_report_issue(uuid, uuid, text, text, text, jsonb),
  ingest.worker_register_snapshot(uuid, uuid, jsonb),
  ingest.worker_submit_geographies(uuid, uuid, jsonb),
  ingest.worker_submit_geo_relations(uuid, uuid, jsonb),
  ingest.worker_submit_observations(uuid, uuid, jsonb),
  ingest.worker_submit_listings(uuid, uuid, jsonb),
  ingest.worker_register_media(uuid, uuid, jsonb),
  ingest.worker_finish(uuid, uuid, text, jsonb, jsonb, boolean, text, boolean)
to inmo_worker;

grant execute on function ingest.enqueue_job(text, text, jsonb, jsonb, int, text), ingest.request_cancel(uuid) to authenticated;
grant execute on function market.confirm_match(bigint, text), market.reject_match(bigint, text), market.undo_match(bigint, text) to authenticated;
grant execute on function app.is_owner(), app.is_member() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables
            where schemaname in ('catalog','geo','stats','ingest','market','invest','scoring','app') loop
    -- ENABLE (no FORCE): el propietario de las tablas (quien ejecuta las migraciones y es dueño de las
    -- funciones SECURITY DEFINER) no queda sujeto a RLS; authenticated/inmo_web sí.
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end $$;

-- Datos de referencia y de mercado: lectura para miembros autorizados
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables
            where schemaname in ('catalog','geo','stats','market') loop
    execute format('create policy member_read on %I.%I for select to authenticated using (app.is_member())',
                   t.schemaname, t.tablename);
  end loop;
end $$;

create policy member_insert on market.attribute_corrections for insert to authenticated
  with check (app.is_member() and author_id = auth.uid());
create policy author_revoke on market.attribute_corrections for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Cola e importaciones: solo el propietario (las escrituras pasan por funciones)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'ingest' loop
    execute format('create policy owner_read on ingest.%I for select to authenticated using (app.is_owner())', t.tablename);
  end loop;
end $$;

-- Tablas con owner_id: cada usuario solo ve y modifica lo suyo
do $$
declare t record;
begin
  for t in select c.table_schema, c.table_name from information_schema.columns c
            join pg_tables p on p.schemaname = c.table_schema and p.tablename = c.table_name
           where c.table_schema in ('invest','scoring','app') and c.column_name = 'owner_id'
             and c.table_name not in ('tax_rules','profiles','score_results') loop
    execute format('create policy own_rows on %I.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t.table_schema, t.table_name);
  end loop;
end $$;

-- Reglas fiscales y perfiles: los del sistema (owner_id null) son de solo lectura
create policy read_system_or_own on invest.tax_rules for select to authenticated using (owner_id is null or owner_id = auth.uid());
create policy write_own on invest.tax_rules for insert to authenticated with check (owner_id = auth.uid());
create policy update_own on invest.tax_rules for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy delete_own on invest.tax_rules for delete to authenticated using (owner_id = auth.uid());

create policy read_system_or_own on scoring.profiles for select to authenticated using (owner_id is null or owner_id = auth.uid());
create policy write_own on scoring.profiles for insert to authenticated with check (owner_id = auth.uid());
create policy update_own on scoring.profiles for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy read_visible on scoring.profile_versions for select to authenticated
  using (exists (select 1 from scoring.profiles p where p.id = profile_id and (p.owner_id is null or p.owner_id = auth.uid())));
create policy write_own on scoring.profile_versions for insert to authenticated
  with check (exists (select 1 from scoring.profiles p where p.id = profile_id and p.owner_id = auth.uid()));

create policy member_rw on scoring.universes for all to authenticated using (app.is_member()) with check (app.is_member());

create policy read_own on scoring.score_results for select to authenticated using (owner_id = auth.uid());
create policy write_own on scoring.score_results for insert to authenticated with check (owner_id = auth.uid());
create policy delete_own on scoring.score_results for delete to authenticated using (owner_id = auth.uid());

-- Perfiles de usuario: cada uno el suyo; el propietario ve todos. No se puede auto-ascender.
create policy self_read on app.user_profiles for select to authenticated using (user_id = auth.uid() or app.is_owner());
revoke insert, update, delete on app.user_profiles from authenticated;

create policy own_prefs on app.preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
