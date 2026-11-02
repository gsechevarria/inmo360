"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateProfile, type ProfileConfig } from "@inmo360/scoring";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ASSUMPTION_KEYS } from "@/lib/assumptions";

type R = { ok: true; id?: string } | { ok: false; error: string };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof z.ZodError ? `Datos no válidos: ${e.issues[0]?.message ?? ""}` : e instanceof Error ? e.message : "Error" });
const STRAT = z.enum(["resale", "rent_long", "rooms", "temporary", "tourist", "any"]);
const VSTATUS = z.enum(["confirmed", "published_unconfirmed", "estimated", "user_input", "unknown", "not_applicable", "confirmed_zero"]);

export async function saveAssumptionSet(id: string | null, name: string, strategy: string, values: Record<string, { value: number | null; status: string }>, isDefault: boolean): Promise<R> {
  try {
    const u = await requireUser();
    const n = z.string().trim().min(1).max(80).parse(name);
    const s = STRAT.parse(strategy);
    const keys = new Set(ASSUMPTION_KEYS.map((k) => k.key as string));
    const v = z.record(z.string(), z.object({ value: z.number().finite().min(0).max(1_000_000).nullable(), status: VSTATUS })).parse(values);
    for (const k of Object.keys(v)) if (!keys.has(k)) throw new Error(`Supuesto desconocido: ${k}`);
    for (const [k, x] of Object.entries(v)) if (x.value === null && x.status !== "unknown" && x.status !== "not_applicable") throw new Error(`«${k}»: sin valor debe marcarse como desconocido.`);
    const rid = await withUser(u.id, async (tx) => {
      if (isDefault) await tx`update invest.assumption_sets set is_default = false where is_default and (strategy = ${s} or ${s} = 'any' or strategy = 'any')`;
      const r = id
        ? await tx`update invest.assumption_sets set name = ${n}, strategy = ${s}, values = ${tx.json(v)}, is_default = ${isDefault}, updated_at = now() where id = ${z.string().uuid().parse(id)} returning id`
        : await tx`insert into invest.assumption_sets(name, strategy, values, is_default) values (${n}, ${s}, ${tx.json(v)}, ${isDefault}) returning id`;
      if (!r[0]) throw new Error("Conjunto no encontrado.");
      return r[0].id as string;
    });
    revalidatePath("/configuracion"); revalidatePath("/viviendas");
    return { ok: true, id: rid };
  } catch (e) { return fail(e); }
}

export async function deleteAssumptionSet(id: string): Promise<R> {
  try {
    const u = await requireUser();
    await withUser(u.id, (tx) => tx`delete from invest.assumption_sets where id = ${z.string().uuid().parse(id)}`);
    revalidatePath("/configuracion");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Activa (o desactiva con null) un perfil para un bloque y estrategia del usuario. */
export async function activateProfile(block: string, strategy: string, versionId: string | null): Promise<R> {
  try {
    const u = await requireUser();
    const b = z.enum(["zone", "property", "operation"]).parse(block);
    const s = STRAT.parse(strategy);
    const key = `${b}:${s}`;
    await withUser(u.id, async (tx) => {
      if (versionId) {
        const ok = await tx`select v.config from scoring.profile_versions v join scoring.profiles p on p.id = v.profile_id where v.id = ${z.string().uuid().parse(versionId)} and p.block = ${b}`;
        if (!ok[0]) throw new Error("Perfil no válido para este bloque.");
      }
      await tx`insert into app.preferences(user_id) values (${u.id}) on conflict (user_id) do nothing`;
      await tx`update app.preferences set active_profile_versions = case when ${versionId}::uuid is null then active_profile_versions - ${key}
                                                                       else active_profile_versions || jsonb_build_object(${key}::text, ${versionId}::text) end,
                                       updated_at = now() where user_id = ${u.id}`;
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Crea una variante propia de un perfil (pesos, obligatoriedad, política de faltantes). No modifica la plantilla:
 * si el perfil base es del usuario, añade una versión nueva; si es del sistema, crea un perfil propio versión 1.
 */
export async function saveProfileVariant(baseVersionId: string, name: string, patch: { weights: Record<string, number>; required: Record<string, boolean>;
  missingPolicy: "block" | "partial_explicit"; minCoverage: number | null }, activate: boolean): Promise<R> {
  try {
    const u = await requireUser();
    const n = z.string().trim().min(3).max(80).parse(name);
    const w = z.record(z.string(), z.number().min(0).max(100)).parse(patch.weights);
    const req = z.record(z.string(), z.boolean()).parse(patch.required);
    const mp = z.enum(["block", "partial_explicit"]).parse(patch.missingPolicy);
    const mc = patch.minCoverage === null ? undefined : z.number().min(0).max(1).parse(patch.minCoverage);
    const vid = await withUser(u.id, async (tx) => {
      const base = await tx`select v.config, v.version, p.id as profile_id, p.owner_id, p.block, p.strategy, p.description from scoring.profile_versions v
                              join scoring.profiles p on p.id = v.profile_id where v.id = ${z.string().uuid().parse(baseVersionId)}`;
      if (!base[0]) throw new Error("Perfil base no encontrado.");
      const cfg = structuredClone(base[0].config) as ProfileConfig;
      cfg.factors = cfg.factors.map((f) => ({ ...f, weight: w[f.id] ?? f.weight, required: req[f.id] ?? f.required }));
      cfg.factors = cfg.factors.filter((f) => f.weight > 0);
      if (!cfg.factors.length) throw new Error("El perfil necesita al menos un factor con peso.");
      cfg.missingPolicy = mp;
      cfg.minCoverage = mp === "partial_explicit" ? mc ?? 0.6 : undefined;
      cfg.name = n;
      const errs = validateProfile(cfg);
      if (errs.length) throw new Error(errs.join(" "));
      let profileId = base[0].profile_id as string, version = 1;
      if (base[0].owner_id === u.id) {
        const mx = await tx`select max(version) as m from scoring.profile_versions where profile_id = ${profileId}`;
        version = Number(mx[0]!.m) + 1;
        await tx`update scoring.profiles set name = ${n} where id = ${profileId}`;
      } else {
        const p = await tx`insert into scoring.profiles(owner_id, name, strategy, block, description, is_experimental)
                           values (${u.id}, ${n}, ${base[0].strategy}, ${base[0].block}, ${`Variante del usuario basada en «${(base[0].config as ProfileConfig).name}». ${base[0].description ?? ""}`}, true) returning id`;
        profileId = p[0]!.id as string;
      }
      cfg.version = version;
      cfg.profileId = `user.${profileId.slice(0, 8)}`;
      const v = await tx`insert into scoring.profile_versions(profile_id, version, config, created_by, notes) values (${profileId}, ${version}, ${tx.json(cfg as never)}, ${u.id}, 'editado en Supuestos y scoring') returning id`;
      return v[0]!.id as string;
    });
    if (activate) {
      const cfg = await withUser(u.id, (tx) => tx`select p.block, p.strategy from scoring.profile_versions v join scoring.profiles p on p.id = v.profile_id where v.id = ${vid}`);
      await activateProfile(cfg[0]!.block, cfg[0]!.strategy, vid);
    }
    revalidatePath("/configuracion");
    return { ok: true, id: vid };
  } catch (e) { return fail(e); }
}

export async function saveGlobalCombination(weights: { zone: number; property: number; operation: number } | null): Promise<R> {
  try {
    const u = await requireUser();
    const w = weights ? z.object({ zone: z.number().min(0).max(100), property: z.number().min(0).max(100), operation: z.number().min(0).max(100) }).parse(weights) : null;
    if (w && w.zone + w.property + w.operation <= 0) throw new Error("Indique al menos un peso positivo o desactive la puntuación global.");
    await withUser(u.id, async (tx) => {
      await tx`insert into app.preferences(user_id) values (${u.id}) on conflict (user_id) do nothing`;
      await tx`update app.preferences set global_combination = ${w ? tx.json({ weights: w, label: "Combinación explícita del usuario" }) : null}, updated_at = now() where user_id = ${u.id}`;
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

const bracket = z.object({ from: z.number().min(0), to: z.number().positive().nullable(), rate: z.number().min(0).max(1) });
export async function saveTaxRule(id: string | null, raw: Record<string, unknown>): Promise<R> {
  try {
    const u = await requireUser();
    const r = z.object({
      territory_level: z.enum(["country", "ccaa", "province", "municipality"]), territory_code: z.string().regex(/^(ES|\d{2}|\d{5})$/, "Código INE de territorio (ES, 2 o 5 dígitos)"),
      tax_type: z.enum(["ITP", "AJD", "IVA", "IGIC", "IPSI", "IBI", "IIVTNU", "IRPF", "IS", "tasa", "otro"]), profile: z.string().trim().min(1).max(60),
      description: z.string().trim().min(3).max(200), base_description: z.string().trim().min(3).max(300),
      rate: z.number().min(0).max(1).nullable(), brackets: z.array(bracket).max(20).nullable(), fixed_amount: z.number().min(0).nullable(),
      valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      payment_moment: z.enum(["compra", "anual", "venta"]).nullable(), source_name: z.string().trim().max(200).nullable(), source_url: z.string().url().max(500).nullable(),
      verification_status: z.enum(["confirmed", "published_unconfirmed", "user_input"]), auto_apply: z.boolean(), notes: z.string().max(1000).nullable(),
    }).parse(raw);
    const nForms = [r.rate !== null, !!r.brackets?.length, r.fixed_amount !== null].filter(Boolean).length;
    if (nForms !== 1) throw new Error("Indique exactamente una forma: tipo único, tramos o importe fijo.");
    if (r.verification_status === "confirmed" && !r.source_url) throw new Error("Una regla «confirmada» necesita la URL de la fuente oficial.");
    if (r.valid_to && r.valid_to <= r.valid_from) throw new Error("La fecha de fin debe ser posterior al inicio.");
    const rid = await withUser(u.id, async (tx) => {
      const vals = { ...r, brackets: r.brackets ? tx.json(r.brackets) : null };
      const q = id
        ? await tx`update invest.tax_rules set ${tx(vals as never, Object.keys(vals) as never)} where id = ${z.string().uuid().parse(id)} returning id`
        : await tx`insert into invest.tax_rules ${tx(vals as never, Object.keys(vals) as never)} returning id`;
      if (!q[0]) throw new Error("Regla no encontrada o no editable (las reglas del sistema son de solo lectura).");
      return q[0].id as string;
    });
    revalidatePath("/configuracion"); revalidatePath("/calculadora");
    return { ok: true, id: rid };
  } catch (e) { return fail(e); }
}

export async function deleteTaxRule(id: string): Promise<R> {
  try {
    const u = await requireUser();
    await withUser(u.id, (tx) => tx`delete from invest.tax_rules where id = ${z.string().uuid().parse(id)}`);
    revalidatePath("/configuracion");
    return { ok: true };
  } catch (e) { return fail(e); }
}
