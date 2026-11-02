"use client";
import { useState, useTransition } from "react";
import type { ProfileConfig } from "@inmo360/scoring";
import { ASSUMPTION_KEYS, isPctKey, type AssumptionValues } from "@/lib/assumptions";
import { STRATEGIES } from "@/lib/domain";
import { FIN_STATUS, NumInput, PctInput } from "../calculadora/fields";
import { activateProfile, deleteAssumptionSet, deleteTaxRule, saveAssumptionSet, saveGlobalCombination, saveProfileVariant, saveTaxRule } from "./actions";

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = (f: () => Promise<{ ok: boolean; error?: string }>, okText: string) => start(async () => { const r = await f(); setMsg(r.ok ? { ok: true, t: okText } : { ok: false, t: r.error ?? "Error" }); });
  const Msg = () => (msg ? <span role="status" className={`text-[13px] ${msg.ok ? "text-pos" : "text-neg"}`}>{msg.t}</span> : null);
  return { pending, run, Msg };
}

// ------------------------------------------------------------------ supuestos
export function AssumptionSetForm({ set }: { set?: { id: string; name: string; strategy: string; values: AssumptionValues; isDefault: boolean } }) {
  const [name, setName] = useState(set?.name ?? "Mis supuestos");
  const [strategy, setStrategy] = useState(set?.strategy ?? "any");
  const [isDefault, setIsDefault] = useState(set?.isDefault ?? true);
  const [vals, setVals] = useState<AssumptionValues>(() => Object.fromEntries(ASSUMPTION_KEYS.map((k) => [k.key, set?.values[k.key] ?? { value: null, status: "unknown" }])));
  const { pending, run, Msg } = useAction();
  const upd = (k: string, p: Partial<{ value: number | null; status: string }>) => setVals((v) => ({ ...v, [k]: { ...v[k]!, ...p } }));
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => saveAssumptionSet(set?.id ?? null, name, strategy, vals, isDefault), "Supuestos guardados."); }}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="text-[12px] md:col-span-2"><span className="block font-medium text-ink-2">Nombre</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-[12px]"><span className="block font-medium text-ink-2">Modalidad</span>
          <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value)}><option value="any">Todas</option>{STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="flex items-end gap-2 text-[13px]"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Usar por defecto</label>
      </div>
      <table className="tbl"><thead><tr><th>Supuesto</th><th className="w-40">Valor</th><th className="w-48">Estado</th></tr></thead>
        <tbody>{ASSUMPTION_KEYS.map((k) => (
          <tr key={k.key}><td>{k.label}{k.hint && <div className="meta">{k.hint}</div>}</td>
            <td>{isPctKey(k.key) ? <PctInput label={k.label} value={vals[k.key]!.value} onChange={(v) => upd(k.key, { value: v, status: v === null ? "unknown" : vals[k.key]!.status === "unknown" ? "user_input" : vals[k.key]!.status })} />
              : <NumInput label={k.label} suffix={k.unit} value={vals[k.key]!.value} onChange={(v) => upd(k.key, { value: v, status: v === null ? "unknown" : vals[k.key]!.status === "unknown" ? "user_input" : vals[k.key]!.status })} />}</td>
            <td><select aria-label={`Estado de ${k.label}`} className="input" value={vals[k.key]!.status} onChange={(e) => upd(k.key, { status: e.target.value })}>
              {FIN_STATUS.filter((s) => !["published_unconfirmed", "confirmed_zero"].includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></td></tr>))}</tbody></table>
      <div className="flex items-center gap-2"><button className="btn-primary" disabled={pending}>{set ? "Guardar cambios" : "Crear conjunto"}</button>
        {set && <button type="button" className="btn-ghost text-neg" disabled={pending} onClick={() => run(() => deleteAssumptionSet(set.id), "Eliminado.")}>Eliminar</button>}<Msg /></div>
    </form>
  );
}

// ------------------------------------------------------------------ scoring
export interface ProfileOpt { versionId: string; name: string; version: number; own: boolean; experimental: boolean; config: ProfileConfig }
export function ProfileSlot({ block, strategy, label, options, activeId }: { block: string; strategy: string; label: string; options: ProfileOpt[]; activeId: string | null }) {
  const [sel, setSel] = useState(activeId ?? "");
  const [edit, setEdit] = useState(false);
  const { pending, run, Msg } = useAction();
  const cur = options.find((o) => o.versionId === sel) ?? null;
  return (
    <div className="rounded-md border border-line-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[180px] font-medium">{label}</span>
        <select aria-label={`Perfil para ${label}`} className="input w-80" value={sel} disabled={pending}
          onChange={(e) => { setSel(e.target.value); run(() => activateProfile(block, strategy, e.target.value || null), e.target.value ? "Perfil activado." : "Sin perfil: puntuación pendiente de configuración."); }}>
          <option value="">— Sin perfil (no se puntúa) —</option>
          {options.map((o) => <option key={o.versionId} value={o.versionId}>{o.name} · v{o.version}{o.own ? " · propio" : ""}{o.experimental ? " · experimental" : ""}</option>)}
        </select>
        {cur && <button className="btn" onClick={() => setEdit(!edit)}>{edit ? "Cerrar" : "Ver / editar pesos"}</button>}
        <Msg />
      </div>
      {cur && !edit && <p className="meta mt-1">{cur.config.description} · {cur.config.factors.length} factores · faltantes: {cur.config.missingPolicy === "block" ? "no puntúa si falta alguno" : `parcial explícita (mín. ${Math.round((cur.config.minCoverage ?? 0) * 100)} % del peso)`}</p>}
      {cur && edit && <ProfileEditor base={cur} onSaved={() => setEdit(false)} />}
    </div>
  );
}

function ProfileEditor({ base, onSaved }: { base: ProfileOpt; onSaved: () => void }) {
  const [name, setName] = useState(base.own ? base.name : `${base.name} (mi variante)`);
  const [w, setW] = useState<Record<string, number>>(Object.fromEntries(base.config.factors.map((f) => [f.id, f.weight])));
  const [req, setReq] = useState<Record<string, boolean>>(Object.fromEntries(base.config.factors.map((f) => [f.id, !!f.required])));
  const [mp, setMp] = useState(base.config.missingPolicy);
  const [mc, setMc] = useState<number | null>(base.config.minCoverage ?? 0.6);
  const { pending, run, Msg } = useAction();
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return (
    <div className="mt-2 space-y-2">
      <table className="tbl"><thead><tr><th>Factor</th><th>Fuente · transformación</th><th>Grupo de señal</th><th className="w-28">Peso</th><th className="text-right">Cuota</th><th>Imprescindible</th></tr></thead>
        <tbody>{base.config.factors.map((f) => (
          <tr key={f.id}><td>{f.label}<div className="meta">{f.rationale ?? ""}</div></td><td className="meta">{f.source}:{f.key} · {f.transform} · {f.direction === "higher_better" ? "más es mejor" : f.direction === "lower_better" ? "menos es mejor" : "objetivo"}</td>
            <td className="meta">{f.signalGroup ?? "—"}</td>
            <td><NumInput label={`Peso de ${f.label}`} decimals={0} value={w[f.id]} onChange={(v) => setW({ ...w, [f.id]: Math.max(0, v ?? 0) })} /></td>
            <td className="text-right num">{total ? `${Math.round(((w[f.id] ?? 0) / total) * 100)} %` : "—"}</td>
            <td><input type="checkbox" aria-label={`${f.label} imprescindible`} checked={req[f.id]} onChange={(e) => setReq({ ...req, [f.id]: e.target.checked })} /></td></tr>))}</tbody></table>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px]"><span className="block font-medium text-ink-2">Nombre de la variante</span><input className="input w-72" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-[12px]"><span className="block font-medium text-ink-2">Si faltan datos</span>
          <select className="input w-64" value={mp} onChange={(e) => setMp(e.target.value as "block" | "partial_explicit")}><option value="block">No puntuar</option><option value="partial_explicit">Puntuación parcial explícita</option></select></label>
        {mp === "partial_explicit" && <label className="text-[12px]"><span className="block font-medium text-ink-2">Cobertura mínima</span><PctInput label="Cobertura mínima" className="w-28" value={mc} onChange={setMc} /></label>}
        <button className="btn-primary" disabled={pending} onClick={() => run(async () => { const r = await saveProfileVariant(base.versionId, name, { weights: w, required: req, missingPolicy: mp, minCoverage: mc }, true); if (r.ok) onSaved(); return r; }, "Variante guardada y activada.")}>
          Guardar como {base.own ? "nueva versión" : "variante propia"} y activar</button><Msg />
      </div>
      <p className="meta">La plantilla experimental no se modifica. Factores con peso 0 se eliminan. Los atributos protegidos no pueden añadirse como factor.</p>
    </div>
  );
}

export function GlobalCombinationForm({ current }: { current: { zone: number; property: number; operation: number } | null }) {
  const [on, setOn] = useState(!!current);
  const [w, setW] = useState(current ?? { zone: 40, property: 20, operation: 40 });
  const { pending, run, Msg } = useAction();
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Calcular una puntuación global combinando bloques</label>
      {on && <div className="flex flex-wrap gap-2">{(["zone", "property", "operation"] as const).map((k) => (
        <label key={k} className="text-[12px]"><span className="block font-medium text-ink-2">{{ zone: "Zona", property: "Vivienda", operation: "Operación" }[k]}</span>
          <NumInput label={`Peso ${k}`} className="w-24" decimals={0} value={w[k]} onChange={(v) => setW({ ...w, [k]: Math.max(0, v ?? 0) })} /></label>))}</div>}
      <div className="flex items-center gap-2"><button className="btn" disabled={pending} onClick={() => run(() => saveGlobalCombination(on ? w : null), on ? "Combinación guardada." : "Puntuación global desactivada.")}>Guardar</button><Msg /></div>
      <p className="meta">Sin combinación explícita no se muestra puntuación global: zona, vivienda y operación se presentan por separado.</p>
    </div>
  );
}

// ------------------------------------------------------------------ fiscalidad
const EMPTY = { territory_level: "ccaa", territory_code: "", tax_type: "ITP", profile: "general", description: "", base_description: "Precio de compra declarado",
  rate: null as number | null, brackets: null as { from: number; to: number | null; rate: number }[] | null, fixed_amount: null as number | null,
  valid_from: new Date().toISOString().slice(0, 10), valid_to: null as string | null, payment_moment: "compra", source_name: "", source_url: "",
  verification_status: "user_input", auto_apply: false, notes: "" };
export type TaxRuleRow = typeof EMPTY & { id?: string };

/** Fuera del componente: si se definiera dentro, cada tecleo remontaría los campos y perdería el foco. */
const F = ({ label, children, w = "" }: { label: string; children: React.ReactNode; w?: string }) => <label className={`text-[12px] ${w}`}><span className="block font-medium text-ink-2">{label}</span>{children}</label>;

export function TaxRuleForm({ rule, onDone }: { rule?: TaxRuleRow; onDone?: () => void }) {
  const [r, setR] = useState<TaxRuleRow>(rule ?? EMPTY);
  const [form, setForm] = useState<"rate" | "brackets" | "fixed">(rule?.brackets?.length ? "brackets" : rule?.fixed_amount != null ? "fixed" : "rate");
  const [bTxt, setBTxt] = useState(rule?.brackets ? rule.brackets.map((b) => `${b.from};${b.to ?? ""};${b.rate * 100}`).join("\n") : "0;;");
  const { pending, run, Msg } = useAction();
  const set = (p: Partial<TaxRuleRow>) => setR({ ...r, ...p });
  const submit = () => {
    let brackets: TaxRuleRow["brackets"] = null;
    if (form === "brackets") brackets = bTxt.split("\n").filter((l) => l.trim()).map((l) => { const [a, b, c] = l.split(";"); return { from: Number(a), to: b?.trim() ? Number(b) : null, rate: Number((c ?? "").replace(",", ".")) / 100 }; });
    const body = { ...r, rate: form === "rate" ? r.rate : null, fixed_amount: form === "fixed" ? r.fixed_amount : null, brackets,
      source_name: r.source_name || null, source_url: r.source_url || null, notes: r.notes || null, valid_to: r.valid_to || null, payment_moment: r.payment_moment || null };
    delete (body as { id?: string }).id;
    run(async () => { const x = await saveTaxRule(rule?.id ?? null, body); if (x.ok && !rule) setR(EMPTY); if (x.ok) onDone?.(); return x; }, "Regla guardada.");
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <F label="Ámbito"><select className="input" value={r.territory_level} onChange={(e) => set({ territory_level: e.target.value })}>
          <option value="country">España</option><option value="ccaa">Comunidad autónoma</option><option value="province">Provincia</option><option value="municipality">Municipio</option></select></F>
        <F label="Código INE (ES, CCAA 2 díg., prov. 2 díg., municipio 5 díg.)"><input className="input code" value={r.territory_code} onChange={(e) => set({ territory_code: e.target.value.trim() })} placeholder={r.territory_level === "country" ? "ES" : ""} /></F>
        <F label="Impuesto"><select className="input" value={r.tax_type} onChange={(e) => set({ tax_type: e.target.value })}>{["ITP", "AJD", "IVA", "IGIC", "IPSI", "IBI", "IIVTNU", "IRPF", "IS", "tasa", "otro"].map((t) => <option key={t}>{t}</option>)}</select></F>
        <F label="Perfil / supuesto"><input className="input" value={r.profile} onChange={(e) => set({ profile: e.target.value })} placeholder="general, vivienda habitual joven…" /></F>
        <F label="Descripción" w="md:col-span-2"><input className="input" value={r.description} onChange={(e) => set({ description: e.target.value })} placeholder="ITP tipo general vivienda usada" /></F>
        <F label="Base imponible" w="md:col-span-2"><input className="input" value={r.base_description} onChange={(e) => set({ base_description: e.target.value })} /></F>
        <F label="Forma"><select className="input" value={form} onChange={(e) => setForm(e.target.value as "rate" | "brackets" | "fixed")}><option value="rate">Tipo único</option><option value="brackets">Tramos marginales</option><option value="fixed">Importe fijo</option></select></F>
        {form === "rate" && <F label="Tipo"><PctInput label="Tipo" value={r.rate} onChange={(v) => set({ rate: v })} /></F>}
        {form === "fixed" && <F label="Importe"><NumInput label="Importe" suffix="€" value={r.fixed_amount} onChange={(v) => set({ fixed_amount: v })} /></F>}
        {form === "brackets" && <F label="Tramos: desde;hasta;tipo % (una línea por tramo; hasta vacío = sin límite)" w="col-span-2"><textarea className="input code" rows={3} value={bTxt} onChange={(e) => setBTxt(e.target.value)} /></F>}
        <F label="Vigente desde"><input type="date" className="input" value={r.valid_from} onChange={(e) => set({ valid_from: e.target.value })} /></F>
        <F label="Vigente hasta (opcional)"><input type="date" className="input" value={r.valid_to ?? ""} onChange={(e) => set({ valid_to: e.target.value || null })} /></F>
        <F label="Fuente (nombre)"><input className="input" value={r.source_name ?? ""} onChange={(e) => set({ source_name: e.target.value })} placeholder="BOE / boletín autonómico / web de Hacienda" /></F>
        <F label="URL de la fuente"><input className="input" value={r.source_url ?? ""} onChange={(e) => set({ source_url: e.target.value })} placeholder="https://…" /></F>
        <F label="Verificación"><select className="input" value={r.verification_status} onChange={(e) => set({ verification_status: e.target.value })}>
          <option value="user_input">Introducida por mí</option><option value="published_unconfirmed">Publicada, sin confirmar</option><option value="confirmed">Confirmada con fuente oficial</option></select></F>
      </div>
      <div className="flex items-center gap-2"><button className="btn-primary" disabled={pending} onClick={submit}>{rule ? "Guardar regla" : "Añadir regla"}</button><Msg /></div>
    </div>
  );
}

export function TaxRuleRowActions({ rule }: { rule: TaxRuleRow & { id: string } }) {
  const [edit, setEdit] = useState(false);
  const { pending, run, Msg } = useAction();
  return (
    <div>
      <div className="flex gap-1"><button className="btn-ghost" onClick={() => setEdit(!edit)}>{edit ? "Cerrar" : "Editar"}</button>
        <button className="btn-ghost text-neg" disabled={pending} onClick={() => run(() => deleteTaxRule(rule.id), "Eliminada.")}>Eliminar</button><Msg /></div>
      {edit && <div className="mt-2 rounded-md border border-line-2 p-2"><TaxRuleForm rule={rule} onDone={() => setEdit(false)} /></div>}
    </div>
  );
}
