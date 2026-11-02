"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtUnit, n, periodLabel } from "@/lib/format";
import { IconClose } from "@/components/icons";

type P = { code: string; name: string; prov: string; hasGeometry: boolean; values: Record<string, { v: number | null; p: string; s: string; r: string }>;
           market: { properties: number; listings: number; synthetic: boolean } };
const ROWS: [string, string, string][] = [["pop.padron", "Población", "personas"], ["demo.pop_cagr_5y", "Crec. anual comp. 5 años", "%"],
  ["demo.pop_growth_1y", "Crecimiento 1 año", "%"], ["inc.net_mean_household", "Renta neta por hogar", "EUR"], ["tour.dwellings", "Viviendas turísticas", "viviendas"],
  ["mkt.offer_price_sale_m2", "Oferta venta (mediana)", "EUR/m2"], ["mkt.offer_rent_m2", "Oferta alquiler (mediana)", "EUR/m2/mes"]];

export function ZonePreview({ code, onClose }: { code: string; onClose: () => void }) {
  const [d, setD] = useState<P | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setD(null); setErr(null);
    fetch(`/api/zones/preview?code=${code}`, { signal: ctl.signal }).then(async (r) => (r.ok ? setD(await r.json()) : setErr("No se pudo cargar")))
      .catch(() => {});
    return () => ctl.abort();
  }, [code]);
  return (
    <aside aria-label="Vista previa del municipio" className="panel mt-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold">{d?.name ?? "Cargando…"}</div>
          {d && <div className="meta">{d.prov} · <span className="code">{d.code}</span>{!d.hasGeometry && " · sin geometría"}</div>}
        </div>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar vista previa"><IconClose /></button>
      </div>
      {err && <p role="alert" className="meta text-neg">{err}</p>}
      {d && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
            {ROWS.map(([k, l, u]) => (
              <div key={k}><dt className="meta">{l}</dt><dd className="num font-medium">{d.values[k]?.v == null ? <span className="text-ink-3">Sin dato</span> : fmtUnit(d.values[k]!.v, u)} <span className="meta">{periodLabel(d.values[k]?.p)}</span></dd></div>
            ))}
          </dl>
          <p className="meta mt-2">Cobertura de anuncios (separada de la estadística): {n(d.market.properties)} inmuebles únicos · {n(d.market.listings)} anuncios activos{d.market.synthetic && " · incluye sintéticos"}</p>
          <div className="mt-2 flex gap-2">
            <Link className="btn-primary" href={`/zonas/municipality/${d.code}`}>Abrir ficha</Link>
            <Link className="btn" href={`/viviendas?muni=${d.code}`}>Ver viviendas</Link>
          </div>
        </>
      )}
    </aside>
  );
}
