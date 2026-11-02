import Link from "next/link";
import { redirect } from "next/navigation";
import { simulate, templates, type Item, type Metric, type ScenarioInput, type ScenarioResult, type Strategy } from "@inmo360/finance";
import { requireUser } from "@/lib/auth";
import { num, withUser, type Tx } from "@/lib/db";
import { COND_LABEL, STRATEGIES, TYPE_LABEL, ZONE_COLUMNS, strategyLabel } from "@/lib/domain";
import { eur, n, periodLabel, fmtUnit } from "@/lib/format";
import { comparables } from "@/lib/queries/property";
import { compStats } from "@/lib/comparables";
import { activeProfile, zoneScore } from "@/lib/scoring";
import { Empty, Notice, PageHeader, Panel, SyntheticBadge, Tabs } from "@/components/ui";
import { fmtMetric, KEY_METRICS } from "@/lib/metrics";

type SP = Record<string, string | undefined>;
const list = (v: string | undefined, re: RegExp, max: number) => Array.from(new Set((v ?? "").split(",").map((x) => x.trim()).filter((x) => re.test(x)))).slice(0, max);
const UUID = /^[0-9a-f-]{36}$/;
const qs = (sp: SP, patch: SP) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v); return `/comparar?${u.toString()}`; };

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const zonas = list(sp.zonas, /^\d{5}$/, 6), viviendas = list(sp.viviendas, UUID, 4), escenarios = list(sp.escenarios, UUID, 4);
  const mode = sp.modo === "escenarios" || (!sp.modo && escenarios.length && !viviendas.length) ? "escenarios" : sp.modo === "viviendas" || (!sp.modo && viviendas.length && !zonas.length) ? "viviendas" : "zonas";

  // Añadir una zona por nombre o código (formulario GET sin JavaScript)
  if (sp.add && mode === "zonas") {
    const code = await withUser(user.id, async (tx) => {
      const r = await tx`select code from geo.geographies where level = 'municipality' and valid_to is null
                          and (code = ${sp.add!.trim()} or unaccent(lower(name)) = unaccent(lower(${sp.add!.trim()})) or unaccent(lower(name)) like unaccent(lower(${sp.add!.trim() + "%"})))
                         order by (code = ${sp.add!.trim()}) desc, length(name) limit 1`;
      return (r[0]?.code as string) ?? null;
    }).catch(() => null);
    redirect(qs({ ...sp, add: undefined }, { zonas: [...zonas, ...(code ? [code] : [])].join(","), ...(code ? {} : { noencontrado: sp.add }) }));
  }

  const tabs = [
    { id: "zonas", label: "Zonas", href: qs(sp, { modo: "zonas" }), count: zonas.length },
    { id: "viviendas", label: "Viviendas (mismos supuestos)", href: qs(sp, { modo: "viviendas" }), count: viviendas.length },
    { id: "escenarios", label: "Escenarios guardados", href: qs(sp, { modo: "escenarios" }), count: escenarios.length },
  ];
  return (
    <div className="pb-8">
      <PageHeader title="Comparar" subtitle="Comparación con los mismos indicadores, periodos y supuestos. Cuando los periodos o las fuentes no coinciden, se indica." />
      <div className="px-4 md:px-6 space-y-3">
        <Tabs items={tabs} active={mode} />
        {mode === "zonas" && <ZoneCompare sp={sp} codes={zonas} userId={user.id} />}
        {mode === "viviendas" && <PropertyCompare sp={sp} ids={viviendas} userId={user.id} />}
        {mode === "escenarios" && <ScenarioCompare sp={sp} ids={escenarios} userId={user.id} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ zonas
async function ZoneCompare({ sp, codes, userId }: { sp: SP; codes: string[]; userId: string }) {
  const data = await withUser(userId, async (tx) => {
    const geos = await tx`select g.id, g.code, g.name, p.name as prov from geo.geographies g left join geo.geographies p on p.id = g.parent_id
                           where g.level = 'municipality' and g.valid_to is null and g.code = any(${codes})`;
    const ids = geos.map((g) => Number(g.id));
    const vals = ids.length ? await tx`select geography_id, indicator_code, value_num::float8 as v, period, resource_code, is_synthetic from stats.latest_values
                                        where geography_id = any(${ids}) and dims_key = '' and indicator_code = any(${ZONE_COLUMNS.map((c) => c.code)})` : [];
    const pref = await tx`select active_strategy from app.preferences where user_id = ${userId}`;
    const strategy = (pref[0]?.active_strategy as string) ?? "rent_long";
    const prof = await activeProfile(tx, userId, "zone", strategy);
    const scores = await Promise.all(ids.map((id) => zoneScore(tx, id, prof)));
    const market = ids.length ? await tx`select l.geography_id, count(distinct pl.property_id) as n from market.listings l join market.property_listings pl on pl.listing_id = l.id and pl.unlinked_at is null
                                          where l.status = 'active' and l.geography_id = any(${ids}) group by 1` : [];
    return { geos: codes.map((c) => geos.find((g) => g.code === c)).filter(Boolean) as typeof geos, vals, strategy, scores: Object.fromEntries(ids.map((id, i) => [id, scores[i]!])), market };
  });
  const v = (gid: number, code: string) => data.vals.find((x) => Number(x.geography_id) === gid && x.indicator_code === code);
  return (
    <>
      <form action="/comparar" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="modo" value="zonas" /><input type="hidden" name="zonas" value={codes.join(",")} />
        <label className="text-[12px]"><span className="block font-medium text-ink-2">Añadir municipio (nombre o código INE)</span>
          <input name="add" className="input w-72" placeholder="p. ej. Albacete o 02003" required /></label>
        <button className="btn" disabled={codes.length >= 6}>Añadir</button>
        <span className="meta">Hasta 6 municipios. También puede seleccionarlos en el <Link className="underline" href="/zonas">explorador de zonas</Link>.</span>
      </form>
      {sp.noencontrado && <Notice kind="warn">No se encontró el municipio «{sp.noencontrado}».</Notice>}
      {data.geos.length === 0 ? <Empty title="Sin zonas seleccionadas">Añada municipios para compararlos.</Empty> : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Indicador</th>{data.geos.map((g) => <th key={g.code} className="text-right min-w-[150px]">
                <Link className="hover:underline" href={`/zonas/municipality/${g.code}`}>{g.name}</Link><div className="meta font-normal">{g.prov} · {g.code}</div>
                <Link className="meta font-normal underline" href={qs(sp, { zonas: codes.filter((c) => c !== g.code).join(",") })}>quitar</Link></th>)}</tr></thead>
              <tbody>
                {ZONE_COLUMNS.map((c) => {
                  const periods = new Set(data.geos.map((g) => v(Number(g.id), c.code)?.period).filter(Boolean));
                  const values = data.geos.map((g) => v(Number(g.id), c.code)?.v ?? null);
                  const known = values.filter((x): x is number => x !== null);
                  const best = known.length > 1 ? Math.max(...known) : null;
                  return (
                    <tr key={c.code}>
                      <td>{c.label}{periods.size > 1 && <div className="meta text-warn">Periodos distintos: comparación con cautela</div>}</td>
                      {data.geos.map((g, i) => { const x = v(Number(g.id), c.code); return (
                        <td key={g.code} className={`text-right num ${values[i] !== null && values[i] === best ? "font-semibold" : ""}`}>
                          {x?.v == null ? <span className="meta">sin dato</span> : fmtUnit(x.v, c.unit)}<div className="meta">{x ? periodLabel(x.period) : ""}{x?.is_synthetic && <> <SyntheticBadge /></>}</div></td>); })}
                    </tr>
                  );
                })}
                <tr><td>Inmuebles con anuncio activo</td>{data.geos.map((g) => <td key={g.code} className="text-right num">{n(num(data.market.find((m) => Number(m.geography_id) === Number(g.id))?.n) ?? 0)}</td>)}</tr>
                <tr><td>Puntuación de zona · {strategyLabel(data.strategy)}</td>{data.geos.map((g) => { const s = data.scores[Number(g.id)]!; return (
                  <td key={g.code} className="text-right num">{s.status === "pending_configuration" ? <Link className="meta underline" href="/configuracion#scoring">sin perfil activo</Link>
                    : s.score === null ? <span className="meta">no puntuable</span> : <>{n(s.score)} / 100{s.status === "partial" && <div className="meta">parcial</div>}</>}</td>); })}</tr>
              </tbody>
            </table>
          </div>
          <p className="meta p-3">Negrita = valor más alto de la fila (no implica «mejor»: depende de su estrategia). Valores más recientes disponibles por indicador; ver fuente y método en la ficha de cada municipio.</p>
        </Panel>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ viviendas
const COMMON = [
  { key: "itp", label: "Impuesto de adquisición", unit: "%", pct: true }, { key: "not", label: "Notaría, registro, gestoría", unit: "%", pct: true },
  { key: "com", label: "Comunidad", unit: "€/mes", pct: false }, { key: "ibi", label: "IBI", unit: "€/año", pct: false }, { key: "seg", label: "Seguro", unit: "€/año", pct: false },
  { key: "vac", label: "Vacancia", unit: "%", pct: true }, { key: "man", label: "Mantenimiento", unit: "% ingresos", pct: true },
  { key: "ltv", label: "Financiación (LTV)", unit: "%", pct: true }, { key: "tin", label: "TIN", unit: "%", pct: true }, { key: "pla", label: "Plazo", unit: "años", pct: false },
] as const;
const pnum = (v?: string) => { if (!v) return null; const x = Number(v.replace(",", ".")); return Number.isFinite(x) ? x : null; };

function homogeneous(strategy: Strategy, price: number | null, rent: number | null, c: Record<string, number | null>, date: string): ScenarioInput {
  const s = templates(strategy, { price, date, rent });
  const fix = (items: Item[], id: string, patch: Partial<Item>) => items.forEach((it) => { if (it.id === id) Object.assign(it, patch); });
  const origin = "supuesto común del comparador";
  if (c.itp !== null) fix(s.acquisitionCosts, "itp", { rate: c.itp! / 100, status: "user_input", origin });
  if (c.not !== null) fix(s.acquisitionCosts, "notary", { rate: c.not! / 100, status: "user_input", origin });
  if (c.com !== null) fix(s.operatingExpenses, "community", { amount: c.com, status: "user_input", origin });
  if (c.ibi !== null) fix(s.operatingExpenses, "ibi", { amount: c.ibi, status: "user_input", origin });
  if (c.seg !== null) fix(s.operatingExpenses, "insurance", { amount: c.seg, status: "user_input", origin });
  if (c.man !== null) fix(s.operatingExpenses, "maintenance", { rate: c.man! / 100, status: "user_input", origin });
  if (c.vac !== null && s.operation.kind === "rent_long") s.operation.vacancy = { mode: "percent", percent: c.vac! / 100 };
  if (c.ltv && c.tin !== null && c.pla) s.financing.loans = [{ id: "h", label: "Hipoteca", ltv: { ratio: c.ltv / 100, base: "price" }, status: "user_input",
    rate: { type: "fixed", annualRate: c.tin! / 100 }, termMonths: Math.round(c.pla * 12), paymentFrequency: "monthly", fees: [] }];
  return s;
}

async function PropertyCompare({ sp, ids, userId }: { sp: SP; ids: string[]; userId: string }) {
  const strategy: Strategy = STRATEGIES.some((s) => s.id === sp.estrategia) ? (sp.estrategia as Strategy) : "rent_long";
  const common = Object.fromEntries(COMMON.map((c) => [c.key, pnum(sp[c.key])])) as Record<string, number | null>;
  const date = new Date().toISOString().slice(0, 10);
  const data = await withUser(userId, async (tx) => {
    const rows = ids.length ? await tx`
      select distinct on (p.id) p.id, st_y(p.location) as lat, st_x(p.location) as lon, l.title, l.price_amount::float8 as price, l.price_unit, l.built_area_m2::float8 as area, l.rooms, l.bathrooms,
             l.property_type, l.condition, l.has_elevator, l.is_synthetic, l.geography_id, g.name as muni_name
        from market.properties p join market.property_listings pl on pl.property_id = p.id and pl.unlinked_at is null
        join market.listings l on l.id = pl.listing_id left join geo.geographies g on g.id = l.geography_id
       where p.id = any(${ids}) order by p.id, (l.status = 'active' and l.operation = 'sale') desc, l.last_seen_at desc` : [];
    const ordered = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as typeof rows;
    const out = [];
    for (const r of ordered) {
      const zv = r.geography_id ? await tx`select indicator_code, value_num::float8 as v from stats.latest_values where geography_id = ${r.geography_id} and dims_key = ''
                                              and indicator_code in ('inc.net_mean_household','demo.pop_cagr_5y','mkt.offer_rent_m2')` : [];
      let rent: { value: number | null; note: string } = { value: null, note: "sin estimación" };
      if (r.geography_id && strategy === "rent_long") {
        const c = await comparables(tx, { propertyId: r.id, geographyId: Number(r.geography_id), area: num(r.area), rooms: r.rooms, type: r.property_type, lat: num(r.lat), lon: num(r.lon) }, "rent_long");
        const st = compStats(c.comps, new Set(), c.expanded);
        if (st.median && num(r.area) && st.quality !== "insuficiente") rent = { value: Math.round((st.median * num(r.area)!) / 10) * 10, note: `comparables (${st.nUsed}, calidad ${st.quality})` };
        else rent = { value: null, note: st.reasons[0] ?? "sin comparables" };
      }
      const price = r.price_unit === "sale_total" ? num(r.price) : null;
      const result = simulate(homogeneous(strategy, price, rent.value, common, date));
      out.push({ r, zv, rent, result });
    }
    const candidates = await tx`select o.property_id, l.title from app.opportunities o
                                  left join lateral (select l.title from market.property_listings pl join market.listings l on l.id = pl.listing_id where pl.property_id = o.property_id limit 1) l on true
                                 where not (o.property_id = any(${ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]})) order by o.updated_at desc limit 12`;
    return { out, candidates };
  });
  const keys = KEY_METRICS[strategy] ?? [];
  const zv = (x: { indicator_code: string; v: number }[], c: string) => x.find((z) => z.indicator_code === c)?.v ?? null;
  return (
    <>
      <form action="/comparar" className="rounded-lg border border-line bg-surface p-3">
        <input type="hidden" name="modo" value="viviendas" /><input type="hidden" name="viviendas" value={ids.join(",")} />
        <div className="mb-2 text-[13px] font-semibold">Supuestos comunes a todas las viviendas</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <label className="text-[12px]"><span className="block font-medium text-ink-2">Modalidad</span>
            <select name="estrategia" defaultValue={strategy} className="input">{STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          {COMMON.map((c) => (
            <label key={c.key} className="text-[12px]"><span className="block font-medium text-ink-2">{c.label} ({c.unit})</span>
              <input name={c.key} defaultValue={sp[c.key] ?? ""} className="input num" inputMode="decimal" placeholder="desconocido" /></label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2"><button className="btn-primary">Recalcular</button>
          <span className="meta">Campo vacío = desconocido (no cero). Las rentas se estiman por comparables solo para alquiler completo; en otras modalidades complete el escenario en la calculadora.</span></div>
      </form>
      {data.out.length === 0 ? <Empty title="Sin viviendas seleccionadas">Use «Comparar» desde la ficha de una vivienda o seleccione varias en Mis oportunidades.</Empty> : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Dato</th>{data.out.map(({ r }) => <th key={r.id} className="min-w-[170px] text-right">
                <Link className="hover:underline" href={`/viviendas/${r.id}`}>{r.title ?? "Inmueble"}</Link> {r.is_synthetic && <SyntheticBadge />}
                <div className="meta font-normal">{r.muni_name}</div><Link className="meta font-normal underline" href={qs(sp, { viviendas: ids.filter((x) => x !== r.id).join(",") })}>quitar</Link></th>)}</tr></thead>
              <tbody>
                {([["Precio publicado", (o) => eur(num(o.r.price))], ["€/m²", (o) => num(o.r.price) && num(o.r.area) ? `${n(num(o.r.price)! / num(o.r.area)!)} €/m²` : "—"],
                   ["Tipo · superficie", (o) => `${TYPE_LABEL[o.r.property_type] ?? "—"} · ${o.r.area ? `${n(num(o.r.area))} m²` : "m² ?"}`],
                   ["Habitaciones · baños", (o) => `${o.r.rooms ?? "?"} · ${o.r.bathrooms ?? "?"}`], ["Estado · ascensor", (o) => `${COND_LABEL[o.r.condition] ?? "—"} · ${o.r.has_elevator === null ? "?" : o.r.has_elevator ? "sí" : "no"}`],
                   ["Renta neta media hogar (municipio)", (o) => eur(zv(o.zv as never, "inc.net_mean_household"))], ["Crec. población 5 años (anual)", (o) => { const x = zv(o.zv as never, "demo.pop_cagr_5y"); return x === null ? "—" : `${n(x, 2)} %`; }],
                   ["Renta mensual usada", (o) => <>{o.rent.value ? `${eur(o.rent.value)}/mes` : "desconocida"}<div className="meta">{o.rent.note}</div></>],
                  ] as [string, (o: (typeof data.out)[number]) => React.ReactNode][]).map(([label, f]) => (
                  <tr key={label}><td>{label}</td>{data.out.map((o) => <td key={o.r.id} className="text-right num">{f(o)}</td>)}</tr>))}
                {keys.map((k) => <MetricRow key={k} k={k} results={data.out.map((o) => o.result)} />)}
                <tr><td>Datos pendientes</td>{data.out.map((o) => <td key={o.r.id} className="text-right meta">{o.result.missing.length ? o.result.missing.map((m) => m.concept).join(", ") : "ninguno"}</td>)}</tr>
                <tr><td></td>{data.out.map((o) => <td key={o.r.id} className="text-right"><Link className="btn py-0.5" href={`/calculadora?property=${o.r.id}&strategy=${strategy}${o.rent.value ? `&rent=${o.rent.value}` : ""}`}>Abrir en calculadora</Link></td>)}</tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {data.candidates.length > 0 && ids.length < 4 && (
        <div className="meta">Añadir desde Mis oportunidades: {data.candidates.map((c, i) => <span key={c.property_id}>{i > 0 && " · "}<Link className="underline" href={qs(sp, { viviendas: [...ids, c.property_id].join(","), modo: "viviendas" })}>{c.title ?? "Inmueble"}</Link></span>)}</div>
      )}
    </>
  );
}

function MetricRow({ k, results }: { k: string; results: ScenarioResult[] }) {
  const ms = results.map((r) => r.metrics[k]) as (Metric | undefined)[];
  const label = ms.find(Boolean)?.label ?? k;
  return <tr><td>{label}</td>{ms.map((m, i) => <td key={i} className={`text-right num ${m?.status !== "ok" ? "text-warn" : ""}`}>{fmtMetric(m)}</td>)}</tr>;
}

// ------------------------------------------------------------------------------------------------ escenarios
async function loadScenarios(tx: Tx, ids: string[]) {
  return ids.length ? tx`select s.id, s.name, s.strategy, s.inputs, s.property_id, s.updated_at, l.title from invest.scenarios s
                           left join lateral (select l.title from market.property_listings pl join market.listings l on l.id = pl.listing_id where pl.property_id = s.property_id limit 1) l on true
                          where s.id = any(${ids}) and s.archived_at is null` : [];
}

async function ScenarioCompare({ sp, ids, userId }: { sp: SP; ids: string[]; userId: string }) {
  const { rows, available } = await withUser(userId, async (tx) => ({
    rows: await loadScenarios(tx, ids),
    available: await tx`select s.id, s.name, s.strategy from invest.scenarios s where s.archived_at is null order by s.updated_at desc limit 30`,
  }));
  const sc = ids.map((id) => rows.find((r) => r.id === id)).filter((r) => !!r).map((r) => ({
    id: r!.id as string, name: r!.name as string, strategy: r!.strategy as string, title: (r!.title as string | null) ?? null,
    input: r!.inputs as ScenarioInput, result: simulate(r!.inputs as ScenarioInput) }));
  const allKeys = Array.from(new Set(sc.flatMap((s) => KEY_METRICS[s.strategy] ?? [])));
  const sum = (items: Item[], s: ScenarioResult, comp: string) => { const unk = s.ledger.some((e) => e.unknown && e.component === comp); return unk ? null : -s.ledger.filter((e) => e.component === comp && e.date === s.ledger[0]?.date).reduce((a, e) => a + e.amount, 0); };
  const assumptions: [string, (x: (typeof sc)[number]) => string][] = [
    ["Modalidad", (x) => strategyLabel(x.strategy)], ["Precio de compra", (x) => eur(x.input.purchase.price)], ["Fecha de compra", (x) => x.input.purchase.date],
    ["Gastos de adquisición (día de compra)", (x) => { const v = sum(x.input.acquisitionCosts, x.result, "acquisition"); return v === null ? "incluye desconocidos" : eur(v); }],
    ["Reforma", (x) => x.input.renovation.mode === "none" ? "sin reforma" : fmtMetric(x.result.metrics.renovationTotal)],
    ["Financiación", (x) => x.input.financing.loans.length ? x.input.financing.loans.map((l) => `${l.ltv ? `${n(l.ltv.ratio * 100)} % LTV` : eur(l.principal)} · ${l.rate.type === "fixed" ? `${n((l.rate.annualRate ?? NaN) * 100, 2)} %` : "escenario de tipos"} · ${n(l.termMonths / 12)} años`).join("; ") : "sin financiación"],
    ["Salida", (x) => x.input.exit ? `${x.input.exit.date} · ${eur(x.input.exit.price)}` : "sin venta"],
    ["Fiscalidad del inversor", (x) => x.input.investorTax?.mode === "manual" ? "manual" : "no configurada (antes de impuestos)"],
  ];
  return (
    <>
      <form action="/comparar" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="modo" value="escenarios" />
        <label className="text-[12px]"><span className="block font-medium text-ink-2">Escenarios (hasta 4)</span>
          <select name="escenarios" className="input w-96" defaultValue="" required>
            <option value="" disabled>Añadir escenario…</option>
            {available.filter((a) => !ids.includes(a.id)).map((a) => <option key={a.id} value={[...ids, a.id].join(",")}>{a.name} · {strategyLabel(a.strategy)}</option>)}
          </select></label>
        <button className="btn" disabled={ids.length >= 4}>Añadir</button>
      </form>
      {sc.length === 0 ? <Empty title="Sin escenarios seleccionados">Guarde escenarios en la calculadora y añádalos aquí.</Empty> : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Supuesto / métrica</th>{sc.map((s) => <th key={s.id} className="min-w-[170px] text-right"><Link className="hover:underline" href={`/calculadora?scenario=${s.id}`}>{s.name}</Link>
                <div className="meta font-normal">{s.title ?? "sin inmueble"}</div><Link className="meta font-normal underline" href={qs(sp, { escenarios: ids.filter((x) => x !== s.id).join(",") })}>quitar</Link></th>)}</tr></thead>
              <tbody>
                {assumptions.map(([l, f]) => { const vals = sc.map(f); const differ = new Set(vals).size > 1; return (
                  <tr key={l}><td>{l}{differ && <span className="chip ml-1 bg-info-50 text-info">difiere</span>}</td>{vals.map((v, i) => <td key={i} className="text-right num">{v}</td>)}</tr>); })}
                <tr><td>Estado del cálculo</td>{sc.map((s) => <td key={s.id} className="text-right">{s.result.status === "complete" ? "completo" : `parcial (${s.result.missing.length} pendientes)`}</td>)}</tr>
                {allKeys.map((k) => <MetricRow key={k} k={k} results={sc.map((s) => s.result)} />)}
              </tbody>
            </table>
          </div>
          <p className="meta p-3">Los resultados se recalculan con la versión actual del motor a partir de los datos guardados. Las filas marcadas «difiere» explican parte de las diferencias de resultado.</p>
        </Panel>
      )}
    </>
  );
}
