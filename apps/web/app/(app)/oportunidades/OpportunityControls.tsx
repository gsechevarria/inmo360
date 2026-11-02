"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOpportunity } from "../actions";

export function OpportunityRowControls({ propertyId, status, offer, statuses, compact = false }: { propertyId: string; status: string | null; offer: number | null;
  statuses: { id: string; label: string }[]; compact?: boolean }) {
  const [st, setSt] = useState(status ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label="Estado de seguimiento" className={`input ${compact ? "w-36 py-0.5" : "w-40"}`} value={st} disabled={pending}
        onChange={(e) => { const v = e.target.value; setSt(v); start(async () => { const r = await setOpportunity(propertyId, v || "saved", offer); setErr(r.ok ? null : r.error); }); }}>
        {!status && <option value="">— Asignar estado —</option>}
        {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {err && <span role="alert" className="meta text-neg">{err}</span>}
    </span>
  );
}

/** Envuelve una tabla con casillas name="cmp" y ofrece comparar los seleccionados (2–4). */
export function CompareSelection({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [nSel, setNSel] = useState(0);
  const router = useRouter();
  const ids = () => Array.from(ref.current?.querySelectorAll<HTMLInputElement>('input[name="cmp"]:checked') ?? []).map((x) => x.value);
  return (
    <div ref={ref} onChange={() => setNSel(ids().length)}>
      <div className="flex items-center gap-2 border-b border-line-2 px-3 py-2">
        <button className="btn" disabled={nSel < 2 || nSel > 4} onClick={() => router.push(`/comparar?viviendas=${ids().join(",")}`)}>Comparar seleccionadas ({nSel})</button>
        <span className="meta">Selecciona entre 2 y 4 inmuebles.</span>
      </div>
      {children}
    </div>
  );
}
