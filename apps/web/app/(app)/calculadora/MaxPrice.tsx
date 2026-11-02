"use client";
import { useState, useTransition } from "react";
import { maxPurchasePrice, type MaxPriceResult, type Objectives, type ScenarioInput } from "@inmo360/finance";
import { eur, n } from "@/lib/format";
import { Notice } from "@/components/ui";
import { Field, NumInput } from "./fields";
import { saveMaxPrice } from "./actions";

const OBJ: { key: keyof Objectives; label: string; unit: string; forStrategies?: string[] }[] = [
  { key: "maxEquity", label: "Capital propio máximo (necesidad máxima de aportaciones)", unit: "€" },
  { key: "minNetYield", label: "Rentabilidad neta operativa mínima", unit: "%", forStrategies: ["rent_long", "rooms", "temporary", "tourist"] },
  { key: "minMonthlyCashflow", label: "Flujo de caja mensual mínimo", unit: "€/mes", forStrategies: ["rent_long", "rooms", "temporary", "tourist"] },
  { key: "minResaleProfit", label: "Beneficio mínimo después de financiación", unit: "€", forStrategies: ["resale"] },
  { key: "minReturnOnCost", label: "Retorno mínimo sobre coste", unit: "%", forStrategies: ["resale"] },
  { key: "minIrr", label: "TIR mínima del capital propio", unit: "%" },
  { key: "maxDurationMonths", label: "Plazo máximo de la operación", unit: "meses", forStrategies: ["resale"] },
];
const STATUS: Record<string, string> = { calculated: "Calculado", infeasible: "No hay precio que cumpla", insufficient_data: "Datos insuficientes", search_limit: "Límite de búsqueda alcanzado" };

export function MaxPrice({ input, scenarioId, listingPrice }: { input: ScenarioInput; scenarioId: string | null; listingPrice: number | null }) {
  const [obj, setObj] = useState<Objectives>({});
  const [range, setRange] = useState<{ min: number | null; max: number | null; tol: number | null }>({ min: null, max: null, tol: 100 });
  const [res, setRes] = useState<MaxPriceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const objectives = OBJ.filter((o) => !o.forStrategies || o.forStrategies.includes(input.strategy));
  const run = () => {
    setBusy(true); setMsg(null);
    setTimeout(() => {   // deja pintar el estado «calculando»
      setRes(maxPurchasePrice(input, obj, { min: range.min ?? undefined, max: range.max ?? undefined, tolerance: range.tol ?? 100 }));
      setBusy(false);
    }, 10);
  };
  return (
    <div className="space-y-3">
      <Notice>Busca el mayor precio de compra que cumple <strong>todos</strong> los objetivos activos, recalculando el escenario completo (impuestos por tramos, financiación sobre precio, comisiones…) para cada precio candidato. No supone monotonía. El resultado es una oferta compatible con sus supuestos, no una tasación.</Notice>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {objectives.map((o) => (
          <Field key={o.key} label={`${o.label} (${o.unit})`}>
            <NumInput label={o.label} placeholder="sin objetivo" value={(obj[o.key] as number | null | undefined) ?? null} onChange={(v) => setObj({ ...obj, [o.key]: v })} />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 md:w-2/3">
        <Field label="Buscar desde (€)"><NumInput label="Precio mínimo de búsqueda" placeholder="1.000" value={range.min} onChange={(v) => setRange({ ...range, min: v })} /></Field>
        <Field label="Hasta (€)"><NumInput label="Precio máximo de búsqueda" placeholder="3 × precio" value={range.max} onChange={(v) => setRange({ ...range, max: v })} /></Field>
        <Field label="Precisión (€)"><NumInput label="Precisión" value={range.tol} onChange={(v) => setRange({ ...range, tol: v })} /></Field>
      </div>
      <button className="btn-primary" disabled={busy} onClick={run}>{busy ? "Calculando…" : "Calcular precio máximo"}</button>
      {res && (
        <div className="rounded-lg border border-line p-3" role="status">
          <div className="flex flex-wrap items-baseline gap-3">
            <div><div className="meta">Precio máximo compatible</div><div className="kpi num">{res.price !== null ? eur(res.price) : "—"}</div></div>
            <span className={`chip ${res.status === "calculated" ? "bg-pos-50 text-pos" : "bg-warn-50 text-warn"}`}>{STATUS[res.status]}</span>
            {listingPrice && res.price !== null && <span className="meta">Precio publicado {eur(listingPrice)} · diferencia {eur(res.price - listingPrice)} ({n(((res.price - listingPrice) / listingPrice) * 100, 1)} %)</span>}
          </div>
          {res.binding && <p className="mt-1 text-[13px]">Restricción limitante: <strong>{res.binding}</strong></p>}
          <table className="tbl mt-2"><thead><tr><th>Objetivo</th><th className="text-right">Objetivo</th><th className="text-right">Valor al precio máximo</th><th>Cumple</th></tr></thead>
            <tbody>{res.checks.map((c) => (
              <tr key={c.objective}><td>{c.label}</td><td className="text-right num">{n(c.target, 2)}</td><td className="text-right num">{c.value === null ? "no calculable" : n(c.value, 2)}</td>
                <td>{c.ok === null ? "no evaluable" : c.ok ? "sí" : "no"}</td></tr>
            ))}</tbody></table>
          <ul className="meta mt-2">
            <li>· Intervalo explorado: {eur(res.searchRange[0])} – {eur(res.searchRange[1])} · precisión {eur(res.tolerance)} · {res.evaluations} recálculos.</li>
            {res.feasibleIntervals.length > 0 && <li>· Intervalos factibles: {res.feasibleIntervals.map(([a, b]) => `${eur(a)}–${eur(b)}`).join(" · ")}</li>}
            {res.notes.map((x) => <li key={x}>· {x}</li>)}
          </ul>
          {scenarioId ? (
            <button className="btn mt-2" disabled={pending} onClick={() => start(async () => { const r = await saveMaxPrice(scenarioId, input, obj, { min: range.min ?? undefined, max: range.max ?? undefined, tolerance: range.tol ?? 100 });
              setMsg(r.ok ? `Resultado recalculado en servidor y guardado (${r.price != null ? eur(r.price) : "sin precio"}).` : r.error); })}>Guardar resultado en el escenario</button>
          ) : <p className="meta mt-2">Guarde el escenario para conservar este resultado.</p>}
          {msg && <p className="meta mt-1" role="status">{msg}</p>}
        </div>
      )}
    </div>
  );
}
