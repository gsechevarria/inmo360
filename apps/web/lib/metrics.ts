import type { Metric } from "@inmo360/finance";
import { n } from "./format";

// Formato de métricas financieras compartido por servidor y cliente.
const ST_LABEL: Record<string, string> = { not_computable: "No calculable", not_applicable: "No aplica", no_solution: "Sin solución", multiple_solutions: "Varias soluciones", not_converged: "No converge" };
export const KEY_METRICS: Record<string, string[]> = {
  resale: ["peakEquity", "profitBeforeFinancing", "profitAfterFinancing", "marginOnSale", "returnOnCost", "irrEquity", "durationMonths"],
  rent_long: ["equityInitial", "grossYieldOnPrice", "netOperatingYield", "cashflowMonthly", "cashOnCash", "peakEquity"],
  rooms: ["equityInitial", "grossYieldOnPrice", "netOperatingYield", "cashflowMonthly", "cashOnCash", "peakEquity"],
  temporary: ["equityInitial", "grossYieldOnPrice", "netOperatingYield", "cashflowMonthly", "cashOnCash", "peakEquity"],
  tourist: ["equityInitial", "grossIncomeAnnual", "netOperatingYield", "cashflowMonthly", "cashOnCash", "peakEquity"],
};

export function fmtMetric(m: Metric | undefined): string {
  if (!m) return "—";
  if (m.status !== "ok" || m.value === null) return ST_LABEL[m.status] ?? "—";
  switch (m.unit) {
    case "EUR": return `${n(m.value)} €`;
    case "EUR/mes": return `${n(m.value)} €/mes`;
    case "EUR/año": return `${n(m.value)} €/año`;
    case "%": return `${n(m.value, 2)} %`;
    case "años": return `${n(m.value, 1)} años`;
    case "meses": return `${n(m.value)} meses`;
    default: return n(m.value, 2);
  }
}

