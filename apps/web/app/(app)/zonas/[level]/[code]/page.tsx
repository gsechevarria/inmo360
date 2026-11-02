import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { FAMILY_LABELS, ZONE_SECTIONS, strategyLabel } from "@/lib/domain";
import { dateEs, dimsLabel, fmtUnit, n, periodLabel } from "@/lib/format";
import { childAggregates, familyCatalog, marketCoverage, zoneHeader, zoneSeries, zoneValues, type ZoneValue } from "@/lib/queries/zone-detail";
import { activeProfile, zoneScore } from "@/lib/scoring";
import { LineChart } from "@/components/LineChart";
import { ScoreCard } from "@/components/ScoreCard";
import { Metric, Notice, PageHeader, Panel, StatusChip, TechChip } from "@/components/ui";
import { NotesBox } from "@/components/NotesBox";
import { FavoriteButton } from "@/components/FavoriteButton";

const LEVEL_LABEL: Record<string, string> = { municipality: "Municipio", province: "Provincia", ccaa: "Comunidad autónoma" };

export async function generateMetadata({ params }: { params: Promise<{ level: string; code: string }> }) {
  const { code } = await params;
  return { title: `Ficha ${code}` };
}

export default async function ZoneDetail({ params }: { params: Promise<{ level: string; code: string }> }) {
  const user = await requireUser();
  const { level, code } = await params;
  if (!["municipality", "province", "ccaa"].includes(level) || !/^\d{2,5}$/.test(code)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const h = await zoneHeader(tx, level, code);
    if (!h) return null;
    const geoId = num(h.id)!;
    const pref = await tx`select active_strategy from app.preferences where user_id = ${user.id}`;
    const strategy = (pref[0]?.active_strategy as string) ?? "rent_long";
    const [values, series, catalog, aggs, market, notes, fav, profile] = await Promise.all([
      zoneValues(tx, geoId), zoneSeries(tx, geoId, ["pop.padron", "inc.net_mean_household", "inc.net_mean_person"]), familyCatalog(tx),
      level !== "municipality" ? childAggregates(tx, geoId, level) : Promise.resolve([]), marketCoverage(tx, geoId, level),
      tx`select id, body, created_at from app.notes where target_type = 'geography' and target_id = ${`${level}:${code}`} order by created_at desc`,
      tx`select 1 from app.favorites where target_type = 'geography' and target_id = ${`${level}:${code}`}`,
      activeProfile(tx, user.id, "zone", strategy),
    ]);
    const score = level === "municipality" ? await zoneScore(tx, geoId, profile) : null;
    const vte = await tx`select period, value_num from stats.observations where geography_id = ${geoId} and indicator_code = 'tour.dwellings' and is_current order by period`;
    return { h, values, series, catalog, aggs, market, notes, fav: fav.length > 0, score, strategy, vte };
  });
  if (!data) notFound();
  const { h, values } = data;
  const v = (c: string) => values.find((x) => x.code === c && x.dims_key === "");
  const crumbs = [{ href: "/zonas", label: "España" }];
  if (h.pp_code) crumbs.push({ href: `/zonas/${h.pp_level}/${h.pp_code}`, label: h.pp_name });
  if (h.p_code && h.p_level !== "country") crumbs.push({ href: `/zonas/${h.p_level}/${h.p_code}`, label: h.p_name });
  const pop = v("pop.padron");
  const byFamily = new Map<string, ZoneValue[]>();
  for (const x of values) if (x.dims_key === "" || x.protected) (byFamily.get(x.family) ?? byFamily.set(x.family, []).get(x.family)!).push(x);
  const haveCodes = new Set(values.filter((x) => x.value !== null).map((x) => x.code));
  const resources = Array.from(new Map(values.filter((x) => x.resource).map((x) => [x.resource!, x])).values());

  return (
    <div className="pb-8">
      <PageHeader crumbs={crumbs}
        title={<>{h.name} <span className="meta text-[14px] font-normal">{LEVEL_LABEL[level]} · INE <span className="code">{h.code}</span></span></>}
        subtitle={<>
          {pop?.value != null && <>{n(pop.value)} hab. · Padrón {pop.period} · </>}
          {h.area && <>{n(num(h.area), 1)} km² (geometría simplificada) · </>}
          {h.valid_to && <strong className="text-warn">Territorio histórico (hasta {dateEs(h.valid_to)}) · </strong>}
          {!h.has_geometry && <span className="text-warn">Sin geometría en la cartografía cargada · </span>}
          Estrategia activa: {strategyLabel(data.strategy)}
        </>}
        actions={<>
          <FavoriteButton targetType="geography" targetId={`${level}:${code}`} active={data.fav} />
          {level === "municipality" && <Link className="btn" href={`/comparar?zonas=${code}`}>Comparar</Link>}
          {(level === "province" || level === "ccaa") && <Link className="btn" href={`/zonas?${level === "province" ? "prov" : "ccaa"}=${code}`}>Ver municipios</Link>}
          <Link className="btn-primary" href={`/viviendas?${level === "municipality" ? "muni" : level === "province" ? "prov" : "ccaa"}=${code}`}>Ver viviendas</Link>
        </>} />
      {h.notes && <div className="px-4 md:px-6 mb-3"><Notice kind="warn">{h.notes}</Notice></div>}

      <nav aria-label="Secciones de la ficha" className="sticky top-[49px] z-10 mb-3 flex gap-1 overflow-x-auto border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-6">
        {[["resumen", "Resumen"], ...ZONE_SECTIONS.map((s) => [s.id, s.title]), ["indicadores", "Indicadores completos"], ["fuentes", "Fuentes y metodología"]].map(([id, t]) => (
          <a key={id} href={`#${id}`} className="whitespace-nowrap px-3 py-2 text-[13px] text-ink-2 hover:text-brand">{t}</a>
        ))}
      </nav>

      <div className="grid gap-3 px-4 md:px-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          <Panel title="Resumen" id="resumen">
            <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
              {[["pop.padron", "Población"], ["demo.pop_cagr_5y", "Crec. anual compuesto 5 años"], ["inc.net_mean_household", "Renta neta por hogar"],
                ["tour.dwellings", "Viviendas turísticas"], ["demo.pop_growth_1y", "Crecimiento 1 año"], ["demo.pop_cagr_10y", "Crec. anual compuesto 10 años"],
                ["inc.net_mean_person", "Renta neta por persona"], ["demo.density", "Densidad"]].map(([c, l]) => {
                const x = v(c!);
                return <Metric key={c} label={l!} value={x?.value ?? null} unit={x?.unit} period={x?.period} status={x?.status} source={x?.resource} big={c === "pop.padron"}
                  hint={x?.warnings?.length ? x.warnings[0] : x && x.value === null ? "Sin dato en la fuente" : !x ? "Pendiente de importar" : null} />;
              })}
            </div>
            {level !== "municipality" && data.aggs.length > 0 && (
              <div className="border-t border-line p-4">
                <div className="text-[13px] font-semibold">Agregados calculados sobre sus municipios</div>
                <p className="meta mb-2">No son referencias publicadas para la {LEVEL_LABEL[level]!.toLowerCase()}: la suma solo se usa en magnitudes aditivas y, en el resto, la mediana municipal con su n.</p>
                <table className="tbl"><thead><tr><th>Indicador</th><th className="text-right">Valor calculado</th><th>Método</th><th className="text-right">n / municipios</th><th>Periodos</th></tr></thead>
                  <tbody>{data.aggs.map((a) => (
                    <tr key={a.code}><td>{a.name}</td>
                      <td className="text-right num">{fmtUnit(a.additive ? a.total : a.median, a.unit)}</td>
                      <td className="meta">{a.additive ? (a.n < a.universe ? "Suma parcial (faltan municipios)" : "Suma de municipios") : "Mediana municipal"}</td>
                      <td className="text-right num">{n(a.n)} / {n(a.universe)}</td><td className="meta">{a.pmin === a.pmax ? periodLabel(a.pmin) : `${periodLabel(a.pmin)}–${periodLabel(a.pmax)}`}</td></tr>
                  ))}</tbody></table>
              </div>
            )}
          </Panel>

          {ZONE_SECTIONS.map((s) => {
            const rows = s.families.flatMap((f) => byFamily.get(f) ?? []);
            const pending = data.catalog.filter((c) => s.families.includes(c.family as string) && !haveCodes.has(c.code as string));
            return (
              <Panel key={s.id} title={s.title} id={s.id}>
                <div className="p-4">
                  {s.id === "poblacion" && data.series["pop.padron"] && <LineChart title="Población padronal" unit="personas" points={data.series["pop.padron"]} />}
                  {s.id === "economia" && data.series["inc.net_mean_household"] && <LineChart title="Renta neta media por hogar" unit="EUR" points={data.series["inc.net_mean_household"]} />}
                  {s.id === "turismo" && data.vte.length > 1 && <LineChart title="Viviendas turísticas (INE, experimental)" unit="viviendas" points={data.vte.map((r) => ({ x: periodLabel(r.period), y: num(r.value_num) }))} />}
                  {s.id === "mercado" && (
                    <div className="mb-3 rounded-md bg-canvas p-3 text-[13px]">
                      <div className="font-semibold">Cobertura de anuncios (independiente de la estadística)</div>
                      {data.market.length === 0 ? <p className="meta">Sin anuncios importados en este territorio.</p> : data.market.map((m) => (
                        <p key={m.operation} className="meta">{m.operation === "sale" ? "Venta" : "Alquiler"}: {n(m.properties)} inmuebles únicos · {n(m.listings)} anuncios · {m.sources} fuente(s) · última observación {dateEs(m.lastSeen)}{m.synthetic && " · incluye SINTÉTICOS"}</p>
                      ))}
                    </div>
                  )}
                  {rows.length > 0 ? (
                    <table className="tbl mt-2">
                      <thead><tr><th>Indicador</th><th className="text-right">Valor</th><th>Periodo</th><th>Estado</th><th>Fuente</th></tr></thead>
                      <tbody>{rows.map((x) => (
                        <tr key={x.code + x.dims_key}>
                          <td>{x.name}{x.dims_key && <span className="meta"> · {dimsLabel(x.dims_key)}</span>}
                            {x.protected && <div className="meta">Contexto agregado: no se usa en filtros ni puntuaciones.</div>}
                            {x.warnings?.length ? <div className="meta text-warn">{x.warnings.join(" · ")}</div> : null}</td>
                          <td className="text-right num whitespace-nowrap">{x.value === null ? <span className="text-ink-3">{x.raw ?? "—"}</span> : fmtUnit(x.value, x.unit)}</td>
                          <td className="meta whitespace-nowrap">{periodLabel(x.period)}</td>
                          <td><StatusChip status={x.status} /></td>
                          <td className="meta"><code>{x.resource}</code>{x.kind === "derived" && <div title={x.formula ?? undefined}>derivado</div>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : <p className="meta">Sin datos importados para este bloque.</p>}
                  {pending.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer meta">{pending.length} indicadores del catálogo sin dato aquí (pendientes de fuente o importación)</summary>
                      <ul className="mt-1 grid gap-x-4 text-[12.5px] md:grid-cols-2">
                        {pending.map((p) => <li key={p.code as string} className="flex justify-between gap-2 border-b border-line-2 py-0.5"><span>{p.name as string}</span><span className="meta">{(p.statuses as string | null)?.split(",").map((st) => <TechChip key={st} status={st} />) ?? "sin recurso"}</span></li>)}
                      </ul>
                    </details>
                  )}
                </div>
              </Panel>
            );
          })}

          <Panel title="Indicadores completos" id="indicadores">
            <div className="p-4 text-[13px]">
              <p className="meta mb-2">Todos los indicadores del catálogo por familia. Los que no tienen dato muestran el estado de su recurso.</p>
              {Object.entries(FAMILY_LABELS).filter(([f]) => f !== "excluidos").map(([f, label]) => {
                const all = data.catalog.filter((c) => c.family === f);
                const have = all.filter((c) => haveCodes.has(c.code as string)).length;
                return all.length ? <div key={f} className="flex justify-between border-b border-line-2 py-1"><span>{label}</span><span className="num meta">{have} con dato / {all.length}</span></div> : null;
              })}
              <Link href="/catalogo?vista=indicadores" className="btn mt-2">Abrir catálogo</Link>
            </div>
          </Panel>

          <Panel title="Fuentes, cobertura y metodología" id="fuentes">
            <div className="p-4 text-[13px] space-y-1">
              {resources.map((r) => (
                <p key={r.resource}><code>{r.resource}</code> · captura {dateEs(r.as_of)}{r.method === "browser_capture" && " · respuesta real capturada desde el navegador del propietario e importada por el trabajador"}{r.kind === "derived" && " · cálculo propio con fórmula registrada"}</p>
              ))}
              <p className="meta">Geometría: {h.version_label ?? "—"}. Los territorios se unen por código INE (texto), nunca por nombre. Periodos distintos no se ajustan: cada cifra lleva el suyo.</p>
            </div>
          </Panel>
        </div>

        <aside className="space-y-3 min-w-0">
          {data.score && <Panel title="Puntuación de zona"><div className="p-3"><ScoreCard result={data.score} title={`Zona · ${strategyLabel(data.strategy)}`} /></div></Panel>}
          <Panel title="Notas"><NotesBox targetType="geography" targetId={`${level}:${code}`} notes={data.notes.map((x) => ({ id: x.id as string, body: x.body as string, created_at: x.created_at as string }))} path={`/zonas/${level}/${code}`} /></Panel>
        </aside>
      </div>
    </div>
  );
}
