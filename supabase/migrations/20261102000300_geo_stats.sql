-- Inmo360 · 0003 · Territorios, geometrías y observaciones estadísticas

-- ---------------------------------------------------------------------------
-- Territorios. Los códigos son TEXTO (ceros iniciales). Nunca se une por nombre.
-- ---------------------------------------------------------------------------
create table geo.geographies (
  id              bigint generated always as identity primary key,
  level           text not null check (level in ('country','ccaa','province','island','comarca',
                                                  'municipality','district','census_section',
                                                  'non_municipal_area','other')),
  code            text not null check (code ~ '^[0-9A-Za-z._-]+$'),
  name            text not null,
  name_alt        text[] not null default '{}',
  parent_id       bigint references geo.geographies(id),   -- padre jerárquico vigente
  valid_from      date not null default '1900-01-01',
  valid_to        date,                                     -- null = vigente
  version_label   text,                                     -- 'INE padrón 2025', 'IGN 2024'…
  source_resource text references catalog.resources(code),
  has_geometry    boolean not null default false,
  notes           text,
  name_search     text generated always as (lower(name)) stored,
  created_at      timestamptz not null default now(),
  unique (level, code, valid_from)
);
create unique index geographies_current_uq on geo.geographies(level, code) where valid_to is null;
create index on geo.geographies(parent_id);
create index geographies_name_trgm on geo.geographies using gin (name_search extensions.gin_trgm_ops);

-- Relaciones muchos-a-muchos y sucesiones históricas (fusiones, segregaciones, traslados).
create table geo.geography_relations (
  id              bigint generated always as identity primary key,
  parent_id       bigint not null references geo.geographies(id) on delete cascade,
  child_id        bigint not null references geo.geographies(id) on delete cascade,
  relation_type   text not null check (relation_type in ('contains','succeeded_by','merged_into','split_from','moved_to','overlaps','associated')),
  valid_from      date,
  valid_to        date,
  weight          numeric,             -- proporción (p. ej. superficie) si aplica
  note            text,
  source_resource text references catalog.resources(code),
  unique (parent_id, child_id, relation_type, valid_from)
);
create index on geo.geography_relations(child_id);

-- Geometrías por resolución: 'full' (detalle), 'simplified' (escala provincial), 'national'.
create table geo.geometries (
  geography_id    bigint not null references geo.geographies(id) on delete cascade,
  resolution      text not null check (resolution in ('full','simplified','national')),
  version         text not null,
  geom            extensions.geometry(MultiPolygon, 4326) not null,
  centroid        extensions.geometry(Point, 4326),
  area_km2        numeric,
  source_resource text references catalog.resources(code),
  loaded_at       timestamptz not null default now(),
  primary key (geography_id, resolution, version)
);
create index geometries_geom_gix on geo.geometries using gist (geom);
-- Geometría en Web Mercator para teselas MVT (evita reproyectar en cada petición)
alter table geo.geometries add column geom_3857 extensions.geometry(MultiPolygon, 3857)
  generated always as (extensions.st_multi(extensions.st_transform(geom, 3857))::extensions.geometry(MultiPolygon, 3857)) stored;
create index geometries_geom3857_gix on geo.geometries using gist (geom_3857);

-- Vista de territorios vigentes con jerarquía resuelta
create view geo.current_geographies as
select g.id, g.level, g.code, g.name, g.parent_id,
       p.code as parent_code, p.name as parent_name, p.level as parent_level,
       pp.code as grandparent_code, pp.name as grandparent_name,
       g.has_geometry, g.version_label
from geo.geographies g
left join geo.geographies p on p.id = g.parent_id
left join geo.geographies pp on pp.id = p.parent_id
where g.valid_to is null;

-- ---------------------------------------------------------------------------
-- Observaciones en formato largo.
-- ---------------------------------------------------------------------------
create table stats.raw_snapshots (
  id              uuid primary key default extensions.gen_random_uuid(),
  resource_code   text not null references catalog.resources(code),
  import_run_id   uuid,
  url             text,
  fetched_at      timestamptz not null,
  http_status     int,
  content_type    text,
  byte_size       bigint,
  content_sha256  text not null,
  storage_provider text not null default 'local' check (storage_provider in ('local','supabase','none')),
  storage_key     text,                      -- clave relativa en el almacén del trabajador
  capture_method  text not null default 'worker' check (capture_method in ('worker','browser_capture','manual_upload','fixture')),
  notes           text,
  unique (resource_code, content_sha256)
);

create table stats.observations (
  id              bigint generated always as identity primary key,
  resource_code   text not null references catalog.resources(code),
  indicator_code  text not null references catalog.indicators(code),
  geography_id    bigint not null references geo.geographies(id),
  period          text not null,                -- '2025', '2025-Q2', '2025-06', '2025-01-01'
  period_type     text not null check (period_type in ('year','quarter','month','date','range','census')),
  period_start    date,
  period_end      date,
  ref_date        date,                         -- fecha de referencia (padrón: 1 de enero)
  published_at    date,
  captured_at     timestamptz not null,
  dims            jsonb not null default '{}'::jsonb,
  dims_key        text not null default '',
  value_raw       text,                         -- literal original ('<5', '1.234', '..')
  value_num       numeric,                      -- valor numérico cuando procede
  value_status    text not null check (value_status in ('observed','provisional','revised','estimated','censored',
                                                         'suppressed','absent','not_applicable','not_available',
                                                         'pending_interpretation')),
  unit_raw        text,
  scale_raw       text,
  notes           text,
  revision        int not null default 1,
  is_current      boolean not null default true,
  superseded_at   timestamptz,
  import_run_id   uuid,
  raw_snapshot_id uuid references stats.raw_snapshots(id),
  capture_method  text not null default 'worker' check (capture_method in ('worker','browser_capture','manual_upload','fixture')),
  is_synthetic    boolean not null default false,
  constraint numeric_only_when_meaningful check (
    value_num is null or value_status in ('observed','provisional','revised','estimated')
  ),
  unique (resource_code, indicator_code, geography_id, period, dims_key, revision)
);
create unique index observations_current_uq on stats.observations(resource_code, indicator_code, geography_id, period, dims_key) where is_current;
create index observations_lookup on stats.observations(indicator_code, period, dims_key) where is_current;
create index observations_geo on stats.observations(geography_id, indicator_code) where is_current;

-- Inserción idempotente con revisiones: mismo valor => no crea revisión.
create or replace function stats.upsert_observation(o jsonb, p_run uuid)
returns text language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_key text := app.dims_key(o->'dims');
  v_cur stats.observations%rowtype;
  v_num numeric := nullif(o->>'value_num','')::numeric;
begin
  select * into v_cur from stats.observations
   where resource_code = o->>'resource_code' and indicator_code = o->>'indicator_code'
     and geography_id = (o->>'geography_id')::bigint and period = o->>'period'
     and dims_key = v_key and is_current
   for update;
  if found then
    if v_cur.value_raw is not distinct from (o->>'value_raw')
       and v_cur.value_num is not distinct from v_num
       and v_cur.value_status = o->>'value_status' then
      update stats.observations set captured_at = greatest(captured_at, (o->>'captured_at')::timestamptz)
       where id = v_cur.id;
      return 'unchanged';
    end if;
    update stats.observations set is_current = false, superseded_at = now() where id = v_cur.id;
  end if;
  insert into stats.observations(resource_code, indicator_code, geography_id, period, period_type, period_start,
    period_end, ref_date, published_at, captured_at, dims, dims_key, value_raw, value_num, value_status,
    unit_raw, scale_raw, notes, revision, import_run_id, raw_snapshot_id, capture_method, is_synthetic)
  values (o->>'resource_code', o->>'indicator_code', (o->>'geography_id')::bigint, o->>'period', o->>'period_type',
    nullif(o->>'period_start','')::date, nullif(o->>'period_end','')::date, nullif(o->>'ref_date','')::date,
    nullif(o->>'published_at','')::date, (o->>'captured_at')::timestamptz, coalesce(o->'dims','{}'::jsonb), v_key,
    o->>'value_raw', v_num, o->>'value_status', o->>'unit_raw', o->>'scale_raw', o->>'notes',
    coalesce(v_cur.revision, 0) + 1, p_run, nullif(o->>'raw_snapshot_id','')::uuid,
    coalesce(o->>'capture_method','worker'), coalesce((o->>'is_synthetic')::boolean, false));
  return case when v_cur.id is null then 'inserted' else 'revised' end;
end $$;

-- Observaciones derivadas: fórmula, entradas y versión del método.
create table stats.derived_observations (
  id              bigint generated always as identity primary key,
  indicator_code  text not null references catalog.indicators(code),
  geography_id    bigint not null references geo.geographies(id),
  period          text not null,
  dims_key        text not null default '',
  dims            jsonb not null default '{}'::jsonb,
  value_num       numeric,
  value_status    text not null check (value_status in ('observed','estimated','not_available','pending_interpretation','censored')),
  formula         text not null,
  inputs          jsonb not null,               -- [{observation_id, indicator_code, period, value_num, value_status}]
  method_version  text not null,
  warnings        text[] not null default '{}',
  computed_at     timestamptz not null default now(),
  unique (indicator_code, geography_id, period, dims_key, method_version)
);
create index derived_lookup on stats.derived_observations(indicator_code, period, dims_key);

-- Valor vigente unificado (observado o derivado) para pantallas y filtros.
create view stats.current_values as
select 'observed'::text as kind, o.id, o.indicator_code, o.geography_id, o.period, o.period_end, o.dims_key, o.dims,
       o.value_num, o.value_raw, o.value_status, o.resource_code, o.captured_at, o.is_synthetic, null::text as formula
from stats.observations o where o.is_current
union all
select 'derived', d.id, d.indicator_code, d.geography_id, d.period, null, d.dims_key, d.dims,
       d.value_num, d.value_num::text, d.value_status, null, d.computed_at, false, d.formula
from stats.derived_observations d;
