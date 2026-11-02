"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { JOB_TYPE_IDS } from "@/lib/jobs";

type R = { ok: true; id?: string; info?: string } | { ok: false; error: string };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof z.ZodError ? "Datos no válidos." : e instanceof SyntaxError ? "Los parámetros no son JSON válido." : e instanceof Error ? e.message : "Error" });

export async function enqueueJob(jobType: string, source: string, paramsJson: string, priority: number, idempotencyKey: string | null): Promise<R> {
  try {
    const u = await requireOwner();
    const t = z.enum(JOB_TYPE_IDS).parse(jobType);
    const s = z.string().regex(/^[a-z0-9_]{2,60}$/, "Código de fuente: minúsculas, números y guion bajo.").parse(source);
    if (paramsJson.length > 20_000) throw new Error("Parámetros demasiado grandes.");
    const params = z.record(z.string(), z.unknown()).parse(JSON.parse(paramsJson || "{}"));
    // Los secretos nunca viajan en los parámetros del trabajo: viven en el .env del PC.
    if (/(secret|password|token|api[_-]?key)/i.test(paramsJson)) throw new Error("No incluya credenciales en los parámetros: configúrelas en el .env del trabajador.");
    const p = z.number().int().min(0).max(1000).parse(priority);
    const key = idempotencyKey ? z.string().max(120).parse(idempotencyKey) : null;
    const r = await withUser(u.id, (tx) => tx`select ingest.enqueue_job(${t}, ${s}, '{}'::jsonb, ${tx.json(params as never)}, ${p}, ${key}) as id`);
    revalidatePath("/importaciones");
    return { ok: true, id: r[0]!.id as string };
  } catch (e) { return fail(e); }
}

export async function cancelJob(id: string): Promise<R> {
  try {
    const u = await requireOwner();
    const r = await withUser(u.id, (tx) => tx`select ingest.request_cancel(${z.string().uuid().parse(id)}) as s`);
    revalidatePath("/importaciones");
    const s = r[0]!.s as string;
    return { ok: true, info: s === "cancelled" ? "Cancelado." : s === "running" ? "Cancelación solicitada: el trabajador la aplicará en el siguiente punto seguro." : "No se puede cancelar en su estado actual." };
  } catch (e) { return fail(e); }
}

export async function reviewMatch(candidateId: number, action: "confirm" | "reject" | "undo", note: string | null): Promise<R> {
  try {
    const u = await requireOwner();
    const id = z.number().int().positive().parse(candidateId);
    const n = note ? z.string().max(500).parse(note) : null;
    await withUser(u.id, (tx) => action === "confirm" ? tx`select market.confirm_match(${id}, ${n})`
      : action === "reject" ? tx`select market.reject_match(${id}, ${n})` : tx`select market.undo_match(${id}, ${n})`);
    revalidatePath("/importaciones/duplicados");
    return { ok: true };
  } catch (e) { return fail(e); }
}
