"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { STRATEGIES } from "@/lib/domain";

type R = { ok: true; id?: string } | { ok: false; error: string };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof z.ZodError ? "Datos no válidos." : e instanceof Error ? e.message : "Error" });

export async function setStrategy(strategy: string) {
  const u = await requireUser();
  if (!STRATEGIES.some((s) => s.id === strategy)) return;
  await withUser(u.id, (tx) => tx`insert into app.preferences(user_id, active_strategy) values (${u.id}, ${strategy})
                                 on conflict (user_id) do update set active_strategy = excluded.active_strategy, updated_at = now()`);
  revalidatePath("/", "layout");
}

export async function saveZoneSelection(name: string, codes: string[], filters: Record<string, string>): Promise<R> {
  try {
    const u = await requireUser();
    const n = z.string().trim().min(1).max(80).parse(name);
    const c = z.array(z.string().regex(/^\d{5}$/)).min(1).max(500).parse(codes);
    const rows = await withUser(u.id, async (tx) => {
      const ids = await tx`select id from geo.geographies where level = 'municipality' and code = any(${c}) and valid_to is null`;
      return tx`insert into app.zone_selections(name, geography_ids, filters) values (${n}, ${ids.map((r) => Number(r.id))}, ${tx.json(filters)}) returning id`;
    });
    revalidatePath("/busquedas");
    return { ok: true, id: rows[0]!.id as string };
  } catch (e) { return fail(e); }
}

export async function toggleFavorite(targetType: "property" | "listing" | "geography", targetId: string): Promise<R> {
  try {
    const u = await requireUser();
    z.enum(["property", "listing", "geography"]).parse(targetType);
    const id = z.string().min(1).max(64).parse(targetId);
    await withUser(u.id, async (tx) => {
      const del = await tx`delete from app.favorites where target_type = ${targetType} and target_id = ${id} returning 1`;
      if (!del.length) await tx`insert into app.favorites(target_type, target_id) values (${targetType}, ${id})`;
    });
    revalidatePath("/oportunidades");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function addNote(targetType: string, targetId: string, body: string, path: string): Promise<R> {
  try {
    const u = await requireUser();
    const t = z.enum(["property", "listing", "geography", "scenario"]).parse(targetType);
    const b = z.string().trim().min(1).max(5000).parse(body);
    await withUser(u.id, (tx) => tx`insert into app.notes(target_type, target_id, body) values (${t}, ${z.string().max(64).parse(targetId)}, ${b})`);
    revalidatePath(path);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteNote(id: string, path: string): Promise<R> {
  try {
    const u = await requireUser();
    await withUser(u.id, (tx) => tx`delete from app.notes where id = ${z.string().uuid().parse(id)}`);
    revalidatePath(path);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setOpportunity(propertyId: string, status: string, plannedOffer: number | null, note?: string): Promise<R> {
  try {
    const u = await requireUser();
    const pid = z.string().uuid().parse(propertyId);
    const st = z.enum(["saved", "to_analyze", "analyzed", "visit_pending", "offer_prepared", "negotiating", "discarded", "closed"]).parse(status);
    const offer = plannedOffer === null ? null : z.number().nonnegative().max(1e9).parse(plannedOffer);
    await withUser(u.id, async (tx) => {
      const prev = await tx`select id, status from app.opportunities where property_id = ${pid}`;
      const row = await tx`insert into app.opportunities(property_id, status, planned_offer) values (${pid}, ${st}, ${offer})
                           on conflict (owner_id, property_id) do update set status = excluded.status, planned_offer = excluded.planned_offer
                           returning id`;
      if (prev[0]?.status !== st) {
        await tx`insert into app.opportunity_events(opportunity_id, from_status, to_status, note) values (${row[0]!.id}, ${prev[0]?.status ?? null}, ${st}, ${note ?? null})`;
      }
    });
    revalidatePath("/oportunidades");
    revalidatePath(`/viviendas/${pid}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function addCorrection(targetType: "listing" | "property", targetId: string, field: string, value: string, reason: string, path: string): Promise<R> {
  try {
    const u = await requireUser();
    const f = z.enum(["built_area_m2", "useful_area_m2", "rooms", "bathrooms", "floor_text", "has_elevator", "has_terrace", "condition", "year_built", "energy_rating", "address_text"]).parse(field);
    const r = z.string().trim().min(3).max(500).parse(reason);
    const numeric = ["built_area_m2", "useful_area_m2", "rooms", "bathrooms", "year_built"].includes(f);
    const bool = ["has_elevator", "has_terrace"].includes(f);
    const v = numeric ? z.coerce.number().nonnegative().parse(value.replace(",", ".")) : bool ? value === "true" : z.string().trim().min(1).max(200).parse(value);
    await withUser(u.id, (tx) => tx`insert into market.attribute_corrections(target_type, target_id, field, value, author_id, reason)
                                     values (${targetType}, ${z.string().uuid().parse(targetId)}, ${f}, ${tx.json(v)}, ${u.id}, ${r})`);
    revalidatePath(path);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function saveSearch(kind: "listings" | "zones", name: string, params: Record<string, string>): Promise<R> {
  try {
    const u = await requireUser();
    const n = z.string().trim().min(1).max(80).parse(name);
    const rows = await withUser(u.id, (tx) => tx`insert into app.saved_searches(kind, name, params, last_viewed_at) values (${kind}, ${n}, ${tx.json(params)}, now()) returning id`);
    revalidatePath("/busquedas");
    return { ok: true, id: rows[0]!.id as string };
  } catch (e) { return fail(e); }
}

export async function deleteSavedSearch(id: string): Promise<R> {
  try {
    const u = await requireUser();
    await withUser(u.id, (tx) => tx`delete from app.saved_searches where id = ${z.string().uuid().parse(id)}`);
    revalidatePath("/busquedas");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function refreshAggregates(): Promise<R> {
  try {
    const u = await requireOwner();
    await withUser(u.id, (tx) => tx`select stats.owner_refresh_latest()`);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}
