import "server-only";
import { num, type Tx } from "../db";

export interface ZoneValue {
  code: string; name: string; unit: string | null; family: string; dims_key: string; value: number | null; raw: string | null;
  period: string; status: string; resource: string | null; as_of: string | null; kind: string; method: string | null;
  formula: string | null; warnings: string[] | null; protected: boolean; functions: string[]; synthetic: boolean;
}

export async function zoneHeader(tx: Tx, level: string, code: string) {
  const r = await tx`
    select g.id, g.level, g.code, g.name, g.has_geometry, g.version_label, g.notes, g.valid_to,
           p.level as p_level, p.code as p_code, p.name as p_name, pp.level as pp_level, pp.code as pp_code, pp.name as pp_name,
           (select gm.area_km2 from geo.geometries gm where gm.geography_id = g.id and gm.resolution = 'full' limit 1) as area
      from geo.geographies g left join geo.geographies p on p.id = g.parent_id left join geo.geographies pp on pp.id = p.parent_id
     where g.level = ${level} and g.code = ${code}
     order by (g.valid_to is null) desc limit 1`;
  return r[0] ?? null;
}

export async function zoneValues(tx: Tx, geoId: number): Promise<ZoneValue[]> {
  const rows = await tx`
    select i.code, i.name, i.unit, i.family, lv.dims_key, lv.value_num, lv.value_raw, lv.period, lv.value_status, lv.resource_code,
           lv.as_of, lv.kind, lv.capture_method, lv.formula, lv.warnings, i.is_protected_attribute, i.app_functions, lv.is_synthetic
      from stats.latest_values lv join catalog.indicators i on i.code = lv.indicator_code
     where lv.geography_id = ${geoId}
     order by i.family, i.code, lv.dims_key`;
  return rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, family: r.family, dims_key: r.dims_key, value: num(r.value_num), raw: r.value_raw,
    period: r.period, status: r.value_status, resource: r.resource_code, as_of: r.as_of, kind: r.kind, method: r.capture_method,
    formula: r.formula, warnings: r.warnings, protected: r.is_protected_attribute, functions: r.app_functions, synthetic: r.is_synthetic }));
}

export async function zoneSeries(tx: Tx, geoId: number, codes: string[]) {
  const rows = await tx`
    select indicator_code, period, value_num, value_status from stats.observations
     where geography_id = ${geoId} and is_current and dims_key = '' and indicator_code = any(${codes}) order by period`;
  const out: Record<string, { x: string; y: number | null }[]> = {};
  for (const r of rows) (out[r.indicator_code] ??= []).push({ x: r.period, y: num(r.value_num) });
  return out;
}

export async function familyCatalog(tx: Tx) {
  return tx`select code, name, family, unit, is_protected_attribute, is_excluded, app_functions,
                   (select string_agg(distinct r.tech_status, ',') from catalog.resource_indicators ri join catalog.resources r on r.code = ri.resource_code
                     where ri.indicator_code = i.code) as statuses
              from catalog.indicators i where not is_excluded order by family, code`;
}

/** Agregados de los municipios hijos: suma (indicadores aditivos) o mediana (resto), siempre etiquetados como calculados. */
export async function childAggregates(tx: Tx, geoId: number, level: string) {
  const childFilter = level === "province"
    ? tx`g.parent_id = ${geoId}`
    : tx`g.parent_id in (select id from geo.geographies where parent_id = ${geoId})`;
  const rows = await tx`
    select lv.indicator_code, i.name, i.unit, i.stat_type,
           count(*) filter (where lv.value_num is not null) as n,
           (select count(*) from geo.geographies g where g.level = 'municipality' and g.valid_to is null and ${childFilter}) as universe,
           sum(lv.value_num) as total, percentile_cont(0.5) within group (order by lv.value_num) as median,
           min(lv.period) as pmin, max(lv.period) as pmax
      from stats.latest_values lv join geo.geographies g on g.id = lv.geography_id and g.level = 'municipality' and g.valid_to is null
      join catalog.indicators i on i.code = lv.indicator_code
     where ${childFilter} and lv.dims_key = '' and not i.is_protected_attribute
     group by lv.indicator_code, i.name, i.unit, i.stat_type order by lv.indicator_code`;
  return rows.map((r) => ({ code: r.indicator_code as string, name: r.name as string, unit: r.unit as string, additive: ["stock", "flow", "count"].includes(r.stat_type),
    n: num(r.n)!, universe: num(r.universe)!, total: num(r.total), median: num(r.median), pmin: r.pmin as string, pmax: r.pmax as string }));
}

export async function marketCoverage(tx: Tx, geoId: number, level: string) {
  const filter = level === "municipality" ? tx`l.geography_id = ${geoId}`
    : level === "province" ? tx`l.geography_id in (select id from geo.geographies where parent_id = ${geoId})`
    : tx`l.geography_id in (select g.id from geo.geographies g join geo.geographies p on p.id = g.parent_id where p.parent_id = ${geoId})`;
  const r = await tx`
    select l.operation, count(*) as listings, count(distinct pl.property_id) as properties, max(l.last_seen_at) as last_seen,
           count(distinct l.source_code) as sources, bool_or(l.is_synthetic) as synth
      from market.listings l join market.property_listings pl on pl.listing_id = l.id and pl.unlinked_at is null
     where ${filter} and l.status = 'active' group by l.operation`;
  return r.map((x) => ({ operation: x.operation as string, listings: num(x.listings)!, properties: num(x.properties)!, lastSeen: x.last_seen as string,
                         sources: num(x.sources)!, synthetic: !!x.synth }));
}

/** Universo estable para percentiles: municipios vigentes con ≥ minPop habitantes (no depende de filtros). */
export async function universeValues(tx: Tx, code: string, minPop: number) {
  const r = await tx`
    select lv.value_num::float8 as v from stats.latest_values lv
      join stats.latest_values pop on pop.geography_id = lv.geography_id and pop.indicator_code = 'pop.padron' and pop.dims_key = ''
      join geo.geographies g on g.id = lv.geography_id and g.level = 'municipality' and g.valid_to is null
     where lv.indicator_code = ${code} and lv.dims_key = '' and lv.value_num is not null and pop.value_num >= ${minPop}
     order by 1`;
  return r.map((x) => x.v as number);
}
