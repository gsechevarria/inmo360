import "server-only";
import { num, type Tx } from "../db";
import { ZONE_COLUMNS } from "../domain";

export type Cond = { code: string; op: "gte" | "lte"; v: number };
export interface ZoneQuery {
  ccaa: string[]; prov: string[]; ids: string[]; q: string; cols: string[]; conds: Cond[]; sort: string; dir: "asc" | "desc";
  page: number; showNotEvaluable: boolean;
}
const ALLOWED = new Set<string>(ZONE_COLUMNS.map((c) => c.code));

export function parseZoneQuery(sp: Record<string, string | string[] | undefined>, defaults: string[]): ZoneQuery {
  const list = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).split(",").filter(Boolean) : []);
  const cols = list("cols").filter((c) => ALLOWED.has(c));
  const conds: Cond[] = list("f").map((s) => s.split(":")).filter(([c, op, v]) => ALLOWED.has(c!) && (op === "gte" || op === "lte") && v !== undefined && Number.isFinite(Number(v)))
    .map(([c, op, v]) => ({ code: c!, op: op as Cond["op"], v: Number(v) }));
  const sort = typeof sp.sort === "string" && (ALLOWED.has(sp.sort) || sp.sort === "name") ? sp.sort : "pop.padron";
  return {
    ccaa: list("ccaa").filter((c) => /^\d{2}$/.test(c)), prov: list("prov").filter((c) => /^\d{2}$/.test(c)),
    ids: list("ids").filter((c) => /^\d{5}$/.test(c)), q: typeof sp.q === "string" ? sp.q.slice(0, 80) : "",
    cols: cols.length ? cols : defaults, conds, sort, dir: sp.dir === "asc" ? "asc" : "desc",
    page: Math.max(1, Number(sp.page ?? 1) || 1), showNotEvaluable: sp.ne === "1",
  };
}

export const PAGE = 50;

export interface ZoneRow {
  id: number; code: string; name: string; prov_code: string; prov_name: string; ccaa_name: string;
  vals: Record<string, { v: number | null; p: string | null; s: string | null }>; evaluable: boolean;
}

export async function zoneTable(tx: Tx, q: ZoneQuery) {
  const codes = Array.from(new Set([...q.cols, ...q.conds.map((c) => c.code), ...(q.sort !== "name" ? [q.sort] : [])]));
  const condCodes = q.conds.map((c) => c.code);
  const ops = q.conds.map((c) => c.op);
  const vals = q.conds.map((c) => c.v);
  const rows = await tx`
    with g as (
      select g.id, g.code, g.name, p.code as prov_code, p.name as prov_name, c.code as ccaa_code, c.name as ccaa_name
        from geo.geographies g
        join geo.geographies p on p.id = g.parent_id
        join geo.geographies c on c.id = p.parent_id
       where g.level = 'municipality' and g.valid_to is null
         and (${q.prov.length === 0} or p.code = any(${q.prov}))
         and (${q.ccaa.length === 0} or c.code = any(${q.ccaa}))
         and (${q.ids.length === 0} or g.code = any(${q.ids}))
         and (${q.q === ""} or g.name_search like ${"%" + q.q.toLowerCase() + "%"} or g.code = ${q.q})
    ), v as (
      select lv.geography_id, jsonb_object_agg(lv.indicator_code, jsonb_build_object('v', lv.value_num, 'p', lv.period, 's', lv.value_status)) as vals
        from stats.latest_values lv
       where lv.indicator_code = any(${codes}) and lv.dims_key = '' and lv.geography_id in (select id from g)
       group by lv.geography_id
    ), j as (
      select g.*, coalesce(v.vals, '{}'::jsonb) as vals,
             -- evaluable: todas las condiciones tienen dato numérico
             coalesce((select bool_and((v.vals -> cc ->> 'v') is not null) from unnest(${condCodes}::text[]) cc), true) as evaluable,
             coalesce((select bool_and(case when (v.vals -> u.cc ->> 'v') is null then true
                                            when u.op = 'gte' then (v.vals -> u.cc ->> 'v')::numeric >= u.val
                                            else (v.vals -> u.cc ->> 'v')::numeric <= u.val end)
                         from unnest(${condCodes}::text[], ${ops}::text[], ${vals}::numeric[]) as u(cc, op, val)), true) as passes
        from g left join v on v.geography_id = g.id
    )
    select *, count(*) over () as total,
           (select count(*) from j where not evaluable) as n_not_evaluable,
           (select count(*) from j where evaluable and not passes) as n_fail
      from j
     where passes and (evaluable or ${q.showNotEvaluable})
     order by
       case when ${q.sort} = 'name' then null else (vals -> ${q.sort} ->> 'v')::numeric end ${q.dir === "asc" ? tx`asc` : tx`desc`} nulls last,
       name ${q.dir === "asc" ? tx`asc` : tx`desc`}
     limit ${PAGE} offset ${(q.page - 1) * PAGE}`;
  const total = num(rows[0]?.total) ?? 0;
  const counts = { total, notEvaluable: num(rows[0]?.n_not_evaluable) ?? 0, failing: num(rows[0]?.n_fail) ?? 0 };
  if (!rows.length) {
    const c = await tx`
      with g as (select g.id from geo.geographies g join geo.geographies p on p.id = g.parent_id join geo.geographies c on c.id = p.parent_id
                  where g.level = 'municipality' and g.valid_to is null and (${q.prov.length === 0} or p.code = any(${q.prov}))
                    and (${q.ccaa.length === 0} or c.code = any(${q.ccaa})))
      select count(*) as n from g`;
    counts.total = 0;
    return { rows: [] as ZoneRow[], counts: { ...counts, scope: num(c[0]?.n) ?? 0 } };
  }
  return {
    rows: rows.map((r) => ({ id: num(r.id)!, code: r.code, name: r.name, prov_code: r.prov_code, prov_name: r.prov_name, ccaa_name: r.ccaa_name,
                              vals: r.vals as ZoneRow["vals"], evaluable: r.evaluable })) as ZoneRow[],
    counts: { ...counts, scope: total + counts.failing + (q.showNotEvaluable ? 0 : counts.notEvaluable) },
  };
}

export async function regions(tx: Tx) {
  const rows = await tx`
    select c.code as ccaa, c.name as ccaa_name, p.code as prov, p.name as prov_name
      from geo.geographies p join geo.geographies c on c.id = p.parent_id
     where p.level = 'province' and p.valid_to is null order by c.name, p.name`;
  return rows as unknown as { ccaa: string; ccaa_name: string; prov: string; prov_name: string }[];
}

export async function legend(tx: Tx, code: string) {
  const rows = await tx`
    select lv.value_num::float8 as v, lv.period
      from stats.latest_values lv join geo.geographies g on g.id = lv.geography_id and g.level = 'municipality' and g.valid_to is null
     where lv.indicator_code = ${code} and lv.dims_key = '' and lv.value_num is not null
     order by lv.value_num`;
  const vals = rows.map((r) => r.v as number);
  const universe = await tx`select count(*) as n from geo.geographies where level = 'municipality' and valid_to is null`;
  const periods = new Map<string, number>();
  for (const r of rows) periods.set(r.period, (periods.get(r.period) ?? 0) + 1);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))]!;
  const breaks = vals.length >= 6 ? [1, 2, 3, 4, 5].map((i) => q(i / 6)) : [];
  return { code, n: vals.length, universe: num(universe[0]?.n) ?? 0, breaks: Array.from(new Set(breaks)),
           periods: [...periods.entries()].sort((a, b) => b[1] - a[1]).map(([p, c]) => ({ period: p, n: c })),
           min: vals[0] ?? null, max: vals.at(-1) ?? null };
}

export async function bbox(tx: Tx, level: string, codes: string[]) {
  const r = await tx`
    select st_xmin(e) as x0, st_ymin(e) as y0, st_xmax(e) as x1, st_ymax(e) as y1
      from (select st_extent(gm.geom)::geometry as e from geo.geometries gm join geo.geographies g on g.id = gm.geography_id
             where g.level = ${level} and g.code = any(${codes}) and g.valid_to is null and gm.resolution = 'full') s`;
  const b = r[0];
  return b && b.x0 !== null ? [num(b.x0)!, num(b.y0)!, num(b.x1)!, num(b.y1)!] as [number, number, number, number] : null;
}
