import "server-only";
import { num, type Tx } from "../db";

export interface ListingQuery {
  muni: string[]; prov: string[]; ccaa: string[]; op: "sale" | "rent"; types: string[]; pmin: number | null; pmax: number | null;
  amin: number | null; amax: number | null; rooms: number | null; baths: number | null; cond: string[]; elevator: boolean;
  terrace: boolean; source: string; fresh: number | null; changes: "" | "new" | "price"; complete: boolean; synth: boolean;
  bbox: [number, number, number, number] | null; sort: string; page: number; ymin: number | null; emax: number | null;
  /** Solo inmuebles observados por primera vez después de esta fecha (novedades de una búsqueda guardada). */
  since?: string | null;
}

const n = (v: unknown) => (v === undefined || v === "" || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
const list = (v: unknown, re: RegExp) => (typeof v === "string" ? v.split(",").filter((x) => re.test(x)) : []);

export function parseListingQuery(sp: Record<string, string | string[] | undefined>): ListingQuery {
  const bb = typeof sp.bbox === "string" ? sp.bbox.split(",").map(Number) : [];
  return {
    muni: list(sp.muni, /^\d{5}$/), prov: list(sp.prov, /^\d{2}$/), ccaa: list(sp.ccaa, /^\d{2}$/),
    op: sp.op === "rent" ? "rent" : "sale",
    types: list(sp.types, /^(flat|house|penthouse|duplex|studio|rural_house|room|other|unknown)$/),
    pmin: n(sp.pmin), pmax: n(sp.pmax), amin: n(sp.amin), amax: n(sp.amax), rooms: n(sp.rooms), baths: n(sp.baths),
    cond: list(sp.cond, /^(new|good|to_renovate|unknown)$/), elevator: sp.elev === "1", terrace: sp.terr === "1",
    source: typeof sp.src === "string" && /^[a-z0-9_]+$/.test(sp.src) ? sp.src : "", fresh: n(sp.fresh),
    changes: sp.chg === "new" || sp.chg === "price" ? sp.chg : "", complete: sp.complete === "1", synth: sp.synth !== "0",
    bbox: bb.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : null,
    sort: typeof sp.sort === "string" && ["price_asc", "price_desc", "m2_asc", "m2_desc", "recent", "area_desc", "below_zone"].includes(sp.sort) ? sp.sort : "recent",
    page: Math.max(1, Number(sp.page ?? 1) || 1), ymin: n(sp.ymin), emax: n(sp.emax),
    since: typeof sp.since === "string" && !Number.isNaN(Date.parse(sp.since)) ? new Date(sp.since).toISOString() : null,
  };
}

export const LPAGE = 30;

/** Condición SQL común (sobre la publicación principal de cada inmueble). */
function where(tx: Tx, q: ListingQuery) {
  return tx`
    l.status = 'active' and l.operation = ${q.op}
    and (${q.muni.length === 0} or g.code = any(${q.muni}))
    and (${q.prov.length === 0} or p.code = any(${q.prov}))
    and (${q.ccaa.length === 0} or c.code = any(${q.ccaa}))
    and (${q.types.length === 0} or l.property_type = any(${q.types}))
    and (${q.pmin === null} or l.price_amount >= ${q.pmin ?? 0})
    and (${q.pmax === null} or l.price_amount <= ${q.pmax ?? 0})
    and (${q.amin === null} or l.built_area_m2 >= ${q.amin ?? 0})
    and (${q.amax === null} or l.built_area_m2 <= ${q.amax ?? 0})
    and (${q.rooms === null} or l.rooms >= ${q.rooms ?? 0})
    and (${q.baths === null} or l.bathrooms >= ${q.baths ?? 0})
    and (${q.cond.length === 0} or l.condition = any(${q.cond}))
    and (${!q.elevator} or l.has_elevator)
    and (${!q.terrace} or l.has_terrace)
    and (${q.source === ""} or l.source_code = ${q.source})
    and (${q.fresh === null} or l.last_checked_at >= now() - make_interval(days => ${q.fresh ?? 0}::int))
    and (${q.synth} or not l.is_synthetic)
    and (${!q.since} or l.first_seen_at > ${q.since ?? "1970-01-01"}::timestamptz)
    and (${!q.complete} or (l.price_amount is not null and l.built_area_m2 is not null and l.rooms is not null and l.location_precision <> 'unknown'))
    and (${q.changes !== "new"} or l.first_seen_at >= now() - interval '7 days')
    and (${q.changes !== "price"} or exists (select 1 from market.listing_events e where e.listing_id = l.id and e.event_type = 'price_change' and e.occurred_at >= now() - interval '30 days'))
    and (${q.bbox === null} or l.location && st_makeenvelope(${q.bbox?.[0] ?? 0}, ${q.bbox?.[1] ?? 0}, ${q.bbox?.[2] ?? 0}, ${q.bbox?.[3] ?? 0}, 4326))`;
}

/** Inmuebles únicos (no anuncios): una fila por inmueble con su publicación principal y nº de publicaciones. */
export async function listProperties(tx: Tx, q: ListingQuery, a: { acq: number | null; ltv: number | null } = { acq: null, ltv: null }) {
  const order = {
    price_asc: tx`price asc nulls last`, price_desc: tx`price desc nulls last`, m2_asc: tx`price_m2 asc nulls last`, m2_desc: tx`price_m2 desc nulls last`,
    recent: tx`first_seen desc`, area_desc: tx`area desc nulls last`, below_zone: tx`(price_m2 / nullif(zone_m2, 0)) asc nulls last`,
  }[q.sort]!;
  const rows = await tx`
    with prim as (
      select distinct on (pl.property_id) pl.property_id, l.*
        from market.property_listings pl join market.listings l on l.id = pl.listing_id
       where pl.unlinked_at is null and l.status = 'active'
       order by pl.property_id, l.last_seen_at desc, l.price_amount asc
    ), f as (
      select l.property_id, l.id as listing_id, l.source_code, l.external_id, l.url, l.price_amount::float8 as price, l.price_unit, l.operation,
             l.property_type, l.title, l.built_area_m2::float8 as area, l.rooms, l.bathrooms, l.condition, l.has_elevator, l.has_terrace,
             l.location_precision, st_y(l.location) as lat, st_x(l.location) as lon, l.first_seen_at as first_seen, l.last_checked_at as checked,
             l.is_synthetic, g.code as muni_code, g.name as muni_name, p.name as prov_name,
             case when l.built_area_m2 > 0 then l.price_amount / l.built_area_m2 end::float8 as price_m2,
             (select count(*) from market.property_listings x where x.property_id = l.property_id and x.unlinked_at is null) as n_listings,
             (select lv.value_num from stats.latest_values lv where lv.geography_id = l.geography_id and lv.dims_key = ''
               and lv.indicator_code = case when l.operation = 'sale' then 'mkt.offer_price_sale_m2' else 'mkt.offer_rent_m2' end)::float8 as zone_m2,
             (select lv.value_num from stats.latest_values lv where lv.geography_id = l.geography_id and lv.dims_key = '' and lv.indicator_code = 'mkt.offer_rent_m2')::float8 as zone_rent_m2,
             exists (select 1 from market.listing_events e where e.listing_id = l.id and e.event_type = 'price_change') as price_changed
        from prim l
        left join geo.geographies g on g.id = l.geography_id
        left join geo.geographies p on p.id = g.parent_id
        left join geo.geographies c on c.id = p.parent_id
       where ${where(tx, q)}
    )
    select *, count(*) over () as total from f
     where (${q.ymin === null} or (zone_rent_m2 * area * 12 / nullif(price, 0) * 100) >= ${q.ymin ?? 0})
       and (${q.emax === null} or (${a.acq !== null && a.ltv !== null} and price * (1 + ${a.acq ?? 0}) - price * ${a.ltv ?? 0} <= ${q.emax ?? 0}))
     order by ${order} limit ${LPAGE} offset ${(q.page - 1) * LPAGE}`;
  return { rows: rows.map((r) => ({ ...r, n_listings: num(r.n_listings), total: undefined })), total: num(rows[0]?.total) ?? 0 };
}

/** Agrupación en servidor por celdas según zoom; ubicaciones aproximadas se marcan como tales. */
export async function clusters(tx: Tx, q: ListingQuery, zoom: number) {
  const cell = 360 / 2 ** (zoom + 1.5);
  const rows = await tx`
    with prim as (
      select distinct on (pl.property_id) pl.property_id, l.*
        from market.property_listings pl join market.listings l on l.id = pl.listing_id
       where pl.unlinked_at is null and l.status = 'active' order by pl.property_id, l.last_seen_at desc
    ), f as (
      select l.property_id, coalesce(l.location, (select gm.centroid from geo.geometries gm where gm.geography_id = l.geography_id limit 1)) as pt,
             l.location is null or l.location_precision in ('municipality','unknown') as approx, l.location_precision, l.price_amount
        from prim l left join geo.geographies g on g.id = l.geography_id left join geo.geographies p on p.id = g.parent_id
        left join geo.geographies c on c.id = p.parent_id
       where ${where(tx, { ...q, bbox: null })}
    )
    select st_x(st_centroid(st_collect(pt))) as lon, st_y(st_centroid(st_collect(pt))) as lat, count(*) as n,
           bool_and(approx) as all_approx, min(location_precision) as precision,
           (array_agg(property_id::text))[1] as sample_id, percentile_cont(0.5) within group (order by price_amount)::float8 as median_price
      from f where pt is not null
       and (${q.bbox === null} or pt && st_makeenvelope(${q.bbox?.[0] ?? 0}, ${q.bbox?.[1] ?? 0}, ${q.bbox?.[2] ?? 0}, ${q.bbox?.[3] ?? 0}, 4326))
     group by st_snaptogrid(pt, ${cell}), approx
     limit 3000`;
  return rows.map((r) => ({ lon: num(r.lon)!, lat: num(r.lat)!, n: num(r.n)!, approx: r.all_approx as boolean, precision: r.precision as string,
                            id: num(r.n) === 1 ? (r.sample_id as string) : null, median: num(r.median_price) }));
}
