"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ZONE_COLUMNS } from "@/lib/domain";
import { fmtUnit, n, periodLabel } from "@/lib/format";
import type { ZoneQuery, ZoneRow } from "@/lib/queries/zones";
import { ZoneMap } from "@/components/ZoneMap";
import { StatusChip } from "@/components/ui";
import { saveZoneSelection } from "../actions";
import { ZonePreview } from "./ZonePreview";

type Region = { ccaa: string; ccaa_name: string; prov: string; prov_name: string };

export function ZoneExplorer({ query, layer, rows, counts, pageSize, regions, selected, savedSelections }: {
  query: ZoneQuery; layer: string; rows: ZoneRow[]; counts: { total: number; notEvaluable: number; failing: number; scope: number };
  pageSize: number; regions: Region[]; selected: string | null; savedSelections: { id: string; name: string; n: number }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"map" | "list">("list");
  const [showCols, setShowCols] = useState(false);
  const [cond, setCond] = useState({ code: ZONE_COLUMNS[0].code as string, op: "gte", v: "" });
  const [saveName, setSaveName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v === null || v === "" ? p.delete(k) : p.set(k, v);
    if (resetPage && !("page" in patch)) p.delete("page");
    start(() => router.replace(`${path}?${p.toString()}`, { scroll: false }));
  };
  const ccaas = useMemo(() => Array.from(new Map(regions.map((r) => [r.ccaa, r.ccaa_name])).entries()), [regions]);
  const provs = regions.filter((r) => !query.ccaa.length || query.ccaa.includes(r.ccaa));
  const ids = query.ids;
  const toggleId = (code: string) => set({ ids: (ids.includes(code) ? ids.filter((c) => c !== code) : [...ids, code]).join(",") || null }, false);
  const colMeta = (c: string) => ZONE_COLUMNS.find((x) => x.code === c)!;
  const layerMeta = colMeta(layer);
  const pages = Math.max(1, Math.ceil(counts.total / pageSize));
  const highlight = selected ? [selected, ...ids] : ids;

  const sortBy = (c: string) => set({ sort: c, dir: query.sort === c && query.dir === "desc" ? "asc" : "desc" });
  const ariaSort = (c: string) => (query.sort === c ? (query.dir === "asc" ? "ascending" : "descending") : "none");

  return (
    <div className="px-3 pb-6 md:px-6">
      {/* Filtros agrupados y progresivos */}
      <div className="panel mb-3 p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <label className="label" htmlFor="f-ccaa">Comunidad autónoma</label>
            <select id="f-ccaa" className="input" value={query.ccaa[0] ?? ""} onChange={(e) => set({ ccaa: e.target.value || null, prov: null })}>
              <option value="">Toda España</option>
              {ccaas.map(([c, nm]) => <option key={c} value={c}>{nm}</option>)}
            </select>
          </div>
          <div>
            <span className="label" id="f-prov-l">Provincias {query.prov.length > 0 && <span className="meta">({query.prov.length})</span>}</span>
            <details className="relative">
              <summary className="input cursor-pointer list-none truncate">{query.prov.length ? provs.filter((p) => query.prov.includes(p.prov)).map((p) => p.prov_name).join(", ") : "Todas"}</summary>
              <div role="group" aria-labelledby="f-prov-l" className="absolute z-30 mt-1 max-h-72 w-72 overflow-auto rounded-md border border-line bg-surface p-2 shadow-lg">
                {provs.map((p) => (
                  <label key={p.prov} className="flex items-center gap-2 py-0.5 text-[13px]">
                    <input type="checkbox" checked={query.prov.includes(p.prov)}
                      onChange={() => set({ prov: (query.prov.includes(p.prov) ? query.prov.filter((x) => x !== p.prov) : [...query.prov, p.prov]).join(",") || null })} />
                    {p.prov_name} <span className="meta code">{p.prov}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
          <div>
            <label className="label" htmlFor="f-q">Municipio (nombre o código)</label>
            <input id="f-q" className="input" defaultValue={query.q} placeholder="p. ej. Albacete o 02003"
              onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value || null })} onBlur={(e) => e.target.value !== query.q && set({ q: e.target.value || null })} />
          </div>
          <div className="flex items-end gap-2">
            <button className="btn" onClick={() => setShowCols((s) => !s)} aria-expanded={showCols}>Columnas · {query.cols.length}</button>
          </div>
        </div>
        {showCols && (
          <fieldset className="mt-3 grid gap-1 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="sr-only">Columnas visibles</legend>
            {ZONE_COLUMNS.map((c) => (
              <label key={c.code} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={query.cols.includes(c.code)}
                  onChange={() => set({ cols: (query.cols.includes(c.code) ? query.cols.filter((x) => x !== c.code) : [...query.cols, c.code]).join(",") }, false)} />
                {c.label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <span className="text-[12px] font-medium text-ink-2">Condiciones:</span>
          {query.conds.map((c, i) => (
            <span key={i} className="chip bg-brand-50 text-brand">
              {colMeta(c.code).short} {c.op === "gte" ? "≥" : "≤"} {fmtUnit(c.v, colMeta(c.code).unit)}
              <button aria-label="Quitar condición" className="ml-1" onClick={() => set({ f: query.conds.filter((_, j) => j !== i).map((x) => `${x.code}:${x.op}:${x.v}`).join(",") || null })}>×</button>
            </span>
          ))}
          <select aria-label="Indicador de la condición" className="input w-auto" value={cond.code} onChange={(e) => setCond({ ...cond, code: e.target.value })}>
            {ZONE_COLUMNS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select aria-label="Operador" className="input w-auto" value={cond.op} onChange={(e) => setCond({ ...cond, op: e.target.value })}>
            <option value="gte">≥</option><option value="lte">≤</option>
          </select>
          <input aria-label="Valor" className="input w-28" inputMode="decimal" value={cond.v} onChange={(e) => setCond({ ...cond, v: e.target.value })} placeholder="valor" />
          <button className="btn" disabled={!cond.v || !Number.isFinite(Number(cond.v.replace(",", ".")))}
            onClick={() => { set({ f: [...query.conds.map((x) => `${x.code}:${x.op}:${x.v}`), `${cond.code}:${cond.op}:${Number(cond.v.replace(",", "."))}`].join(",") }); setCond({ ...cond, v: "" }); }}>
            Añadir
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={query.showNotEvaluable} onChange={(e) => set({ ne: e.target.checked ? "1" : null })} />
            Mostrar «no evaluables» ({n(counts.notEvaluable)})
          </label>
        </div>
      </div>

      {/* Resumen de resultados: no cumple ≠ no evaluable */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
        <strong className="num">{n(counts.total)}</strong> municipios
        {query.conds.length > 0 && <>
          <span className="meta">No cumplen: <span className="num">{n(counts.failing)}</span></span>
          <span className="meta" title="Les falta algún dato necesario para evaluar las condiciones">No evaluables (sin dato): <span className="num">{n(counts.notEvaluable)}</span></span>
        </>}
        {pending && <span className="meta">Actualizando…</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Link className={`btn ${ids.length < 2 ? "pointer-events-none opacity-50" : ""}`} aria-disabled={ids.length < 2} href={`/comparar?zonas=${ids.join(",")}`}>Comparar ({ids.length})</Link>
          <Link className="btn" href={`/viviendas?${ids.length ? `muni=${ids.join(",")}` : query.prov.length ? `prov=${query.prov.join(",")}` : ""}`}>Ver viviendas</Link>
        </div>
      </div>

      <div className="mb-2 flex gap-1 md:hidden" role="tablist">
        {(["list", "map"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`btn flex-1 justify-center ${tab === t ? "bg-brand-50 text-brand" : ""}`} onClick={() => setTab(t)}>{t === "list" ? "Lista" : "Mapa"}</button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className={`${tab === "map" ? "" : "hidden"} md:block`}>
          <div className="mb-2 flex items-center gap-2">
            <label htmlFor="f-layer" className="text-[12px] font-medium text-ink-2">Capa del mapa</label>
            <select id="f-layer" className="input w-auto" value={layer} onChange={(e) => set({ layer: e.target.value }, false)}>
              {ZONE_COLUMNS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <ZoneMap indicator={layer} unit={layerMeta.unit} label={layerMeta.label} selectedProvinces={query.prov} highlight={highlight}
            onSelect={(code) => set({ sel: code }, false)} className="h-[420px] lg:sticky lg:top-16 lg:h-[calc(100vh-170px)]" />
          {selected && <ZonePreview code={selected} onClose={() => set({ sel: null }, false)} />}
        </div>

        <div className={`${tab === "list" ? "" : "hidden"} md:block min-w-0`}>
          <div className="panel overflow-x-auto">
            <table className="tbl">
              <caption className="sr-only">Municipios que cumplen los filtros</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8"><span className="sr-only">Seleccionar</span></th>
                  <th scope="col" aria-sort={ariaSort("name")}><button className="font-semibold" onClick={() => sortBy("name")}>Municipio</button></th>
                  {query.cols.map((c) => (
                    <th key={c} scope="col" className="text-right" aria-sort={ariaSort(c)}>
                      <button className="font-semibold" onClick={() => sortBy(c)} title={colMeta(c).label}>
                        {colMeta(c).short}{query.sort === c ? (query.dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={query.cols.length + 2} className="py-8 text-center meta">
                    Ningún municipio cumple los filtros.{counts.notEvaluable > 0 && ` Hay ${n(counts.notEvaluable)} sin dato para evaluarlos.`}
                  </td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.code} className={!r.evaluable ? "opacity-70" : ""}>
                    <td><input type="checkbox" aria-label={`Seleccionar ${r.name}`} checked={ids.includes(r.code)} onChange={() => toggleId(r.code)} /></td>
                    <td>
                      <Link href={`/zonas/municipality/${r.code}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                      <div className="meta">{r.prov_name} · <span className="code">{r.code}</span>{!r.evaluable && " · no evaluable"}</div>
                    </td>
                    {query.cols.map((c) => {
                      const v = r.vals[c];
                      return (
                        <td key={c} className="text-right">
                          <div className="num">{v?.v == null ? <span className="text-ink-3" title="Sin dato">—</span> : fmtUnit(Number(v.v), colMeta(c).unit)}</div>
                          <div className="meta">{v ? periodLabel(v.p) : ""}{v?.s && !["observed", "revised"].includes(v.s) && v.v != null ? <> <StatusChip status={v.s} /></> : null}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="meta">Página {query.page} de {pages}</span>
            <div className="flex gap-1">
              <button className="btn" disabled={query.page <= 1} onClick={() => set({ page: String(query.page - 1) }, false)}>Anterior</button>
              <button className="btn" disabled={query.page >= pages} onClick={() => set({ page: String(query.page + 1) }, false)}>Siguiente</button>
            </div>
          </div>
          <div className="panel mt-3 p-3">
            <div className="text-[13px] font-semibold">Guardar selección de zonas</div>
            <p className="meta">Guarda los municipios marcados ({ids.length}) y los filtros actuales.</p>
            <form className="mt-2 flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const r = await saveZoneSelection(saveName, ids, Object.fromEntries(sp.entries()));
              setMsg(r.ok ? "Selección guardada." : r.error); if (r.ok) setSaveName("");
            }}>
              <label htmlFor="sel-name" className="sr-only">Nombre de la selección</label>
              <input id="sel-name" className="input" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Nombre" required />
              <button className="btn-primary" disabled={!ids.length || !saveName}>Guardar</button>
            </form>
            {msg && <p role="status" className="meta mt-1">{msg}</p>}
            {savedSelections.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1">
                {savedSelections.map((s) => <li key={s.id}><Link className="chip bg-line-2 text-ink-2 hover:bg-brand-50" href={`/busquedas#sel-${s.id}`}>{s.name} · {s.n}</Link></li>)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
