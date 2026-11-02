-- Inmo360 · 0006 · Cola de importación, ejecuciones, incidencias y API del trabajador
-- El trabajador (rol inmo_worker) NO tiene acceso a tablas: solo ejecuta ingest.worker_*.

create table ingest.workers (
  id                uuid primary key default extensions.gen_random_uuid(),
  name              text not null unique,
  hostname          text,
  version           text,
  capabilities      text[] not null default '{}',
  registered_at     timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  revoked_at        timestamptz,
  note              text
);

create table ingest.schedules (
  id           uuid primary key default extensions.gen_random_uuid(),
  job_type     text not null,
  source_code  text not null,
  scope        jsonb not null default '{}'::jsonb,
  params       jsonb not null default '{}'::jsonb,
  every_hours  int not null check (every_hours between 1 and 24*31),
  next_run_at  timestamptz not null,
  enabled      boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

create table ingest.jobs (
  id                 uuid primary key default extensions.gen_random_uuid(),
  job_type           text not null check (job_type ~ '^[a-z0-9_.]+$'),
  source_code        text not null,
  scope_requested    jsonb not null default '{}'::jsonb,
  params             jsonb not null default '{}'::jsonb,
  priority           int not null default 100,
  status             text not null default 'pending'
    check (status in ('pending','running','completed','partial','failed','cancelled')),
  attempts           int not null default 0,
  max_attempts       int not null default 4 check (max_attempts between 1 and 20),
  progress           jsonb not null default '{}'::jsonb,
  last_error         text,
  idempotency_key    text unique,
  schedule_id        uuid references ingest.schedules(id) on delete set null,
  not_before         timestamptz not null default now(),
  next_retry_at      timestamptz,
  current_run_id     uuid,
  worker_id          uuid references ingest.workers(id),
  lease_expires_at   timestamptz,
  cancel_requested_at timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index jobs_claimable on ingest.jobs(priority desc, created_at) where status in ('pending','running');
create trigger trg_jobs_upd before update on ingest.jobs for each row execute function app.touch_updated_at();

create table ingest.runs (
  id                uuid primary key default extensions.gen_random_uuid(),
  job_id            uuid not null references ingest.jobs(id) on delete cascade,
  worker_id         uuid not null references ingest.workers(id),
  attempt           int not null,
  lease_token       uuid not null default extensions.gen_random_uuid(),
  lease_expires_at  timestamptz not null,
  started_at        timestamptz not null default now(),
  heartbeat_at      timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running'
    check (status in ('running','completed','partial','failed','cancelled','lease_lost')),
  stats             jsonb not null default '{}'::jsonb,
  scope_covered     jsonb not null default '{}'::jsonb,
  coverage_complete boolean not null default false,
  error             text
);
create index on ingest.runs(job_id, started_at desc);

create table ingest.issues (
  id          bigint generated always as identity primary key,
  job_id      uuid references ingest.jobs(id) on delete cascade,
  run_id      uuid references ingest.runs(id) on delete cascade,
  severity    text not null check (severity in ('info','warning','error')),
  code        text not null,
  message     text not null,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on ingest.issues(job_id, created_at desc);

create table ingest.checkpoints (
  job_id      uuid not null references ingest.jobs(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  run_id      uuid,
  updated_at  timestamptz not null default now(),
  primary key (job_id, key)
);

-- ---------------------------------------------------------------------------
-- Funciones internas
-- ---------------------------------------------------------------------------
create or replace function ingest._backoff_seconds(p_attempt int) returns int
language sql immutable as $$ select least(3600, 30 * (2 ^ greatest(p_attempt - 1, 0))::int) $$;

-- Valida que la ejecución es la vigente del trabajo y que su reserva no ha caducado (fencing).
create or replace function ingest._assert_lease(p_run_id uuid, p_token uuid)
returns ingest.jobs language plpgsql set search_path = pg_catalog, public as $$
declare v_run ingest.runs; v_job ingest.jobs;
begin
  select * into v_run from ingest.runs where id = p_run_id;
  if not found or v_run.lease_token <> p_token then
    raise exception 'LEASE_INVALID' using errcode = 'P0001';
  end if;
  select * into v_job from ingest.jobs where id = v_run.job_id for update;
  if v_job.current_run_id is distinct from p_run_id or v_run.status <> 'running' then
    raise exception 'LEASE_LOST: la ejecución ya no es la vigente' using errcode = 'P0001';
  end if;
  if v_run.lease_expires_at < now() then
    raise exception 'LEASE_EXPIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from ingest.workers w where w.id = v_run.worker_id and w.revoked_at is not null) then
    raise exception 'WORKER_REVOKED' using errcode = 'P0001';
  end if;
  return v_job;
end $$;

-- ---------------------------------------------------------------------------
-- API del trabajador
-- ---------------------------------------------------------------------------
create or replace function ingest.worker_register(p_name text, p_hostname text, p_version text, p_capabilities text[])
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  if p_name !~ '^[A-Za-z0-9._-]{1,64}$' then raise exception 'WORKER_NAME_INVALID'; end if;
  insert into ingest.workers(name, hostname, version, capabilities, last_heartbeat_at)
  values (p_name, left(p_hostname, 128), left(p_version, 32), coalesce(p_capabilities, '{}'), now())
  on conflict (name) do update set hostname = excluded.hostname, version = excluded.version,
       capabilities = excluded.capabilities, last_heartbeat_at = now()
  returning id into v_id;
  if exists (select 1 from ingest.workers where id = v_id and revoked_at is not null) then
    raise exception 'WORKER_REVOKED';
  end if;
  return v_id;
end $$;

create or replace function ingest.worker_heartbeat(p_worker_id uuid)
returns timestamptz language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update ingest.workers set last_heartbeat_at = now() where id = p_worker_id and revoked_at is null;
  if not found then raise exception 'WORKER_UNKNOWN_OR_REVOKED'; end if;
  -- Materializa trabajos programados vencidos (idempotente por clave)
  insert into ingest.jobs(job_type, source_code, scope_requested, params, schedule_id, idempotency_key)
  select s.job_type, s.source_code, s.scope, s.params, s.id, 'sched:' || s.id || ':' || to_char(s.next_run_at, 'YYYYMMDDHH24MI')
    from ingest.schedules s where s.enabled and s.next_run_at <= now()
  on conflict (idempotency_key) do nothing;
  update ingest.schedules set next_run_at = next_run_at + make_interval(hours => every_hours)
   where enabled and next_run_at <= now();
  return now();
end $$;

-- Reserva atómica: un único trabajador obtiene cada trabajo (SKIP LOCKED).
create or replace function ingest.worker_claim(p_worker_id uuid, p_job_types text[], p_lease_seconds int default 120)
returns table(job_id uuid, run_id uuid, lease_token uuid, lease_expires_at timestamptz, job_type text, source_code text,
              scope_requested jsonb, params jsonb, attempt int, checkpoints jsonb)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; v_run ingest.runs; v_lease int := greatest(30, least(coalesce(p_lease_seconds,120), 900));
begin
  if not exists (select 1 from ingest.workers w where w.id = p_worker_id and w.revoked_at is null) then
    raise exception 'WORKER_UNKNOWN_OR_REVOKED';
  end if;
  update ingest.workers set last_heartbeat_at = now() where id = p_worker_id;

  loop
    select * into v_job from ingest.jobs j
     where j.job_type = any(p_job_types)
       and j.cancel_requested_at is null
       and ((j.status = 'pending' and j.not_before <= now() and coalesce(j.next_retry_at, now()) <= now())
         or (j.status = 'running' and j.lease_expires_at < now()))
     order by j.priority desc, j.created_at
     for update skip locked
     limit 1;
    if not found then return; end if;

    if v_job.status = 'running' then
      -- Reserva caducada: la ejecución anterior pierde el derecho a escribir.
      update ingest.runs set status = 'lease_lost', finished_at = now(), error = 'reserva caducada'
       where id = v_job.current_run_id and status = 'running';
      insert into ingest.issues(job_id, run_id, severity, code, message)
      values (v_job.id, v_job.current_run_id, 'warning', 'LEASE_EXPIRED', 'La reserva caducó; se reasigna el trabajo.');
      if v_job.attempts >= v_job.max_attempts then
        update ingest.jobs set status = 'failed', last_error = 'Agotados los intentos tras caducar la reserva',
               current_run_id = null, lease_expires_at = null, finished_at = now() where id = v_job.id;
        continue;
      end if;
    end if;
    exit;
  end loop;

  insert into ingest.runs(job_id, worker_id, attempt, lease_expires_at)
  values (v_job.id, p_worker_id, v_job.attempts + 1, now() + make_interval(secs => v_lease))
  returning * into v_run;

  update ingest.jobs set status = 'running', attempts = attempts + 1, current_run_id = v_run.id,
         worker_id = p_worker_id, lease_expires_at = v_run.lease_expires_at, last_error = null
   where id = v_job.id;

  return query select v_job.id, v_run.id, v_run.lease_token, v_run.lease_expires_at, v_job.job_type, v_job.source_code,
                      v_job.scope_requested, v_job.params, v_run.attempt,
                      coalesce((select jsonb_object_agg(c.key, c.value) from ingest.checkpoints c where c.job_id = v_job.id), '{}'::jsonb);
end $$;

-- Renovación de reserva + progreso. Devuelve true si se ha pedido cancelar (cancelación cooperativa).
create or replace function ingest.worker_renew(p_run_id uuid, p_token uuid, p_lease_seconds int default 120, p_progress jsonb default null)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; v_exp timestamptz := now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds,120), 900)));
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  update ingest.runs set lease_expires_at = v_exp, heartbeat_at = now() where id = p_run_id;
  update ingest.jobs set lease_expires_at = v_exp, progress = coalesce(p_progress, progress) where id = v_job.id;
  update ingest.workers set last_heartbeat_at = now() where id = v_job.worker_id;
  return v_job.cancel_requested_at is not null;
end $$;

create or replace function ingest.worker_save_checkpoint(p_run_id uuid, p_token uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if p_key !~ '^[A-Za-z0-9:._-]{1,128}$' then raise exception 'CHECKPOINT_KEY_INVALID'; end if;
  insert into ingest.checkpoints(job_id, key, value, run_id) values (v_job.id, p_key, p_value, p_run_id)
  on conflict (job_id, key) do update set value = excluded.value, run_id = excluded.run_id, updated_at = now();
end $$;

create or replace function ingest.worker_report_issue(p_run_id uuid, p_token uuid, p_severity text, p_code text, p_message text, p_context jsonb default '{}')
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  insert into ingest.issues(job_id, run_id, severity, code, message, context)
  values (v_job.id, p_run_id, p_severity, left(p_code, 64), left(p_message, 2000), coalesce(p_context, '{}'));
end $$;

-- Instantánea bruta (solo metadatos y huella; los bytes quedan en el almacén local)
create or replace function ingest.worker_register_snapshot(p_run_id uuid, p_token uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; v_id uuid;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if (p_item->>'storage_key') ~ '(^[A-Za-z]:|^[/\\]|\.\.)' then raise exception 'STORAGE_KEY_INVALID'; end if;
  insert into stats.raw_snapshots(resource_code, import_run_id, url, fetched_at, http_status, content_type, byte_size,
                                  content_sha256, storage_provider, storage_key, capture_method, notes)
  values (p_item->>'resource_code', p_run_id, p_item->>'url', (p_item->>'fetched_at')::timestamptz,
          (p_item->>'http_status')::int, p_item->>'content_type', (p_item->>'byte_size')::bigint, p_item->>'content_sha256',
          coalesce(p_item->>'storage_provider','local'), p_item->>'storage_key', coalesce(p_item->>'capture_method','worker'),
          p_item->>'notes')
  on conflict (resource_code, content_sha256) do update set fetched_at = greatest(stats.raw_snapshots.fetched_at, excluded.fetched_at)
  returning id into v_id;
  return v_id;
end $$;

-- Territorios: alta/actualización por (nivel, código). Nunca por nombre.
create or replace function ingest.worker_submit_geographies(p_run_id uuid, p_token uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare v_job ingest.jobs; it jsonb; v_parent bigint; v_id bigint; n_ins int := 0; n_upd int := 0; n_geom int := 0; n_rej int := 0;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then raise exception 'BATCH_INVALID'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_parent := null;
      if it ? 'parent_level' then
        select id into v_parent from geo.geographies
         where level = it->>'parent_level' and code = it->>'parent_code' and valid_to is null;
        if v_parent is null then raise exception 'PARENT_NOT_FOUND %:%', it->>'parent_level', it->>'parent_code'; end if;
      end if;
      if it ? 'valid_to' then   -- territorio histórico: cualquier versión con ese código
        select id into v_id from geo.geographies where level = it->>'level' and code = it->>'code'
         order by valid_to nulls first limit 1;
      else
        select id into v_id from geo.geographies where level = it->>'level' and code = it->>'code' and valid_to is null;
      end if;
      if v_id is null then
        insert into geo.geographies(level, code, name, name_alt, parent_id, valid_from, valid_to, version_label, source_resource, notes)
        values (it->>'level', it->>'code', it->>'name',
                coalesce((select array_agg(x) from jsonb_array_elements_text(it->'name_alt') x), '{}'),
                v_parent, coalesce((it->>'valid_from')::date, '1900-01-01'), (it->>'valid_to')::date,
                it->>'version_label', it->>'resource_code', it->>'notes')
        returning id into v_id;
        n_ins := n_ins + 1;
      elsif not coalesce((it->>'only_if_missing')::boolean, false) then
        update geo.geographies set name = it->>'name', parent_id = coalesce(v_parent, parent_id),
               version_label = coalesce(it->>'version_label', version_label),
               notes = coalesce(it->>'notes', notes)
         where id = v_id;
        n_upd := n_upd + 1;
      end if;
      if it ? 'geometry_geojson' then
        insert into geo.geometries(geography_id, resolution, version, geom, centroid, area_km2, source_resource)
        select v_id, r.resolution, it->>'geometry_version', g.geom, st_pointonsurface(g.geom),
               st_area(g.geom::geography) / 1e6, it->>'resource_code'
          from (select st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(it->>'geometry_geojson'), 4326)), 3))::geometry(MultiPolygon,4326) as geom) g,
               (select unnest(coalesce((select array_agg(x) from jsonb_array_elements_text(it->'geometry_resolutions') x),
                                       array['full'])) as resolution) r
        on conflict (geography_id, resolution, version) do update set geom = excluded.geom, centroid = excluded.centroid,
               area_km2 = excluded.area_km2, loaded_at = now();
        update geo.geographies set has_geometry = true where id = v_id;
        n_geom := n_geom + 1;
      end if;
    exception when others then
      n_rej := n_rej + 1;
      insert into ingest.issues(job_id, run_id, severity, code, message, context)
      values (v_job.id, p_run_id, 'error', 'GEO_REJECTED', sqlerrm, jsonb_build_object('level', it->>'level', 'code', it->>'code'));
    end;
  end loop;
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'geometries', n_geom, 'rejected', n_rej);
end $$;

-- Relaciones territoriales (sucesiones, traslados…)
create or replace function ingest.worker_submit_geo_relations(p_run_id uuid, p_token uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; it jsonb; n int := 0; v_p bigint; v_c bigint;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  for it in select * from jsonb_array_elements(p_items) loop
    select id into v_p from geo.geographies where level = it->>'parent_level' and code = it->>'parent_code' order by valid_to nulls first limit 1;
    select id into v_c from geo.geographies where level = it->>'child_level' and code = it->>'child_code' order by valid_to nulls first limit 1;
    if v_p is null or v_c is null then
      insert into ingest.issues(job_id, run_id, severity, code, message, context)
      values (v_job.id, p_run_id, 'warning', 'GEO_REL_UNRESOLVED', 'Relación con territorio desconocido', it);
      continue;
    end if;
    insert into geo.geography_relations(parent_id, child_id, relation_type, valid_from, note, source_resource)
    values (v_p, v_c, it->>'relation_type', (it->>'valid_from')::date, it->>'note', it->>'resource_code')
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Observaciones estadísticas (idempotente con revisiones)
create or replace function ingest.worker_submit_observations(p_run_id uuid, p_token uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; it jsonb; v_geo bigint; v_res text; n_ins int := 0; n_rev int := 0; n_same int := 0; n_rej int := 0;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then raise exception 'BATCH_INVALID'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      select id into v_geo from geo.geographies
       where level = it->>'geography_level' and code = it->>'geography_code'
       order by (valid_to is null) desc, valid_from desc limit 1;
      if v_geo is null then raise exception 'GEOGRAPHY_NOT_FOUND %:%', it->>'geography_level', it->>'geography_code'; end if;
      if not exists (select 1 from catalog.resource_indicators ri
                      where ri.resource_code = it->>'resource_code' and ri.indicator_code = it->>'indicator_code') then
        raise exception 'MAPPING_NOT_DECLARED %→%', it->>'resource_code', it->>'indicator_code';
      end if;
      v_res := stats.upsert_observation(it || jsonb_build_object('geography_id', v_geo), p_run_id);
      if v_res = 'inserted' then n_ins := n_ins + 1; elsif v_res = 'revised' then n_rev := n_rev + 1; else n_same := n_same + 1; end if;
    exception when others then
      n_rej := n_rej + 1;
      if n_rej <= 50 then
        insert into ingest.issues(job_id, run_id, severity, code, message, context)
        values (v_job.id, p_run_id, 'error', 'OBS_REJECTED', sqlerrm,
                jsonb_build_object('indicator', it->>'indicator_code', 'geo', it->>'geography_code', 'period', it->>'period'));
      end if;
    end;
  end loop;
  return jsonb_build_object('inserted', n_ins, 'revised', n_rev, 'unchanged', n_same, 'rejected', n_rej);
end $$;

-- Cierre de ejecución. Una ejecución parcial NUNCA marca como no observados los anuncios que no recorrió.
create or replace function ingest.worker_finish(p_run_id uuid, p_token uuid, p_status text, p_stats jsonb,
                                                p_scope_covered jsonb, p_coverage_complete boolean,
                                                p_error text default null, p_retryable boolean default false)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; v_run ingest.runs; v_final text; v_not_obs int := 0;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  select * into v_run from ingest.runs where id = p_run_id;
  if p_status not in ('completed','partial','failed','cancelled') then raise exception 'STATUS_INVALID'; end if;

  if p_status = 'completed' and coalesce(p_coverage_complete, false) and v_job.job_type like 'listings.%' then
    with gone as (
      update market.listings l set status = 'not_observed', status_changed_at = now(), last_checked_at = now()
       where l.source_code = v_job.source_code and l.status = 'active' and l.last_seen_at < v_run.started_at
         and (not (p_scope_covered ? 'agency_ids')
              or l.agency_id::text in (select jsonb_array_elements_text(p_scope_covered->'agency_ids')))
         and (not (p_scope_covered ? 'municipality_codes')
              or l.geography_id in (select g.id from geo.geographies g where g.level = 'municipality'
                                      and g.code in (select jsonb_array_elements_text(p_scope_covered->'municipality_codes'))))
         and (not (p_scope_covered ? 'agency_source_ids')
              or l.agency_id in (select a.id from market.agencies a where a.source_code = v_job.source_code
                                   and a.source_agency_id in (select jsonb_array_elements_text(p_scope_covered->'agency_source_ids'))))
         and (not (p_scope_covered ? 'operations')
              or l.operation in (select jsonb_array_elements_text(p_scope_covered->'operations')))
         and (p_scope_covered ? 'agency_ids' or p_scope_covered ? 'agency_source_ids'
              or p_scope_covered ? 'municipality_codes')  -- exige ámbito explícito
      returning l.id
    )
    insert into market.listing_events(listing_id, event_type, run_id, new_value)
    select id, 'not_observed', p_run_id, jsonb_build_object('scope', p_scope_covered) from gone;
    get diagnostics v_not_obs = row_count;
  end if;

  v_final := case
    when p_status = 'failed' and p_retryable and v_job.attempts < v_job.max_attempts then 'pending'
    else p_status end;

  update ingest.runs set status = p_status, finished_at = now(),
         stats = coalesce(p_stats, '{}') || jsonb_build_object('not_observed', v_not_obs),
         scope_covered = coalesce(p_scope_covered, '{}'), coverage_complete = coalesce(p_coverage_complete, false),
         error = left(p_error, 4000)
   where id = p_run_id;

  update ingest.jobs set status = v_final, current_run_id = null, lease_expires_at = null,
         last_error = left(p_error, 4000),
         next_retry_at = case when v_final = 'pending' then now() + make_interval(secs => ingest._backoff_seconds(attempts)) end,
         finished_at = case when v_final <> 'pending' then now() end
   where id = v_job.id;
  return v_final;
end $$;

-- ---------------------------------------------------------------------------
-- Operaciones del propietario desde la web
-- ---------------------------------------------------------------------------
create or replace function ingest.enqueue_job(p_job_type text, p_source_code text, p_scope jsonb, p_params jsonb,
                                              p_priority int default 100, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  if not app.is_owner() then raise exception 'FORBIDDEN'; end if;
  insert into ingest.jobs(job_type, source_code, scope_requested, params, priority, idempotency_key, created_by)
  values (p_job_type, p_source_code, coalesce(p_scope,'{}'), coalesce(p_params,'{}'), p_priority, p_idempotency_key, auth.uid())
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from ingest.jobs where idempotency_key = p_idempotency_key; end if;
  return v_id;
end $$;

create or replace function ingest.request_cancel(p_job_id uuid)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_status text;
begin
  if not app.is_owner() then raise exception 'FORBIDDEN'; end if;
  update ingest.jobs set cancel_requested_at = now(),
         status = case when status = 'pending' then 'cancelled' else status end,
         finished_at = case when status = 'pending' then now() else finished_at end
   where id = p_job_id and status in ('pending','running')
  returning status into v_status;
  return coalesce(v_status, 'not_cancellable');
end $$;

-- Estado de los trabajadores para el panel (sin inventar ejecuciones activas)
create view ingest.worker_status as
select w.id, w.name, w.hostname, w.version, w.capabilities, w.last_heartbeat_at, w.revoked_at,
       case when w.revoked_at is not null then 'revoked'
            when w.last_heartbeat_at > now() - interval '2 minutes' then 'online'
            else 'offline' end as connection,
       (select count(*) from ingest.jobs j where j.worker_id = w.id and j.status = 'running' and j.lease_expires_at > now()) as active_jobs
from ingest.workers w;
