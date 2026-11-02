import { simulate } from "./engine";
import type { ScenarioInput, ScenarioResult } from "./types";

export interface Objectives {
  maxEquity?: number | null;            // capital propio máximo (necesidad máxima de aportaciones, incluye reserva)
  minNetYield?: number | null;          // % rentabilidad neta operativa mínima
  minMonthlyCashflow?: number | null;   // € flujo mensual estabilizado mínimo
  minResaleProfit?: number | null;      // € beneficio después de financiación mínimo
  minReturnOnCost?: number | null;      // % retorno sobre coste mínimo
  minIrr?: number | null;               // % TIR del capital propio mínima
  maxDurationMonths?: number | null;    // plazo máximo (reventa)
}

export type MaxPriceStatus = "calculated" | "infeasible" | "insufficient_data" | "search_limit";

export interface Check { objective: keyof Objectives; label: string; target: number; value: number | null; ok: boolean | null; slack: number | null }

export interface MaxPriceResult {
  status: MaxPriceStatus;
  price: number | null;
  tolerance: number;
  searchRange: [number, number];
  checks: Check[];
  binding: string | null;
  feasibleIntervals: [number, number][];
  evaluations: number;
  notes: string[];
}

const LABELS: Record<keyof Objectives, string> = {
  maxEquity: "Capital propio máximo", minNetYield: "Rentabilidad neta operativa mínima", minMonthlyCashflow: "Flujo de caja mensual mínimo",
  minResaleProfit: "Beneficio mínimo de reventa", minReturnOnCost: "Retorno mínimo sobre coste", minIrr: "TIR mínima del capital propio",
  maxDurationMonths: "Plazo máximo",
};

export function evaluateObjectives(r: ScenarioResult, o: Objectives): Check[] {
  const m = (k: string) => (r.metrics[k]?.status === "ok" ? r.metrics[k]!.value : null);
  const out: Check[] = [];
  const add = (objective: keyof Objectives, value: number | null, target: number, higherIsBetter: boolean) => {
    const slack = value === null ? null : higherIsBetter ? value - target : target - value;
    out.push({ objective, label: LABELS[objective], target, value, ok: slack === null ? null : slack >= -1e-9, slack });
  };
  if (o.maxEquity != null) add("maxEquity", m("peakEquity"), o.maxEquity, false);
  if (o.minNetYield != null) add("minNetYield", m("netOperatingYield"), o.minNetYield, true);
  if (o.minMonthlyCashflow != null) add("minMonthlyCashflow", m("cashflowMonthly"), o.minMonthlyCashflow, true);
  if (o.minResaleProfit != null) add("minResaleProfit", m("profitAfterFinancing"), o.minResaleProfit, true);
  if (o.minReturnOnCost != null) add("minReturnOnCost", m("returnOnCost"), o.minReturnOnCost, true);
  if (o.minIrr != null) add("minIrr", m("irrEquity"), o.minIrr, true);
  if (o.maxDurationMonths != null) add("maxDurationMonths", m("durationMonths"), o.maxDurationMonths, false);
  return out;
}

/**
 * Mayor precio de compra compatible con TODOS los objetivos activos.
 * Recalcula el escenario completo para cada precio candidato (impuestos por tramos, comisiones, LTV…).
 * No supone monotonía: explora una malla, identifica intervalos factibles y refina por bisección el borde
 * superior del intervalo factible más alto.
 */
export function maxPurchasePrice(s: ScenarioInput, o: Objectives,
                                 opts: { min?: number; max?: number; tolerance?: number; gridPoints?: number } = {}): MaxPriceResult {
  const lo = opts.min ?? 1_000;
  const hi = opts.max ?? Math.max(50_000, (s.purchase.price ?? 200_000) * 3);
  const tol = opts.tolerance ?? 100;
  const n = opts.gridPoints ?? 120;
  const notes: string[] = [];
  const active = Object.entries(o).filter(([, v]) => v != null).length;
  if (!active) return { status: "insufficient_data", price: null, tolerance: tol, searchRange: [lo, hi], checks: [], binding: null, feasibleIntervals: [], evaluations: 0, notes: ["No hay objetivos activos."] };

  let evals = 0;
  const feasible = (p: number) => {
    evals++;
    const r = simulate(s, p);
    const checks = evaluateObjectives(r, o);
    const unknown = checks.some((c) => c.ok === null) || r.errors.length > 0;
    return { ok: !unknown && checks.every((c) => c.ok), unknown, checks, r };
  };

  const grid: { p: number; ok: boolean; unknown: boolean }[] = [];
  for (let i = 0; i <= n; i++) {
    const p = lo + ((hi - lo) * i) / n;
    const f = feasible(p);
    grid.push({ p, ok: f.ok, unknown: f.unknown });
    if (f.unknown && i === 0) {
      const miss = f.r.errors.length ? f.r.errors : f.checks.filter((c) => c.ok === null).map((c) => c.label);
      return { status: "insufficient_data", price: null, tolerance: tol, searchRange: [lo, hi], checks: f.checks, binding: null,
               feasibleIntervals: [], evaluations: evals, notes: [`No calculable con los datos actuales: ${miss.join(", ")}.`,
               ...f.r.missing.map((m) => `Pendiente: ${m.concept}`)] };
    }
  }
  const intervals: [number, number][] = [];
  let open: number | null = null;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]!.ok && open === null) open = grid[i]!.p;
    if ((!grid[i]!.ok || i === grid.length - 1) && open !== null) {
      intervals.push([open, grid[i]!.ok ? grid[i]!.p : grid[i - 1]!.p]);
      open = null;
    }
  }
  if (intervals.length > 1) notes.push("Los objetivos no son monótonos respecto al precio: hay varios intervalos factibles.");
  if (!intervals.length) {
    const f = feasible(lo);
    return { status: "infeasible", price: null, tolerance: tol, searchRange: [lo, hi], checks: f.checks,
             binding: f.checks.find((c) => c.ok === false)?.label ?? null, feasibleIntervals: [], evaluations: evals,
             notes: [...notes, "Ningún precio del intervalo cumple todos los objetivos."] };
  }
  const top = intervals[intervals.length - 1]!;
  const idx = grid.findIndex((g) => g.p === top[1]);
  if (idx === grid.length - 1) {
    const f = feasible(top[1]);
    return { status: "search_limit", price: top[1], tolerance: tol, searchRange: [lo, hi], checks: f.checks, binding: null,
             feasibleIntervals: intervals, evaluations: evals, notes: [...notes, "Se alcanzó el límite superior de búsqueda: el precio máximo puede ser mayor."] };
  }
  let a = top[1], b = grid[idx + 1]!.p;
  while (b - a > tol) {
    const mid = (a + b) / 2;
    if (feasible(mid).ok) a = mid; else b = mid;
  }
  const finalP = Math.floor(a / tol) * tol;   // redondeo hacia abajo a la precisión
  const f = feasible(finalP);
  const above = feasible(b);
  const binding = above.checks.find((c) => c.ok === false)?.label ?? above.checks.find((c) => c.ok === null)?.label ?? null;
  return { status: f.ok ? "calculated" : "infeasible", price: f.ok ? finalP : null, tolerance: tol, searchRange: [lo, hi], checks: f.checks,
           binding, feasibleIntervals: intervals, evaluations: evals,
           notes: [...notes, "Oferta compatible con los supuestos indicados; no es una tasación."] };
}
