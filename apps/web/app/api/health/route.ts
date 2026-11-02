import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Comprobación de salud sin sesión (para Nagios u otro monitor): solo dice si el servidor llega a la base con su
 * credencial. No toca tablas (el rol inmo_web no tiene acceso sin SET ROLE) ni devuelve detalles del error.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  let db: "ok" | "error" = "ok";
  try {
    await sql()`select 1`;
  } catch {
    db = "error";
  }
  return NextResponse.json(
    { ok: db === "ok", db, ms: Date.now() - t0, region: process.env.VERCEL_REGION ?? null },
    { status: db === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
