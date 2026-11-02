// Estadística de comparables: robusta y explicable (mediana, cuartiles, regla de Tukey documentada).
// Función pura: se usa en servidor y en el navegador para recalcular al excluir comparables.

export interface Comp {
  listingId: string; propertyId: string; price: number; area: number | null; rooms: number | null; type: string; condition: string;
  muni: string; distanceM: number | null; lastSeen: string; source: string; synthetic: boolean; reason: string;
}

export interface CompStats {
  n: number; nUsed: number; median: number | null; p25: number | null; p75: number | null; iqr: number | null; min: number | null; max: number | null;
  dispersion: number | null; outliers: string[]; excluded: string[]; quality: "alta" | "media" | "baja" | "insuficiente"; reasons: string[];
  oldest: string | null; newest: string | null;
}

const q = (s: number[], p: number) => {
  if (!s.length) return null;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};

/** €/m² de cada comparable → mediana y cuartiles. Excluye (y lista) atípicos fuera de Q1−1,5·RIC y Q3+1,5·RIC y exclusiones del usuario. */
export function compStats(comps: Comp[], userExcluded: Set<string> = new Set(), expanded = false): CompStats {
  const withM2 = comps.filter((c) => c.area && c.area > 0 && !userExcluded.has(c.listingId));
  const per = withM2.map((c) => ({ id: c.listingId, v: c.price / c.area! })).sort((a, b) => a.v - b.v);
  const v0 = per.map((x) => x.v);
  const q1 = q(v0, 0.25), q3 = q(v0, 0.75);
  let outliers: string[] = [];
  let used = per;
  if (per.length >= 8 && q1 !== null && q3 !== null) {
    const f = 1.5 * (q3 - q1);
    outliers = per.filter((x) => x.v < q1 - f || x.v > q3 + f).map((x) => x.id);
    used = per.filter((x) => !outliers.includes(x.id));
  }
  const s = used.map((x) => x.v);
  const median = q(s, 0.5), p25 = q(s, 0.25), p75 = q(s, 0.75);
  const dispersion = median && p25 !== null && p75 !== null ? (p75 - p25) / median : null;
  const dates = comps.map((c) => c.lastSeen).sort();
  const reasons: string[] = [];
  let quality: CompStats["quality"] = "alta";
  if (s.length < 5) { quality = "insuficiente"; reasons.push(`Muestra de ${s.length} comparables (< 5): no se presenta como resultado sólido.`); }
  else {
    if (s.length < 10) { quality = "media"; reasons.push(`Muestra reducida (${s.length}).`); }
    if (dispersion !== null && dispersion > 0.35) { quality = quality === "alta" ? "media" : "baja"; reasons.push(`Dispersión alta (RIC/mediana ${(dispersion * 100).toFixed(0)} %).`); }
    if (expanded) { quality = quality === "alta" ? "media" : quality; reasons.push("Búsqueda ampliada fuera del municipio."); }
    if (comps.some((c) => c.synthetic)) reasons.push("Incluye anuncios sintéticos de prueba.");
  }
  return { n: comps.length, nUsed: s.length, median, p25, p75, iqr: p25 !== null && p75 !== null ? p75 - p25 : null, min: s[0] ?? null, max: s.at(-1) ?? null,
           dispersion, outliers, excluded: [...userExcluded], quality, reasons, oldest: dates[0] ?? null, newest: dates.at(-1) ?? null };
}
