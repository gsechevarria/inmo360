"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { simulate, templates, type Item, type Loan, type RenovationLine, type ScenarioInput, type Strategy } from "@inmo360/finance";
import { scoreSubject, type FactorInput, type ProfileConfig } from "@inmo360/scoring";
import { STRATEGIES, strategyLabel } from "@/lib/domain";
import { eur, n } from "@/lib/format";
import { Notice, SyntheticBadge } from "@/components/ui";
import { ScoreCard } from "@/components/ScoreCard";
import { Field, ItemsEditor, NumInput, PctInput, Section, StatusSelect, newId } from "./fields";
import { OperationEditor } from "./OperationEditor";
import { MetricTile, ResultTabs } from "./Results";
import { KEY_METRICS } from "@/lib/metrics";
import { MaxPrice } from "./MaxPrice";
import { saveScenario } from "./actions";

export interface TaxRule {
  id: string; territory_level: string; territory_code: string; tax_type: string; profile: string; description: string; base_description: string; rate: number | null;
  brackets: { from: number; to: number | null; rate: number }[] | null; fixed_amount: number | null; valid_from: string; valid_to: string | null; payment_moment: string | null;
  source_name: string | null; source_url: string | null; verification_status: "confirmed" | "published_unconfirmed" | "user_input"; auto_apply: boolean; is_system: boolean;
}
export interface CalcContext {
  property: { id: string; listingId: string; title: string; price: number | null; area: number | null; rooms: number | null; muniName: string | null; synthetic: boolean } | null;
  scenario: { id: string; name: string; parentId: string | null; listingPriceAtSave: number | null } | null;
  rules: TaxRule[];
  sets: { id: string; name: string; strategy: string; values: Record<string, { value: number | null; status: string }>; isDefault: boolean }[];
  opProfiles: Record<string, ProfileConfig | null>;
  siblings: { id: string; name: string; strategy: string; parentId: string | null }[];
  territory: { muni: string | null; prov: string | null; ccaa: string | null };
  assumptionNote: string | null;
}

const COMMON_OPEX = new Set(["community", "ibi", "insurance"]);

/** Cambiar de modalidad conserva compra, adquisición, reforma, financiación, reserva y gastos de tenencia comunes. */
function switchStrategy(s: ScenarioInput, to: Strategy): ScenarioInput {
  const rent = s.operation.kind === "rent_long" ? s.operation.rentMonthly : null;
  const t = templates(to, { price: s.purchase.price, date: s.purchase.date, rent });
  const kept = s.operatingExpenses.filter((i) => COMMON_OPEX.has(i.id) || i.origin === "usuario");
  return { ...t, name: s.name, purchase: s.purchase, acquisitionCosts: s.acquisitionCosts, renovation: s.renovation, financing: s.financing, reserve: s.reserve,
           investorTax: s.investorTax, discountRate: s.discountRate, capex: s.capex,
           operatingExpenses: [...kept, ...t.operatingExpenses.filter((i) => !kept.some((k) => k.id === i.id))] };
}

export function Calculator({ initial, ctx }: { initial: ScenarioInput; ctx: CalcContext }) {
  const [s, setS] = useState<ScenarioInput>(initial);
  const [tab, setTab] = useState<"scenario" | "max">("scenario");
  const [name, setName] = useState(ctx.scenario?.name ?? `${strategyLabel(initial.strategy)} · ${ctx.property?.title ?? "sin inmueble"}`.slice(0, 120));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const r = useMemo(() => simulate(s), [s]);
  const set = <K extends keyof ScenarioInput>(k: K, v: ScenarioInput[K]) => setS((x) => ({ ...x, [k]: v }));

  const profile = ctx.opProfiles[s.strategy] ?? null;
  const opScore = useMemo(() => {
    const mv: Record<string, number | null> = {};
    for (const [k, m] of Object.entries(r.metrics)) mv[k] = m.status === "ok" ? m.value : null;
    const inputs: Record<string, FactorInput> = {};
    for (const f of profile?.factors ?? []) inputs[f.id] = { value: mv[f.key] ?? null };
    return scoreSubject(profile, inputs, {}, mv);
  }, [r, profile]);

  const save = (asAlternative: boolean) => start(async () => {
    const res = await saveScenario({ ...s, name }, { id: ctx.scenario?.id ?? null, asAlternativeOf: asAlternative ? ctx.scenario?.id ?? null : null, name,
                                                     propertyId: ctx.property?.id ?? null, listingId: ctx.property?.listingId ?? null });
    if (res.ok) { setMsg({ ok: true, text: asAlternative ? "Alternativa guardada; el escenario original no se modifica." : "Escenario guardado y recalculado en servidor." });
                  if (res.id !== ctx.scenario?.id) router.push(`/calculadora?scenario=${res.id}`); else router.refresh(); }
    else setMsg({ ok: false, text: res.error });
  });

  const acqRules = ctx.rules.filter((x) => ["ITP", "IVA", "AJD", "IGIC", "IPSI"].includes(x.tax_type));
  const applyRule = (rule: TaxRule) => {
    const it = s.acquisitionCosts.find((i) => i.group === "acq_tax") ?? s.acquisitionCosts.find((i) => i.id === "itp");
    const origin = `regla fiscal: ${rule.description} · ${rule.source_name ?? "sin fuente"} · vigente desde ${String(rule.valid_from).slice(0, 10)}`;
    const patch: Partial<Item> = rule.brackets?.length ? { kind: "brackets_of_price", brackets: rule.brackets, bracketMode: "marginal", rate: null, amount: null }
      : rule.rate !== null ? { kind: "percent_of_price", rate: rule.rate, amount: null } : { kind: "fixed", amount: rule.fixed_amount, rate: null };
    const status = rule.verification_status;
    if (it) set("acquisitionCosts", s.acquisitionCosts.map((i) => (i === it ? { ...i, ...patch, status, origin, notes: rule.base_description } : i)));
    else set("acquisitionCosts", [...s.acquisitionCosts, { id: newId("tax"), concept: rule.description, periodicity: "once", group: "acq_tax", status, origin, ...patch }]);
  };

  const priceChanged = ctx.scenario && ctx.property?.price != null && ctx.scenario.listingPriceAtSave != null && ctx.property.price !== ctx.scenario.listingPriceAtSave;
  const keys = KEY_METRICS[s.strategy] ?? [];
  const unknownCount = r.missing.length;

  return (
    <div className="px-4 md:px-6">
      {/* barra de escenario */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
        <Field label="Modalidad" className="w-56">
          <select className="input" value={s.strategy} onChange={(e) => setS(switchStrategy(s, e.target.value as Strategy))}>
            {STRATEGIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Nombre del escenario" className="min-w-[220px] flex-1"><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        {ctx.scenario ? <>
          <button className="btn-primary" disabled={pending || r.errors.length > 0} onClick={() => save(false)}>Guardar cambios</button>
          <button className="btn" disabled={pending || r.errors.length > 0} onClick={() => save(true)}>Guardar como alternativa</button>
        </> : <button className="btn-primary" disabled={pending || r.errors.length > 0} onClick={() => save(false)}>Guardar escenario</button>}
        <button className="btn-ghost" onClick={() => setS(initial)}>Restablecer</button>
        {msg && <p role="status" className={`w-full text-[13px] ${msg.ok ? "text-pos" : "text-neg"}`}>{msg.text}</p>}
        <div className="meta w-full">
          {ctx.property ? <>Inmueble: <Link className="underline" href={`/viviendas/${ctx.property.id}`}>{ctx.property.title}</Link>{ctx.property.muniName && ` · ${ctx.property.muniName}`}
            {ctx.property.area && ` · ${n(ctx.property.area)} m²`} {ctx.property.synthetic && <SyntheticBadge />}</> : "Escenario libre (sin inmueble asociado)."}
          {ctx.assumptionNote && ` · ${ctx.assumptionNote}`}
          {ctx.siblings.length > 0 && <> · Otros escenarios: {ctx.siblings.filter((x) => x.id !== ctx.scenario?.id).slice(0, 6).map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link className="underline" href={`/calculadora?scenario=${x.id}`}>{x.name}</Link></span>)}</>}
        </div>
      </div>
      {priceChanged && (
        <div className="mb-3"><Notice kind="warn">El precio del anuncio cambió desde que se guardó este escenario ({eur(ctx.scenario!.listingPriceAtSave)} → {eur(ctx.property!.price)}). El escenario conserva su propio precio.
          <button className="btn ml-2 py-0.5" onClick={() => set("purchase", { ...s.purchase, price: ctx.property!.price, priceStatus: "published_unconfirmed" })}>Usar el precio actual</button></Notice></div>
      )}
      <div role="tablist" className="mb-3 flex gap-1">
        {([["scenario", "Escenario y resultados"], ["max", "Precio máximo de compra"]] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={tab === id ? "btn-primary" : "btn"}>{l}</button>
        ))}
      </div>

      {tab === "max" ? <MaxPrice input={s} scenarioId={ctx.scenario?.id ?? null} listingPrice={ctx.property?.price ?? null} /> : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
          <div className="min-w-0 space-y-2">
            <Section title="Compra y horizonte" defaultOpen badge={s.purchase.priceStatus === "unknown" ? <span className="chip bg-warn-50 text-warn">precio desconocido</span> : null}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Precio de compra"><NumInput label="Precio de compra" suffix="€" value={s.purchase.price} onChange={(v) => set("purchase", { ...s.purchase, price: v, priceStatus: v === null ? "unknown" : s.purchase.priceStatus === "unknown" ? "user_input" : s.purchase.priceStatus })} /></Field>
                <Field label="Estado del precio"><StatusSelect value={s.purchase.priceStatus} onChange={(v) => set("purchase", { ...s.purchase, priceStatus: v })} /></Field>
                <Field label="Fecha de compra"><input type="date" className="input" value={s.purchase.date} onChange={(e) => e.target.value && set("purchase", { ...s.purchase, date: e.target.value })} /></Field>
                <Field label="Horizonte (meses)" hint={s.exit ? "Con salida, el horizonte lo marca la fecha de venta." : "Sin salida: periodo de análisis."}>
                  <NumInput label="Horizonte en meses" decimals={0} value={s.horizonMonths} onChange={(v) => v && v > 0 && set("horizonMonths", Math.min(600, Math.round(v)))} /></Field>
                <Field label="Tasa de descuento (VAN)" hint="Vacío = no se calcula VAN"><PctInput label="Tasa de descuento" value={s.discountRate} onChange={(v) => set("discountRate", v)} /></Field>
              </div>
            </Section>

            <Section title="Gastos e impuestos de adquisición" badge={<PendingBadge items={s.acquisitionCosts} />}>
              <ItemsEditor items={s.acquisitionCosts} onChange={(x) => set("acquisitionCosts", x)} allowKinds={["fixed", "percent_of_price", "brackets_of_price"]} />
              <div className="mt-3 rounded-md bg-canvas p-2 text-[13px]">
                <div className="font-medium">Reglas fiscales registradas para el territorio {ctx.territory.muni ? `(${[ctx.territory.ccaa, ctx.territory.prov, ctx.territory.muni].filter(Boolean).join(" / ")})` : "(sin territorio: solo reglas estatales)"}</div>
                {acqRules.length === 0 ? <p className="meta">No hay reglas de impuestos de adquisición registradas. Introduzca el tipo en la partida o regístrelo con su fuente en <Link className="underline" href="/configuracion#fiscal">Supuestos → Reglas fiscales</Link>. Mientras tanto, la partida queda como desconocida.</p>
                  : acqRules.map((rule) => (
                    <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 py-1 last:border-0">
                      <span>{rule.tax_type} · {rule.description} · {rule.rate !== null ? `${n(rule.rate * 100, 2)} %` : rule.brackets ? `${rule.brackets.length} tramos` : eur(rule.fixed_amount)}
                        <span className="meta"> · {rule.territory_level} {rule.territory_code} · {rule.verification_status === "confirmed" ? "confirmada" : rule.verification_status === "user_input" ? "introducida por usuario" : "publicada sin confirmar"} · {rule.source_name ?? "sin fuente"}</span></span>
                      <button className="btn py-0.5" onClick={() => applyRule(rule)}>Aplicar</button>
                    </div>))}
              </div>
            </Section>

            <Section title="Reforma" badge={s.renovation.mode !== "none" ? <span className="chip bg-info-50 text-info">{s.renovation.mode === "itemized" ? "por partidas" : "simplificada"}</span> : null}>
              <RenovationEditor s={s} set={set} />
            </Section>
            <Section title="Mobiliario y equipamiento" badge={<PendingBadge items={s.equipment} />}>
              <ItemsEditor items={s.equipment} onChange={(x) => set("equipment", x)} allowKinds={["fixed"]} />
            </Section>
            <Section title="Financiación" badge={s.financing.loans.length ? <span className="chip bg-info-50 text-info">{s.financing.loans.length} préstamo(s)</span> : <span className="meta">sin financiación</span>}>
              <LoansEditor loans={s.financing.loans} onChange={(loans) => set("financing", { loans })} />
            </Section>
            <Section title="Reserva de liquidez">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Importe retenido"><NumInput label="Reserva" suffix="€" value={s.reserve.initial} onChange={(v) => set("reserve", { ...s.reserve, initial: v, status: v === null ? "unknown" : v === 0 ? "confirmed_zero" : "user_input" })} /></Field>
                <Field label="Estado"><StatusSelect value={s.reserve.status} onChange={(v) => set("reserve", { ...s.reserve, status: v })} /></Field>
                <Field label="Al final"><select className="input" value={s.reserve.releaseAtEnd ? "1" : "0"} onChange={(e) => set("reserve", { ...s.reserve, releaseAtEnd: e.target.value === "1" })}>
                  <option value="1">Se libera</option><option value="0">No se libera</option></select></Field>
              </div>
              <p className="meta mt-1">La reserva es dinero inmovilizado, no un gasto: cuenta en la necesidad de aportaciones y en la TIR del capital propio, no en la rentabilidad del activo.</p>
            </Section>
            <Section title={`Explotación · ${strategyLabel(s.strategy)}`} defaultOpen>
              <OperationEditor op={s.operation} onChange={(op) => set("operation", op)} purchaseDate={s.purchase.date} />
            </Section>
            <Section title="Gastos de tenencia y explotación" badge={<PendingBadge items={s.operatingExpenses} />}>
              <ItemsEditor items={s.operatingExpenses} onChange={(x) => set("operatingExpenses", x)} allowKinds={["fixed", "percent_of_income"]} defaultPeriodicity="monthly" />
            </Section>
            <Section title="Reposiciones e inversiones posteriores" badge={<PendingBadge items={s.capex} />}>
              <ItemsEditor items={s.capex} onChange={(x) => set("capex", x)} allowKinds={["fixed"]} />
            </Section>
            <Section title="Salida (venta)" defaultOpen={s.strategy === "resale"} badge={s.exit ? <span className="chip bg-info-50 text-info">venta {s.exit.date}</span> : <span className="meta">sin venta</span>}>
              {!s.exit ? (
                <button className="btn" onClick={() => set("exit", { date: new Date(new Date(`${s.purchase.date}T00:00:00Z`).setUTCMonth(new Date(`${s.purchase.date}T00:00:00Z`).getUTCMonth() + s.horizonMonths)).toISOString().slice(0, 10),
                  price: null, priceStatus: "unknown", saleCosts: [{ id: "sale_agency", concept: "Honorarios de venta", kind: "percent_of_sale", rate: null, periodicity: "once", status: "unknown" },
                                                                   { id: "plusvalia", concept: "Plusvalía municipal (IIVTNU)", amount: null, periodicity: "once", status: "unknown" }] })}>Añadir venta</button>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Field label="Fecha de venta"><input type="date" className="input" value={s.exit.date} onChange={(e) => e.target.value && set("exit", { ...s.exit!, date: e.target.value })} /></Field>
                    <Field label="Precio de venta"><NumInput label="Precio de venta" suffix="€" value={s.exit.price} onChange={(v) => set("exit", { ...s.exit!, price: v, priceStatus: v === null ? "unknown" : s.exit!.priceStatus === "unknown" ? "user_input" : s.exit!.priceStatus })} /></Field>
                    <Field label="Estado"><StatusSelect value={s.exit.priceStatus} onChange={(v) => set("exit", { ...s.exit!, priceStatus: v })} /></Field>
                    {s.strategy !== "resale" && <button className="btn self-end" onClick={() => set("exit", null)}>Quitar venta</button>}
                  </div>
                  <ItemsEditor items={s.exit.saleCosts} onChange={(x) => set("exit", { ...s.exit!, saleCosts: x })} allowKinds={["fixed", "percent_of_sale"]} addLabel="Añadir coste de venta" />
                </div>
              )}
            </Section>
            <Section title="Fiscalidad del inversor">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Modo"><select className="input" value={s.investorTax?.mode ?? "none"} onChange={(e) => set("investorTax", { ...(s.investorTax ?? {}), mode: e.target.value as "none" | "manual" })}>
                  <option value="none">No configurada (resultados antes de impuestos)</option><option value="manual">Manual</option></select></Field>
                {s.investorTax?.mode === "manual" && <Field label="Tipo efectivo sobre beneficio de venta"><PctInput label="Tipo efectivo" value={s.investorTax.profitTaxRate} onChange={(v) => set("investorTax", { ...s.investorTax!, profitTaxRate: v })} /></Field>}
              </div>
              {s.investorTax?.mode === "manual" && <div className="mt-2"><ItemsEditor items={s.investorTax.items ?? []} onChange={(x) => set("investorTax", { ...s.investorTax!, items: x as never })} allowKinds={["fixed"]} defaultPeriodicity="annual" addLabel="Añadir impuesto" /></div>}
              <p className="meta mt-1">La fiscalidad personal depende de su situación: Inmo360 no la calcula automáticamente. Si no se configura, todas las métricas se rotulan «antes de impuestos del inversor».</p>
            </Section>
          </div>

          {/* resumen fijo */}
          <aside className="min-w-0">
            <div className="space-y-3 xl:sticky xl:top-3">
              <div className="rounded-lg border border-line bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide">Resultado</h2>
                  {r.errors.length ? <span className="chip bg-neg-50 text-neg">con errores</span>
                    : r.status === "complete" ? <span className="chip bg-pos-50 text-pos">completo</span> : <span className="chip bg-warn-50 text-warn">parcial · {unknownCount} dato(s) pendiente(s)</span>}
                </div>
                {r.errors.length > 0 ? <Notice kind="neg"><ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice> : (
                  <div className="grid grid-cols-2 gap-2">{keys.map((k) => <MetricTile key={k} m={r.metrics[k]} />)}</div>
                )}
                {r.windows.stabilized && <p className="meta mt-2">Ventana estabilizada: {r.windows.stabilized.from} a {r.windows.stabilized.to} · primer año: {r.windows.firstYear.from} a {r.windows.firstYear.to}.</p>}
                {r.warnings.length > 0 && <ul className="meta mt-1 text-warn">{r.warnings.map((w) => <li key={w}>· {w}</li>)}</ul>}
              </div>
              {r.missing.length > 0 && (
                <div className="rounded-lg border border-warn/50 bg-surface p-3">
                  <h2 className="mb-1 text-[13px] font-semibold">Datos pendientes ({r.missing.length})</h2>
                  <p className="meta mb-1">No se sustituyen por cero. Cada uno bloquea las métricas que dependen de él.</p>
                  <ul className="space-y-1 text-[13px]">{r.missing.map((m) => (
                    <li key={m.itemId}><span className="font-medium">{m.concept}</span><span className="meta"> · afecta a: {m.affects.slice(0, 4).join(", ")}{m.affects.length > 4 ? "…" : ""}</span></li>
                  ))}</ul>
                </div>
              )}
              <div className="rounded-lg border border-line bg-surface p-3">
                <ScoreCard result={opScore} title={`Operación · ${strategyLabel(s.strategy)}`} />
              </div>
              <p className="meta">Motor {r.engineVersion} · huella {r.inputsHash.split(":")[1]}</p>
            </div>
          </aside>
          <div className="xl:col-span-2"><ResultTabs r={r} /></div>
        </div>
      )}
    </div>
  );
}

function PendingBadge({ items }: { items: Item[] }) {
  const u = items.filter((i) => i.status === "unknown").length;
  return u ? <span className="chip bg-warn-50 text-warn">{u} desconocida(s)</span> : <span className="meta">{items.length} partida(s)</span>;
}

function RenovationEditor({ s, set }: { s: ScenarioInput; set: <K extends keyof ScenarioInput>(k: K, v: ScenarioInput[K]) => void }) {
  const rv = s.renovation;
  const lines = rv.lines ?? [];
  const updL = (i: number, p: Partial<RenovationLine>) => set("renovation", { ...rv, lines: lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const total = lines.reduce((a, l) => (a === null || l.unitPrice === null || l.status === "unknown" ? null : a + l.quantity * l.unitPrice), 0 as number | null);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Modo"><select className="input" value={rv.mode} onChange={(e) => {
          const mode = e.target.value as "none" | "itemized" | "simplified";
          set("renovation", mode === "simplified" && !rv.simplified ? { ...rv, mode, simplified: { id: "reno_simpl", concept: "Reforma (estimación simplificada)", amount: null, periodicity: "once", status: "unknown", basis: "" } } : { ...rv, mode });
        }}><option value="none">Sin reforma</option><option value="simplified">Estimación simplificada</option><option value="itemized">Por partidas</option></select></Field>
        {rv.mode !== "none" && <Field label="Duración (meses)" hint="La explotación empieza después"><NumInput label="Duración de la reforma" decimals={0} value={rv.durationMonths ?? 0} onChange={(v) => set("renovation", { ...rv, durationMonths: v ?? 0 })} /></Field>}
      </div>
      {rv.mode === "simplified" && rv.simplified && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Importe total"><NumInput label="Importe de la reforma" suffix="€" value={rv.simplified.amount} onChange={(v) => set("renovation", { ...rv, simplified: { ...rv.simplified!, amount: v, status: v === null ? "unknown" : "estimated" } })} /></Field>
          <Field label="Estado"><StatusSelect value={rv.simplified.status} onChange={(v) => set("renovation", { ...rv, simplified: { ...rv.simplified!, status: v } })} /></Field>
          <Field label="Base de la estimación" className="col-span-2"><input className="input" placeholder="p. ej. 450 €/m² × 70 m², presupuesto verbal…" value={rv.simplified.basis ?? ""} onChange={(e) => set("renovation", { ...rv, simplified: { ...rv.simplified!, basis: e.target.value } })} /></Field>
        </div>
      )}
      {rv.mode === "itemized" && (
        <>
          {lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-2 gap-1.5 rounded-md border border-line-2 p-2 md:grid-cols-[1.6fr_0.6fr_0.9fr_1fr_1fr_0.9fr_auto]">
              <input aria-label="Partida" className="input" value={l.concept} onChange={(e) => updL(i, { concept: e.target.value })} />
              <NumInput label="Cantidad" value={l.quantity} onChange={(v) => updL(i, { quantity: v ?? 0 })} />
              <NumInput label="Precio unitario" suffix="€" value={l.unitPrice} onChange={(v) => updL(i, { unitPrice: v, status: v !== null && l.status === "unknown" ? "user_input" : l.status })} />
              <StatusSelect value={l.status} onChange={(v) => updL(i, { status: v })} />
              <input aria-label="Fecha" type="date" className="input" value={l.date ?? ""} onChange={(e) => updL(i, { date: e.target.value || undefined })} />
              <select aria-label="Fase" className="input" value={l.phase ?? "initial"} onChange={(e) => updL(i, { phase: e.target.value as "initial" | "later" })}><option value="initial">Inicial</option><option value="later">Posterior</option></select>
              <button className="btn-ghost" aria-label={`Eliminar ${l.concept}`} onClick={() => set("renovation", { ...rv, lines: lines.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button className="btn" onClick={() => set("renovation", { ...rv, lines: [...lines, { id: newId("rl"), concept: "Partida de reforma", quantity: 1, unitPrice: null, status: "unknown", phase: "initial" }] })}>+ Partida de reforma</button>
            <span className="meta">Total: {total === null ? "incompleto (hay partidas desconocidas)" : eur(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function LoansEditor({ loans, onChange }: { loans: Loan[]; onChange: (l: Loan[]) => void }) {
  const upd = (i: number, p: Partial<Loan>) => onChange(loans.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-2">
      {loans.map((l, i) => (
        <div key={l.id} className="space-y-2 rounded-md border border-line-2 p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Nombre"><input className="input" value={l.label ?? ""} onChange={(e) => upd(i, { label: e.target.value })} /></Field>
            <Field label="Importe"><select className="input" value={l.ltv ? "ltv" : "principal"} onChange={(e) => upd(i, e.target.value === "ltv" ? { ltv: { ratio: 0.7, base: "price" }, principal: null } : { ltv: null, principal: null })}>
              <option value="ltv">% sobre precio/tasación</option><option value="principal">Importe fijo</option></select></Field>
            {l.ltv ? <>
              <Field label="Porcentaje"><PctInput label="LTV" value={l.ltv.ratio} onChange={(v) => upd(i, { ltv: { ...l.ltv!, ratio: v ?? 0 } })} /></Field>
              <Field label="Base"><select className="input" value={l.ltv.base} onChange={(e) => upd(i, { ltv: { ...l.ltv!, base: e.target.value as "price" | "appraisal" } })}>
                <option value="price">Precio de compra</option><option value="appraisal">Tasación (mín. con precio)</option></select></Field>
              {l.ltv.base === "appraisal" && <Field label="Tasación"><NumInput label="Tasación" suffix="€" value={l.ltv.appraisal} onChange={(v) => upd(i, { ltv: { ...l.ltv!, appraisal: v } })} /></Field>}
            </> : <Field label="Principal"><NumInput label="Principal" suffix="€" value={l.principal} onChange={(v) => upd(i, { principal: v, status: v === null ? "unknown" : "user_input" })} /></Field>}
            <Field label="Estado"><StatusSelect value={l.status} onChange={(v) => upd(i, { status: v })} /></Field>
            <Field label="Tipo de interés"><select className="input" value={l.rate.type} onChange={(e) => upd(i, { rate: e.target.value === "fixed" ? { type: "fixed", annualRate: l.rate.annualRate ?? 0.03 } : { type: "schedule", schedule: [{ fromMonth: 1, annualRate: l.rate.annualRate ?? 0.03 }], label: "Escenario de tipos" } })}>
              <option value="fixed">Fijo</option><option value="schedule">Variable/mixto (escenario de tipos)</option></select></Field>
            {l.rate.type === "fixed" && <Field label="TIN anual"><PctInput label="TIN anual" value={l.rate.annualRate} onChange={(v) => upd(i, { rate: { ...l.rate, annualRate: v ?? 0 } })} /></Field>}
            <Field label="Plazo (años)"><NumInput label="Plazo en años" decimals={1} value={l.termMonths / 12} onChange={(v) => v && upd(i, { termMonths: Math.round(v * 12) })} /></Field>
            <Field label="Pago"><select className="input" value={l.paymentFrequency} onChange={(e) => upd(i, { paymentFrequency: e.target.value as "monthly" | "quarterly" })}><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option></select></Field>
            <Field label="Carencia (meses)"><NumInput label="Carencia" decimals={0} value={l.graceMonths ?? 0} onChange={(v) => upd(i, { graceMonths: v ?? 0 })} /></Field>
            {(l.graceMonths ?? 0) > 0 && <Field label="Tipo de carencia"><select className="input" value={l.graceType ?? "interest_only"} onChange={(e) => upd(i, { graceType: e.target.value as "interest_only" | "capitalized" })}>
              <option value="interest_only">Solo intereses</option><option value="capitalized">Intereses capitalizados</option></select></Field>}
            <Field label="Comisión cancelación en venta"><PctInput label="Comisión de cancelación" value={l.earlyRepaymentFeeRate} onChange={(v) => upd(i, { earlyRepaymentFeeRate: v ?? undefined })} /></Field>
          </div>
          {l.rate.type === "schedule" && (
            <div className="space-y-1">
              <p className="meta">Escenario explícito de tipos (no es una previsión): tipo anual a partir del mes indicado del préstamo.</p>
              {(l.rate.schedule ?? []).map((sc, k) => (
                <div key={k} className="flex gap-1">
                  <NumInput label="Desde el mes" decimals={0} className="w-28" value={sc.fromMonth} onChange={(v) => upd(i, { rate: { ...l.rate, schedule: l.rate.schedule!.map((x, j) => j === k ? { ...x, fromMonth: Math.max(1, v ?? 1) } : x) } })} />
                  <PctInput label="Tipo anual" className="w-28" value={sc.annualRate} onChange={(v) => upd(i, { rate: { ...l.rate, schedule: l.rate.schedule!.map((x, j) => j === k ? { ...x, annualRate: v ?? 0 } : x) } })} />
                  <button className="btn-ghost" aria-label="Quitar tramo" onClick={() => upd(i, { rate: { ...l.rate, schedule: l.rate.schedule!.filter((_, j) => j !== k) } })}>✕</button>
                </div>
              ))}
              <button className="btn" onClick={() => upd(i, { rate: { ...l.rate, schedule: [...(l.rate.schedule ?? []), { fromMonth: 13, annualRate: 0.04 }] } })}>+ Tramo de tipo</button>
            </div>
          )}
          <details><summary className="meta cursor-pointer">Comisiones y gastos del préstamo ({l.fees?.length ?? 0})</summary>
            <ItemsEditor items={l.fees ?? []} onChange={(x) => upd(i, { fees: x })} allowKinds={["fixed", "percent_of_principal"]} addLabel="Añadir comisión" /></details>
          <details><summary className="meta cursor-pointer">Amortizaciones anticipadas ({l.prepayments?.length ?? 0})</summary>
            <div className="space-y-1 pt-1">
              {(l.prepayments ?? []).map((p, k) => (
                <div key={k} className="flex flex-wrap gap-1">
                  <input aria-label="Fecha" type="date" className="input w-40" value={p.date} onChange={(e) => upd(i, { prepayments: l.prepayments!.map((x, j) => j === k ? { ...x, date: e.target.value } : x) })} />
                  <NumInput label="Importe" suffix="€" className="w-36" value={p.amount} onChange={(v) => upd(i, { prepayments: l.prepayments!.map((x, j) => j === k ? { ...x, amount: v ?? 0 } : x) })} />
                  <select aria-label="Efecto" className="input w-44" value={p.mode} onChange={(e) => upd(i, { prepayments: l.prepayments!.map((x, j) => j === k ? { ...x, mode: e.target.value as "reduce_term" | "reduce_payment" } : x) })}>
                    <option value="reduce_term">Reducir plazo</option><option value="reduce_payment">Reducir cuota</option></select>
                  <button className="btn-ghost" aria-label="Quitar amortización" onClick={() => upd(i, { prepayments: l.prepayments!.filter((_, j) => j !== k) })}>✕</button>
                </div>
              ))}
              <button className="btn" onClick={() => upd(i, { prepayments: [...(l.prepayments ?? []), { date: new Date().toISOString().slice(0, 10), amount: 0, mode: "reduce_term" }] })}>+ Amortización anticipada</button>
            </div>
          </details>
          <button className="btn-ghost text-neg" onClick={() => onChange(loans.filter((_, j) => j !== i))}>Eliminar préstamo</button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...loans, { id: newId("loan"), label: `Préstamo ${loans.length + 1}`, ltv: { ratio: 0.7, base: "price" }, status: "user_input",
                                                               rate: { type: "fixed", annualRate: null as unknown as number }, termMonths: 360, paymentFrequency: "monthly", fees: [] }])}>+ Añadir préstamo</button>
      <p className="meta">Un préstamo nuevo empieza sin tipo de interés: indíquelo (no se supone ninguno).</p>
    </div>
  );
}
