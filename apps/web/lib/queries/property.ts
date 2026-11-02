import "server-only";
import { num, type Tx } from "../db";
import type { Comp } from "../comparables";

export const CANON_FIELDS = ["property_type", "built_area_m2", "useful_area_m2", "rooms", "bathrooms", "floor_text", "has_elevator", "has_terrace",
  "has_parking", "condition", "energy_rating", "year_built", "address_text"] as const;

export async function propertyDetail(tx: Tx, id: string) {
  const prop = await tx`select p.*, st_y(p.location) as lat, st_x(p.location) as lon from market.properties p where p.id = ${id}`;
  if (!prop[0]) return null;
  if (prop[0].status === "merged" && prop[0].merged_into) return { kind: "redirect" as const, to: prop[0].merged_into as string };
  const listings = await tx`
    select l.*, l.price_amount::float8 as price, l.built_area_m2::float8 as area, st_y(l.location) as lat, st_x(l.location) as lon,
           g.code as muni_code, g.name as muni_name, a.name as agency_name, pl.link_type, pl.linked_at
      from market.property_listings pl join market.listings l on l.id = pl.listing_id
      left join geo.geographies g on g.id = l.geography_id left join market.agencies a on a.id = l.agency_id
     where pl.property_id = ${id} and pl.unlinked_at is null order by l.status = 'active' desc, l.last_seen_at desc`;
  const ids = listings.map((l) => l.id as string);
  const [events, corrections, candidates, history] = await Promise.all([
    tx`select e.*, l.source_code from market.listing_events e join market.listings l on l.id = e.listing_id where e.listing_id = any(${ids}) order by e.occurred_at desc limit 100`,
    tx`select * from market.attribute_corrections where ((target_type = 'property' and target_id = ${id}) or (target_type = 'listing' and target_id = any(${ids}))) and revoked_at is null order by created_at desc`,
    tx`select mc.*, la.source_code as a_src, lb.source_code as b_src, la.external_id as a_ext, lb.external_id as b_ext
         from market.match_candidates mc join market.listings la on la.id = mc.listing_a join market.listings lb on lb.id = mc.listing_b
        where (mc.listing_a = any(${ids}) or mc.listing_b = any(${ids})) order by mc.score desc limit 20`,
    tx`select s.observed_at, s.price_amount::float8 as price, s.price_unit, l.source_code from market.listing_snapshots s join market.listings l on l.id = s.listing_id
        where s.listing_id = any(${ids}) order by s.observed_at`,
  ]);
  return { kind: "ok" as const, prop: prop[0]!, listings, events, corrections, candidates, history };
}

/** Valores canónicos explicables: corrección del usuario > valor más reciente no nulo; discrepancias visibles. */
export function canonical(listings: Record<string, unknown>[], corrections: Record<string, unknown>[]) {
  const out: Record<string, { value: unknown; origin: string; discrepancies: { source: string; value: unknown }[]; correction?: Record<string, unknown> }> = {};
  for (const f of CANON_FIELDS) {
    const corr = corrections.find((c) => c.field === f);
    const vals = listings.filter((l) => l[f] !== null && l[f] !== undefined && l[f] !== "unknown").map((l) => ({ source: `${l.source_code}`, value: l[f] }));
    const distinct = Array.from(new Set(vals.map((v) => JSON.stringify(v.value))));
    out[f] = corr
      ? { value: corr.value, origin: "corrección del usuario", discrepancies: vals, correction: corr }
      : { value: vals[0]?.value ?? null, origin: vals[0] ? `publicación más reciente (${vals[0].source})` : "sin dato", discrepancies: distinct.length > 1 ? vals : [] };
  }
  return out;
}

/**
 * Comparables por modalidad. Primero mismo municipio; si hay < 5, se amplía a la provincia y se indica.
 * Un comparable = un inmueble (se deduplica antes de calcular).
 */
export async function comparables(tx: Tx, subject: { propertyId: string; geographyId: number; area: number | null; rooms: number | null; type: string; lat: number | null; lon: number | null },
                                  mode: "sale" | "rent_long" | "rooms" | "tourist") {
  const unit = { sale: "sale_total", rent_long: "rent_month", rooms: "rent_room_month", tourist: "rent_night" }[mode];
  const op = mode === "sale" ? "sale" : "rent";
  const typeGroup = subject.type === "house" || subject.type === "rural_house" ? ["house", "rural_house"] : ["flat", "penthouse", "duplex", "studio", "unknown", "other"];
  const run = async (scope: "muni" | "prov") => tx`
    with cand as (
      select distinct on (pl.property_id) l.id, pl.property_id, l.price_amount::float8 as price, l.built_area_m2::float8 as area, l.rooms, l.property_type,
             l.condition, g.code as muni, l.last_seen_at, l.source_code, l.is_synthetic,
             case when ${subject.lat !== null} and l.location is not null and l.location_precision in ('exact','street')
                  then st_distance(l.location::geography, st_setsrid(st_makepoint(${subject.lon ?? 0}, ${subject.lat ?? 0}), 4326)::geography) end as dist
        from market.listings l join market.property_listings pl on pl.listing_id = l.id and pl.unlinked_at is null
        join geo.geographies g on g.id = l.geography_id
       where l.status = 'active' and l.operation = ${op} and l.price_unit = ${unit} and l.price_amount > 0 and pl.property_id <> ${subject.propertyId}
         and (${mode === "rooms"} or l.property_type = any(${typeGroup}))
         and (${scope === "muni"} and l.geography_id = ${subject.geographyId}
              or ${scope === "prov"} and g.parent_id = (select parent_id from geo.geographies where id = ${subject.geographyId}))
         and (${subject.area === null || mode === "rooms"} or l.built_area_m2 between ${(subject.area ?? 0) * 0.7} and ${(subject.area ?? 0) * 1.3})
         and (${subject.rooms === null || mode === "rooms"} or l.rooms between ${(subject.rooms ?? 0) - 1} and ${(subject.rooms ?? 0) + 1})
       order by pl.property_id, l.last_seen_at desc
    ) select * from cand order by dist nulls last, abs(coalesce(area, 0) - ${subject.area ?? 0}) limit 60`;
  let rows = await run("muni");
  let expanded = false;
  if (rows.length < 5) { rows = await run("prov"); expanded = true; }
  const comps: Comp[] = rows.map((r) => ({
    listingId: r.id, propertyId: r.property_id, price: num(r.price)!, area: num(r.area), rooms: r.rooms, type: r.property_type, condition: r.condition, muni: r.muni,
    distanceM: num(r.dist), lastSeen: (r.last_seen_at as Date).toISOString?.() ?? String(r.last_seen_at), source: r.source_code, synthetic: r.is_synthetic,
    reason: [expanded ? "misma provincia (ampliado)" : "mismo municipio", mode === "rooms" ? "habitación" : "tipo compatible",
             subject.area && mode !== "rooms" ? "superficie ±30 %" : null, subject.rooms !== null && mode !== "rooms" ? "habitaciones ±1" : null].filter(Boolean).join(" · "),
  }));
  return { comps, expanded, unit };
}
