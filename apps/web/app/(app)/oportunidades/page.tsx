import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { OPPORTUNITY_STATUSES, TYPE_LABEL, strategyLabel } from "@/lib/domain";
import { ago, dateEs, eur, n } from "@/lib/format";
import { Empty, PageHeader, Panel, SyntheticBadge } from "@/components/ui";
import { OpportunityRowControls, CompareSelection } from "./OpportunityControls";

const KEY: Record<string, [string, string][]> = {
  resale: [["profitAfterFinancing", "Beneficio"], ["irrEquity", "TIR cap."]],
  default: [["netOperatingYield", "Rent. neta"], ["cashflowMonthly", "Flujo/mes"]],
};

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = OPPORTUNITY_STATUSES.some((s) => s.id === sp.estado) ? sp.estado! : null;
  const { rows, favorites, events } = await withUser(user.id, async (tx) => {
    const rows = await tx`
      select o.id, o.property_id, o.status, o.planned_offer::float8 as planned_offer, o.updated_at, o.created_at,
             l.title, l.price_amount::float8 as price, l.built_area_m2::float8 as area, l.rooms, l.property_type, l.is_synthetic, l.status as listing_status,
             g.name as muni_name, g.code as muni_code,
             (select count(*) from invest.scenarios s where s.property_id = o.property_id and s.archived_at is null) as n_scen,
             sc.id as scen_id, sc.name as scen_name, sc.strategy as scen_strategy, sc.listing_price_at_save::float8 as price_at_save,
             cr.status as calc_status, cr.metrics as calc_metrics,
             (select count(*) from app.notes nt where nt.target_type = 'property' and nt.target_id = o.property_id::text) as n_notes
        from app.opportunities o
        left join lateral (select l.* from market.property_listings pl join market.listings l on l.id = pl.listing_id
                            where pl.property_id = o.property_id and pl.unlinked_at is null order by (l.status = 'active') desc, l.last_seen_at desc limit 1) l on true
        left join geo.geographies g on g.id = l.geography_id
        left join lateral (select * from invest.scenarios s where s.property_id = o.property_id and s.archived_at is null
                            order by (s.id = o.main_scenario_id) desc, s.updated_at desc limit 1) sc on true
        left join lateral (select * from invest.calculation_results r where r.scenario_id = sc.id and r.kind = 'scenario' order by r.computed_at desc limit 1) cr on true
       where ${filter === null} or o.status = ${filter ?? ""}
       order by o.updated_at desc`;
    const favorites = await tx`
      select f.target_id as property_id, l.title, l.price_amount::float8 as price, g.name as muni_name, l.is_synthetic
        from app.favorites f
        join lateral (select l.* from market.property_listings pl join market.listings l on l.id = pl.listing_id
                       where pl.property_id = f.target_id::uuid and pl.unlinked_at is null order by l.last_seen_at desc limit 1) l on true
        left join geo.geographies g on g.id = l.geography_id
       where f.target_type = 'property' and not exists (select 1 from app.opportunities o where o.property_id = f.target_id::uuid)
       order by f.created_at desc limit 50`;
    const events = await tx`select e.to_status, e.from_status, e.created_at, e.note, l.title, o.property_id from app.opportunity_events e
                              join app.opportunities o on o.id = e.opportunity_id
                              left join lateral (select l.title from market.property_listings pl join market.listings l on l.id = pl.listing_id where pl.property_id = o.property_id limit 1) l on true
                             order by e.created_at desc limit 15`;
    return { rows, favorites, events };
  });
  const counts = await withUser(user.id, (tx) => tx`select status, count(*)::int as n from app.opportunities group by 1`);
  const cnt = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const label = (s: string) => OPPORTUNITY_STATUSES.find((x) => x.id === s)?.label ?? s;
  const metric = (m: unknown, k: string) => { const x = (m as Record<string, { status: string; value: number | null; unit: string }> | null)?.[k]; return x?.status === "ok" ? x : null; };

  return (
    <div className="pb-8">
      <PageHeader title="Mis oportunidades" subtitle="Inmuebles en seguimiento con su estado, oferta prevista y escenario principal. El estado es tuyo: no altera el anuncio." />
      <div className="px-4 md:px-6 space-y-3">
        <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-1">
          <Link href="/oportunidades" className={filter === null ? "btn-primary" : "btn"}>Todas ({counts.reduce((a, c) => a + Number(c.n), 0)})</Link>
          {OPPORTUNITY_STATUSES.map((s) => <Link key={s.id} href={`/oportunidades?estado=${s.id}`} className={filter === s.id ? "btn-primary" : "btn"}>{s.label} ({cnt(s.id)})</Link>)}
        </nav>
        {rows.length === 0 ? (
          <Empty title={filter ? `No hay oportunidades en «${label(filter)}»` : "Todavía no sigues ningún inmueble"}>
            Desde la ficha de una vivienda puedes asignarle un estado de seguimiento y una oferta prevista. <Link className="underline" href="/viviendas">Ir al explorador de viviendas</Link>.
          </Empty>
        ) : (
          <Panel>
            <CompareSelection>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th><span className="sr-only">Seleccionar</span></th><th>Inmueble</th><th className="text-right">Precio publicado</th><th className="text-right">Oferta prevista</th>
                    <th>Escenario principal</th><th className="text-right">Métricas</th><th>Estado</th><th>Actualizada</th></tr></thead>
                  <tbody>{rows.map((r) => {
                    const keys = KEY[r.scen_strategy === "resale" ? "resale" : "default"]!;
                    const changed = r.price_at_save !== null && r.price !== null && num(r.price_at_save) !== num(r.price);
                    return (
                      <tr key={r.id}>
                        <td><input type="checkbox" name="cmp" value={r.property_id} aria-label={`Seleccionar ${r.title ?? "inmueble"} para comparar`} /></td>
                        <td className="min-w-[220px]">
                          <Link className="font-medium hover:underline" href={`/viviendas/${r.property_id}`}>{r.title ?? "Inmueble"}</Link> {r.is_synthetic && <SyntheticBadge />}
                          <div className="meta">{r.muni_name ?? "—"} · {TYPE_LABEL[r.property_type] ?? "—"} · {r.area ? `${n(num(r.area))} m²` : "m² ?"} · {r.rooms ?? "?"} hab.
                            {r.listing_status !== "active" && " · anuncio no observado"} · {Number(r.n_notes)} nota(s)</div>
                        </td>
                        <td className="text-right num whitespace-nowrap">{eur(num(r.price))}{changed && <div className="meta text-info">al guardar escenario: {eur(num(r.price_at_save))}</div>}</td>
                        <td className="text-right num">{eur(num(r.planned_offer))}</td>
                        <td>{r.scen_id ? <><Link className="hover:underline" href={`/calculadora?scenario=${r.scen_id}`}>{r.scen_name}</Link>
                          <div className="meta">{strategyLabel(r.scen_strategy)} · {Number(r.n_scen)} escenario(s){r.calc_status === "partial" ? " · resultado parcial" : ""}</div></>
                          : <Link className="btn py-0.5" href={`/calculadora?property=${r.property_id}`}>Crear escenario</Link>}</td>
                        <td className="text-right num whitespace-nowrap">{r.scen_id ? keys.map(([k, l]) => {
                          const m = metric(r.calc_metrics, k);
                          return <div key={k}><span className="meta">{l} </span>{m ? (m.unit === "%" ? `${n(m.value, 2)} %` : eur(m.value)) : <span className="text-warn">no calc.</span>}</div>;
                        }) : "—"}</td>
                        <td><OpportunityRowControls propertyId={r.property_id} status={r.status} offer={num(r.planned_offer)} statuses={OPPORTUNITY_STATUSES as never} /></td>
                        <td className="meta whitespace-nowrap">{ago(r.updated_at)}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </CompareSelection>
          </Panel>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title={`Favoritos sin estado (${favorites.length})`}>
            <div className="p-3">{favorites.length === 0 ? <p className="meta">Sin favoritos pendientes de clasificar.</p> : (
              <ul className="divide-y divide-line-2 text-[13px]">{favorites.map((f) => (
                <li key={f.property_id} className="flex items-center justify-between py-1.5">
                  <span><Link className="hover:underline" href={`/viviendas/${f.property_id}`}>{f.title ?? "Inmueble"}</Link> {f.is_synthetic && <SyntheticBadge />}<span className="meta"> · {f.muni_name} · {eur(num(f.price))}</span></span>
                  <OpportunityRowControls propertyId={f.property_id} status={null} offer={null} statuses={OPPORTUNITY_STATUSES as never} compact />
                </li>))}</ul>)}
            </div>
          </Panel>
          <Panel title="Actividad reciente">
            <ul className="p-3 text-[13px] space-y-1">{events.length === 0 ? <li className="meta">Sin cambios de estado.</li> : events.map((e, i) => (
              <li key={i}><span className="meta">{dateEs(e.created_at, true)} · </span><Link className="hover:underline" href={`/viviendas/${e.property_id}`}>{e.title ?? "Inmueble"}</Link>
                <span className="meta">: {e.from_status ? `${label(e.from_status)} → ` : ""}{label(e.to_status)}{e.note ? ` · ${e.note}` : ""}</span></li>))}</ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
