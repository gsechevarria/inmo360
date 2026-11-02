"use client";
import { useEffect, useId, useState } from "react";
import type { Item, Periodicity, ValueStatus } from "@inmo360/finance";

export const FIN_STATUS: { id: ValueStatus; label: string }[] = [
  { id: "confirmed", label: "Confirmado" }, { id: "published_unconfirmed", label: "Publicado sin confirmar" }, { id: "estimated", label: "Estimado" },
  { id: "user_input", label: "Introducido por mí" }, { id: "unknown", label: "Desconocido" }, { id: "not_applicable", label: "No aplica" }, { id: "confirmed_zero", label: "Cero confirmado" },
];
export const statusLabel = (s: string) => FIN_STATUS.find((x) => x.id === s)?.label ?? s;
const PERIOD: { id: Periodicity; label: string }[] = [{ id: "once", label: "Única" }, { id: "monthly", label: "Mensual" }, { id: "quarterly", label: "Trimestral" }, { id: "annual", label: "Anual" }];
const KIND: { id: NonNullable<Item["kind"]>; label: string }[] = [
  { id: "fixed", label: "Importe fijo" }, { id: "percent_of_price", label: "% del precio" }, { id: "percent_of_sale", label: "% de la venta" },
  { id: "percent_of_principal", label: "% del préstamo" }, { id: "percent_of_income", label: "% de ingresos" }, { id: "brackets_of_price", label: "Tramos sobre precio" },
];

/** Admite «1.234,56», «1234.56» y «1234». Vacío → null (desconocido). */
export function parseEs(s: string): number | null {
  const t = s.trim().replace(/\s|€|%/g, "");
  if (!t) return null;
  let x = t;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, "").replace(",", ".");
  else x = x.replace(",", ".");
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
const show = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d, useGrouping: false }).format(v));

export function NumInput({ value, onChange, label, suffix, decimals = 2, className = "", placeholder = "desconocido", id }: {
  value: number | null | undefined; onChange: (v: number | null) => void; label: string; suffix?: string; decimals?: number; className?: string; placeholder?: string; id?: string }) {
  const [txt, setTxt] = useState(show(value, decimals));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setTxt(show(value, decimals)); }, [value, decimals, focus]);
  const auto = useId();
  return (
    <span className={`relative inline-flex w-full items-center ${className}`}>
      <input id={id ?? auto} aria-label={label} className={`input num ${suffix ? "pr-9" : ""}`} inputMode="decimal" value={txt} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); onChange(parseEs(txt)); }}
        onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span className="pointer-events-none absolute right-2 text-[12px] text-ink-3">{suffix}</span>}
    </span>
  );
}

/** Porcentaje mostrado en % y guardado como fracción. */
export function PctInput({ value, onChange, label, className }: { value: number | null | undefined; onChange: (v: number | null) => void; label: string; className?: string }) {
  return <NumInput label={label} className={className} suffix="%" decimals={3} value={value === null || value === undefined ? null : Math.round(value * 1e6) / 1e4}
                   onChange={(v) => onChange(v === null ? null : v / 100)} />;
}

export function StatusSelect({ value, onChange, label = "Estado del dato" }: { value: ValueStatus; onChange: (v: ValueStatus) => void; label?: string }) {
  return (
    <select aria-label={label} className={`input ${value === "unknown" ? "border-warn text-warn" : ""}`} value={value} onChange={(e) => onChange(e.target.value as ValueStatus)}>
      {FIN_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-[12px] ${className}`}>
      <span className="mb-0.5 block font-medium text-ink-2">{label}</span>{children}{hint && <span className="meta mt-0.5 block">{hint}</span>}
    </label>
  );
}

let seq = 0;
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Editor genérico de partidas: concepto, forma de cálculo, importe/tipo, periodicidad, fechas, estado y origen. */
export function ItemsEditor({ items, onChange, allowKinds, defaultPeriodicity = "once", addLabel = "Añadir partida", dateHint }: {
  items: Item[]; onChange: (items: Item[]) => void; allowKinds?: NonNullable<Item["kind"]>[]; defaultPeriodicity?: Periodicity; addLabel?: string; dateHint?: string }) {
  const kinds = KIND.filter((k) => !allowKinds || allowKinds.includes(k.id));
  const upd = (i: number, patch: Partial<Item>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <p className="meta">Sin partidas.</p>}
      {items.map((it, i) => {
        const kind = it.kind ?? "fixed";
        return (
          <div key={it.id} className={`grid grid-cols-2 gap-1.5 rounded-md border p-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] ${it.status === "unknown" ? "border-warn/60 bg-warn-50/40" : "border-line-2"}`}>
            <input aria-label="Concepto" className="input col-span-2 md:col-span-1" value={it.concept} onChange={(e) => upd(i, { concept: e.target.value })} />
            <select aria-label="Forma de cálculo" className="input" value={kind} onChange={(e) => { const k = e.target.value as NonNullable<Item["kind"]>; upd(i, k === "fixed" ? { kind: k, rate: null } : { kind: k, amount: null }); }}>
              {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            {kind === "fixed" ? <NumInput label={`Importe de ${it.concept}`} suffix="€" value={it.amount} onChange={(v) => upd(i, { amount: v, status: v !== null && it.status === "unknown" ? "user_input" : it.status })} />
              : kind === "brackets_of_price" ? <span className="meta self-center">{it.brackets?.length ? `${it.brackets.length} tramos (${it.bracketMode === "whole_base" ? "base completa" : "marginal"})` : "sin tramos"}</span>
              : <PctInput label={`Tipo de ${it.concept}`} value={it.rate} onChange={(v) => upd(i, { rate: v, status: v !== null && it.status === "unknown" ? "user_input" : it.status })} />}
            <select aria-label="Periodicidad" className="input" value={it.periodicity} onChange={(e) => upd(i, { periodicity: e.target.value as Periodicity })}>
              {PERIOD.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <StatusSelect value={it.status} onChange={(v) => upd(i, { status: v })} />
            <button type="button" className="btn-ghost justify-self-end" aria-label={`Eliminar ${it.concept}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
            <div className="col-span-2 grid grid-cols-2 gap-1.5 md:col-span-6 md:grid-cols-[1fr_1fr_2fr]">
              {it.periodicity === "once"
                ? <input aria-label="Fecha" type="date" className="input" value={it.date ?? ""} onChange={(e) => upd(i, { date: e.target.value || undefined })} title={dateHint} />
                : <><input aria-label="Inicio" type="date" className="input" value={it.start ?? ""} onChange={(e) => upd(i, { start: e.target.value || undefined })} />
                    <input aria-label="Fin (exclusivo)" type="date" className="input" value={it.end ?? ""} onChange={(e) => upd(i, { end: e.target.value || undefined })} /></>}
              <span className="meta self-center">{it.origin ? `Origen: ${it.origin}` : ""}{it.notes ? ` · ${it.notes}` : ""}</span>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn" onClick={() => onChange([...items, { id: newId("it"), concept: "Nueva partida", amount: null, periodicity: defaultPeriodicity, status: "unknown", origin: "usuario" }])}>+ {addLabel}</button>
    </div>
  );
}

export function Section({ title, children, badge, defaultOpen = false }: { title: string; children: React.ReactNode; badge?: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-lg border border-line bg-surface" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink">
        <span>{title}</span><span className="flex items-center gap-2 normal-case">{badge}<span className="text-ink-3 transition group-open:rotate-90">›</span></span>
      </summary>
      <div className="border-t border-line-2 p-4">{children}</div>
    </details>
  );
}
