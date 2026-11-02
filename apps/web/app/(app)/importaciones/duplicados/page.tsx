import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { dateEs, eur, n } from "@/lib/format";
import { Empty, PageHeader, Panel, SyntheticBadge } from "@/components/ui";
import { MatchReview } from "../ImportControls";

const SIG: Record<string, string> = { area: "Superficie", distance: "Distancia", agency_ref: "Referencia de agencia", agency_reference: "Referencia de agencia", image: "Imagen idéntica", description: "Descripción", rooms: "Habitaciones",
  bathrooms: "Baños", floor: "Planta", elevator: "Ascensor", price: "Precio", type: "Tipo" };

function detail(v: Record<string, unknown>): string {
  const parts: string[] = [];
  if (v.diff_pct !== undefined) parts.push(`diferencia ${n(Number(v.diff_pct), 2)} %`);
  if (v.meters !== undefined) parts.push(`${n(Number(v.meters))} m`);
  if (v.similarity !== undefined) parts.push(`similitud ${n(Number(v.similarity) * 100)} % (solo apoyo: las agencias usan plantillas)`);
  for (const [k, x] of Object.entries(v)) if (!["points", "diff_pct", "meters", "similarity"].includes(k)) parts.push(`${k}: ${String(x)}`);
  return parts.length ? parts.join(" · ") : Number(v.points) > 0 ? "coincide" : "difiere";
}

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const user = await requireOwner();
  const sp = await searchParams;
  const st = ["pending", "confirmed", "rejected", "undone", "auto_linked"].includes(sp.estado ?? "") ? sp.estado! : "pending";
  const rows = await withUser(user.id, (tx) => tx`
    select mc.*, la.source_code as a_src, la.external_id as a_ext, la.title as a_title, la.price_amount::float8 as a_price, la.built_area_m2::float8 as a_area, la.rooms as a_rooms,
           la.is_synthetic as a_syn, lb.source_code as b_src, lb.external_id as b_ext, lb.title as b_title, lb.price_amount::float8 as b_price, lb.built_area_m2::float8 as b_area,
           lb.rooms as b_rooms, lb.is_synthetic as b_syn, ga.name as muni,
           (select pl.property_id from market.property_listings pl where pl.listing_id = la.id and pl.unlinked_at is null limit 1) as a_prop,
           (select pl.property_id from market.property_listings pl where pl.listing_id = lb.id and pl.unlinked_at is null limit 1) as b_prop
      from market.match_candidates mc join market.listings la on la.id = mc.listing_a join market.listings lb on lb.id = mc.listing_b
      left join geo.geographies ga on ga.id = la.geography_id
     where mc.status = ${st} order by mc.score desc limit 100`);
  return (
    <div className="pb-8">
      <PageHeader crumbs={[{ href: "/importaciones", label: "Importaciones" }]} title="Posibles duplicados entre publicaciones"
        subtitle="Una coincidencia se propone solo con varias señales y al menos una fuerte (superficie casi idéntica, misma ubicación exacta, misma referencia o imagen idéntica). Unir es reversible y conserva el historial." />
      <div className="space-y-3 px-4 md:px-6">
        <nav className="flex flex-wrap gap-1">{[["pending", "Pendientes"], ["confirmed", "Confirmados"], ["auto_linked", "Unidos automáticamente"], ["rejected", "Rechazados"], ["undone", "Deshechos"]].map(([id, l]) =>
          <Link key={id} href={`/importaciones/duplicados?estado=${id}`} className={st === id ? "btn-primary" : "btn"}>{l}</Link>)}</nav>
        {rows.length === 0 ? <Empty title="Nada que revisar">No hay candidatos en este estado.</Empty> : rows.map((c) => (
          <Panel key={c.id} id={`c${c.id}`} title={<>Puntuación {n(num(c.score))} · {c.strong_signals} señal(es) fuerte(s) · {c.muni ?? "—"}</>}>
            <div className="grid gap-3 p-3 md:grid-cols-2">
              {(["a", "b"] as const).map((k) => (
                <div key={k} className="rounded-md border border-line-2 p-2 text-[13px]">
                  <div className="font-medium">{c[`${k}_title`] ?? "Sin título"} {c[`${k}_syn`] && <SyntheticBadge />}</div>
                  <div className="meta"><code>{c[`${k}_src`]}</code> · {c[`${k}_ext`]}</div>
                  <div className="num">{eur(num(c[`${k}_price`]))} · {c[`${k}_area`] ? `${n(num(c[`${k}_area`]))} m²` : "m² ?"} · {c[`${k}_rooms`] ?? "?"} hab.</div>
                  {c[`${k}_prop`] && <Link className="meta underline" href={`/viviendas/${c[`${k}_prop`]}`}>Ver inmueble</Link>}
                </div>
              ))}
              <div className="md:col-span-2">
                <table className="tbl"><thead><tr><th>Señal</th><th>Detalle</th><th className="text-right">Puntos</th></tr></thead>
                  <tbody>{Object.entries(c.signals as Record<string, Record<string, unknown> | null>).filter(([, v]) => v).map(([k, v]) => (
                    <tr key={k}><td>{SIG[k] ?? k}</td><td className="meta">{detail(v!)}</td>
                      <td className={`text-right num ${Number(v!.points) < 0 ? "text-neg" : ""}`}>{String(v!.points)}</td></tr>))}</tbody></table>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="meta">Método {c.method_version} · propuesto {dateEs(c.created_at)}{c.reviewed_at && ` · revisado ${dateEs(c.reviewed_at)}`}{c.review_note && ` · «${c.review_note}»`}</span>
                  <MatchReview id={Number(c.id)} status={c.status} />
                </div>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
