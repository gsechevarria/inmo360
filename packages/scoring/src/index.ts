/**
 * Motor de scoring de Inmo360: zona, vivienda y operación.
 * - Sin factores de riesgo. Sin atributos personales protegidos.
 * - Ausencias explícitas: nunca se rellenan con cero ni se redistribuye el peso en silencio.
 * - Percentiles sobre un universo ESTABLE declarado (no depende de filtros de pantalla).
 * - Versionado: cada resultado guarda versión del perfil, universo y entradas usadas.
 */

export type Block = "zone" | "property" | "operation";
export type Strategy = "resale" | "rent_long" | "rooms" | "temporary" | "tourist" | "any";

export const PROTECTED_DIMENSIONS = ["sex", "nationality", "birthplace", "marital_status", "disability"] as const;

export interface FactorConfig {
  id: string;
  label: string;
  source: "indicator" | "attribute" | "metric";
  key: string;                                   // código de indicador, atributo o métrica
  dims?: Record<string, string>;
  transform: "percentile" | "thresholds" | "target_band" | "boolean";
  direction: "higher_better" | "lower_better" | "target";
  thresholds?: { value: number; score: number }[];   // interpolación lineal por tramos (0–100)
  target?: { low: number; high: number; falloff: number }; // 100 dentro de [low, high]; cae a 0 a `falloff` de distancia
  weight: number;
  required?: boolean;
  signalGroup?: string;                          // señales correlacionadas: no se cuentan dos veces
  rationale?: string;
  subBlock?: "unlevered" | "levered";            // operación: sin financiación / financiada
}

export interface Requirement { id: string; label: string; metric: string; op: ">=" | "<="; value: number }

export interface ProfileConfig {
  profileId: string;
  name: string;
  version: number;
  strategy: Strategy;
  block: Block;
  experimental: boolean;
  description: string;
  missingPolicy: "block" | "partial_explicit";
  minCoverage?: number;                          // 0–1, solo con partial_explicit
  universe?: { level: "municipality"; minPopulation?: number; description: string };
  factors: FactorConfig[];
  requirements?: Requirement[];
  validFrom: string;
}

export interface CatalogInfo { code: string; isProtected: boolean; isExcluded: boolean; scoringRole: string }

export class ProfileError extends Error {}

export function validateProfile(p: ProfileConfig, catalog?: Map<string, CatalogInfo>): string[] {
  const errs: string[] = [];
  if (!p.factors.length) errs.push("El perfil no tiene factores.");
  const groups = new Map<string, string>();
  let total = 0;
  for (const f of p.factors) {
    if (!(f.weight > 0)) errs.push(`Factor ${f.id}: el peso debe ser positivo.`);
    total += f.weight;
    for (const d of Object.keys(f.dims ?? {}))
      if ((PROTECTED_DIMENSIONS as readonly string[]).includes(d)) errs.push(`Factor ${f.id}: usa la dimensión protegida «${d}».`);
    if (f.source === "indicator" && catalog) {
      const c = catalog.get(f.key);
      if (!c) errs.push(`Factor ${f.id}: indicador desconocido ${f.key}.`);
      else {
        if (c.isProtected || c.scoringRole === "excluded_protected") errs.push(`Factor ${f.id}: ${f.key} es un atributo personal protegido.`);
        if (c.isExcluded || c.scoringRole === "excluded_risk") errs.push(`Factor ${f.id}: ${f.key} está excluido (sin factores de riesgo).`);
        if (c.scoringRole !== "eligible") errs.push(`Factor ${f.id}: ${f.key} no está habilitado para scoring en el catálogo.`);
      }
    }
    if (/^risk\./.test(f.key)) errs.push(`Factor ${f.id}: no se admiten factores de riesgo.`);
    if (f.signalGroup) {
      if (groups.has(f.signalGroup)) errs.push(`Señal correlacionada contada dos veces: «${f.id}» y «${groups.get(f.signalGroup)}» (${f.signalGroup}).`);
      else groups.set(f.signalGroup, f.id);
    }
    if (f.transform === "thresholds" && !(f.thresholds?.length! >= 2)) errs.push(`Factor ${f.id}: faltan tramos.`);
    if (f.transform === "target_band" && !f.target) errs.push(`Factor ${f.id}: falta el intervalo objetivo.`);
    if (f.transform === "percentile" && !p.universe) errs.push(`Factor ${f.id}: percentil sin universo declarado.`);
  }
  if (!(total > 0)) errs.push("La suma de pesos debe ser positiva.");
  return errs;
}

// ------------------------------------------------------------------------- transformaciones

/** Percentil de rango medio sobre un universo ordenado (0–100). */
export function percentileOf(sorted: number[], x: number): number {
  if (!sorted.length) return NaN;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! < x) lo = m + 1; else hi = m; }
  const below = lo;
  let eq = 0;
  for (let i = lo; i < sorted.length && sorted[i] === x; i++) eq++;
  return ((below + eq / 2) / sorted.length) * 100;
}

export function piecewise(points: { value: number; score: number }[], x: number): number {
  const p = [...points].sort((a, b) => a.value - b.value);
  if (x <= p[0]!.value) return p[0]!.score;
  if (x >= p[p.length - 1]!.value) return p[p.length - 1]!.score;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    if (x <= b.value) return a.score + ((x - a.value) / (b.value - a.value)) * (b.score - a.score);
  }
  return p[p.length - 1]!.score;
}

export function transform(f: FactorConfig, x: number | boolean, universe?: number[]): number {
  if (f.transform === "boolean") {
    const v = x === true || x === 1;
    return f.direction === "lower_better" ? (v ? 0 : 100) : v ? 100 : 0;
  }
  const n = Number(x);
  if (f.transform === "percentile") {
    const pct = percentileOf(universe ?? [], n);
    return f.direction === "lower_better" ? 100 - pct : pct;
  }
  if (f.transform === "thresholds") return Math.max(0, Math.min(100, piecewise(f.thresholds!, n)));
  const t = f.target!;
  if (n >= t.low && n <= t.high) return 100;
  const d = n < t.low ? t.low - n : n - t.high;
  return Math.max(0, 100 * (1 - d / t.falloff));
}

// ------------------------------------------------------------------------- cálculo

export interface FactorInput { value: number | boolean | null; period?: string; source?: string; status?: string }

export interface Contribution {
  factorId: string;
  label: string;
  key: string;
  raw: number | boolean | null;
  period?: string;
  source?: string;
  score: number | null;               // 0–100 del factor
  weight: number;
  weightShare: number;                // peso / suma de pesos del perfil
  points: number | null;              // aportación a la puntuación final
  missing: boolean;
  explanation: string;
}

export interface ScoreResult {
  profileId: string;
  profileVersion: number;
  block: Block;
  experimental: boolean;
  status: "scored" | "partial" | "not_scorable" | "pending_configuration";
  score: number | null;
  coverage: number;                   // fracción del peso con dato
  contributions: Contribution[];
  missing: string[];
  requirements: { id: string; label: string; status: "met" | "not_met" | "not_evaluable"; value: number | null; target: string }[];
  inputsHash: string;
  universe?: string;
  notes: string[];
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function scoreSubject(p: ProfileConfig | null, inputs: Record<string, FactorInput>, universes: Record<string, number[]> = {},
                             metrics: Record<string, number | null> = {}): ScoreResult {
  if (!p) {
    return { profileId: "", profileVersion: 0, block: "zone", experimental: false, status: "pending_configuration", score: null, coverage: 0,
             contributions: [], missing: [], requirements: [], inputsHash: "", notes: ["Puntuación pendiente de configuración: active un perfil."] };
  }
  const errs = validateProfile(p);
  if (errs.length) throw new ProfileError(errs.join(" "));
  const total = p.factors.reduce((s, f) => s + f.weight, 0);
  const contributions: Contribution[] = p.factors.map((f) => {
    const inp = inputs[f.id];
    const raw = inp?.value ?? null;
    const missing = raw === null || raw === undefined || (typeof raw === "number" && !Number.isFinite(raw));
    const score = missing ? null : transform(f, raw as number | boolean, universes[f.id]);
    const scoreOk = score !== null && Number.isFinite(score);
    return {
      factorId: f.id, label: f.label, key: f.key, raw: missing ? null : raw, period: inp?.period, source: inp?.source,
      score: scoreOk ? score : null, weight: f.weight, weightShare: f.weight / total, points: null, missing: missing || !scoreOk,
      explanation: missing ? "Sin dato: no se puntúa ni se rellena con cero."
        : f.transform === "percentile" ? `Percentil ${score!.toFixed(0)} en el universo (${f.direction === "lower_better" ? "menor es mejor" : "mayor es mejor"}).`
        : f.transform === "target_band" ? `Intervalo objetivo ${f.target!.low}–${f.target!.high}.`
        : f.transform === "boolean" ? (raw ? "Cumple" : "No cumple")
        : "Escala por tramos del perfil.",
    };
  });
  const present = contributions.filter((c) => !c.missing);
  const covered = present.reduce((s, c) => s + c.weight, 0);
  const coverage = covered / total;
  const missing = contributions.filter((c) => c.missing).map((c) => c.label);
  const requiredMissing = p.factors.filter((f) => f.required && contributions.find((c) => c.factorId === f.id)!.missing).map((f) => f.label);
  const notes: string[] = [];
  if (p.experimental) notes.push("Perfil experimental: pesos propuestos, no validados.");
  let status: ScoreResult["status"] = "scored";
  let score: number | null = null;
  if (requiredMissing.length) {
    status = "not_scorable";
    notes.push(`Faltan factores imprescindibles: ${requiredMissing.join(", ")}.`);
  } else if (missing.length && p.missingPolicy === "block") {
    status = "not_scorable";
    notes.push("El perfil exige todos los factores: no se puntúa con datos incompletos.");
  } else if (missing.length && coverage < (p.minCoverage ?? 0)) {
    status = "not_scorable";
    notes.push(`Cobertura ${(coverage * 100).toFixed(0)} % inferior al mínimo del perfil (${((p.minCoverage ?? 0) * 100).toFixed(0)} %).`);
  } else if (covered > 0) {
    score = present.reduce((s, c) => s + c.weight * c.score!, 0) / covered;
    for (const c of present) c.points = (c.weight * c.score!) / covered;
    if (missing.length) {
      status = "partial";
      notes.push(`Puntuación parcial: calculada sobre el ${(coverage * 100).toFixed(0)} % del peso; sin dato: ${missing.join(", ")}.`);
    }
  } else status = "not_scorable";
  const requirements = (p.requirements ?? []).map((r) => {
    const v = metrics[r.metric] ?? null;
    return { id: r.id, label: r.label, value: v, target: `${r.op} ${r.value}`,
             status: v === null ? "not_evaluable" as const : (r.op === ">=" ? v >= r.value : v <= r.value) ? "met" as const : "not_met" as const };
  });
  if (requirements.some((r) => r.status === "not_met")) notes.push("Incumple un requisito imprescindible: la puntuación no lo compensa.");
  return { profileId: p.profileId, profileVersion: p.version, block: p.block, experimental: p.experimental, status,
           score: score === null ? null : Math.round(score * 10) / 10, coverage, contributions, missing, requirements,
           inputsHash: hash(JSON.stringify({ i: inputs, v: p.version, id: p.profileId })), universe: p.universe?.description, notes };
}

export interface GlobalCombination { weights: Partial<Record<Block, number>>; label: string }

/** Puntuación global SOLO con combinación explícita; si falta un bloque, no hay global. */
export function combine(results: Partial<Record<Block, ScoreResult>>, comb: GlobalCombination | null) {
  if (!comb) return { status: "pending_configuration" as const, score: null, notes: ["Sin combinación global configurada: se muestran los bloques por separado."] };
  const blocks = Object.entries(comb.weights).filter(([, w]) => (w ?? 0) > 0) as [Block, number][];
  const missing = blocks.filter(([b]) => results[b]?.status !== "scored").map(([b]) => b);
  if (missing.length) return { status: "not_scorable" as const, score: null, notes: [`Bloques sin puntuación completa: ${missing.join(", ")}.`] };
  const anyUnmet = blocks.some(([b]) => results[b]!.requirements.some((r) => r.status === "not_met"));
  const tw = blocks.reduce((s, [, w]) => s + w, 0);
  const score = blocks.reduce((s, [b, w]) => s + w * results[b]!.score!, 0) / tw;
  return { status: "scored" as const, score: Math.round(score * 10) / 10,
           notes: anyUnmet ? ["Incumple requisitos imprescindibles: revise antes de usar la puntuación global."] : [] };
}

/**
 * Universo estable: se construye SOLO con la definición del perfil (nivel, población mínima), nunca con los
 * filtros de pantalla. Devuelve los valores ordenados para percentiles.
 */
export function buildUniverse(rows: { population: number | null; value: number | null; isCurrent?: boolean }[],
                              def: NonNullable<ProfileConfig["universe"]>): number[] {
  return rows.filter((r) => r.isCurrent !== false && r.value !== null && Number.isFinite(r.value)
                            && (def.minPopulation == null || (r.population ?? 0) >= def.minPopulation))
    .map((r) => r.value as number).sort((a, b) => a - b);
}

export { EXPERIMENTAL_PROFILES } from "./profiles";
