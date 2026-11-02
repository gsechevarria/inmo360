"use client";
import { useState } from "react";
import type { Operation, Room, Stay, TouristMonth } from "@inmo360/finance";
import { Field, ItemsEditor, NumInput, PctInput, StatusSelect, newId } from "./fields";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function OperationEditor({ op, onChange, purchaseDate }: { op: Operation; onChange: (op: Operation) => void; purchaseDate: string }) {
  switch (op.kind) {
    case "rent_long":
      return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Renta mensual"><NumInput label="Renta mensual" suffix="€" value={op.rentMonthly} onChange={(v) => onChange({ ...op, rentMonthly: v, rentStatus: v !== null && op.rentStatus === "unknown" ? "user_input" : op.rentStatus })} /></Field>
          <Field label="Estado de la renta"><StatusSelect value={op.rentStatus} onChange={(v) => onChange({ ...op, rentStatus: v })} /></Field>
          <Field label="Inicio del contrato"><input type="date" className="input" value={op.leaseStart} onChange={(e) => onChange({ ...op, leaseStart: e.target.value })} /></Field>
          <Field label="Actualización anual supuesta" hint="Vacío = sin actualización"><PctInput label="Actualización anual" value={op.annualIndexation} onChange={(v) => onChange({ ...op, annualIndexation: v })} /></Field>
          <Field label="Vacancia">
            <select className="input" value={op.vacancy.mode} onChange={(e) => onChange({ ...op, vacancy: { ...op.vacancy, mode: e.target.value as "none" | "percent" | "calendar" } })}>
              <option value="none">Sin vacancia</option><option value="percent">% medio de meses</option><option value="calendar">Periodos concretos</option>
            </select>
          </Field>
          {op.vacancy.mode === "percent" && <Field label="% de vacancia"><PctInput label="Vacancia" value={op.vacancy.percent} onChange={(v) => onChange({ ...op, vacancy: { ...op.vacancy, percent: v } })} /></Field>}
          {op.vacancy.mode === "calendar" && (
            <div className="col-span-2 space-y-1">
              {(op.vacancy.gaps ?? []).map((g, i) => (
                <div key={i} className="flex gap-1">
                  <input aria-label="Desde" type="date" className="input" value={g.start} onChange={(e) => onChange({ ...op, vacancy: { ...op.vacancy, gaps: op.vacancy.gaps!.map((x, j) => j === i ? { ...x, start: e.target.value } : x) } })} />
                  <input aria-label="Hasta (exclusivo)" type="date" className="input" value={g.end} onChange={(e) => onChange({ ...op, vacancy: { ...op.vacancy, gaps: op.vacancy.gaps!.map((x, j) => j === i ? { ...x, end: e.target.value } : x) } })} />
                  <button type="button" className="btn-ghost" aria-label="Quitar periodo" onClick={() => onChange({ ...op, vacancy: { ...op.vacancy, gaps: op.vacancy.gaps!.filter((_, j) => j !== i) } })}>✕</button>
                </div>
              ))}
              <button type="button" className="btn" onClick={() => onChange({ ...op, vacancy: { ...op.vacancy, gaps: [...(op.vacancy.gaps ?? []), { start: op.leaseStart, end: op.leaseStart }] } })}>+ Periodo sin inquilino</button>
            </div>
          )}
        </div>
      );
    case "rooms": {
      const upd = (i: number, p: Partial<Room>) => onChange({ ...op, rooms: op.rooms.map((r, j) => (j === i ? { ...r, ...p } : r)) });
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Duración de los contratos"><select className="input" value={op.term} onChange={(e) => onChange({ ...op, term: e.target.value as "long" | "temporary" })}>
              <option value="long">Larga duración</option><option value="temporary">Temporal</option></select></Field>
            <Field label="Actualización anual supuesta"><PctInput label="Actualización anual" value={op.annualIndexation} onChange={(v) => onChange({ ...op, annualIndexation: v })} /></Field>
          </div>
          <p className="meta">Habitaciones y duración son independientes: también puede modelar alquiler temporal por habitaciones con estancias en la modalidad «Temporal».</p>
          {op.rooms.map((r, i) => (
            <div key={r.id} className={`grid grid-cols-2 gap-1.5 rounded-md border p-2 md:grid-cols-[0.6fr_1.4fr_1fr_1fr_0.8fr_1fr_auto] ${r.status === "unknown" ? "border-warn/60" : "border-line-2"}`}>
              <input aria-label="Nombre" className="input" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} />
              <input aria-label="Características" className="input" placeholder="Características (baño propio, m²…)" value={r.features ?? ""} onChange={(e) => upd(i, { features: e.target.value })} />
              <NumInput label={`Renta ${r.label}`} suffix="€/mes" value={r.rentMonthly} onChange={(v) => upd(i, { rentMonthly: v, status: v !== null && r.status === "unknown" ? "user_input" : r.status })} />
              <StatusSelect value={r.status} onChange={(v) => upd(i, { status: v })} />
              <PctInput label={`Ocupación ${r.label}`} value={r.occupancy ?? 1} onChange={(v) => upd(i, { occupancy: v })} />
              <input aria-label="Inicio" type="date" className="input" value={r.start} onChange={(e) => upd(i, { start: e.target.value })} />
              <button type="button" className="btn-ghost" aria-label={`Eliminar ${r.label}`} onClick={() => onChange({ ...op, rooms: op.rooms.filter((_, j) => j !== i) })}>✕</button>
              <details className="col-span-2 md:col-span-7"><summary className="meta cursor-pointer">Gastos específicos de {r.label} ({r.expenses?.length ?? 0})</summary>
                <ItemsEditor items={r.expenses ?? []} onChange={(x) => upd(i, { expenses: x })} allowKinds={["fixed"]} defaultPeriodicity="monthly" /></details>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => onChange({ ...op, rooms: [...op.rooms, { id: newId("h"), label: `H${op.rooms.length + 1}`, rentMonthly: null, status: "unknown", start: purchaseDate, occupancy: 1 }] })}>+ Habitación</button>
        </div>
      );
    }
    case "temporary": {
      const upd = (i: number, p: Partial<Stay>) => onChange({ ...op, stays: op.stays.map((s, j) => (j === i ? { ...s, ...p } : s)) });
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Coste por cambio de ocupante"><NumInput label="Coste por cambio" suffix="€" value={op.turnoverCost} onChange={(v) => onChange({ ...op, turnoverCost: v, turnoverStatus: v !== null ? "user_input" : op.turnoverStatus })} /></Field>
            <Field label="Estado"><StatusSelect value={op.turnoverStatus ?? "unknown"} onChange={(v) => onChange({ ...op, turnoverStatus: v })} /></Field>
          </div>
          <p className="meta">Cada estancia se prorratea por días reales del calendario; los huecos entre estancias son meses sin ingresos.</p>
          {op.stays.length === 0 && <p className="meta text-warn">Sin estancias: los ingresos son desconocidos.</p>}
          {op.stays.map((s, i) => (
            <div key={s.id} className="grid grid-cols-2 gap-1.5 rounded-md border border-line-2 p-2 md:grid-cols-[1fr_1fr_1fr_1fr_0.9fr_1fr_auto]">
              <input aria-label="Entrada" type="date" className="input" value={s.start} onChange={(e) => upd(i, { start: e.target.value })} />
              <input aria-label="Salida (exclusiva)" type="date" className="input" value={s.end} onChange={(e) => upd(i, { end: e.target.value })} />
              <NumInput label="Tarifa mensual" suffix="€/mes" value={s.monthlyRate} onChange={(v) => upd(i, { monthlyRate: v, totalAmount: v !== null ? null : s.totalAmount })} />
              <NumInput label="o importe total" suffix="€" value={s.totalAmount} placeholder="o importe total" onChange={(v) => upd(i, { totalAmount: v, monthlyRate: v !== null ? null : s.monthlyRate })} />
              <PctInput label="Comisión" value={s.commissionRate} onChange={(v) => upd(i, { commissionRate: v })} />
              <StatusSelect value={s.status} onChange={(v) => upd(i, { status: v })} />
              <button type="button" className="btn-ghost" aria-label="Eliminar estancia" onClick={() => onChange({ ...op, stays: op.stays.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => {
            const last = op.stays.at(-1)?.end ?? purchaseDate;
            const end = new Date(`${last}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 6);
            onChange({ ...op, stays: [...op.stays, { id: newId("st"), start: last, end: end.toISOString().slice(0, 10), monthlyRate: null, status: "unknown" }] });
          }}>+ Estancia</button>
        </div>
      );
    }
    case "tourist": {
      const updM = (i: number, p: Partial<TouristMonth>) => onChange({ ...op, months: op.months.map((m, j) => (j === i ? { ...m, ...p } : m)) });
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Inicio de la explotación"><input type="date" className="input" value={op.operationStart} onChange={(e) => onChange({ ...op, operationStart: e.target.value })} /></Field>
            <Field label="Comisión de plataforma" hint="Vacío = desconocida"><PctInput label="Comisión de plataforma" value={op.platformCommissionRate} onChange={(v) => onChange({ ...op, platformCommissionRate: v })} /></Field>
            <Field label="¿Cobros ya netos de comisión?"><select className="input" value={op.payoutsAreNet ? "1" : "0"} onChange={(e) => onChange({ ...op, payoutsAreNet: e.target.value === "1" })}>
              <option value="0">No: ingresos brutos</option><option value="1">Sí: liquidaciones netas</option></select></Field>
            <Field label="Gestión (sobre ingresos netos)"><PctInput label="Gestión" value={op.managementRate} onChange={(v) => onChange({ ...op, managementRate: v })} /></Field>
            <Field label="Limpieza por estancia"><NumInput label="Limpieza por estancia" suffix="€" value={op.cleaningCostPerStay} onChange={(v) => onChange({ ...op, cleaningCostPerStay: v })} /></Field>
            <Field label="Lavandería por estancia"><NumInput label="Lavandería por estancia" suffix="€" value={op.laundryCostPerStay} onChange={(v) => onChange({ ...op, laundryCostPerStay: v })} /></Field>
            <Field label="Actualización anual de tarifa"><PctInput label="Actualización anual de tarifa" value={op.annualAdrIndexation} onChange={(v) => onChange({ ...op, annualAdrIndexation: v })} /></Field>
          </div>
          <Field label="Hipótesis de ocupación y tarifa (texto visible en el informe)">
            <textarea className="input" rows={2} value={op.assumptions ?? ""} onChange={(e) => onChange({ ...op, assumptions: e.target.value })} />
          </Field>
          <div className="overflow-x-auto">
            <table className="tbl"><thead><tr><th>Mes</th><th>Noches disp.</th><th>Noches ocupadas</th><th>Tarifa media (ADR)</th><th>Estancia media (noches)</th><th>Ocupación</th></tr></thead>
              <tbody>{op.months.map((m, i) => (
                <tr key={m.month}>
                  <td>{MONTHS[m.month - 1]}</td>
                  <td className="w-24"><NumInput label={`Noches disponibles ${MONTHS[m.month - 1]}`} decimals={0} value={m.availableNights} onChange={(v) => updM(i, { availableNights: v ?? 0 })} /></td>
                  <td className="w-28"><NumInput label={`Noches ocupadas ${MONTHS[m.month - 1]}`} decimals={0} value={m.occupiedNights} onChange={(v) => updM(i, { occupiedNights: v })} /></td>
                  <td className="w-32"><NumInput label={`ADR ${MONTHS[m.month - 1]}`} suffix="€" value={m.adr} onChange={(v) => updM(i, { adr: v })} /></td>
                  <td className="w-28"><NumInput label={`Estancia media ${MONTHS[m.month - 1]}`} decimals={1} value={m.avgStayNights} onChange={(v) => updM(i, { avgStayNights: v })} /></td>
                  <td className="meta num">{m.occupiedNights !== null && m.availableNights ? `${Math.round((m.occupiedNights / m.availableNights) * 100)} %` : "—"}</td>
                </tr>
              ))}</tbody></table>
          </div>
          <QuickFill onApply={(occ, adr, stay) => onChange({ ...op, months: op.months.map((m) => ({ ...m,
            ...(adr !== null ? { adr } : {}), ...(stay !== null ? { avgStayNights: stay } : {}),
            ...(occ !== null ? { occupiedNights: Math.round(m.availableNights * occ) } : {}) })) })} />
        </div>
      );
    }
    case "resale":
      return (
        <div className="space-y-2">
          <p className="meta">Gastos de comercialización de la reventa (los costes de venta se indican en «Salida»).</p>
          <ItemsEditor items={op.marketing ?? []} onChange={(x) => onChange({ ...op, marketing: x })} allowKinds={["fixed", "percent_of_sale"]} />
        </div>
      );
  }
}

function QuickFill({ onApply }: { onApply: (occ: number | null, adr: number | null, stay: number | null) => void }) {
  const [occ, setOcc] = useState<number | null>(null), [adr, setAdr] = useState<number | null>(null), [stay, setStay] = useState<number | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-canvas p-2">
      <span className="meta w-full">Rellenar los 12 meses con un mismo supuesto (después puede ajustar mes a mes):</span>
      <Field label="Ocupación" className="w-28"><PctInput label="Ocupación para todos los meses" value={occ} onChange={setOcc} /></Field>
      <Field label="ADR" className="w-28"><NumInput label="ADR para todos los meses" suffix="€" value={adr} onChange={setAdr} /></Field>
      <Field label="Estancia media" className="w-28"><NumInput label="Estancia media para todos los meses" value={stay} onChange={setStay} /></Field>
      <button type="button" className="btn" disabled={occ === null && adr === null && stay === null} onClick={() => onApply(occ, adr, stay)}>Aplicar a todos</button>
    </div>
  );
}
