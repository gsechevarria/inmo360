import { fmtUnit, n } from "@/lib/format";

/**
 * Serie temporal en SVG con eje, unidad, etiquetas directas y tabla alternativa accesible.
 * Huecos (null) se dibujan como interrupciones, nunca como cero.
 */
export function LineChart({ points, unit, title, height = 140 }: { points: { x: string; y: number | null }[]; unit: string; title: string; height?: number }) {
  const vals = points.map((p) => p.y).filter((v): v is number => v !== null);
  if (vals.length < 2) return <p className="meta px-1 py-2">Serie insuficiente para graficar ({vals.length} dato{vals.length === 1 ? "" : "s"}).</p>;
  const W = 520, H = height, L = 52, R = 12, T = 10, B = 22;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08; min -= pad; max += pad;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const segs: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.y === null) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const ticks = [min + pad, (min + max) / 2, max - pad];
  const last = [...points].reverse().find((p) => p.y !== null)!;
  const li = points.lastIndexOf(last);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${n(vals[0], 0)} a ${n(last.y!, 0)}`} className="h-auto w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eef1f4" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="#5f6b79">{fmtUnit(t, unit).replace(" personas", "")}</text>
          </g>
        ))}
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#1f5f8b" strokeWidth="2" />)}
        {points.map((p, i) => p.y !== null && <circle key={i} cx={x(i)} cy={y(p.y)} r={i === li ? 3.5 : 2} fill="#1f5f8b" />)}
        <text x={L} y={H - 6} fontSize="10.5" fill="#5f6b79">{points[0]!.x}</text>
        <text x={W - R} y={H - 6} fontSize="10.5" fill="#5f6b79" textAnchor="end">{points.at(-1)!.x}</text>
        <text x={Math.min(x(li), W - R - 4)} y={y(last.y!) - 8} fontSize="11" fill="#0f1e2e" textAnchor="end" fontWeight="600">{fmtUnit(last.y!, unit)}</text>
      </svg>
      <details className="meta">
        <summary className="cursor-pointer">Ver datos</summary>
        <table className="tbl mt-1"><thead><tr><th>Periodo</th><th className="text-right">Valor</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.x}><td>{p.x}</td><td className="text-right num">{p.y === null ? "—" : fmtUnit(p.y, unit)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}
