"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ENGINE_VERSION, hashInputs, maxPurchasePrice, simulate, validate, type Objectives, type ScenarioInput } from "@inmo360/finance";
import { requireUser } from "@/lib/auth";
import { num, withUser, type Tx } from "@/lib/db";

type R = { ok: true; id: string } | { ok: false; error: string };
const STRATEGY = z.enum(["resale", "rent_long", "rooms", "temporary", "tourist"]);
const uuid = z.string().uuid();

/** Validación estructural mínima (el motor valida el contenido). Limita tamaño para no aceptar cargas arbitrarias. */
function parseInput(raw: unknown): ScenarioInput {
  const s = z.object({ strategy: STRATEGY, purchase: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).passthrough(), horizonMonths: z.number().int().min(1).max(600),
                       operation: z.object({ kind: STRATEGY }).passthrough() }).passthrough().parse(raw);
  if (JSON.stringify(s).length > 400_000) throw new Error("Escenario demasiado grande.");
  return s as unknown as ScenarioInput;
}

/** Recalcula en servidor (no se confía en el resultado del navegador) y guarda resultado + movimientos. */
async function storeResult(tx: Tx, scenarioId: string, input: ScenarioInput) {
  const r = simulate(input);
  const res = await tx`
    insert into invest.calculation_results(scenario_id, kind, engine_version, inputs_hash, status, metrics, missing)
    values (${scenarioId}, 'scenario', ${r.engineVersion}, ${r.inputsHash}, ${r.status}, ${tx.json(r.metrics as never)}, ${tx.json(r.missing as never)})
    on conflict (scenario_id, kind, inputs_hash, engine_version) do update set computed_at = now(), metrics = excluded.metrics, missing = excluded.missing, status = excluded.status
    returning id`;
  const resultId = res[0]!.id as string;
  await tx`delete from invest.cashflow_entries where result_id = ${resultId}`;
  const rows = r.ledger.filter((e) => !e.unknown).map((e) => ({ result_id: resultId, period_date: e.date, layer: e.layer, category: e.category, concept: e.concept.slice(0, 200),
                                                               amount: Math.round(e.amount * 100) / 100, item_ref: e.itemId ?? null }));
  for (let i = 0; i < rows.length; i += 2000) await tx`insert into invest.cashflow_entries ${tx(rows.slice(i, i + 2000))}`;
  return r;
}

export async function saveScenario(raw: unknown, meta: { id?: string | null; asAlternativeOf?: string | null; name: string; propertyId?: string | null; listingId?: string | null }): Promise<R> {
  try {
    const u = await requireUser();
    const input = parseInput(raw);
    const errors = validate(input);
    if (errors.length) return { ok: false, error: `El escenario tiene errores: ${errors.join(" ")}` };
    const name = z.string().trim().min(1).max(120).parse(meta.name);
    const propertyId = meta.propertyId ? uuid.parse(meta.propertyId) : null;
    const listingId = meta.listingId ? uuid.parse(meta.listingId) : null;
    const id = await withUser(u.id, async (tx) => {
      const lp = listingId ? await tx`select price_amount from market.listings where id = ${listingId}` : [];
      const listingPrice = lp[0] ? num(lp[0].price_amount) : null;
      const hash = hashInputs(input);
      let sid: string;
      if (meta.id && !meta.asAlternativeOf) {
        const r = await tx`update invest.scenarios set name = ${name}, strategy = ${input.strategy}, inputs = ${tx.json(input as never)}, inputs_hash = ${hash},
                             engine_version = ${ENGINE_VERSION}, listing_price_at_save = ${listingPrice}, updated_at = now()
                            where id = ${uuid.parse(meta.id)} and archived_at is null returning id`;
        if (!r[0]) throw new Error("Escenario no encontrado.");
        sid = r[0].id as string;
      } else {
        const parent = meta.asAlternativeOf ? uuid.parse(meta.asAlternativeOf) : null;
        const r = await tx`insert into invest.scenarios(property_id, listing_id, parent_scenario_id, name, strategy, inputs, inputs_hash, engine_version, listing_price_at_save)
                           values (${propertyId}, ${listingId}, ${parent}, ${name}, ${input.strategy}, ${tx.json(input as never)}, ${hash}, ${ENGINE_VERSION}, ${listingPrice}) returning id`;
        sid = r[0]!.id as string;
      }
      await storeResult(tx, sid, input);
      return sid;
    });
    if (propertyId) revalidatePath(`/viviendas/${propertyId}`);
    revalidatePath("/oportunidades");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? "Datos no válidos." : e instanceof Error ? e.message : "Error" }; }
}

export async function archiveScenario(id: string): Promise<R> {
  try {
    const u = await requireUser();
    const sid = uuid.parse(id);
    await withUser(u.id, (tx) => tx`update invest.scenarios set archived_at = now() where id = ${sid}`);
    revalidatePath("/oportunidades");
    return { ok: true, id: sid };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Error" }; }
}

/** El precio máximo se RECALCULA en servidor con los mismos objetivos y rango; no se guarda lo que envía el navegador. */
export async function saveMaxPrice(scenarioId: string, raw: unknown, objectives: Objectives, opts: { min?: number; max?: number; tolerance?: number }): Promise<R & { price?: number | null }> {
  try {
    const u = await requireUser();
    const sid = uuid.parse(scenarioId);
    const input = parseInput(raw);
    const obj = z.record(z.string(), z.number().nullable()).parse(objectives) as Objectives;
    const o = z.object({ min: z.number().positive().optional(), max: z.number().positive().optional(), tolerance: z.number().min(1).max(100_000).optional() }).parse(opts);
    const result = maxPurchasePrice(input, obj, o);
    const hash = hashInputs({ input, obj, o });
    const id = await withUser(u.id, async (tx) => {
      const r = await tx`insert into invest.calculation_results(scenario_id, kind, engine_version, inputs_hash, status, metrics, missing)
                         values (${sid}, 'max_price', ${ENGINE_VERSION}, ${hash}, ${result.status},
                                 ${tx.json({ objectives: obj, price: result.price, binding: result.binding, checks: result.checks, intervals: result.feasibleIntervals,
                                             tolerance: result.tolerance, searchRange: result.searchRange, notes: result.notes } as never)}, '[]'::jsonb)
                         on conflict (scenario_id, kind, inputs_hash, engine_version) do update set computed_at = now(), metrics = excluded.metrics, status = excluded.status
                         returning id`;
      return r[0]!.id as string;
    });
    return { ok: true, id, price: result.price };
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? "Datos no válidos." : e instanceof Error ? e.message : "Error" }; }
}
