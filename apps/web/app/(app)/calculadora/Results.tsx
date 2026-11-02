"use client";
import { useState } from "react";
import type { Metric, ScenarioResult } from "@inmo360/finance";
import { n } from "@/lib/format";
import { fmtMetric } from "@/lib/metrics";
export { KEY_METRICS, fmtMetric } from "@/lib/metrics";

export function MetricTile({ m }: { m?: Metric }) {
  if (!m) return null;
  const ok = m.status === "ok";
  return (
    <div className={`rounded-md border p-2.5 ${ok ? "border-line-2" : "border-warn/50 bg-warn-50/50"}`} title={[m.convention, m.denominator && `Denominador: ${m.denominator}`, m.period].filter(Boolean).join(" · ")}>
      <div className="meta leading-tight">{m.label}</div>
      <div className={`num mt-0.5 font-semibold ${ok ? "text-[17px]" : "text-[13px] text-warn"} ${ok && m.value !== null && m.value < 0 ? "text-neg" : ""}`}>{fmtMetric(m)}</div>
      {!ok && m.missing?.length ? <div className="meta mt-0.5">Falta: {m.missing.slice(0, 3).join(", ")}{m.missing.length > 3 ? "…" : ""}</div> : null}
      {m.status === "multiple_solutions" && m.values && <div className="meta">Raíces: {m.values.map((v) => `${n(v, 2)} %`).join(" · ")}</div>}
    </div>
  );
}

export function ResultTabs({ r }: { r: ScenarioResult }) {
  const [tab, setTab] = useState<"metrics" | "months" | "ledger" | "amort" | "rooms">("metrics");
  const tabs = [["metrics", "Todas las métricas"], ["months", "Flujo mensual"], ["ledger", "Movimientos"], ["amort", "Amortización"], ...(r.rooms ? [["rooms", "Por habitación"]] : [])] as [typeof tab, string][];
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-t-md px-3 py-1.5 text-[13px] ${tab === id ? "border border-b-0 border-line bg-surface font-semibold" : "text-ink-2 hover:bg-canvas"}`}>{label}</button>
        ))}
      </div>
      <div className="max-h-[560px] overflow-auto p-2">
        {tab === "metrics" && (
          <table className="tbl"><thead><tr><th>Métrica</th><th className="text-right">Valor</th><th>Periodo</th><th>Convención / denominador</th></tr></thead>
            <tbody>{Object.values(r.metrics).map((m) => (
              <tr key={m.key}><td>{m.label}</td><td className={`text-right num whitespace-nowrap ${m.status !== "ok" ? "text-warn" : ""}`}>{fmtMetric(m)}</td>
                <td className="meta">{m.period ?? "—"}</td>
                <td className="meta">{[m.convention, m.denominator && `sobre ${m.denominator}`, ...(m.notes ?? []), m.missing?.length ? `Falta: ${m.missing.join(", ")}` : null].filter(Boolean).join(" · ")}</td></tr>
            ))}</tbody></table>
        )}
        {tab === "months" && (
          <table className="tbl"><thead><tr><th>Mes</th><th className="text-right">Ingresos</th><th className="text-right">Gastos expl.</th><th className="text-right">Res. operativo</th><th className="text-right">Reposiciones</th>
            <th className="text-right">Flujo activo</th><th className="text-right">Financiación</th><th className="text-right">Reserva</th><th className="text-right">Impuestos</th><th className="text-right">Flujo capital propio</th><th className="text-right">Acumulado</th></tr></thead>
            <tbody>{r.months.map((m) => (
              <tr key={m.month}><td className="whitespace-nowrap">{m.month}</td>{[m.income, m.opex, m.noi, m.capex, m.assetFlow, m.financingFlow, m.reserveFlow, m.taxFlow, m.equityFlow, m.cumulativeEquity].map((v, i) =>
                <td key={i} className={`text-right num ${v < 0 ? "text-neg" : ""}`}>{v === 0 ? "·" : n(v)}</td>)}</tr>
            ))}</tbody></table>
        )}
        {tab === "ledger" && (
          <>
            <p className="meta px-1 pb-1">Signo desde el inversor: + cobro, − pago. Las partidas desconocidas aparecen sin importe y no se suman.</p>
            <table className="tbl"><thead><tr><th>Fecha</th><th>Capa</th><th>Categoría</th><th>Concepto</th><th className="text-right">Importe</th></tr></thead>
              <tbody>{r.ledger.map((e, i) => (
                <tr key={i} className={e.unknown ? "bg-warn-50/60" : ""}><td className="whitespace-nowrap">{e.date}</td><td className="meta">{{ asset: "activo", financing: "financiación", reserve: "reserva", tax: "impuestos" }[e.layer]}</td>
                  <td className="meta">{e.category}</td><td>{e.concept}</td><td className={`text-right num ${e.amount < 0 ? "text-neg" : ""}`}>{e.unknown ? "desconocido" : n(e.amount, 2)}</td></tr>
              ))}</tbody></table>
          </>
        )}
        {tab === "amort" && (r.amortization.length === 0 ? <p className="meta p-2">Sin financiación.</p> : (
          <table className="tbl"><thead><tr><th>Préstamo</th><th>Fecha</th><th>Tipo</th><th className="text-right">Tipo anual</th><th className="text-right">Disposición</th><th className="text-right">Intereses</th>
            <th className="text-right">Principal</th><th className="text-right">Cuota</th><th className="text-right">Comisión</th><th className="text-right">Pendiente</th></tr></thead>
            <tbody>{r.amortization.map((a, i) => (
              <tr key={i}><td>{a.loanId}</td><td className="whitespace-nowrap">{a.date}</td><td className="meta">{{ disbursement: "disposición", grace: "carencia", installment: "cuota", prepayment: "amortización anticipada", payoff: "cancelación" }[a.kind]}</td>
                <td className="text-right num">{n(a.rate * 100, 3)} %</td><td className="text-right num">{a.disbursement ? n(a.disbursement) : "·"}</td><td className="text-right num">{n(a.interest, 2)}</td>
                <td className="text-right num">{n(a.principal, 2)}</td><td className="text-right num">{n(a.payment, 2)}</td><td className="text-right num">{a.fee ? n(a.fee, 2) : "·"}</td><td className="text-right num">{n(a.outstanding, 2)}</td></tr>
            ))}</tbody></table>
        ))}
        {tab === "rooms" && r.rooms && (
          <table className="tbl"><thead><tr><th>Habitación</th><th className="text-right">Ingresos 12 m</th><th className="text-right">Gastos específicos 12 m</th><th className="text-right">Contribución</th></tr></thead>
            <tbody>{r.rooms.map((x) => (
              <tr key={x.roomId}><td>{x.label}</td><td className="text-right num">{x.grossIncome12m === null ? "desconocido" : n(x.grossIncome12m)}</td>
                <td className="text-right num">{x.specificExpenses12m === null ? "desconocido" : n(x.specificExpenses12m)}</td><td className="text-right num">{x.contribution12m === null ? "—" : n(x.contribution12m)}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </div>
  );
}
