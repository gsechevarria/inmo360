import type { Item, ScenarioInput, ValueStatus } from "@inmo360/finance";

/** Supuestos editables por el usuario (invest.assumption_sets.values). Cada valor lleva su estado: desconocido ≠ 0. */
export const ASSUMPTION_KEYS = [
  { key: "acquisition_cost_rate", label: "Coste total de adquisición (impuestos + notaría…) para el explorador", unit: "%", hint: "Solo para filtros rápidos del explorador. La calculadora usa partidas detalladas." },
  { key: "ltv", label: "Financiación sobre precio (LTV)", unit: "%", hint: "Se usa en el explorador (capital propio estimado) y para crear un préstamo en la calculadora." },
  { key: "interest_rate", label: "Tipo de interés anual", unit: "%", hint: "Préstamo creado a partir del LTV." },
  { key: "term_years", label: "Plazo del préstamo", unit: "años", hint: "" },
  { key: "notary_rate", label: "Notaría, registro y gestoría", unit: "%", hint: "Sobre el precio." },
  { key: "vacancy_rate", label: "Vacancia media (alquiler completo)", unit: "%", hint: "Fracción de meses sin ingresos." },
  { key: "maintenance_rate", label: "Mantenimiento", unit: "%", hint: "Sobre ingresos." },
  { key: "sale_cost_rate", label: "Costes de venta", unit: "%", hint: "Sobre el precio de venta." },
  { key: "horizon_years", label: "Horizonte de análisis (rentas)", unit: "años", hint: "" },
  { key: "rent_indexation", label: "Actualización anual supuesta de rentas", unit: "%", hint: "Supuesto del usuario, no una previsión." },
] as const;

export type AssumptionValues = Record<string, { value: number | null; status: string }>;

const PCT = new Set(["acquisition_cost_rate", "ltv", "interest_rate", "notary_rate", "vacancy_rate", "maintenance_rate", "sale_cost_rate", "rent_indexation"]);
/** Los porcentajes se guardan como fracción (0,05 = 5 %). */
export const isPctKey = (k: string) => PCT.has(k);

export function applyAssumptions(s: ScenarioInput, values: AssumptionValues, setName: string): ScenarioInput {
  const out: ScenarioInput = structuredClone(s);
  const origin = `supuestos «${setName}»`;
  const known = (k: string) => (values[k] && values[k]!.status !== "unknown" && values[k]!.value !== null ? Number(values[k]!.value) : null);
  const st = (k: string): ValueStatus => (values[k]?.status as ValueStatus) ?? "user_input";
  const setRate = (items: Item[], id: string, k: string) => {
    const v = known(k);
    const it = items.find((i) => i.id === id);
    if (it && v !== null) Object.assign(it, { rate: v, status: st(k), origin });
  };
  setRate(out.acquisitionCosts, "notary", "notary_rate");
  setRate(out.operatingExpenses, "maintenance", "maintenance_rate");
  if (out.exit) setRate(out.exit.saleCosts, "sale_agency", "sale_cost_rate");
  if (out.operation.kind === "rent_long" && known("vacancy_rate") !== null) out.operation.vacancy = { mode: "percent", percent: known("vacancy_rate") };
  if ((out.operation.kind === "rent_long" || out.operation.kind === "rooms") && known("rent_indexation") !== null) out.operation.annualIndexation = known("rent_indexation");
  if (out.strategy !== "resale" && known("horizon_years") !== null) out.horizonMonths = Math.round(known("horizon_years")! * 12);
  const ltv = known("ltv"), rate = known("interest_rate"), term = known("term_years");
  if (ltv !== null && ltv > 0 && rate !== null && term !== null && !out.financing.loans.length) {
    out.financing.loans.push({ id: "loan1", label: "Hipoteca", ltv: { ratio: ltv, base: "price" }, status: st("ltv"), rate: { type: "fixed", annualRate: rate },
      termMonths: Math.round(term * 12), paymentFrequency: "monthly", fees: [] });
  }
  return out;
}
