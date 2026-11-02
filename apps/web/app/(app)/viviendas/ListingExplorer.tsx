"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ListingQuery } from "@/lib/queries/listings";
import { dateEs, eur, n, pct, signed } from "@/lib/format";
import { COND_LABEL, STRATEGIES, TYPE_LABEL } from "@/lib/domain";
import { ListingMap } from "@/components/ListingMap";
import { SyntheticBadge } from "@/components/ui";
import { saveSearch } from "../actions";
import { PropertyPreview } from "./PropertyPreview";

type Row = { property_id: string; listing_id: string; source_code: string; price: number | null; price_unit: string; operation: string; property_type: string;
  title: string | null; area: number | null; rooms: number | null; bathrooms: number | null; condition: string; has_elevator: boolean | null;
  location_precision: string; first_seen: string; checked: string; is_synthetic: boolean; muni_code: string | null; muni_name: string | null; prov_name: string | null;
  price_m2: number | null; n_listings: number; zone_m2: number | null; zone_rent_m2: number | null; price_changed: boolean };

const UNIT_LABEL: Record<string, string> = { sale_total: "", rent_month: "/mes", rent_room_month: "/hab./mes", rent_night: "/noche", other: " (unidad no estándar)" };

export function ListingExplorer({ q, rows, total, pageSize, strategy, sources, assumptions, selected }: {
  q: ListingQuery; rows: Row[]; total: number; pageSize: number; strategy: string; sources: { code: string; n: number }[];
  assumptions: Record<string, { value: number | null; status: string }> | null; selected: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"list" | "map">("list");
  const [follow, setFollow] = useState(!!q.bbox);
  const [saveName, setSaveName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v === null || v === "" ? p.delete(k) : p.set(k, v);
    if (resetPage && !("page" in patch)) p.delete("page");
    start(() => router.replace(`${path}?${p.toString()}`, { scroll: false }));
  };
  const queryForMap = useMemo(() => { const p = new URLSearchParams(sp.toString()); p.delete("bbox"); p.delete("sel"); p.delete("page"); return p.toString(); }, [sp]);
  const fit = q.muni.length ? { level: "municipality", codes: q.muni } : q.prov.length ? { level: "province", codes: q.prov } : q.ccaa.length ? { level: "ccaa", codes: q.ccaa } : null;
  const rental = strategy !== "resale";
  const acq = assumptions?.acquisition_cost_rate, ltv = assumptions?.ltv;
  const assumptionsOk = !!acq && acq.status !== "unknown" && acq.value !== null && !!ltv && ltv.status !== "unknown" && ltv.value !== null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const numInput = (key: string, label: string, ph?: string) => (
    <div>
      <label className="label" htmlFor={`f-${key}`}>{label}</label>
      <input id={`f-${key}`} className="input" inputMode="decimal" defaultValue={sp.get(key) ?? ""} placeholder={ph}
        onBlur={(e) => e.target.value !== (sp.get(key) ?? "") && set({ [key]: e.target.value.replace(/\./g, "").replace(",", ".") || null })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );

  return (
    <div className="px-3 pb-6 md:px-6">
      <div className="panel mb-3">
        <details open className="group">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[13px] font-semibold">Filtros
            <span className="meta font-normal">{STRATEGIES.find((s) => s.id === strategy)?.label} · {q.op === "sale" ? "venta" : "alquiler"}</span></summary>
          <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-6">
            <fieldset className="lg:col-span-2">
              <legend className="label">Operación del anuncio</legend>
              <div className="flex gap-1">
                {(["sale", "rent"] as const).map((o) => (
                  <button key={o} className={`btn flex-1 justify-center ${q.op === o ? "bg-brand-50 text-brand border-brand-2" : ""}`} aria-pressed={q.op === o} onClick={() => set({ op: o === "sale" ? null : o })}>
                    {o === "sale" ? "En venta" : "En alquiler (comparables)"}
                  </button>
                ))}
              </div>
              <p className="meta mt-1">Ámbito: {q.muni.length ? `${q.muni.length} municipio(s)` : q.prov.length ? `${q.prov.length} provincia(s)` : q.ccaa.length ? "comunidad" : "toda España"}
                {(q.muni.length > 0 || q.prov.length > 0) && <button className="ml-1 underline" onClick={() => set({ muni: null, prov: null, ccaa: null })}>quitar</button>}</p>
            </fieldset>
            {numInput("pmin", "Precio mínimo (€)")}
            {numInput("pmax", "Precio máximo (€)")}
            {numInput("amin", "Superficie mín. (m²)")}
            {numInput("amax", "Superficie máx. (m²)")}
            <div>
              <label className="label" htmlFor="f-types">Tipo</label>
              <select id="f-types" className="input" value={q.types[0] ?? ""} onChange={(e) => set({ types: e.target.value || null })}>
                <option value="">Todos</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {numInput("rooms", "Habitaciones (mín.)")}
            {numInput("baths", "Baños (mín.)")}
            <div>
              <label className="label" htmlFor="f-cond">Estado</label>
              <select id="f-cond" className="input" value={q.cond[0] ?? ""} onChange={(e) => set({ cond: e.target.value || null })}>
                <option value="">Cualquiera</option>{Object.entries(COND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <fieldset className="flex flex-col justify-end gap-1 text-[13px]">
              <legend className="sr-only">Características</legend>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.elevator} onChange={(e) => set({ elev: e.target.checked ? "1" : null })} /> Con ascensor</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.terrace} onChange={(e) => set({ terr: e.target.checked ? "1" : null })} /> Con terraza</label>
            </fieldset>
            <div>
              <label className="label" htmlFor="f-src">Fuente</label>
              <select id="f-src" className="input" value={q.source} onChange={(e) => set({ src: e.target.value || null })}>
                <option value="">Todas</option>{sources.map((s) => <option key={s.code} value={s.code}>{s.code} ({n(s.n)})</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-fresh">Comprobado en los últimos</label>
              <select id="f-fresh" className="input" value={q.fresh ?? ""} onChange={(e) => set({ fresh: e.target.value || null })}>
                <option value="">Cualquier fecha</option><option value="1">1 día</option><option value="7">7 días</option><option value="30">30 días</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-chg">Novedades</label>
              <select id="f-chg" className="input" value={q.changes} onChange={(e) => set({ chg: e.target.value || null })}>
                <option value="">Todas</option><option value="new">Nuevos (7 días)</option><option value="price">Cambio de precio (30 días)</option>
              </select>
            </div>
            {rental && q.op === "sale" && numInput("ymin", "Rentab. bruta estimada mín. (%)", "p. ej. 6")}
            <div>
              {numInput("emax", "Capital necesario máx. (€)")}
              {!assumptionsOk && <p className="meta text-warn">Requiere supuestos de compra y financiación (<Link className="underline" href="/configuracion#supuestos">configurar</Link>).</p>}
            </div>
            <fieldset className="flex flex-col justify-end gap-1 text-[13px]">
              <legend className="sr-only">Calidad de datos</legend>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.complete} onChange={(e) => set({ complete: e.target.checked ? "1" : null })} /> Solo con datos esenciales</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.synth} onChange={(e) => set({ synth: e.target.checked ? null : "0" })} /> Incluir sintéticos</label>
            </fieldset>
          </div>
        </details>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]" aria-live="polite">
        <strong className="num">{n(total)}</strong> inmuebles únicos {pending && <span className="meta">· actualizando…</span>}
        <label className="ml-2 flex items-center gap-1.5 text-ink-2"><input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); if (!e.target.checked) set({ bbox: null }); }} /> Buscar al mover el mapa</label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor="f-sort" className="meta">Ordenar</label>
          <select id="f-sort" className="input w-auto" value={q.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="recent">Más recientes</option><option value="price_asc">Precio ↑</option><option value="price_desc">Precio ↓</option>
            <option value="m2_asc">€/m² ↑</option><option value="m2_desc">€/m² ↓</option><option value="below_zone">Más por debajo de la mediana de la zona</option><option value="area_desc">Superficie ↓</option>
          </select>
          <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); const r = await saveSearch("listings", saveName, Object.fromEntries(sp.entries())); setMsg(r.ok ? "Búsqueda guardada" : r.error); if (r.ok) setSaveName(""); }}>
            <label htmlFor="ss-name" className="sr-only">Nombre de la búsqueda</label>
            <input id="ss-name" className="input w-36" placeholder="Nombre búsqueda" value={saveName} onChange={(e) => setSaveName(e.target.value)} required />
            <button className="btn">Guardar búsqueda</button>
          </form>
          {msg && <span role="status" className="meta">{msg}</span>}
        </div>
      </div>

      <div className="mb-2 flex gap-1 md:hidden" role="tablist">
        {(["list", "map"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`btn flex-1 justify-center ${tab === t ? "bg-brand-50 text-brand" : ""}`} onClick={() => setTab(t)}>{t === "list" ? "Lista" : "Mapa"}</button>)}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <div className={`${tab === "list" ? "" : "hidden"} md:block min-w-0`}>
          <ul className="space-y-2" aria-label="Viviendas">
            {rows.length === 0 && <li className="panel p-6 text-center meta">Ninguna vivienda cumple los filtros. Revise el ámbito o amplíe los rangos; si aún no hay importaciones, vaya a Importaciones.</li>}
            {rows.map((r) => {
              const dev = r.price_m2 && r.zone_m2 ? (r.price_m2 / r.zone_m2 - 1) * 100 : null;
              const yieldEst = rental && r.operation === "sale" && r.zone_rent_m2 && r.area && r.price ? (r.zone_rent_m2 * r.area * 12 / r.price) * 100 : null;
              const equity = assumptionsOk && r.price ? r.price * (1 + Number(acq!.value)) - r.price * Number(ltv!.value) : null;
              const active = selected === r.property_id;
              return (
                <li key={r.property_id}>
                  <article className={`panel p-3 ${active ? "ring-2 ring-focus" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button className="text-left font-semibold hover:underline" onClick={() => set({ sel: r.property_id }, false)} aria-expanded={active}>
                          {TYPE_LABEL[r.property_type] ?? r.property_type} · {r.area ? `${n(r.area)} m²` : "superficie ?"} · {r.rooms ?? "?"} hab. · {r.bathrooms ?? "?"} baños
                        </button>
                        <div className="meta">{r.muni_name ?? "Municipio desconocido"}{r.prov_name && ` (${r.prov_name})`} · {COND_LABEL[r.condition]} · {r.has_elevator === null ? "ascensor ?" : r.has_elevator ? "con ascensor" : "sin ascensor"}
                          {r.location_precision !== "exact" && <> · <span className="text-warn">ubicación {r.location_precision === "street" ? "de calle" : "aproximada"}</span></>}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[17px] font-semibold num">{eur(r.price)}{UNIT_LABEL[r.price_unit]}</div>
                        <div className="meta num">{r.price_m2 && r.price_unit === "sale_total" ? `${n(r.price_m2)} €/m²` : ""}</div>
                      </div>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-4">
                      <div><dt className="meta">vs. mediana zona</dt><dd className="num">{dev === null ? <span className="text-ink-3">sin referencia</span> : <span className={dev < 0 ? "text-pos" : "text-neg"}>{signed(dev, 0)}</span>}</dd></div>
                      {rental && r.operation === "sale" && <div><dt className="meta">Rentab. bruta ≈</dt><dd className="num" title="Estimación con la mediana municipal de oferta de alquiler; no es un resultado de inversión">{yieldEst === null ? <span className="text-ink-3">no calculable</span> : `${pct(yieldEst)} (est.)`}</dd></div>}
                      <div><dt className="meta">Capital necesario ≈</dt><dd className="num">{equity === null ? <span className="text-ink-3">configurar supuestos</span> : eur(equity)}</dd></div>
                      <div><dt className="meta">Comprobado</dt><dd>{dateEs(r.checked)}</dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {r.is_synthetic && <SyntheticBadge />}
                      <span className="chip bg-line-2 text-ink-2">{r.n_listings} publicación{r.n_listings === 1 ? "" : "es"}</span>
                      {r.price_changed && <span className="chip bg-info-50 text-info">cambio de precio</span>}
                      <span className="chip bg-line-2 text-ink-3">{r.source_code}</span>
                      <span className="ml-auto flex gap-1">
                        <Link className="btn py-1" href={`/viviendas/${r.property_id}`}>Ficha</Link>
                        <Link className="btn py-1" href={`/calculadora?property=${r.property_id}&strategy=${strategy}`}>Analizar</Link>
                      </span>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between">
            <span className="meta">Página {q.page} de {pages}</span>
            <div className="flex gap-1">
              <button className="btn" disabled={q.page <= 1} onClick={() => set({ page: String(q.page - 1) }, false)}>Anterior</button>
              <button className="btn" disabled={q.page >= pages} onClick={() => set({ page: String(q.page + 1) }, false)}>Siguiente</button>
            </div>
          </div>
        </div>
        <div className={`${tab === "map" ? "" : "hidden"} md:block`}>
          <ListingMap query={queryForMap} fitCodes={fit} selected={selected} className="h-[420px] lg:sticky lg:top-16 lg:h-[calc(100vh-150px)]"
            onSelect={(id) => set({ sel: id }, false)} onBounds={(b) => follow && set({ bbox: b.map((x) => x.toFixed(4)).join(",") })} />
        </div>
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          {selected ? <PropertyPreview id={selected} strategy={strategy} onClose={() => set({ sel: null }, false)} />
            : <div className="panel p-4 meta">Seleccione una vivienda en la lista o en el mapa para ver la vista previa.</div>}
        </div>
      </div>
    </div>
  );
}
