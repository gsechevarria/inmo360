-- Inmo360 · 0010 · Agregados para la web: último valor disponible por indicador y territorio, cobertura y teselas MVT

create index if not exists derived_geo on stats.derived_observations(geography_id, indicator_code);

-- Último dato DISPONIBLE (con número) por indicador/territorio/dimensiones; si no hay ninguno, la fila más reciente
-- para poder mostrar su estado. Observado tiene prioridad sobre derivado para el mismo código.
create materialized view stats.latest_values_mv as
with obs as (
  select distinct on (indicator_code, geography_id, dims_key)
         indicator_code, geography_id, dims_key, period, value_num, value_raw, value_status, resource_code,
         captured_at as as_of, 'observed'::text as kind, is_synthetic, capture_method, null::text as formula, null::text[] as warnings
    from stats.observations where is_current
   order by indicator_code, geography_id, dims_key, (value_num is null), period desc
), der as (
  select distinct on (indicator_code, geography_id, dims_key)
         indicator_code, geography_id, dims_key, period, value_num, value_num::text, value_status, 'derived.inmo360'::text,
         computed_at, 'derived'::text, false, 'derived'::text, formula, warnings
    from stats.derived_observations
   order by indicator_code, geography_id, dims_key, (value_num is null), period desc, computed_at desc
)
select * from obs
union all
select d.* from der d
 where not exists (select 1 from obs o where o.indicator_code = d.indicator_code and o.geography_id = d.geography_id and o.dims_key = d.dims_key);

create unique index latest_values_mv_uq on stats.latest_values_mv(indicator_code, geography_id, dims_key);
create index latest_values_mv_geo on stats.latest_values_mv(geography_id);
revoke all on stats.latest_values_mv from public, anon, authenticated;

-- Acceso solo para miembros (las vistas materializadas no admiten RLS)
create view stats.latest_values with (security_barrier = true) as
  select * from stats.latest_values_mv where app.is_member();
grant select on stats.latest_values to authenticated;

create or replace function stats.refresh_latest() returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  refresh materialized view concurrently stats.latest_values_mv;
end $$;
revoke execute on function stats.refresh_latest() from public;

-- El cálculo de derivados refresca el agregado al terminar
create or replace function ingest.worker_refresh_latest(p_run_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform ingest._assert_lease(p_run_id, p_token);
  perform stats.refresh_latest();
end $$;
revoke execute on function ingest.worker_refresh_latest(uuid, uuid) from public;
grant execute on function ingest.worker_refresh_latest(uuid, uuid) to inmo_worker;

create or replace function stats.owner_refresh_latest() returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not app.is_owner() then raise exception 'FORBIDDEN'; end if;
  perform stats.refresh_latest();
end $$;
revoke execute on function stats.owner_refresh_latest() from public;
grant execute on function stats.owner_refresh_latest() to authenticated;

-- Cobertura por indicador (n territorios con dato en su último periodo / universo de municipios vigentes)
create view stats.indicator_coverage with (security_barrier = true) as
select lv.indicator_code,
       count(*) filter (where lv.value_num is not null) as n_with_value,
       (select count(*) from geo.geographies g where g.level = 'municipality' and g.valid_to is null) as n_universe,
       min(lv.period) filter (where lv.value_num is not null) as period_min,
       max(lv.period) filter (where lv.value_num is not null) as period_max,
       bool_or(lv.is_synthetic) as any_synthetic,
       max(lv.as_of) as last_update
  from stats.latest_values_mv lv
  join geo.geographies g on g.id = lv.geography_id and g.level = 'municipality'
 where lv.dims_key = '' and app.is_member()
 group by lv.indicator_code;
grant select on stats.indicator_coverage to authenticated;

-- Teselas vectoriales de territorios con el valor de un indicador (sin dependencia de teselas externas)
create or replace function geo.zone_tile(z int, x int, y int, p_level text, p_indicator text, p_dims text default '')
returns bytea language sql stable parallel safe set search_path = pg_catalog, public, extensions as $$
  with b as (select st_tileenvelope(z, x, y) as env),
  t as (
    select st_asmvtgeom(
             case when z < 9 then st_simplify(gm.geom_3857, 40075016.0 / (256 * 2 ^ z) * 0.6) else gm.geom_3857 end,
             b.env, 4096, 64, true) as geom,
           g.code, g.name, g.level, lv.value_num::float8 as value, lv.period, lv.value_status as status
      from geo.geometries gm
      join geo.geographies g on g.id = gm.geography_id and g.valid_to is null and g.level = p_level
      cross join b
      left join stats.latest_values lv on lv.geography_id = g.id and lv.indicator_code = p_indicator and lv.dims_key = p_dims
     where gm.resolution = 'full' and gm.geom_3857 && b.env
  )
  select coalesce((select st_asmvt(t.*, 'zones', 4096, 'geom') from t where geom is not null), ''::bytea)
$$;
grant execute on function geo.zone_tile(int, int, int, text, text, text) to authenticated;
