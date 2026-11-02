import { templates, type ScenarioInput, type Strategy } from "@inmo360/finance";
import type { ProfileConfig } from "@inmo360/scoring";
import { requireUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { STRATEGIES } from "@/lib/domain";
import { activeProfile } from "@/lib/scoring";
import { PageHeader } from "@/components/ui";
import { Calculator, type CalcContext, type TaxRule } from "./Calculator";
import { applyAssumptions } from "@/lib/assumptions";

const isStrategy = (s: unknown): s is Strategy => typeof s === "string" && STRATEGIES.some((x) => x.id === s);
const today = () => new Date().toISOString().slice(0, 10);

export default async function CalculatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const ctx = await withUser(user.id, async (tx) => {
    let scenario: Record<string, unknown> | null = null;
    if (uuid(sp.scenario)) scenario = (await tx`select * from invest.scenarios where id = ${uuid(sp.scenario)!} and archived_at is null`)[0] ?? null;
    const propertyId = (scenario?.property_id as string | null) ?? uuid(sp.property);
    let property: CalcContext["property"] = null;
    let geo: { muni: string | null; prov: string | null; ccaa: string | null } = { muni: null, prov: null, ccaa: null };
    if (propertyId) {
      const r = await tx`
        select p.id, l.id as listing_id, l.title, l.price_amount::float8 as price, l.price_unit, l.built_area_m2::float8 as area, l.rooms, l.is_synthetic,
               m.code as muni, m.name as muni_name, pv.code as prov, ca.code as ccaa
          from market.properties p
          join market.property_listings pl on pl.property_id = p.id and pl.unlinked_at is null
          join market.listings l on l.id = pl.listing_id
          left join geo.geographies m on m.id = l.geography_id
          left join geo.geographies pv on pv.id = m.parent_id
          left join geo.geographies ca on ca.id = pv.parent_id
         where p.id = ${propertyId}
         order by (l.status = 'active' and l.operation = 'sale') desc, l.last_seen_at desc limit 1`;
      if (r[0]) {
        property = { id: r[0].id, listingId: r[0].listing_id, title: r[0].title ?? "Inmueble", price: r[0].price_unit === "sale_total" ? num(r[0].price) : null,
                     area: num(r[0].area), rooms: r[0].rooms ?? null, muniName: r[0].muni_name ?? null, synthetic: !!r[0].is_synthetic };
        geo = { muni: r[0].muni, prov: r[0].prov, ccaa: r[0].ccaa };
      }
    }
    const [rules, pref, sets, siblings] = await Promise.all([
      tx`select id, territory_level, territory_code, tax_type, profile, description, base_description, rate::float8 as rate, brackets, fixed_amount::float8 as fixed_amount,
                valid_from, valid_to, payment_moment, source_name, source_url, verification_status, auto_apply, owner_id is null as is_system
           from invest.tax_rules
          where valid_from <= current_date and (valid_to is null or valid_to > current_date)
            and ((territory_level = 'country' and territory_code = 'ES')
              or (territory_level = 'ccaa' and territory_code = ${geo.ccaa ?? "-"})
              or (territory_level = 'province' and territory_code = ${geo.prov ?? "-"})
              or (territory_level = 'municipality' and territory_code = ${geo.muni ?? "-"}))
          order by tax_type, territory_level`,
      tx`select active_strategy from app.preferences where user_id = ${user.id}`,
      tx`select id, name, strategy, values, is_default from invest.assumption_sets order by is_default desc, updated_at desc`,
      propertyId ? tx`select id, name, strategy, updated_at, parent_scenario_id from invest.scenarios where property_id = ${propertyId} and archived_at is null order by updated_at desc` : [],
    ]);
    const strategy: Strategy = (scenario?.strategy as Strategy) ?? (isStrategy(sp.strategy) ? sp.strategy : isStrategy(pref[0]?.active_strategy) ? pref[0]!.active_strategy : "rent_long");
    const opProfiles: Record<string, ProfileConfig | null> = {};
    for (const s of STRATEGIES) opProfiles[s.id] = ((await activeProfile(tx, user.id, "operation", s.id))?.config as ProfileConfig) ?? null;
    return { scenario, property, strategy, rules: rules as unknown as TaxRule[], sets: sets.map((s) => ({ id: s.id as string, name: s.name as string, strategy: s.strategy as string,
             values: s.values as Record<string, { value: number | null; status: string }>, isDefault: !!s.is_default })), siblings, opProfiles, geo };
  });

  let initial: ScenarioInput;
  let assumptionNote: string | null = null;
  if (ctx.scenario) initial = ctx.scenario.inputs as ScenarioInput;
  else {
    const priceParam = sp.price ? Number(sp.price) : null;
    const rent = sp.rent ? Number(sp.rent) : null;
    initial = templates(ctx.strategy, { price: ctx.property?.price ?? (priceParam && priceParam > 0 ? priceParam : null), date: today(), rent: rent && rent > 0 ? rent : null });
    const set = ctx.sets.find((s) => s.isDefault && (s.strategy === ctx.strategy || s.strategy === "any"));
    if (set) { initial = applyAssumptions(initial, set.values, set.name); assumptionNote = `Supuestos aplicados: «${set.name}».`; }
  }
  const context: CalcContext = {
    property: ctx.property,
    scenario: ctx.scenario ? { id: ctx.scenario.id as string, name: ctx.scenario.name as string, parentId: (ctx.scenario.parent_scenario_id as string | null) ?? null,
                               listingPriceAtSave: num(ctx.scenario.listing_price_at_save) } : null,
    rules: ctx.rules, sets: ctx.sets, opProfiles: ctx.opProfiles,
    siblings: ctx.siblings.map((s) => ({ id: s.id as string, name: s.name as string, strategy: s.strategy as string, parentId: (s.parent_scenario_id as string | null) ?? null })),
    territory: ctx.geo, assumptionNote,
  };
  return (
    <div className="pb-10">
      <PageHeader crumbs={ctx.property ? [{ href: "/viviendas", label: "Viviendas" }, { href: `/viviendas/${ctx.property.id}`, label: ctx.property.title }] : undefined}
        title={ctx.scenario ? `Escenario: ${ctx.scenario.name as string}` : "Calculadora de inversión"}
        subtitle="Cálculo determinista por calendario mensual. Un dato desconocido nunca cuenta como cero: las métricas que dependen de él se marcan como no calculables." />
      <Calculator key={(ctx.scenario?.id as string) ?? `${ctx.property?.id ?? "libre"}-${ctx.strategy}`} initial={initial} ctx={context} />
    </div>
  );
}
