import "server-only";
import postgres from "postgres";

/**
 * Acceso a Postgres SOLO desde el servidor. Cada consulta de usuario corre en una transacción con
 * `SET LOCAL ROLE authenticated` y los claims del usuario verificado → RLS se aplica igual que en PostgREST.
 * La credencial (rol inmo_web) no tiene privilegios propios: sin SET ROLE no puede leer nada.
 */
const g = globalThis as unknown as { __inmoSql?: postgres.Sql };

export function sql(): postgres.Sql {
  if (!g.__inmoSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL (servidor)");
    g.__inmoSql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 5),
      prepare: false,            // compatible con el pooler de Supabase en modo transacción
      idle_timeout: 20,
      connect_timeout: 15,
      types: { bigint: postgres.BigInt },
      transform: { undefined: null },
    });
  }
  return g.__inmoSql;
}

export type Tx = postgres.TransactionSql;

export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return (await sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`set local role authenticated`;
    await tx`set local statement_timeout = '25s'`;
    return fn(tx);
  })) as T;
}

/** Convierte bigint/numeric de Postgres a number para la interfaz (los importes no superan 2^53). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}
