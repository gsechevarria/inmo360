import type { ProfileConfig } from "@inmo360/scoring";
import { requireUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { STRATEGIES, strategyLabel } from "@/lib/domain";
import { dateEs, n } from "@/lib/format";
import { Notice, PageHeader, Panel } from "@/components/ui";
import type { AssumptionValues } from "@/lib/assumptions";
import { AssumptionSetForm, GlobalCombinationForm, ProfileSlot, TaxRuleForm, TaxRuleRowActions, type ProfileOpt, type TaxRuleRow } from "./ConfigControls";

export const metadata = { title: "Supuestos y scoring" };

export default async function ConfigPage() {
  const user = await requireUser();
  const d = await withUser(user.id, async (tx) => {
    const [sets, profiles, pref, rules] = await Promise.all([
      tx`select id, name, strategy, values, is_default, updated_at from invest.assumption_sets order by is_default desc, updated_at desc`,
      tx`select v.id as version_id, v.version, v.config, p.name, p.block, p.strategy, p.owner_id, p.is_experimental from scoring.profile_versions v
           join scoring.profiles p on p.id = v.profile_id where p.archived_at is null order by p.owner_id nulls first, p.name, v.version desc`,
      tx`select active_profile_versions, global_combination from app.preferences where user_id = ${user.id}`,
      tx`select *, rate::float8 as rate_f, fixed_amount::float8 as fixed_f, owner_id is null as is_system from invest.tax_rules order by territory_level, territory_code, tax_type, valid_from desc`,
    ]);
    return { sets, profiles, pref: pref[0] ?? null, rules };
  });
  const active = (d.pref?.active_profile_versions ?? {}) as Record<string, string>;
  const gc = (d.pref?.global_combination as { weights: { zone: number; property: number; operation: number } } | null)?.weights ?? null;
  const opts = (block: string, strategy: string): ProfileOpt[] => d.profiles.filter((p) => p.block === block && (p.strategy === strategy || p.strategy === "any"))
    .map((p) => ({ versionId: p.version_id, name: p.name, version: p.version, own: p.owner_id === user.id, experimental: p.is_experimental, config: p.config as ProfileConfig }));
  const slots: { block: string; strategy: string; label: string }[] = [
    ...STRATEGIES.map((s) => ({ block: "zone", strategy: s.id, label: `Zona · ${s.label}` })),
    { block: "property", strategy: "any", label: "Vivienda (estado actual)" },
    ...STRATEGIES.map((s) => ({ block: "operation", strategy: s.id, label: `Operación · ${s.label}` })),
  ];
  return (
    <div className="pb-8">
      <PageHeader title="Supuestos y scoring" subtitle="Valores por defecto de la calculadora y del explorador, perfiles de puntuación y reglas fiscales con su fuente. Nada se aplica en silencio: cada uso indica su origen." />
      <div className="space-y-3 px-4 md:px-6">
        <nav className="flex flex-wrap gap-1 text-[13px]"><a className="btn" href="#supuestos">Supuestos</a><a className="btn" href="#scoring">Perfiles de puntuación</a><a className="btn" href="#global">Puntuación global</a><a className="btn" href="#fiscal">Reglas fiscales</a></nav>

        <Panel title="Supuestos por defecto" id="supuestos">
          <div className="space-y-4 p-3">
            <p className="meta">Se aplican al crear un escenario nuevo (el escenario guarda su copia: cambiar aquí no altera escenarios guardados) y al calcular el capital propio estimado del explorador. Un valor vacío es «desconocido», nunca cero.</p>
            {d.sets.map((s) => (
              <details key={s.id} className="rounded-md border border-line-2 p-2" open={d.sets.length === 1}>
                <summary className="cursor-pointer text-[13px] font-medium">{s.name} · {s.strategy === "any" ? "todas las modalidades" : strategyLabel(s.strategy)}{s.is_default ? " · por defecto" : ""} <span className="meta">· {dateEs(s.updated_at)}</span></summary>
                <div className="pt-2"><AssumptionSetForm set={{ id: s.id, name: s.name, strategy: s.strategy, values: s.values as AssumptionValues, isDefault: s.is_default }} /></div>
              </details>
            ))}
            <details className="rounded-md border border-dashed border-line p-2" open={d.sets.length === 0}>
              <summary className="cursor-pointer text-[13px] font-medium">+ Nuevo conjunto de supuestos</summary>
              <div className="pt-2"><AssumptionSetForm /></div>
            </details>
          </div>
        </Panel>

        <Panel title="Perfiles de puntuación" id="scoring">
          <div className="space-y-2 p-3">
            <Notice kind="warn">Los perfiles incluidos son <strong>experimentales</strong>: pesos y umbrales propuestos, no validados empíricamente. Actívelos de forma explícita y revise cada factor. La puntuación nunca usa atributos protegidos ni factores de riesgo, y separa zona, vivienda y operación.</Notice>
            {slots.map((s) => <ProfileSlot key={`${s.block}:${s.strategy}`} block={s.block} strategy={s.strategy} label={s.label} options={opts(s.block, s.strategy)}
              activeId={active[`${s.block}:${s.strategy}`] ?? null} />)}
          </div>
        </Panel>

        <Panel title="Puntuación global" id="global"><div className="p-3"><GlobalCombinationForm current={gc} /></div></Panel>

        <Panel title="Reglas fiscales" id="fiscal">
          <div className="space-y-3 p-3">
            <p className="meta">Reglas versionadas por territorio y fecha. La calculadora las ofrece para el territorio del inmueble y las aplica solo cuando usted lo indica, con su fuente y estado de verificación. Inmo360 no incluye tipos impositivos precargados: los tipos cambian por normativa y deben verificarse en la fuente oficial (BOE o boletín autonómico).</p>
            {d.rules.length === 0 ? <p className="meta">No hay reglas registradas.</p> : (
              <div className="overflow-x-auto">
                <table className="tbl"><thead><tr><th>Territorio</th><th>Impuesto</th><th>Descripción</th><th className="text-right">Tipo / importe</th><th>Vigencia</th><th>Fuente · verificación</th><th></th></tr></thead>
                  <tbody>{d.rules.map((r) => (
                    <tr key={r.id}><td className="meta">{r.territory_level} {r.territory_code}</td><td>{r.tax_type}<div className="meta">{r.profile}</div></td><td>{r.description}<div className="meta">Base: {r.base_description}</div></td>
                      <td className="text-right num">{r.rate_f !== null ? `${n(num(r.rate_f)! * 100, 2)} %` : r.brackets ? `${(r.brackets as unknown[]).length} tramos` : `${n(num(r.fixed_f))} €`}</td>
                      <td className="meta">{dateEs(r.valid_from)} → {r.valid_to ? dateEs(r.valid_to) : "vigente"}</td>
                      <td className="meta">{r.source_url ? <a className="underline" href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">{r.source_name ?? "fuente"}</a> : r.source_name ?? "sin fuente"} · {r.verification_status === "confirmed" ? "confirmada" : r.verification_status === "user_input" ? "introducida por usuario" : "publicada sin confirmar"}</td>
                      <td>{r.is_system ? <span className="meta">sistema (solo lectura)</span> : <TaxRuleRowActions rule={{ id: r.id, territory_level: r.territory_level, territory_code: r.territory_code, tax_type: r.tax_type, profile: r.profile,
                        description: r.description, base_description: r.base_description, rate: num(r.rate_f), brackets: r.brackets, fixed_amount: num(r.fixed_f), valid_from: String(r.valid_from instanceof Date ? r.valid_from.toISOString().slice(0, 10) : r.valid_from).slice(0, 10),
                        valid_to: r.valid_to ? String(r.valid_to instanceof Date ? r.valid_to.toISOString() : r.valid_to).slice(0, 10) : null, payment_moment: r.payment_moment ?? "compra", source_name: r.source_name ?? "", source_url: r.source_url ?? "",
                        verification_status: r.verification_status, auto_apply: r.auto_apply, notes: r.notes ?? "" } as TaxRuleRow & { id: string }} />}</td></tr>))}</tbody></table>
              </div>
            )}
            <details className="rounded-md border border-dashed border-line p-2"><summary className="cursor-pointer text-[13px] font-medium">+ Nueva regla fiscal</summary><div className="pt-2"><TaxRuleForm /></div></details>
          </div>
        </Panel>
      </div>
    </div>
  );
}
