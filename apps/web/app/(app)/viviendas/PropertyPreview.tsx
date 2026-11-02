"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { dateEs, eur, n } from "@/lib/format";
import { setOpportunity } from "../actions";
import { SyntheticBadge } from "@/components/ui";
import { IconClose, IconExternal } from "@/components/icons";

type L = { id: string; source_code: string; external_id: string; url: string | null; operation: string; price: number | null; price_unit: string; title: string | null;
  area: number | null; rooms: number | null; bathrooms: number | null; floor_text: string | null; has_elevator: boolean | null; condition: string; energy_rating: string | null;
  location_precision: string; last_checked_at: string; first_seen_at: string; published_at_declared: string | null; is_synthetic: boolean; muni: string; muni_name: string };
type D = { id: string; listings: L[]; zone: Record<string, { v: number | null; p: string }>; opportunity: string | null; missing: string[] };

export function PropertyPreview({ id, strategy, onClose }: { id: string; strategy: string; onClose: () => void }) {
  const [d, setD] = useState<D | null>(null);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setD(null);
    fetch(`/api/properties/preview?id=${id}`, { signal: ctl.signal }).then((r) => r.json()).then((x) => { setD(x); setSaved(x.opportunity); }).catch(() => {});
    return () => ctl.abort();
  }, [id]);
  if (!d) return <aside className="panel p-4 meta" aria-busy>Cargando vista previa…</aside>;
  const m = d.listings[0]!;
  const prices = d.listings.map((x) => x.price).filter((x): x is number => x !== null);
  return (
    <aside aria-label="Vista previa del inmueble" className="panel p-3 lg:sticky lg:top-16">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{m.title ?? "Inmueble"}</div>
          <div className="meta">{m.muni_name} · <span className="code">{m.muni}</span> · ubicación {m.location_precision === "exact" ? "exacta" : "aproximada"}</div>
        </div>
        <button className="btn-ghost" aria-label="Cerrar" onClick={onClose}><IconClose /></button>
      </div>
      {m.is_synthetic && <div className="mt-1"><SyntheticBadge /></div>}
      <div className="mt-2 text-[20px] font-semibold num">{eur(m.price)}{m.price_unit === "rent_month" ? "/mes" : ""}</div>
      {prices.length > 1 && <p className="meta">Precio entre publicaciones: {eur(Math.min(...prices))} – {eur(Math.max(...prices))} ({prices.length} publicaciones)</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
        <dt className="meta">Superficie</dt><dd className="num">{m.area ? `${n(m.area)} m² construidos` : "—"}</dd>
        <dt className="meta">Habitaciones · baños</dt><dd>{m.rooms ?? "?"} · {m.bathrooms ?? "?"}</dd>
        <dt className="meta">Planta · ascensor</dt><dd>{m.floor_text ?? "?"} · {m.has_elevator === null ? "?" : m.has_elevator ? "sí" : "no"}</dd>
        <dt className="meta">Estado</dt><dd>{m.condition}</dd>
        <dt className="meta">Mediana zona (venta)</dt><dd className="num">{d.zone["mkt.offer_price_sale_m2"]?.v ? `${n(d.zone["mkt.offer_price_sale_m2"].v)} €/m²` : "sin referencia"}</dd>
        <dt className="meta">Mediana zona (alquiler)</dt><dd className="num">{d.zone["mkt.offer_rent_m2"]?.v ? `${n(d.zone["mkt.offer_rent_m2"].v, 1)} €/m²/mes` : "sin referencia"}</dd>
        <dt className="meta">Comprobado</dt><dd>{dateEs(m.last_checked_at)}</dd>
        <dt className="meta">Publicado (declarado)</dt><dd>{m.published_at_declared ? dateEs(m.published_at_declared) : "no declarado"}</dd>
      </dl>
      {d.missing.length > 0 && <p className="mt-2 rounded-md bg-warn-50 px-2 py-1 text-[12.5px] text-warn">Datos esenciales pendientes: {d.missing.join(", ")}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link className="btn-primary" href={`/calculadora?property=${id}&strategy=${strategy}`}>Analizar</Link>
        <Link className="btn" href={`/viviendas/${id}`}>Ficha completa</Link>
        <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await setOpportunity(id, saved ?? "saved", null); if (r.ok) setSaved(saved ?? "saved"); })}>
          {saved ? "En mis oportunidades" : "Guardar"}
        </button>
        <Link className="btn" href={`/comparar?viviendas=${id}`}>Comparar</Link>
        {m.url && <a className="btn" href={m.url} target="_blank" rel="noopener noreferrer nofollow">Fuente <IconExternal /></a>}
      </div>
    </aside>
  );
}
