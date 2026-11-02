-- Inmo360 · 0007 · Ingesta de anuncios, deduplicación reversible y medios

-- Campos seguidos para huella y cambios (orden estable)
create or replace function market._tracked(it jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'url', it->>'url', 'operation', it->>'operation',
    'price_amount', nullif(it#>>'{price,amount}','')::numeric, 'price_unit', it#>>'{price,unit}',
    'price_unit_note', it#>>'{price,unit_note}',
    'property_type', it->>'property_type', 'title', it->>'title', 'description_md5', md5(coalesce(it->>'description','')),
    'built_area_m2', nullif(it->>'built_area_m2','')::numeric, 'useful_area_m2', nullif(it->>'useful_area_m2','')::numeric,
    'plot_area_m2', nullif(it->>'plot_area_m2','')::numeric,
    'rooms', nullif(it->>'rooms','')::int, 'bathrooms', nullif(it->>'bathrooms','')::int, 'floor_text', it->>'floor_text',
    'has_elevator', (it->>'has_elevator')::boolean, 'has_terrace', (it->>'has_terrace')::boolean,
    'has_parking', (it->>'has_parking')::boolean, 'has_storage', (it->>'has_storage')::boolean,
    'has_pool', (it->>'has_pool')::boolean, 'has_ac', (it->>'has_ac')::boolean,
    'condition', it->>'condition', 'energy_rating', it->>'energy_rating', 'year_built', nullif(it->>'year_built','')::int,
    'lat', nullif(it#>>'{location,lat}','')::numeric, 'lon', nullif(it#>>'{location,lon}','')::numeric,
    'location_precision', coalesce(it#>>'{location,precision}','unknown'), 'address_text', it#>>'{location,address_text}',
    'postal_code', it#>>'{location,postal_code}', 'municipality_code', it#>>'{location,municipality_code}',
    'published_at_declared', it->>'published_at_declared', 'agency_reference', it->>'agency_reference',
    'image_count', nullif(it->>'image_count','')::int)
$$;

create or replace function ingest.worker_submit_listings(p_run_id uuid, p_token uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_job ingest.jobs; it jsonb; tr jsonb; old_tr jsonb; v_hash text; l market.listings; v_geo bigint; v_agency uuid;
  v_prop uuid; v_pt geometry; v_now timestamptz := now(); v_changed uuid[] := '{}'; v_keys text[];
  n_new int := 0; n_upd int := 0; n_same int := 0; n_rej int := 0; n_price int := 0; n_reap int := 0; n_wd int := 0; n_cand int := 0;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'BATCH_INVALID'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if coalesce(it->>'external_id','') = '' then raise exception 'EXTERNAL_ID_MISSING'; end if;
      if it->>'source_code' is distinct from v_job.source_code then raise exception 'SOURCE_MISMATCH'; end if;
      if it#>>'{price,unit}' is null then raise exception 'PRICE_UNIT_MISSING'; end if;
      if it->>'operation' = 'sale' and it#>>'{price,unit}' <> 'sale_total' and it#>>'{price,unit}' <> 'other' then
        raise exception 'PRICE_UNIT_INCOHERENT';
      end if;
      tr := market._tracked(it);
      v_hash := md5(tr::text);

      -- Territorio por código INE (texto) o por punto exacto. Nunca por nombre.
      v_geo := null;
      if tr->>'municipality_code' ~ '^[0-9]{5}$' then
        select id into v_geo from geo.geographies where level = 'municipality' and code = tr->>'municipality_code' and valid_to is null;
      end if;
      v_pt := case when tr->>'lat' is not null and tr->>'lon' is not null
                   then st_setsrid(st_makepoint((tr->>'lon')::float8, (tr->>'lat')::float8), 4326) end;
      if v_geo is null and v_pt is not null and tr->>'location_precision' in ('exact','street') then
        select g.id into v_geo from geo.geometries gm join geo.geographies g on g.id = gm.geography_id
         where g.level = 'municipality' and g.valid_to is null and gm.resolution = 'full' and st_contains(gm.geom, v_pt) limit 1;
      end if;

      -- Agencia (sin datos personales: nombre comercial y web)
      v_agency := null;
      if it ? 'agency' and coalesce(it#>>'{agency,source_agency_id}','') <> '' then
        insert into market.agencies(source_code, source_agency_id, name, website, website_domain, discovered_via)
        values (v_job.source_code, it#>>'{agency,source_agency_id}', coalesce(it#>>'{agency,name}', it#>>'{agency,source_agency_id}'),
                it#>>'{agency,website}', it#>>'{agency,website_domain}', it#>>'{agency,discovered_via}')
        on conflict (source_code, source_agency_id) do update set name = excluded.name,
               website = coalesce(excluded.website, market.agencies.website)
        returning id into v_agency;
      end if;

      select * into l from market.listings where source_code = v_job.source_code and external_id = it->>'external_id' for update;

      if not found then
        insert into market.listings(source_code, external_id, url, agency_id, agency_reference, operation, price_amount, price_unit,
          price_unit_note, property_type, title, description, built_area_m2, useful_area_m2, plot_area_m2, rooms, bathrooms,
          floor_text, has_elevator, has_terrace, has_parking, has_storage, has_pool, has_ac, condition, energy_rating, year_built,
          location, location_precision, address_text, postal_code, geography_id, published_at_declared, first_seen_at,
          last_seen_at, last_checked_at, content_hash, image_count, extra, is_synthetic, created_run_id, last_run_id)
        values (v_job.source_code, it->>'external_id', tr->>'url', v_agency, tr->>'agency_reference', tr->>'operation',
          (tr->>'price_amount')::numeric, tr->>'price_unit', tr->>'price_unit_note', coalesce(tr->>'property_type','unknown'),
          tr->>'title', it->>'description', (tr->>'built_area_m2')::numeric, (tr->>'useful_area_m2')::numeric,
          (tr->>'plot_area_m2')::numeric, (tr->>'rooms')::int, (tr->>'bathrooms')::int, tr->>'floor_text',
          (tr->>'has_elevator')::boolean, (tr->>'has_terrace')::boolean, (tr->>'has_parking')::boolean,
          (tr->>'has_storage')::boolean, (tr->>'has_pool')::boolean, (tr->>'has_ac')::boolean,
          coalesce(tr->>'condition','unknown'), tr->>'energy_rating', (tr->>'year_built')::int, v_pt,
          tr->>'location_precision', tr->>'address_text', tr->>'postal_code', v_geo, (tr->>'published_at_declared')::date,
          coalesce((it->>'observed_at')::timestamptz, v_now), coalesce((it->>'observed_at')::timestamptz, v_now), v_now,
          v_hash, (tr->>'image_count')::int, coalesce(it->'extra','{}'), coalesce((it->>'is_synthetic')::boolean, false),
          p_run_id, p_run_id)
        returning * into l;
        insert into market.properties(geography_id, location, location_precision, is_synthetic)
        values (v_geo, v_pt, tr->>'location_precision', l.is_synthetic) returning id into v_prop;
        insert into market.property_listings(property_id, listing_id, link_type) values (v_prop, l.id, 'initial');
        insert into market.listing_snapshots(listing_id, observed_at, run_id, content_hash, price_amount, price_unit, data)
        values (l.id, l.first_seen_at, p_run_id, v_hash, l.price_amount, l.price_unit, tr);
        insert into market.listing_events(listing_id, event_type, run_id, new_value)
        values (l.id, 'new', p_run_id, jsonb_build_object('price', l.price_amount, 'unit', l.price_unit));
        n_new := n_new + 1; v_changed := v_changed || l.id;
      else
        if l.status = 'not_observed' then
          insert into market.listing_events(listing_id, event_type, run_id, old_value)
          values (l.id, 'reappeared', p_run_id, jsonb_build_object('not_observed_since', l.status_changed_at));
          n_reap := n_reap + 1;
        end if;
        if l.content_hash = v_hash then
          update market.listings set last_seen_at = greatest(last_seen_at, coalesce((it->>'observed_at')::timestamptz, v_now)),
                 last_checked_at = v_now, last_run_id = p_run_id,
                 status = case when status = 'not_observed' then 'active' else status end,
                 status_changed_at = case when status = 'not_observed' then v_now else status_changed_at end
           where id = l.id;
          n_same := n_same + 1;
        else
          select data into old_tr from market.listing_snapshots where listing_id = l.id order by observed_at desc, id desc limit 1;
          if (old_tr->>'price_amount') is distinct from (tr->>'price_amount') or (old_tr->>'price_unit') is distinct from (tr->>'price_unit') then
            insert into market.listing_events(listing_id, event_type, run_id, old_value, new_value)
            values (l.id, 'price_change', p_run_id,
                    jsonb_build_object('price', old_tr->'price_amount', 'unit', old_tr->'price_unit'),
                    jsonb_build_object('price', tr->'price_amount', 'unit', tr->'price_unit'));
            n_price := n_price + 1;
          end if;
          select array_agg(k) into v_keys from jsonb_object_keys(tr) k
           where k not in ('price_amount','price_unit') and (old_tr->k) is distinct from (tr->k);
          if v_keys is not null then
            insert into market.listing_events(listing_id, event_type, run_id, old_value, new_value)
            values (l.id, 'attribute_change', p_run_id,
                    (select jsonb_object_agg(k, old_tr->k) from unnest(v_keys) k),
                    (select jsonb_object_agg(k, tr->k) from unnest(v_keys) k));
          end if;
          update market.listings set url = tr->>'url', agency_id = coalesce(v_agency, agency_id), agency_reference = tr->>'agency_reference',
                 operation = tr->>'operation', price_amount = (tr->>'price_amount')::numeric, price_unit = tr->>'price_unit',
                 price_unit_note = tr->>'price_unit_note', property_type = coalesce(tr->>'property_type','unknown'),
                 title = tr->>'title', description = it->>'description', built_area_m2 = (tr->>'built_area_m2')::numeric,
                 useful_area_m2 = (tr->>'useful_area_m2')::numeric, plot_area_m2 = (tr->>'plot_area_m2')::numeric,
                 rooms = (tr->>'rooms')::int, bathrooms = (tr->>'bathrooms')::int, floor_text = tr->>'floor_text',
                 has_elevator = (tr->>'has_elevator')::boolean, has_terrace = (tr->>'has_terrace')::boolean,
                 has_parking = (tr->>'has_parking')::boolean, has_storage = (tr->>'has_storage')::boolean,
                 has_pool = (tr->>'has_pool')::boolean, has_ac = (tr->>'has_ac')::boolean,
                 condition = coalesce(tr->>'condition','unknown'), energy_rating = tr->>'energy_rating',
                 year_built = (tr->>'year_built')::int, location = v_pt, location_precision = tr->>'location_precision',
                 address_text = tr->>'address_text', postal_code = tr->>'postal_code', geography_id = coalesce(v_geo, geography_id),
                 published_at_declared = (tr->>'published_at_declared')::date, content_hash = v_hash,
                 image_count = (tr->>'image_count')::int, extra = coalesce(it->'extra', extra),
                 last_seen_at = greatest(last_seen_at, coalesce((it->>'observed_at')::timestamptz, v_now)),
                 last_checked_at = v_now, last_run_id = p_run_id, status = 'active',
                 status_changed_at = case when status <> 'active' then v_now else status_changed_at end
           where id = l.id;
          insert into market.listing_snapshots(listing_id, observed_at, run_id, content_hash, price_amount, price_unit, data)
          values (l.id, coalesce((it->>'observed_at')::timestamptz, v_now), p_run_id, v_hash, (tr->>'price_amount')::numeric, tr->>'price_unit', tr)
          on conflict do nothing;
          n_upd := n_upd + 1; v_changed := v_changed || l.id;
        end if;
      end if;

      -- Retirada confirmada solo si la fuente lo indica explícitamente (p. ej. 404/410 en la ficha)
      if coalesce((it->>'withdrawn_confirmed')::boolean, false) then
        update market.listings set status = 'withdrawn_confirmed', status_changed_at = v_now where id = l.id and status <> 'withdrawn_confirmed';
        if found then
          insert into market.listing_events(listing_id, event_type, run_id, new_value)
          values (l.id, 'withdrawn_confirmed', p_run_id, jsonb_build_object('evidence', it->>'withdrawal_evidence'));
          n_wd := n_wd + 1;
        end if;
      end if;
    exception when others then
      n_rej := n_rej + 1;
      if n_rej <= 100 then
        insert into ingest.issues(job_id, run_id, severity, code, message, context)
        values (v_job.id, p_run_id, 'error', 'LISTING_REJECTED', sqlerrm, jsonb_build_object('external_id', it->>'external_id'));
      end if;
    end;
  end loop;

  if array_length(v_changed, 1) > 0 then
    n_cand := market.generate_match_candidates(v_changed);
  end if;

  return jsonb_build_object('new', n_new, 'updated', n_upd, 'unchanged', n_same, 'rejected', n_rej,
                            'price_changes', n_price, 'reappeared', n_reap, 'withdrawn_confirmed', n_wd,
                            'match_candidates', n_cand);
end $$;

-- ---------------------------------------------------------------------------
-- Candidatos de coincidencia (dedup-v1). Varias señales; nunca una sola.
-- ---------------------------------------------------------------------------
create or replace function market.generate_match_candidates(p_ids uuid[])
returns int language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare n int := 0;
begin
  with subj as (
    select * from market.listings where id = any(p_ids) and status = 'active' and geography_id is not null
  ), pairs as (
    select s.id as sid, c.id as cid, s as s_row, c as c_row,
      case when s.built_area_m2 is not null and c.built_area_m2 is not null
           then abs(s.built_area_m2 - c.built_area_m2) / greatest(s.built_area_m2, c.built_area_m2) end as area_diff,
      case when s.price_amount is not null and c.price_amount is not null and s.price_unit = c.price_unit
           then abs(s.price_amount - c.price_amount) / greatest(s.price_amount, c.price_amount, 1) end as price_diff,
      case when s.location is not null and c.location is not null
                and s.location_precision in ('exact','street') and c.location_precision in ('exact','street')
           then st_distance(s.location::geography, c.location::geography) end as dist_m,
      case when s.description is not null and c.description is not null and length(s.description) > 80 and length(c.description) > 80
           then similarity(left(s.description, 2000), left(c.description, 2000)) end as desc_sim,
      (s.agency_reference is not null and s.agency_reference = c.agency_reference) as same_ref,
      exists (select 1 from market.media_assets ma join market.media_assets mb on ma.sha256 = mb.sha256
               where ma.listing_id = s.id and mb.listing_id = c.id and ma.status = 'available' and mb.status = 'available') as shared_image
    from subj s
    join market.listings c
      on c.geography_id = s.geography_id and c.operation = s.operation and c.status = 'active' and c.id <> s.id
     and not (c.source_code = s.source_code and c.external_id = s.external_id)
     and (s.property_type in ('unknown','other') or c.property_type in ('unknown','other') or c.property_type = s.property_type)
     and (s.rooms is null or c.rooms is null or s.rooms = c.rooms)
     and (s.built_area_m2 is null or c.built_area_m2 is null
          or abs(s.built_area_m2 - c.built_area_m2) <= 0.15 * greatest(s.built_area_m2, c.built_area_m2))
     and (s.price_amount is null or c.price_amount is null or s.price_unit <> c.price_unit
          or abs(s.price_amount - c.price_amount) <= 0.25 * greatest(s.price_amount, c.price_amount))
    -- no reabrir pares ya en el mismo inmueble
    where not exists (select 1 from market.property_listings a join market.property_listings b on a.property_id = b.property_id
                       where a.listing_id = s.id and b.listing_id = c.id and a.unlinked_at is null and b.unlinked_at is null)
  ), scored as (
    select least(sid, cid) as a, greatest(sid, cid) as b,
      jsonb_strip_nulls(jsonb_build_object(
        'area',   case when area_diff is not null then jsonb_build_object('diff_pct', round(area_diff*100, 2),
                       'points', case when area_diff <= 0.02 then 30 when area_diff <= 0.05 then 20 when area_diff <= 0.10 then 8 else 0 end) end,
        'price',  case when price_diff is not null then jsonb_build_object('diff_pct', round(price_diff*100, 2),
                       'points', case when price_diff <= 0.01 then 15 when price_diff <= 0.05 then 10 when price_diff <= 0.15 then 4 else 0 end) end,
        'distance', case when dist_m is not null then jsonb_build_object('meters', round(dist_m::numeric, 1),
                       'points', case when dist_m <= 30 then 25 when dist_m <= 100 then 15 when dist_m <= 300 then 5 when dist_m > 1000 then -30 else 0 end) end,
        'description', case when desc_sim is not null then jsonb_build_object('similarity', round(desc_sim::numeric, 3),
                       'points', case when desc_sim >= 0.6 then 25 when desc_sim >= 0.4 then 12 else 0 end) end,
        'agency_reference', case when same_ref then jsonb_build_object('points', 30) end,
        'shared_image', case when shared_image then jsonb_build_object('points', 15) end,
        'rooms', case when (s_row).rooms is not null and (s_row).rooms = (c_row).rooms then jsonb_build_object('points', 10) end,
        'bathrooms', case when (s_row).bathrooms is not null and (c_row).bathrooms is not null
                          then jsonb_build_object('points', case when (s_row).bathrooms = (c_row).bathrooms then 8 else -15 end) end,
        'floor', case when (s_row).floor_text is not null and (c_row).floor_text is not null
                      then jsonb_build_object('points', case when lower((s_row).floor_text) = lower((c_row).floor_text) then 8 else -10 end) end,
        'elevator', case when (s_row).has_elevator is not null and (c_row).has_elevator is not null
                         then jsonb_build_object('points', case when (s_row).has_elevator = (c_row).has_elevator then 2 else -8 end) end
      )) as signals,
      -- Señales fuertes: superficie casi idéntica, misma ubicación exacta, misma referencia de agencia o imagen idéntica.
      -- La similitud de descripción solo apoya (las agencias usan plantillas).
      ((case when area_diff <= 0.02 then 1 else 0 end) + (case when dist_m <= 30 then 1 else 0 end)
       + (case when same_ref then 1 else 0 end) + (case when shared_image then 1 else 0 end)) as strong,
      ((s_row).source_code = (c_row).source_code) as same_source
    from pairs
  ), totals as (
    select distinct on (a, b) a, b, signals, strong, same_source,
      (select coalesce(sum((v->>'points')::numeric), 0) from jsonb_each(signals) e(k, v)) as score,
      (select count(*) from jsonb_each(signals) e(k, v) where (v->>'points')::numeric > 0) as positive_signals
    from scored
    order by a, b
  ), ins as (
    insert into market.match_candidates(listing_a, listing_b, score, signals, strong_signals, method_version)
    select a, b, score, signals, strong, 'dedup-v2' from totals
     where score >= 55 and positive_signals >= 3          -- nunca por una sola señal
       and strong >= case when same_source then 2 else 1 end  -- misma fuente (posible republicación): más exigente
    on conflict (listing_a, listing_b) do update
      set score = excluded.score, signals = excluded.signals, strong_signals = excluded.strong_signals
      where market.match_candidates.status = 'pending'
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- Confirmar coincidencia: une los inmuebles (reversible).
create or replace function market.confirm_match(p_candidate_id bigint, p_note text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare c market.match_candidates; pa uuid; pb uuid; r record;
begin
  if not app.is_owner() then raise exception 'FORBIDDEN'; end if;
  select * into c from market.match_candidates where id = p_candidate_id for update;
  if not found or c.status <> 'pending' then raise exception 'CANDIDATE_NOT_PENDING'; end if;
  select property_id into pa from market.property_listings where listing_id = c.listing_a and unlinked_at is null;
  select property_id into pb from market.property_listings where listing_id = c.listing_b and unlinked_at is null;
  if pa = pb then
    update market.match_candidates set status = 'superseded', reviewed_at = now(), reviewed_by = auth.uid() where id = c.id;
    return pa;
  end if;
  for r in select * from market.property_listings where property_id = pb and unlinked_at is null loop
    update market.property_listings set unlinked_at = now(), unlinked_by = auth.uid(),
           unlink_reason = 'merge:candidate:' || c.id where id = r.id;
    insert into market.property_listings(property_id, listing_id, link_type, candidate_id, linked_by)
    values (pa, r.listing_id, 'user_confirmed', c.id, auth.uid());
  end loop;
  update market.properties set status = 'merged', merged_into = pa, merged_at = now() where id = pb;
  update market.match_candidates set status = 'confirmed', reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note where id = c.id;
  return pa;
end $$;

create or replace function market.reject_match(p_candidate_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not app.is_owner() then raise exception 'FORBIDDEN'; end if;
  update market.match_candidates set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note
   where id = p_candidate_id and status = 'pending';
  if not found then raise exception 'CANDIDATE_NOT_PENDING'; end if;
end $$;

-- Deshacer una unión: restaura los vínculos anteriores conservando el historial.
create or replace function market.undo_match(p_candidate_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare c market.match_candidates; r record; v_old uuid;
begin
  if not app.is_owner() then raise exception 'FORBIDDEN'; end if;
  select * into c from market.match_candidates where id = p_candidate_id for update;
  if not found or c.status not in ('confirmed','auto_linked') then raise exception 'CANDIDATE_NOT_LINKED'; end if;
  for r in select * from market.property_listings where candidate_id = c.id and unlinked_at is null loop
    select property_id into v_old from market.property_listings
     where listing_id = r.listing_id and unlink_reason = 'merge:candidate:' || c.id order by unlinked_at desc limit 1;
    update market.property_listings set unlinked_at = now(), unlinked_by = auth.uid(), unlink_reason = 'undo:candidate:' || c.id
     where id = r.id;
    insert into market.property_listings(property_id, listing_id, link_type, linked_by)
    values (v_old, r.listing_id, 'user_confirmed', auth.uid());
    update market.properties set status = 'active', merged_into = null, merged_at = null where id = v_old;
  end loop;
  update market.match_candidates set status = 'undone', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = coalesce(p_note, review_note) where id = c.id;
end $$;

-- ---------------------------------------------------------------------------
-- Medios: el trabajador registra solo archivos completos y verificados.
-- ---------------------------------------------------------------------------
create or replace function ingest.worker_register_media(p_run_id uuid, p_token uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job ingest.jobs; it jsonb; v_lid uuid; n_ok int := 0; n_dup int := 0; n_fail int := 0;
begin
  v_job := ingest._assert_lease(p_run_id, p_token);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then raise exception 'BATCH_INVALID'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      select id into v_lid from market.listings where source_code = v_job.source_code and external_id = it->>'listing_external_id';
      if it->>'status' = 'available' then
        if coalesce(it->>'sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'SHA256_INVALID'; end if;
        if (it->>'storage_key') ~ '(^[A-Za-z]:|^[/\\]|\.\.)' then raise exception 'STORAGE_KEY_INVALID'; end if;
        if coalesce(it->>'mime_type','') !~ '^(image/(jpeg|png|webp|gif|avif)|application/pdf|text/html)$' then raise exception 'MIME_NOT_ALLOWED'; end if;
      end if;
      insert into market.media_assets(listing_id, kind, origin_host, origin_url_hash, storage_provider, storage_key, byte_size,
                                      mime_type, width, height, sha256, captured_at, status, error, run_id)
      values (v_lid, coalesce(it->>'kind','photo'), it->>'origin_host', it->>'origin_url_hash', 'local', it->>'storage_key',
              (it->>'byte_size')::bigint, it->>'mime_type', (it->>'width')::int, (it->>'height')::int, it->>'sha256',
              coalesce((it->>'captured_at')::timestamptz, now()), it->>'status', it->>'error', p_run_id)
      on conflict (listing_id, sha256) where sha256 is not null do nothing;
      if found then n_ok := n_ok + 1; else n_dup := n_dup + 1; end if;
    exception when others then
      n_fail := n_fail + 1;
      insert into ingest.issues(job_id, run_id, severity, code, message, context)
      values (v_job.id, p_run_id, 'error', 'MEDIA_REJECTED', sqlerrm, jsonb_build_object('listing', it->>'listing_external_id'));
    end;
  end loop;
  return jsonb_build_object('registered', n_ok, 'duplicates', n_dup, 'rejected', n_fail);
end $$;
