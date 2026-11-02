-- Inmo360 · 0009 · Indicadores derivados (fórmulas documentadas y probadas)
-- Reglas comunes: denominador nulo, cero o negativo → no disponible con aviso; entradas censuradas o no
-- numéricas → no disponible; nunca se rellena con cero ni se interpola.

create or replace function stats._put_derived(p_ind text, p_geo bigint, p_period text, p_value numeric, p_status text,
                                              p_formula text, p_inputs jsonb, p_method text, p_warn text[] default '{}',
                                              p_dims jsonb default '{}')
returns void language sql as $$
  insert into stats.derived_observations(indicator_code, geography_id, period, dims_key, dims, value_num, value_status,
                                         formula, inputs, method_version, warnings, computed_at)
  values (p_ind, p_geo, p_period, app.dims_key(p_dims), p_dims, p_value, p_status, p_formula, p_inputs, p_method, p_warn, now())
  on conflict (indicator_code, geography_id, period, dims_key, method_version)
  do update set value_num = excluded.value_num, value_status = excluded.value_status, inputs = excluded.inputs,
                warnings = excluded.warnings, computed_at = now()
$$;

-- Crecimiento simple y compuesto de un indicador anual (por defecto población padronal total).
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

-- Densidad: población / superficie de la geometría vigente
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

-- Cociente genérico entre dos indicadores del mismo territorio y periodo
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

-- Estadísticas de oferta observada por municipio: sobre INMUEBLES ÚNICOS (no anuncios), con tamaño de muestra.
-- Precio canónico del inmueble = precio más reciente entre sus anuncios activos (empate → el menor).
create or replace function market.compute_offer_stats(p_min_n int default 5, p_method text default 'offer-v1')
returns int language plpgsql set search_path = pg_catalog, public as $$
declare n int := 0; r record; per text := to_char(now(), 'YYYY-MM');
begin
  for r in
    with prop_price as (
      select distinct on (pl.property_id, l.operation)
             pl.property_id, l.operation, l.geography_id, l.price_amount, l.price_unit,
             coalesce(l.built_area_m2, l.useful_area_m2) as area, l.last_seen_at, l.is_synthetic
        from market.property_listings pl join market.listings l on l.id = pl.listing_id
       where pl.unlinked_at is null and l.status = 'active' and l.geography_id is not null
         and l.price_amount > 0 and l.price_unit in ('sale_total','rent_month')
         and l.property_type not in ('room')
       order by pl.property_id, l.operation, l.last_seen_at desc, l.price_amount asc
    )
    select geography_id, operation, count(*) as n_props, count(*) filter (where area > 0) as n_area,
           percentile_cont(0.5) within group (order by price_amount / nullif(area, 0)) filter (where area > 0) as med,
           percentile_cont(0.25) within group (order by price_amount / nullif(area, 0)) filter (where area > 0) as p25,
           percentile_cont(0.75) within group (order by price_amount / nullif(area, 0)) filter (where area > 0) as p75,
           min(last_seen_at) as oldest, max(last_seen_at) as newest, bool_or(is_synthetic) as any_synth
      from prop_price group by geography_id, operation
  loop
    perform stats._put_derived(case when r.operation = 'sale' then 'mkt.offer_price_sale_m2' else 'mkt.offer_rent_m2' end,
      r.geography_id, per,
      case when r.n_area >= p_min_n then round(r.med::numeric, 2) end,
      case when r.n_area >= p_min_n then 'estimated' else 'not_available' end,
      'mediana de precio/m² de inmuebles únicos con anuncio activo (superficie declarada)',
      jsonb_build_array(jsonb_build_object('n_inmuebles', r.n_props, 'n_con_superficie', r.n_area, 'p25', round(r.p25::numeric, 2),
                                           'p75', round(r.p75::numeric, 2), 'primera_obs', r.oldest, 'ultima_obs', r.newest,
                                           'incluye_sinteticos', r.any_synth)),
      p_method,
      array_remove(array[case when r.n_area < p_min_n then format('muestra insuficiente (n=%s < %s)', r.n_area, p_min_n) end,
                         case when r.any_synth then 'incluye datos sintéticos de prueba' end], null));
    perform stats._put_derived('mkt.active_listings', r.geography_id, per, r.n_props, 'observed',
      'recuento de inmuebles únicos con anuncio activo', jsonb_build_array(jsonb_build_object('n', r.n_props)), p_method, '{}',
      jsonb_build_object('operation', r.operation, 'count_unit', 'properties'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Orquestación desde el trabajador
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
  return res;
end $$;

revoke execute on function ingest.worker_compute_derived(uuid, uuid, text[]) from public;
do $$ begin execute 'revoke execute on function ingest.worker_compute_derived(uuid, uuid, text[]) from anon, authenticated'; end $$;
grant execute on function ingest.worker_compute_derived(uuid, uuid, text[]) to inmo_worker;
revoke execute on all functions in schema stats from public;
grant select on stats.derived_observations to authenticated;
alter table stats.derived_observations enable row level security;
revoke execute on function market.compute_offer_stats(int, text) from public;
do $$ begin execute 'revoke execute on function market.compute_offer_stats(int, text) from anon, authenticated'; end $$;
