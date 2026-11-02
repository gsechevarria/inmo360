-- Inmo360 · 0011 · Trazabilidad de datos sintéticos en derivados
-- Un derivado calculado con anuncios sintéticos de prueba (p. ej. estadísticas de oferta) debe heredar la marca
-- «sintético» para que la web lo señale en cualquier pantalla. Antes solo constaba como aviso en `warnings`.

drop view if exists stats.indicator_coverage;
drop view if exists stats.latest_values;
drop materialized view if exists stats.latest_values_mv;

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
         computed_at, 'derived'::text,
         coalesce((inputs -> 0 ->> 'incluye_sinteticos')::boolean, false) or 'incluye datos sintéticos de prueba' = any(warnings),
         'derived'::text, formula, warnings
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

create view stats.latest_values with (security_barrier = true) as
  select * from stats.latest_values_mv where app.is_member();
grant select on stats.latest_values to authenticated;

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

create or replace view stats.current_values as
select 'observed'::text as kind, o.id, o.indicator_code, o.geography_id, o.period, o.period_end, o.dims_key, o.dims,
       o.value_num, o.value_raw, o.value_status, o.resource_code, o.captured_at, o.is_synthetic, null::text as formula
from stats.observations o where o.is_current
union all
select 'derived', d.id, d.indicator_code, d.geography_id, d.period, null, d.dims_key, d.dims,
       d.value_num, d.value_num::text, d.value_status, null, d.computed_at,
       coalesce((d.inputs -> 0 ->> 'incluye_sinteticos')::boolean, false) or 'incluye datos sintéticos de prueba' = any(d.warnings), d.formula
from stats.derived_observations d;

-- Las vistas ordinarias se evalúan con los permisos de quien consulta (RLS de las tablas base).
-- Excepción deliberada: stats.latest_values y stats.indicator_coverage leen la vista materializada (sin RLS posible)
-- y filtran con app.is_member().
alter view catalog.correspondence_matrix set (security_invoker = true);
alter view geo.current_geographies       set (security_invoker = true);
alter view stats.current_values          set (security_invoker = true);
alter view market.property_listing_view  set (security_invoker = true);
alter view ingest.worker_status          set (security_invoker = true);
