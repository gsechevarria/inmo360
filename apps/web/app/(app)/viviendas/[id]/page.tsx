import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { scoreSubject, type ProfileConfig } from "@inmo360/scoring";
import { requireUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { COND_LABEL, OPPORTUNITY_STATUSES, TYPE_LABEL, strategyLabel } from "@/lib/domain";
import { dateEs, eur, n, periodLabel } from "@/lib/format";
import { canonical, comparables, propertyDetail } from "@/lib/queries/property";
import { activeProfile, zoneScore } from "@/lib/scoring";
import { compStats } from "@/lib/comparables";
import { LineChart } from "@/components/LineChart";
import { ScoreCard } from "@/components/ScoreCard";
import { NotesBox } from "@/components/NotesBox";
import { FavoriteButton } from "@/components/FavoriteButton";
import { Notice, PageHeader, Panel, SyntheticBadge } from "@/components/ui";
import { IconExternal } from "@/components/icons";
import { ComparablesPanel } from "./ComparablesPanel";
import { CorrectionForm, OpportunityControl } from "./PropertyControls";

const FIELD_LABEL: Record<string, string> = { property_type: "Tipo", built_area_m2: "Superficie construida (m²)", useful_area_m2: "Superficie útil (m²)", rooms: "Habitaciones",
  bathrooms: "Baños", floor_text: "Planta", has_elevator: "Ascensor", has_terrace: "Terraza", has_parking: "Garaje", condition: "Estado (actual)",
  energy_rating: "Certificado energético", year_built: "Año de construcción", address_text: "Dirección" };
const EVENT_LABEL: Record<string, string> = { new: "Alta observada", price_change: "Cambio de precio", attribute_change: "Cambio de datos", not_observed: "No observado en un recorrido completo",
  reappeared: "Reaparece (posible republicación)", withdrawn_confirmed: "Retirada confirmada por la fuente", possible_republication: "Posible republicación" };
function fmtVal(v: unknown, field?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "string" ? v.replace(/^"|"$/g, "") : v;
  if (typeof s === "boolean" || s === "true" || s === "false") return s === true || s === "true" ? "sí" : "no";
  if (field === "property_type") return TYPE_LABEL[String(s)] ?? String(s);
  if (field === "condition") return COND_LABEL[String(s)] ?? String(s);
  if (field === "year_built") return String(s);
  const x = typeof s === "number" ? s : /^-?\d+(\.\d+)?$/.test(String(s)) ? Number(s) : null;
  return x === null ? String(s) : n(x, Number.isInteger(x) ? 0 : 1);
}

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const d = await propertyDetail(tx, id);
    if (!d) return null;
    if (d.kind === "redirect") return d;
    const det = d;
    const main = det.listings.find((l) => l.status === "active") ?? det.listings[0];
    if (!main) return null;
    const canon = canonical(det.listings, det.corrections);
    const pref = await tx`select active_strategy from app.preferences where user_id = ${user.id}`;
    const strategy = (pref[0]?.active_strategy as string) ?? "rent_long";
    const geoId = num(main.geography_id);
    const area = (canon.built_area_m2?.value as number | null) ?? null, rooms = (canon.rooms?.value as number | null) ?? null;
    const subject = { propertyId: id, geographyId: geoId ?? 0, area, rooms, type: String(canon.property_type?.value ?? "unknown"), lat: num(det.prop.lat), lon: num(det.prop.lon) };
    const [sale, rent, zoneVals, scenarios, notes, opp, fav, zp, pp] = await Promise.all([
      geoId ? comparables(tx, subject, "sale") : null, geoId ? comparables(tx, subject, strategy === "rooms" ? "rooms" : strategy === "tourist" ? "tourist" : "rent_long") : null,
      geoId ? tx`select indicator_code, value_num::float8 as v, period, resource_code from stats.latest_values where geography_id = ${geoId} and dims_key = ''
                  and indicator_code in ('pop.padron','demo.pop_cagr_5y','inc.net_mean_household','tour.dwellings','mkt.offer_price_sale_m2','mkt.offer_rent_m2')` : [],
      tx`select id, name, strategy, updated_at, listing_price_at_save, parent_scenario_id from invest.scenarios where property_id = ${id} and archived_at is null order by updated_at desc`,
      tx`select id, body, created_at from app.notes where target_type = 'property' and target_id = ${id} order by created_at desc`,
      tx`select status, planned_offer from app.opportunities where property_id = ${id}`,
      tx`select 1 from app.favorites where target_type = 'property' and target_id = ${id}`,
      activeProfile(tx, user.id, "zone", strategy), activeProfile(tx, user.id, "property", "any"),
    ]);
    const zs = geoId ? await zoneScore(tx, geoId, zp) : null;
    const condScore = { to_renovate: 0, good: 1, new: 2 }[String(canon.condition?.value)] ?? null;
    const ps = scoreSubject(pp?.config as ProfileConfig ?? null, {
      area_per_room: { value: area && rooms ? area / Math.max(rooms, 1) : null }, bathrooms_ratio: { value: rooms && canon.bathrooms?.value != null ? Number(canon.bathrooms.value) / Math.max(rooms, 1) : null },
      elevator: { value: (canon.has_elevator?.value as boolean | null) ?? null }, condition: { value: condScore }, terrace: { value: (canon.has_terrace?.value as boolean | null) ?? null } });
    return { ...det, main, canon, strategy, sale, rent, zoneVals, scenarios, notes, opp: opp[0] ?? null, fav: fav.length > 0, zs, ps };
  });
  if (!data) notFound();
  if (data.kind === "redirect") redirect(`/viviendas/${data.to}`);
  const { main, canon } = data;
  const zv = (c: string) => data.zoneVals.find((z) => z.indicator_code === c);
  const prices = data.listings.filter((l) => l.status === "active").map((l) => num(l.price)).filter((x): x is number => x !== null);
  const synthetic = data.listings.some((l) => l.is_synthetic);
  const area = canon.built_area_m2?.value as number | null;

  const rentStats = data.rent ? compStats(data.rent.comps, new Set(), data.rent.expanded) : null;
  const estRent = rentStats?.median && area && data.rent?.unit === "rent_month" && rentStats.quality !== "insuficiente" ? Math.round(rentStats.median * area / 10) * 10 : null;
  const calcHref = `/calculadora?property=${data.prop.id}&strategy=${data.strategy}${estRent ? `&rent=${estRent}` : ""}`;

  return (
    <div className="pb-8">
      <PageHeader crumbs={[{ href: "/viviendas", label: "Viviendas" }, ...(main.muni_code ? [{ href: `/zonas/municipality/${main.muni_code}`, label: main.muni_name as string }] : [])]}
        title={<>{main.title ?? "Inmueble"} {synthetic && <SyntheticBadge />}</>}
        subtitle={<>{main.muni_name} · {data.listings.length} publicación(es) asociada(s) · comprobado {dateEs(main.last_checked_at)} · estrategia activa: {strategyLabel(data.strategy)}</>}
        actions={<>
          <FavoriteButton targetType="property" targetId={data.prop.id} active={data.fav} />
          <Link className="btn" href={`/comparar?viviendas=${data.prop.id}`}>Comparar</Link>
          <Link className="btn-primary" href={calcHref}>Analizar inversión</Link>
        </>} />
      <div className="grid gap-3 px-4 md:px-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          <Panel title="Resumen">
            <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
              <div><div className="meta">Precio publicado</div><div className="kpi num">{eur(prices[0] ?? null)}</div>
                {prices.length > 1 && <div className="meta">Rango entre publicaciones: {eur(Math.min(...prices))}–{eur(Math.max(...prices))}</div>}</div>
              <div><div className="meta">€/m² (construidos)</div><div className="text-[18px] font-semibold num">{prices[0] && area ? `${n(prices[0] / area)} €/m²` : "—"}</div>
                <div className="meta">Mediana oferta municipio: {zv("mkt.offer_price_sale_m2")?.v ? `${n(zv("mkt.offer_price_sale_m2")!.v)} €/m²` : "sin referencia"}</div></div>
              <div><div className="meta">Renta estimada (comparables)</div><div className="text-[18px] font-semibold num">{estRent ? `${eur(estRent)}/mes` : "—"}</div>
                <div className="meta">{estRent ? `Estimación propia · calidad ${rentStats!.quality}` : rentStats ? `No calculable: ${rentStats.reasons[0] ?? "sin comparables"}` : "Sin territorio"}</div></div>
              <div><div className="meta">Seguimiento</div><OpportunityControl propertyId={data.prop.id} status={data.opp?.status as string | null} offer={num(data.opp?.planned_offer)} statuses={OPPORTUNITY_STATUSES as never} /></div>
            </div>
          </Panel>

          <Panel title="Características (valores canónicos)">
            <div className="overflow-x-auto p-2">
              <table className="tbl"><thead><tr><th>Dato</th><th>Valor</th><th>Origen</th><th>Discrepancias entre fuentes</th><th><span className="sr-only">Corregir</span></th></tr></thead>
                <tbody>{Object.entries(canon).map(([f, c]) => (
                  <tr key={f}>
                    <td>{FIELD_LABEL[f]}</td>
                    <td className="num">{fmtVal(c.value, f)}</td>
                    <td className="meta">{c.origin}{c.correction && <> · {dateEs(c.correction.created_at as string)} · «{String(c.correction.reason)}»</>}</td>
                    <td className="meta">{c.discrepancies.length ? c.discrepancies.map((d) => `${d.source}: ${fmtVal(d.value, f)}`).join(" · ") : "—"}</td>
                    <td><CorrectionForm propertyId={data.prop.id} field={f} label={FIELD_LABEL[f]!} /></td>
                  </tr>
                ))}</tbody></table>
              <p className="meta px-2 pt-2">Las correcciones del usuario no sobrescriben el dato original: se guardan con autor, fecha y motivo. El estado tras una reforma se evalúa en la calculadora, no aquí.</p>
            </div>
          </Panel>

          <Panel title="Publicaciones asociadas">
            <div className="overflow-x-auto p-2">
              <table className="tbl"><thead><tr><th>Fuente</th><th className="text-right">Precio</th><th>Estado</th><th>Publicación declarada</th><th>Primera obs.</th><th>Última obs.</th><th>Vínculo</th><th></th></tr></thead>
                <tbody>{data.listings.map((l) => (
                  <tr key={l.id}>
                    <td><div>{l.source_code}</div><div className="meta code">{l.external_id}</div>{l.agency_name && <div className="meta">{l.agency_name}</div>}</td>
                    <td className="text-right num whitespace-nowrap">{eur(num(l.price))}{l.price_unit === "rent_month" ? "/mes" : ""}</td>
                    <td>{l.status === "active" ? "Activo" : l.status === "not_observed" ? "No observado (no implica venta)" : "Retirada confirmada"}</td>
                    <td className="meta">{l.published_at_declared ? dateEs(l.published_at_declared) : "no declarada"}</td>
                    <td className="meta">{dateEs(l.first_seen_at)}</td><td className="meta">{dateEs(l.last_seen_at)}</td>
                    <td className="meta">{l.link_type === "initial" ? "propia" : l.link_type === "user_confirmed" ? "unión confirmada" : "automática"}</td>
                    <td>{l.url && <a className="btn-ghost" href={l.url} target="_blank" rel="noopener noreferrer nofollow" aria-label="Abrir anuncio en la fuente"><IconExternal /></a>}</td>
                  </tr>
                ))}</tbody></table>
              <p className="meta px-2 pt-2">El tiempo durante el que se observa un anuncio no es «tiempo de venta».</p>
            </div>
          </Panel>

          <Panel title="Historial">
            <div className="p-4">
              {data.history.length > 1 && <LineChart title="Precio publicado" unit="EUR" points={data.history.map((h) => ({ x: dateEs(h.observed_at as string), y: num(h.price) }))} />}
              <ul className="mt-2 space-y-1 text-[13px]">
                {data.events.map((e) => (
                  <li key={e.id} className="flex gap-2"><span className="meta w-28 shrink-0">{dateEs(e.occurred_at as string)}</span>
                    <span>{EVENT_LABEL[e.event_type as string] ?? e.event_type} <span className="meta">({e.source_code})</span>
                      {e.event_type === "price_change" && <span className="num"> {eur(num((e.old_value as { price: number }).price))} → {eur(num((e.new_value as { price: number }).price))}</span>}</span></li>
                ))}
              </ul>
            </div>
          </Panel>

          {data.sale && <ComparablesPanel title="Comparables de venta (precio de oferta)" comps={data.sale.comps} expanded={data.sale.expanded} subjectArea={area} unit="sale_total" />}
          {data.rent && <ComparablesPanel title={`Comparables de alquiler · ${strategyLabel(data.strategy)}`} comps={data.rent.comps} expanded={data.rent.expanded} subjectArea={area} unit={data.rent.unit} />}

          <Panel title="Escenarios de inversión">
            <div className="p-3">
              {data.scenarios.length === 0 ? <p className="meta">Sin escenarios guardados.</p> : (
                <ul className="divide-y divide-line-2">
                  {data.scenarios.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-1.5 text-[13px]">
                      <span>{s.name} <span className="meta">· {strategyLabel(s.strategy as string)} · {dateEs(s.updated_at as string)}{s.parent_scenario_id ? " · alternativa" : ""}</span>
                        {num(s.listing_price_at_save) !== null && prices[0] !== undefined && num(s.listing_price_at_save) !== prices[0] &&
                          <span className="chip ml-1 bg-info-50 text-info">el precio del anuncio cambió desde que se guardó</span>}</span>
                      <Link className="btn py-1" href={`/calculadora?scenario=${s.id}`}>Abrir</Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link className="btn-primary mt-2" href={calcHref}>Nuevo escenario</Link>
            </div>
          </Panel>

          {data.candidates.length > 0 && (
            <Panel title="Posibles duplicados entre fuentes">
              <div className="p-3 text-[13px]">
                {data.candidates.map((c) => (
                  <div key={c.id} className="flex justify-between border-b border-line-2 py-1"><span>{c.a_src}:{c.a_ext} ↔ {c.b_src}:{c.b_ext} · puntuación {n(num(c.score))} · {c.status}</span>
                    <Link className="underline" href={`/importaciones/duplicados#c${c.id}`}>Revisar</Link></div>
                ))}
              </div>
            </Panel>
          )}
        </div>
        <aside className="space-y-3 min-w-0">
          <Panel title="Contexto territorial">
            <div className="grid grid-cols-2 gap-3 p-3 text-[13px]">
              {[["pop.padron", "Población", ""], ["demo.pop_cagr_5y", "Crec. anual 5 años", "%"], ["inc.net_mean_household", "Renta neta hogar", "€"], ["tour.dwellings", "Viviendas turísticas", ""]].map(([c, l, u]) => (
                <div key={c}><div className="meta">{l}</div><div className="num font-medium">{zv(c!)?.v == null ? "—" : `${n(zv(c!)!.v, u === "%" ? 2 : 0)}${u ? ` ${u}` : ""}`}</div><div className="meta">{periodLabel(zv(c!)?.period)}</div></div>
              ))}
            </div>
            {main.muni_code && <div className="px-3 pb-3"><Link className="btn" href={`/zonas/municipality/${main.muni_code}`}>Ficha de {main.muni_name}</Link></div>}
          </Panel>
          <Panel title="Puntuaciones">
            <div className="space-y-2 p-3">
              {data.zs && <ScoreCard result={data.zs} title="Zona" />}
              <ScoreCard result={data.ps} title="Vivienda (estado actual)" />
              <Notice>La puntuación de la operación se calcula en la calculadora con un escenario concreto.</Notice>
            </div>
          </Panel>
          <Panel title="Notas"><NotesBox targetType="property" targetId={data.prop.id} notes={data.notes.map((x) => ({ id: x.id as string, body: x.body as string, created_at: x.created_at as string }))} path={`/viviendas/${data.prop.id}`} /></Panel>
          <Panel title="Fuentes">
            <div className="p-3 meta">
              {Array.from(new Set(data.listings.map((l) => l.source_code as string))).map((s) => <div key={s}><code>{s}</code></div>)}
              <p className="mt-1">Precio de oferta ≠ tasación ≠ precio de cierre. Las fotografías no se muestran en la web inicial.</p>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
