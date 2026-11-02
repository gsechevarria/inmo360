import Link from "next/link";
import type { ScoreResult } from "@inmo360/scoring";
import { n } from "@/lib/format";

const STATUS: Record<string, string> = { scored: "Puntuación", partial: "Puntuación parcial", not_scorable: "No puntuable", pending_configuration: "Pendiente de configuración" };

/** Puntuación con explicación: contribución de cada factor, datos que faltan y versión del perfil. */
export function ScoreCard({ result, title }: { result: ScoreResult; title: string }) {
  if (result.status === "pending_configuration") {
    return (
      <div className="rounded-md border border-dashed border-line p-3">
        <div className="text-[13px] font-semibold">{title}</div>
        <p className="meta mt-1">Puntuación pendiente de configuración: no hay un perfil activo para esta estrategia. Las métricas se muestran igualmente.</p>
        <Link href="/configuracion#scoring" className="btn mt-2">Elegir perfil</Link>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{title}</div>
        {result.experimental && <span className="chip bg-warn-50 text-warn">Experimental</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="kpi num">{result.score === null ? "—" : n(result.score, 0)}</span>
        <span className="meta">/ 100 · {STATUS[result.status]}{result.status === "partial" && ` · cobertura ${n(result.coverage * 100, 0)} % del peso`}</span>
      </div>
      <table className="tbl mt-2">
        <thead><tr><th>Factor</th><th className="text-right">Dato</th><th className="text-right">Nota</th><th className="text-right">Peso</th><th className="text-right">Aporta</th></tr></thead>
        <tbody>
          {result.contributions.map((c) => (
            <tr key={c.factorId}>
              <td><div>{c.label}</div><div className="meta">{c.explanation}{c.period && ` · ${c.period}`}</div></td>
              <td className="text-right num">{c.raw === null ? <span className="text-neg">sin dato</span> : typeof c.raw === "boolean" ? (c.raw ? "sí" : "no") : n(Number(c.raw), 2)}</td>
              <td className="text-right num">{c.score === null ? "—" : n(c.score, 0)}</td>
              <td className="text-right num">{n(c.weightShare * 100, 0)} %</td>
              <td className="text-right num">{c.points === null ? "—" : n(c.points, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.requirements.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12.5px]">
          {result.requirements.map((r) => (
            <li key={r.id} className={r.status === "not_met" ? "text-neg" : r.status === "met" ? "text-pos" : "text-ink-3"}>
              {r.status === "met" ? "✓" : r.status === "not_met" ? "✗" : "?"} {r.label} ({r.target}) {r.status === "not_evaluable" && "— no evaluable"}
            </li>
          ))}
        </ul>
      )}
      {result.notes.map((x) => <p key={x} className="meta mt-1">{x}</p>)}
      <p className="meta mt-1">Perfil {result.profileId} v{result.profileVersion}{result.universe && ` · universo: ${result.universe}`}</p>
    </div>
  );
}
