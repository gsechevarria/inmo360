"use client";
import { useState, useTransition } from "react";
import { addCorrection, setOpportunity } from "../../actions";

export function OpportunityControl({ propertyId, status, offer, statuses }: { propertyId: string; status: string | null; offer: number | null; statuses: { id: string; label: string }[] }) {
  const [st, setSt] = useState(status ?? "");
  const [of, setOf] = useState(offer?.toString() ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = (s: string, o: string) => start(async () => {
    const r = await setOpportunity(propertyId, s || "saved", o ? Number(o.replace(/\./g, "").replace(",", ".")) : null);
    setMsg(r.ok ? "Guardado" : r.error);
  });
  return (
    <div className="space-y-1">
      <label className="sr-only" htmlFor="opp-st">Estado de seguimiento</label>
      <select id="opp-st" className="input" value={st} disabled={pending} onChange={(e) => { setSt(e.target.value); save(e.target.value, of); }}>
        <option value="">— No guardada —</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <div className="flex gap-1">
        <label className="sr-only" htmlFor="opp-of">Oferta prevista (€)</label>
        <input id="opp-of" className="input" inputMode="decimal" placeholder="Oferta prevista €" value={of} onChange={(e) => setOf(e.target.value)} />
        <button className="btn" disabled={pending} onClick={() => save(st, of)}>OK</button>
      </div>
      {msg && <p role="status" className="meta">{msg} · el estado es tuyo y no altera el anuncio</p>}
    </div>
  );
}

export function CorrectionForm({ propertyId, field, label }: { propertyId: string; field: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (["property_type"].includes(field)) return null;
  if (!open) return <button className="btn-ghost text-[12px]" onClick={() => setOpen(true)} aria-label={`Corregir ${label}`}>Corregir</button>;
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); start(async () => {
      const r = await addCorrection("property", propertyId, field, value, reason, `/viviendas/${propertyId}`);
      if (r.ok) { setOpen(false); setErr(null); } else setErr(r.error);
    }); }}>
      {field.startsWith("has_") ? (
        <select aria-label={`Nuevo valor de ${label}`} className="input w-20" value={value} onChange={(e) => setValue(e.target.value)} required><option value="">—</option><option value="true">sí</option><option value="false">no</option></select>
      ) : field === "condition" ? (
        <select aria-label={`Nuevo valor de ${label}`} className="input w-32" value={value} onChange={(e) => setValue(e.target.value)} required>
          <option value="">—</option><option value="new">nuevo</option><option value="good">buen estado</option><option value="to_renovate">a reformar</option></select>
      ) : <input aria-label={`Nuevo valor de ${label}`} className="input w-24" value={value} onChange={(e) => setValue(e.target.value)} required />}
      <input aria-label="Motivo de la corrección" className="input w-40" placeholder="Motivo (obligatorio)" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
      <button className="btn" disabled={pending}>Guardar</button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      {err && <span role="alert" className="meta text-neg">{err}</span>}
    </form>
  );
}
