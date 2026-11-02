import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { FAMILY_LABELS } from "@/lib/domain";
import { dateEs, n } from "@/lib/format";
import { CoverageBar, PageHeader, Panel, Tabs, TechChip } from "@/components/ui";

const REUSE: Record<string, string> = { open_license: "Licencia abierta", reuse_with_conditions: "Reutilizable con condiciones", consult_only: "Solo consulta",
  restricted: "Restringido", unknown: "Por verificar", not_applicable: "No aplica" };
const MATCH: Record<string, { l: string; c: string }> = { exact: { l: "Exacta", c: "text-pos" }, equivalent_validated: { l: "Equivalente validada", c: "text-pos" },
  partial: { l: "Parcial", c: "text-warn" }, ambiguous: { l: "Ambigua", c: "text-warn" }, unresolved: { l: "Sin resolver", c: "text-neg" } };
const ROLE: Record<string, string> = { eligible: "Puntuable", not_scored: "No puntúa", excluded_protected: "Excluido (atributo protegido)", excluded_risk: "Excluido (riesgo)" };
const FN: Record<string, string> = { pantalla: "pantalla", filtro: "filtro", calculo: "cálculo", scoring: "scoring", contexto: "contexto", documentacion: "documentación" };
type SP = { vista?: string; q?: string; recurso?: string; estado?: string; seccion?: string; page?: string };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = ["recursos", "indicadores", "matriz", "exclusiones"].includes(sp.vista ?? "") ? sp.vista! : "recursos";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const like = `%${q}%`;
  const page = Math.max(1, Number(sp.page) || 1);
  const d = await withUser(user.id, async (tx) => {
    const [summary, sources] = await Promise.all([
      tx`select tech_status, count(*)::int as n from catalog.resources group by 1`,
      tx`select s.*, (select count(*) from catalog.resources r where r.source_code = s.code) as n_res from catalog.sources s order by s.family, s.name`,
    ]);
    let rows: Record<string, unknown>[] = [];
    let total = 0;
    if (view === "recursos") {
      rows = await tx`select r.*, s.name as source_name,
                             (select count(*) from catalog.resource_indicators ri where ri.resource_code = r.code) as n_ind,
                             (select count(*) from stats.observations o where o.resource_code = r.code and o.is_current) as n_obs
                        from catalog.resources r join catalog.sources s on s.code = r.source_code
                       where (${q === ""} or r.name ilike ${like} or r.code ilike ${like} or s.name ilike ${like})
                         and (${!sp.recurso} or r.code = ${sp.recurso ?? ""})
                         and (${!sp.estado} or r.tech_status = ${sp.estado ?? ""})
                       order by case r.tech_status when 'operational' then 0 when 'import_tested' then 1 when 'schema_validated' then 2 when 'download_tested' then 3
                                when 'resource_identified' then 4 when 'catalogued' then 5 when 'blocked' then 6 else 7 end, r.source_code, r.code`;
    } else if (view === "indicadores") {
      rows = await tx`select i.*, c.n_with_value, c.n_universe, c.period_min, c.period_max, c.any_synthetic,
                             (select string_agg(ri.resource_code, ', ') from catalog.resource_indicators ri where ri.indicator_code = i.code) as resources
                        from catalog.indicators i left join stats.indicator_coverage c on c.indicator_code = i.code
                       where (${q === ""} or i.name ilike ${like} or i.code ilike ${like} or i.original_name ilike ${like})
                         and (${!sp.seccion} or i.catalog_section = ${sp.seccion ?? ""})
                       order by (case when i.catalog_section ~ '^[0-9.]+$' then string_to_array(i.catalog_section, '.')::int[] end) nulls last, i.family, i.code`;
    } else if (view === "matriz") {
      const r = await tx`select *, count(*) over () as total from catalog.correspondence_matrix
                          where not is_excluded and (${q === ""} or original_label ilike ${like} or indicator_code ilike ${like} or resource_code ilike ${like})
                            and (${!sp.seccion} or section = ${sp.seccion ?? ""})
                            and (${!sp.estado} or label_match_status = ${sp.estado ?? ""})
                          order by (case when section ~ '^[0-9.]+$' then string_to_array(section, '.')::int[] end) nulls last, inventory_id limit 100 offset ${(page - 1) * 100}`;
      rows = r; total = num(r[0]?.total) ?? 0;
    } else {
      rows = await tx`select * from (select section, block, original_label, exclusion_reason, origin from catalog.inventory_items where is_excluded
                       union all select catalog_section, family, name, exclusion_reason, 'indicador' from catalog.indicators where is_excluded or is_protected_attribute) x
                       order by (case when section ~ '^[0-9.]+$' then string_to_array(section, '.')::int[] end) nulls last, block, original_label`;
    }
    const sections = await tx`select section, count(*)::int as n, count(*) filter (where match_status in ('exact','equivalent_validated'))::int as ok from catalog.inventory_items where not is_excluded group by 1 order by (case when section ~ '^[0-9.]+$' then string_to_array(section, '.')::int[] end) nulls last`;
    return { summary, sources, rows, total, sections };
  });
  const tot = d.summary.reduce((a, s) => a + Number(s.n), 0);
  const href = (patch: Partial<SP>) => { const u = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]); return `/catalogo?${u}`; };
  return (
    <div className="pb-8">
      <PageHeader title="Fuentes e indicadores" subtitle="Catálogo completo con estado técnico y de reutilización por separado. Encontrar la web de una fuente no la convierte en una integración: el estado refleja la prueba real." />
      <div className="space-y-3 px-4 md:px-6">
        <div className="flex flex-wrap gap-2 text-[13px]">
          {d.summary.sort((a, b) => Number(b.n) - Number(a.n)).map((s) => <Link key={s.tech_status} href={href({ vista: "recursos", estado: s.tech_status })} className="inline-flex items-center gap-1"><TechChip status={s.tech_status} /><span className="num">{s.n}</span></Link>)}
          <span className="meta self-center">· {tot} recursos · {d.sources.length} fuentes</span>
        </div>
        <Tabs active={view} items={[{ id: "recursos", label: "Fuentes y recursos", href: "/catalogo?vista=recursos" }, { id: "indicadores", label: "Indicadores", href: "/catalogo?vista=indicadores" },
          { id: "matriz", label: "Matriz de correspondencias", href: "/catalogo?vista=matriz" }, { id: "exclusiones", label: "Exclusiones", href: "/catalogo?vista=exclusiones" }]} />
        {view !== "exclusiones" && (
          <form action="/catalogo" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="vista" value={view} />
            <label className="text-[12px]"><span className="block font-medium text-ink-2">Buscar</span><input name="q" defaultValue={q} className="input w-72" placeholder="nombre, código…" /></label>
            {view !== "recursos" && <label className="text-[12px]"><span className="block font-medium text-ink-2">Sección</span>
              <select name="seccion" defaultValue={sp.seccion ?? ""} className="input w-40"><option value="">Todas</option>{d.sections.map((s) => <option key={s.section} value={s.section}>{s.section}</option>)}</select></label>}
            <button className="btn">Filtrar</button>{(q || sp.estado || sp.seccion || sp.recurso) && <Link className="btn-ghost" href={`/catalogo?vista=${view}`}>Limpiar</Link>}
          </form>
        )}

        {view === "recursos" && (
          <Panel>
            <div className="overflow-x-auto">
              <table className="tbl"><thead><tr><th>Recurso</th><th>Fuente</th><th>Estado técnico</th><th>Reutilización</th><th>Cobertura</th><th className="text-right">Indic.</th><th className="text-right">Observ. vigentes</th><th>Evidencia / bloqueo</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={String(r.code)}>
                    <td className="min-w-[220px]"><div className="font-medium">{String(r.name)}</div><div className="meta code">{String(r.code)}</div>
                      {r.url ? <a className="meta underline" href={String(r.url)} target="_blank" rel="noopener noreferrer nofollow">{String(r.url).replace(/^https?:\/\//, "").slice(0, 60)}</a> : <div className="meta">URL pendiente de identificar</div>}</td>
                    <td className="meta">{String(r.source_name)}</td>
                    <td><TechChip status={String(r.tech_status)} />{r.last_verified_at ? <div className="meta">verificado {dateEs(r.last_verified_at as string)}</div> : null}</td>
                    <td className="meta">{REUSE[String(r.reuse_status)]}</td>
                    <td className="meta">{[r.coverage_geo, r.coverage_time, r.frequency].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="text-right num">{n(num(r.n_ind))}</td><td className="text-right num">{n(num(r.n_obs))}</td>
                    <td className="meta max-w-[340px]">{String(r.blocked_reason ?? r.status_evidence ?? "") || "—"}</td>
                  </tr>))}</tbody></table>
            </div>
          </Panel>
        )}

        {view === "indicadores" && (
          <Panel>
            <div className="overflow-x-auto">
              <table className="tbl"><thead><tr><th>Indicador</th><th>Sección · familia</th><th>Unidad · tipo</th><th>Funciones</th><th>Scoring</th><th>Cobertura municipal</th><th>Periodos</th><th>Recursos</th></tr></thead>
                <tbody>{d.rows.map((i) => (
                  <tr key={String(i.code)} className={i.is_excluded ? "opacity-60" : ""}>
                    <td className="min-w-[220px]"><div className="font-medium">{String(i.name)}</div><div className="meta code">{String(i.code)}</div>{i.is_derived ? <div className="meta">Derivado: {String(i.formula ?? "")}</div> : null}</td>
                    <td className="meta">{String(i.catalog_section ?? "—")} · {FAMILY_LABELS[String(i.family)] ?? String(i.family)}</td>
                    <td className="meta">{String(i.unit ?? "—")} · {String(i.stat_type)}{(i.dimensions as string[]).length ? ` · dims: ${(i.dimensions as string[]).join(", ")}` : ""}</td>
                    <td className="meta">{(i.app_functions as string[]).map((f) => FN[f] ?? f).join(", ") || "—"}</td>
                    <td className={`meta ${String(i.scoring_role).startsWith("excluded") ? "text-neg" : ""}`}>{ROLE[String(i.scoring_role)]}</td>
                    <td className="min-w-[150px]">{i.n_with_value ? <CoverageBar n={num(i.n_with_value)!} of={num(i.n_universe)!} /> : <span className="meta">sin datos importados</span>}
                      {i.any_synthetic ? <div className="meta text-warn">incluye datos sintéticos</div> : null}</td>
                    <td className="meta">{i.period_min ? `${String(i.period_min)} – ${String(i.period_max)}` : "—"}</td>
                    <td className="meta code">{String(i.resources ?? "—")}</td>
                  </tr>))}</tbody></table>
            </div>
          </Panel>
        )}

        {view === "matriz" && (
          <>
            <div className="flex flex-wrap gap-1 text-[12px]">{d.sections.map((s) => (
              <Link key={s.section} href={href({ seccion: s.section, page: undefined })} className={`chip ${sp.seccion === s.section ? "bg-brand text-white" : "bg-line-2 text-ink-2"}`}>{s.section} · {s.ok}/{s.n}</Link>))}</div>
            <p className="meta">Cada etiqueta original (especificación y texto.txt) → indicador normalizado → recurso → estado. «Parcial» y «Ambigua» indican que la correspondencia no es exacta y se documenta en la nota.</p>
            <Panel>
              <div className="overflow-x-auto">
                <table className="tbl"><thead><tr><th>Sección</th><th>Etiqueta original</th><th>Origen</th><th>Correspondencia</th><th>Indicador</th><th>Recurso</th><th>Estado técnico</th></tr></thead>
                  <tbody>{d.rows.map((m, k) => (
                    <tr key={`${m.inventory_id}-${k}`}>
                      <td className="meta">{String(m.section)}</td><td className="min-w-[220px]">{String(m.original_label)}{m.block ? <div className="meta">{String(m.block)}</div> : null}</td>
                      <td className="meta">{String(m.origin)}</td><td className={`meta ${MATCH[String(m.label_match_status)]?.c}`}>{MATCH[String(m.label_match_status)]?.l}</td>
                      <td className="meta code">{String(m.indicator_code ?? "—")}</td><td className="meta code">{String(m.resource_code ?? "—")}</td>
                      <td>{m.tech_status ? <TechChip status={String(m.tech_status)} /> : <span className="meta">sin recurso</span>}</td>
                    </tr>))}</tbody></table>
              </div>
              <div className="flex items-center justify-between p-3 text-[13px]"><span className="meta">{n(d.total)} filas</span>
                <span className="flex gap-1">{page > 1 && <Link className="btn" href={href({ page: String(page - 1) })}>Anterior</Link>}{page * 100 < d.total && <Link className="btn" href={href({ page: String(page + 1) })}>Siguiente</Link>}</span></div>
            </Panel>
          </>
        )}

        {view === "exclusiones" && (
          <Panel title="Elementos excluidos y atributos protegidos">
            <p className="meta px-3 pt-2">Por decisión de producto no existe módulo de riesgo ni factores de riesgo en la puntuación. Los atributos protegidos (nacionalidad, sexo, origen, discapacidad…) pueden mostrarse como contexto estadístico pero nunca se usan para puntuar, penalizar ni filtrar.</p>
            <div className="overflow-x-auto p-2">
              <table className="tbl"><thead><tr><th>Sección</th><th>Bloque / familia</th><th>Elemento</th><th>Origen</th><th>Motivo</th></tr></thead>
                <tbody>{d.rows.map((x, k) => <tr key={k}><td className="meta">{String(x.section ?? "—")}</td><td className="meta">{String(x.block ?? "—")}</td><td>{String(x.original_label)}</td>
                  <td className="meta">{String(x.origin)}</td><td className="meta">{String(x.exclusion_reason ?? "Atributo protegido: solo contexto, nunca puntuación ni filtro")}</td></tr>)}</tbody></table>
            </div>
          </Panel>
        )}

        {view === "recursos" && (
          <Panel title={`Fuentes (${d.sources.length})`}>
            <div className="overflow-x-auto p-2">
              <table className="tbl"><thead><tr><th>Fuente</th><th>Familia</th><th>Organismo</th><th>Licencia / reutilización</th><th className="text-right">Recursos</th><th>Notas</th></tr></thead>
                <tbody>{d.sources.map((s) => <tr key={s.code}><td><div className="font-medium">{s.name}</div><div className="meta code">{s.code}</div></td><td className="meta">{s.family}</td>
                  <td className="meta">{s.owner_org ?? "—"}</td><td className="meta">{s.license ?? "—"} · {REUSE[s.reuse_status]}</td><td className="text-right num">{n(num(s.n_res))}</td>
                  <td className="meta max-w-[360px]">{s.reuse_notes ?? s.scope_note ?? ""}</td></tr>)}</tbody></table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
