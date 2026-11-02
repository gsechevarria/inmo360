import { daysBetween, type ISODate } from "./dates";

export interface Flow { date: ISODate; amount: number }

export interface IrrResult {
  status: "ok" | "no_solution" | "multiple_solutions" | "not_converged" | "insufficient";
  rate: number | null;
  roots: number[];
  note?: string;
}

/** VAN con convención ACT/365 desde la primera fecha. */
export function npv(rate: number, flows: Flow[]): number {
  if (!flows.length) return 0;
  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0]!.date);
  let s = 0;
  for (const f of flows) s += f.amount / Math.pow(1 + rate, daysBetween(t0, f.date) / 365);
  return s;
}

function compact(flows: Flow[]): Flow[] {
  const m = new Map<string, number>();
  for (const f of flows) m.set(f.date, (m.get(f.date) ?? 0) + f.amount);
  return [...m.entries()].map(([date, amount]) => ({ date, amount })).filter((f) => Math.abs(f.amount) > 1e-9)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * TIR por fechas (XIRR) robusta: explora una malla de tipos en (-99 %, 1000 %], localiza TODOS los cambios de
 * signo del VAN y refina cada uno por bisección. Si hay varias raíces devuelve `multiple_solutions` sin
 * elegir una arbitraria; si no hay cambio de signo, `no_solution`.
 */
export function xirr(input: Flow[], tol = 1e-10): IrrResult {
  const flows = compact(input);
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) {
    return { status: "insufficient", rate: null, roots: [], note: "Hacen falta cobros y pagos" };
  }
  const grid: number[] = [];
  for (let r = -0.99; r < -0.5; r += 0.01) grid.push(r);
  for (let r = -0.5; r < 1; r += 0.0025) grid.push(r);
  for (let r = 1; r <= 10; r += 0.05) grid.push(r);
  const roots: number[] = [];
  let prevR = grid[0]!;
  let prevV = npv(prevR, flows);
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]!;
    const v = npv(r, flows);
    if (!Number.isFinite(v) || !Number.isFinite(prevV)) { prevR = r; prevV = v; continue; }
    if (v === 0) roots.push(r);
    else if (Math.sign(v) !== Math.sign(prevV) && prevV !== 0) {
      let lo = prevR, hi = r, flo = prevV;
      let it = 0;
      while (hi - lo > tol && it++ < 200) {
        const mid = (lo + hi) / 2;
        const fm = npv(mid, flows);
        if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
      }
      if (it >= 200) return { status: "not_converged", rate: null, roots };
      roots.push((lo + hi) / 2);
    }
    prevR = r; prevV = v;
  }
  const uniq = roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]!) > 1e-6);
  if (uniq.length === 0) return { status: "no_solution", rate: null, roots: [], note: "El VAN no cambia de signo en (-99 %, 1000 %]" };
  if (uniq.length > 1) return { status: "multiple_solutions", rate: null, roots: uniq, note: "Varias tasas anulan el VAN; ninguna es fiable por sí sola" };
  return { status: "ok", rate: uniq[0]!, roots: uniq };
}
