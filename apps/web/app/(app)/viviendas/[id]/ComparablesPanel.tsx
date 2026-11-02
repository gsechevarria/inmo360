"use client";
import { useMemo, useState } from "react";
import { compStats, type Comp } from "@/lib/comparables";
import { dateEs, eur, n } from "@/lib/format";
import { Panel, SyntheticBadge } from "@/components/ui";

const UNIT: Record<string, string> = { sale_total: "€/m²", rent_month: "€/m²/mes", rent_room_month: "€/hab./mes", rent_night: "€/noche" };

/** Comparables con motivo de inclusión, distribución y exclusiones del usuario (sin perder la selección original). */
export function ComparablesPanel({ title, comps, expanded, subjectArea, unit }: { title: string; comps: Comp[]; expanded: boolean; subjectArea: number | null; unit: string }) {
  const [excl, setExcl] = useState<Set<string>>(new Set());
  const perArea = unit === "sale_total" || unit === "rent_month";
  const st = useMemo(() => perArea ? compStats(comps, excl, expanded) : null, [comps, excl, expanded, perArea]);
  const raw = !perArea ? comps.filter((c) => !excl.has(c.listingId)).map((c) => c.price).sort((a, b) => a - b) : [];
  const med = raw.length ? raw[Math.floor((raw.length - 1) / 2)]! : null;
  const toggle = (id: string) => setExcl((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const est = st?.median && subjectArea ? st.median * subjectArea : null;
  return (
    <Panel title={title}>
      <div className="p-3">
        {comps.length === 0 ? <p className="meta">Sin comparables con anuncio activo en el municipio ni en la provincia.</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 text-[13px] md:grid-cols-5">
              <div><div className="meta">Muestra</div><div className="num font-medium">{st ? `${st.nUsed} de ${st.n}` : raw.length}</div></div>
              <div><div className="meta">Mediana</div><div className="num font-medium">{st ? (st.median ? `${n(st.median, unit === "rent_month" ? 1 : 0)} ${UNIT[unit]}` : "—") : med ? `${eur(med)}${unit === "rent_room_month" ? "/mes" : "/noche"}` : "—"}</div></div>
              {st && <div><div className="meta">Cuartiles (P25–P75)</div><div className="num">{st.p25 && st.p75 ? `${n(st.p25, 1)}–${n(st.p75, 1)}` : "—"}</div></div>}
              {st && <div><div className="meta">Calidad</div><div className={st.quality === "alta" ? "text-pos" : st.quality === "insuficiente" ? "text-neg" : "text-warn"}>{st.quality}</div></div>}
              {st && <div><div className="meta">{unit === "sale_total" ? "Referencia de oferta" : "Renta estimada"}</div>
                <div className="num font-medium">{est && st.quality !== "insuficiente" ? `${eur(Math.round(est / 100) * 100)}${unit === "rent_month" ? "/mes" : ""}` : "no se presenta"}</div></div>}
            </div>
            {st && <ul className="meta mt-1">{st.reasons.map((r) => <li key={r}>· {r}</li>)}
              <li>· Estadístico: mediana del precio por m² de inmuebles únicos; atípicos fuera de Q1−1,5·RIC / Q3+1,5·RIC (con ≥ 8 casos) se listan y no entran en el cálculo.</li>
              <li>· {unit === "sale_total" ? "Es una referencia de precio de oferta, no una tasación." : "Es una estimación propia de renta de oferta, no una referencia oficial."}</li>
              {st.oldest && <li>· Observaciones entre {dateEs(st.oldest)} y {dateEs(st.newest)}.</li>}</ul>}
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] font-medium">Ver comparables ({comps.length}) y excluir</summary>
              <div className="overflow-x-auto">
                <table className="tbl mt-1"><thead><tr><th>Usar</th><th className="text-right">Precio</th><th className="text-right">m²</th><th className="text-right">{UNIT[unit]}</th><th>Hab.</th><th>Distancia</th><th>Motivo de inclusión</th><th>Obs.</th></tr></thead>
                  <tbody>{comps.map((c) => {
                    const out = st?.outliers.includes(c.listingId);
                    return (
                      <tr key={c.listingId} className={excl.has(c.listingId) || out ? "opacity-50" : ""}>
                        <td><input type="checkbox" aria-label="Usar este comparable" checked={!excl.has(c.listingId)} onChange={() => toggle(c.listingId)} /></td>
                        <td className="text-right num">{eur(c.price)}</td><td className="text-right num">{c.area ?? "—"}</td>
                        <td className="text-right num">{c.area && perArea ? n(c.price / c.area, unit === "rent_month" ? 1 : 0) : "—"}</td><td>{c.rooms ?? "—"}</td>
                        <td className="num">{c.distanceM === null ? "ubicación aprox." : `${n(c.distanceM)} m`}</td>
                        <td className="meta">{c.reason}{out && " · ATÍPICO (excluido del cálculo)"} {c.synthetic && <SyntheticBadge />}</td><td className="meta">{dateEs(c.lastSeen)}</td>
                      </tr>
                    );
                  })}</tbody></table>
              </div>
              {excl.size > 0 && <button className="btn mt-1" onClick={() => setExcl(new Set())}>Restaurar selección original ({excl.size} excluidos)</button>}
            </details>
          </>
        )}
      </div>
    </Panel>
  );
}
