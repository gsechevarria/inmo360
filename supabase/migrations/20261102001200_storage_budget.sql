-- Inmo360 · 0012 · Presupuesto de almacenamiento (plan gratuito de Supabase: 500 MB de base de datos)
--
-- Medido en la base aislada con los datos reales importados (padrón 2015-2025, ADRH 2015-2024, VTE 2020-2026):
--   stats.derived_observations ≈ 850 MB (910.000 filas: todos los periodos, incluidos los no calculables)
--   stats.observations         ≈ 400 MB (dos índices únicos casi iguales + una nota de captura repetida por fila)
-- Cambios:
--   1. Los derivados se guardan como FOTO DEL ÚLTIMO PERIODO por indicador/territorio/dimensiones. Son una función
--      determinista de las observaciones (que sí conservan toda la serie), así que la historia se puede recalcular.
--   2. Se elimina el índice único por (recurso, indicador, territorio, periodo, dims, revisión): la unicidad que importa
--      (una sola fila vigente) la garantiza observations_current_uq; la numeración de revisiones se serializa con
--      SELECT … FOR UPDATE en stats.upsert_observation.
--   3. Las notas por fila de las capturas se acortan en el trabajador (la URL y la fecha de captura van en la ejecución).

-- 2 · índice redundante
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'stats.observations'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) ilike '%revision%';
  if c is not null then execute format('alter table stats.observations drop constraint %I', c); end if;
end $$;

-- 1 · derivados: solo el último periodo con dato numérico de la entrada principal
create or replace function stats._latest_numeric_period(p_ind text, p_geo bigint, p_dims text)
returns text language sql stable set search_path = pg_catalog, public as $$
  select max(period) from stats.observations
   where indicator_code = p_ind and geography_id = p_geo and dims_key = p_dims and is_current and value_num is not null
$$;

create or replace function stats.derive_growth(p_out text, p_in text, p_k int, p_compound boolean, p_method text default 'growth-v1')
returns int language plpgsql set search_path = pg_catalog, public as $$
declare n int := 0; r record; v numeric; st text; w text[];
begin
  for r in
    select a.geography_id, a.period, a.id as a_id, a.value_num as a_v, a.value_status as a_s,
           b.id as b_id, b.value_num as b_v, b.value_status as b_s, b.period as b_period
      from stats.observations a
      left join stats.observations b
        on b.indicator_code = a.indicator_code and b.geography_id = a.geography_id and b.dims_key = a.dims_key
       and b.is_current and b.period = (a.period::int - p_k)::text and b.resource_code = a.resource_code
     where a.indicator_code = p_in and a.dims_key = '' and a.is_current and a.period_type = 'year'
       and a.period = stats._latest_numeric_period(p_in, a.geography_id, '')
  loop
    w := '{}'; v := null; st := 'not_available';
    if r.b_id is null then
      w := array['sin dato del año inicial'];
    elsif r.a_v is null or r.b_v is null or r.a_s not in ('observed','provisional','revised','estimated')
          or r.b_s not in ('observed','provisional','revised','estimated') then
      w := array['entrada no numérica o censurada'];
    elsif r.b_v <= 0 or (p_compound and r.a_v <= 0) then
      w := array['denominador cero o negativo'];
    else
      v := case when p_compound then (power(r.a_v / r.b_v, 1.0 / p_k) - 1) * 100 else (r.a_v / r.b_v - 1) * 100 end;
      st := case when 'provisional' in (r.a_s, r.b_s) or 'estimated' in (r.a_s, r.b_s) then 'estimated' else 'observed' end;
    end if;
    perform stats._put_derived(p_out, r.geography_id, r.period, round(v, 6), st,
      case when p_compound then format('(%s[t]/%s[t-%s])^(1/%s) - 1', p_in, p_in, p_k, p_k) else format('%s[t]/%s[t-%s] - 1', p_in, p_in, p_k) end,
      jsonb_build_array(jsonb_build_object('observation_id', r.a_id, 'period', r.period, 'value', r.a_v, 'status', r.a_s),
                        jsonb_build_object('observation_id', r.b_id, 'period', r.b_period, 'value', r.b_v, 'status', r.b_s)),
      p_method, w);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function stats.derive_density(p_method text default 'density-v1')
returns int language plpgsql set search_path = pg_catalog, public as $$
declare n int := 0; r record;
begin
  for r in
    select o.geography_id, o.period, o.id, o.value_num, o.value_status, gm.area_km2, gm.version
      from stats.observations o
      left join lateral (select area_km2, version from geo.geometries g where g.geography_id = o.geography_id
                          and g.resolution = 'full' order by loaded_at desc limit 1) gm on true
     where o.indicator_code = 'pop.padron' and o.dims_key = '' and o.is_current
       and o.period = stats._latest_numeric_period('pop.padron', o.geography_id, '')
  loop
    perform stats._put_derived('demo.density', r.geography_id, r.period,
      case when r.area_km2 > 0 and r.value_num is not null then round(r.value_num / r.area_km2, 4) end,
      case when r.area_km2 > 0 and r.value_num is not null then 'estimated' else 'not_available' end,
      'pop.padron / área km² (geometría vigente)',
      jsonb_build_array(jsonb_build_object('observation_id', r.id, 'value', r.value_num),
                        jsonb_build_object('area_km2', r.area_km2, 'geometry_version', r.version)),
      p_method,
      case when r.area_km2 is null then array['sin geometría'] when r.version like 'es-atlas%'
           then array['superficie de geometría simplificada (es-atlas): densidad aproximada'] else '{}' end);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function stats.derive_ratio(p_out text, p_num text, p_num_dims text, p_den text, p_den_dims text,
                                              p_factor numeric, p_formula text, p_method text default 'ratio-v1',
                                              p_out_dims jsonb default '{}')
returns int language plpgsql set search_path = pg_catalog, public as $$
declare n int := 0; r record; v numeric; st text; w text[];
begin
  for r in
    select a.geography_id, a.period, a.id a_id, a.value_num a_v, a.value_status a_s, b.id b_id, b.value_num b_v, b.value_status b_s
      from stats.observations a
      join stats.observations b on b.geography_id = a.geography_id and b.period = a.period and b.is_current
                               and b.indicator_code = p_den and b.dims_key = p_den_dims
     where a.indicator_code = p_num and a.dims_key = p_num_dims and a.is_current
       and a.period = stats._latest_numeric_period(p_num, a.geography_id, p_num_dims)
  loop
    w := '{}'; v := null; st := 'not_available';
    if r.a_v is null or r.b_v is null then w := array['entrada no numérica, censurada o ausente'];
    elsif r.b_v = 0 then w := array['denominador cero'];
    else v := round(r.a_v / r.b_v * p_factor, 6);
         st := case when r.a_s = 'observed' and r.b_s = 'observed' then 'observed' else 'estimated' end;
    end if;
    perform stats._put_derived(p_out, r.geography_id, r.period, v, st, p_formula,
      jsonb_build_array(jsonb_build_object('observation_id', r.a_id, 'value', r.a_v, 'status', r.a_s),
                        jsonb_build_object('observation_id', r.b_id, 'value', r.b_v, 'status', r.b_s)), p_method, w, p_out_dims);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Poda: por indicador/territorio/dimensiones se conserva el último periodo con valor y, si es más reciente,
-- el último periodo sin valor (para explicar por qué falta). Las estadísticas de oferta conservan su historia mensual.
create or replace function stats.prune_derived(p_codes text[])
returns int language plpgsql set search_path = pg_catalog, public as $$
declare n int;
begin
  with k as (
    select indicator_code, geography_id, dims_key,
           max(period) filter (where value_num is not null) as last_ok, max(period) as last_any
      from stats.derived_observations
     where indicator_code = any(p_codes) and indicator_code not like 'mkt.%'
     group by 1, 2, 3
  )
  delete from stats.derived_observations d using k
   where d.indicator_code = k.indicator_code and d.geography_id = k.geography_id and d.dims_key = k.dims_key
     and d.period is distinct from k.last_ok and d.period <> k.last_any;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function stats.prune_derived(text[]) from public;
revoke execute on function stats._latest_numeric_period(text, bigint, text) from public;

create or replace function ingest.worker_compute_derived(p_run_id uuid, p_token uuid, p_codes text[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; res jsonb := '{}';
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if 'demo.pop_growth_1y' = any(p_codes) then res := res || jsonb_build_object('demo.pop_growth_1y', stats.derive_growth('demo.pop_growth_1y', 'pop.padron', 1, false)); end if;
  if 'demo.pop_growth_5y' = any(p_codes) then res := res || jsonb_build_object('demo.pop_growth_5y', stats.derive_growth('demo.pop_growth_5y', 'pop.padron', 5, false)); end if;
  if 'demo.pop_growth_10y' = any(p_codes) then res := res || jsonb_build_object('demo.pop_growth_10y', stats.derive_growth('demo.pop_growth_10y', 'pop.padron', 10, false)); end if;
  if 'demo.pop_cagr_5y' = any(p_codes) then res := res || jsonb_build_object('demo.pop_cagr_5y', stats.derive_growth('demo.pop_cagr_5y', 'pop.padron', 5, true)); end if;
  if 'demo.pop_cagr_10y' = any(p_codes) then res := res || jsonb_build_object('demo.pop_cagr_10y', stats.derive_growth('demo.pop_cagr_10y', 'pop.padron', 10, true)); end if;
  if 'demo.density' = any(p_codes) then res := res || jsonb_build_object('demo.density', stats.derive_density()); end if;
  if 'demo.masculinity_index' = any(p_codes) then
    res := res || jsonb_build_object('demo.masculinity_index', stats.derive_ratio('demo.masculinity_index', 'pop.padron.by_sex', 'sex=male',
                     'pop.padron.by_sex', 'sex=female', 100, 'hombres / mujeres × 100'));
  end if;
  if 'pop.share.by_sex' = any(p_codes) then
    res := res || jsonb_build_object('pop.share.by_sex:male', stats.derive_ratio('pop.share.by_sex', 'pop.padron.by_sex', 'sex=male',
                     'pop.padron', '', 100, 'hombres / población × 100', 'ratio-v1', '{"sex":"male"}'));
    res := res || jsonb_build_object('pop.share.by_sex:female', stats.derive_ratio('pop.share.by_sex', 'pop.padron.by_sex', 'sex=female',
                     'pop.padron', '', 100, 'mujeres / población × 100', 'ratio-v1', '{"sex":"female"}'));
  end if;
  if 'tour.places_per_dwelling' = any(p_codes) then
    res := res || jsonb_build_object('tour.places_per_dwelling', stats.derive_ratio('tour.places_per_dwelling', 'tour.places', '',
                     'tour.dwellings', '', 1, 'plazas / viviendas turísticas (cociente de valores publicados)'));
  end if;
  if 'market.offer' = any(p_codes) then res := res || jsonb_build_object('market.offer', market.compute_offer_stats()); end if;
  res := res || jsonb_build_object('pruned', stats.prune_derived(p_codes));
  return res;
end $$;
revoke execute on function ingest.worker_compute_derived(uuid, uuid, text[]) from public;
grant execute on function ingest.worker_compute_derived(uuid, uuid, text[]) to inmo_worker;
