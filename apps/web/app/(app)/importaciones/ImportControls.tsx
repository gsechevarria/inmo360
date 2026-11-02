"use client";
import { useState, useTransition } from "react";
import { JOB_TYPES } from "@/lib/jobs";
import { refreshAggregates } from "../actions";
import { cancelJob, enqueueJob, reviewMatch } from "./actions";

export function EnqueueForm({ workerOnline }: { workerOnline: boolean }) {
  const [type, setType] = useState<string>(JOB_TYPES[4].type);
  const def = JOB_TYPES.find((j) => j.type === type)!;
  const [source, setSource] = useState<string>(def.source);
  const [params, setParams] = useState(JSON.stringify(def.params, null, 2));
  const [prio, setPrio] = useState(100);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const pick = (t: string) => { const d = JOB_TYPES.find((j) => j.type === t)!; setType(t); setSource(d.source); setParams(JSON.stringify(d.params, null, 2)); setMsg(null); };
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
      const r = await enqueueJob(type, source, params, prio, null);
      setMsg(r.ok ? { ok: true, t: workerOnline ? "Trabajo encolado; el trabajador lo recogerá." : "Trabajo encolado como PENDIENTE: se ejecutará cuando el trabajador del PC se conecte." } : { ok: false, t: r.error });
    }); }}>
      <label className="block text-[12px]"><span className="font-medium text-ink-2">Tipo de trabajo</span>
        <select className="input" value={type} onChange={(e) => pick(e.target.value)}>{JOB_TYPES.map((j) => <option key={j.type} value={j.type}>{j.label}</option>)}</select></label>
      <p className="meta">{def.note}</p>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="block text-[12px]"><span className="font-medium text-ink-2">Código de fuente</span><input className="input code" value={source} onChange={(e) => setSource(e.target.value)} /></label>
        <label className="block text-[12px]"><span className="font-medium text-ink-2">Prioridad</span><input className="input num" type="number" min={0} max={1000} value={prio} onChange={(e) => setPrio(Number(e.target.value))} /></label>
      </div>
      <label className="block text-[12px]"><span className="font-medium text-ink-2">Parámetros (JSON, sin credenciales)</span>
        <textarea className="input code" rows={6} value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} /></label>
      <button className="btn-primary" disabled={pending}>Encolar trabajo</button>
      {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-pos" : "text-neg"}`}>{msg.t}</p>}
    </form>
  );
}

export function CancelButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  return <span>{info ? <span className="meta">{info}</span> : <button className="btn-ghost text-neg" disabled={pending} onClick={() => start(async () => { const r = await cancelJob(id); setInfo(r.ok ? r.info ?? "Hecho" : r.error); })}>Cancelar</button>}</span>;
}

export function RefreshButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return <span className="inline-flex items-center gap-2"><button className="btn" disabled={pending} onClick={() => start(async () => { const r = await refreshAggregates(); setMsg(r.ok ? "Agregados actualizados." : r.error); })}>
    {pending ? "Actualizando…" : "Actualizar «último dato disponible»"}</button>{msg && <span className="meta" role="status">{msg}</span>}</span>;
}

export function MatchReview({ id, status }: { id: number; status: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = (a: "confirm" | "reject" | "undo") => start(async () => { const r = await reviewMatch(id, a, note || null); setMsg(r.ok ? "Hecho" : r.error); });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input className="input w-48" placeholder="Nota (opcional)" aria-label="Nota de revisión" value={note} onChange={(e) => setNote(e.target.value)} />
      {status === "pending" && <><button className="btn" disabled={pending} onClick={() => act("confirm")}>Es el mismo inmueble</button>
        <button className="btn" disabled={pending} onClick={() => act("reject")}>Son distintos</button></>}
      {(status === "confirmed" || status === "auto_linked") && <button className="btn" disabled={pending} onClick={() => act("undo")}>Deshacer unión</button>}
      {status === "rejected" && <span className="meta">Rechazado: no se volverá a proponer con la misma versión del método.</span>}
      {msg && <span role="status" className="meta">{msg}</span>}
    </div>
  );
}
