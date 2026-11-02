import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ZONE_COLUMNS } from "@/lib/domain";

const LEVELS = new Set(["municipality", "province", "ccaa"]);
const IND = new Set<string>(ZONE_COLUMNS.map((c) => c.code));

// Teselas MVT generadas por PostGIS: límites + valor del indicador. Sin teselas de terceros.
export async function GET(req: NextRequest, ctx: { params: Promise<{ level: string; z: string; x: string; y: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse("No autorizado", { status: 401 });
  const { level, z, x, y } = await ctx.params;
  const zi = Number(z), xi = Number(x), yi = Number(y.replace(/\.pbf$|\.mvt$/, ""));
  const ind = req.nextUrl.searchParams.get("ind") ?? "";
  if (!LEVELS.has(level) || ![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 16 || (ind && !IND.has(ind)))
    return new NextResponse("Parámetros no válidos", { status: 400 });
  const tile = await withUser(user.id, (tx) => tx`select geo.zone_tile(${zi}, ${xi}, ${yi}, ${level}, ${ind}, '') as t`);
  const body = tile[0]?.t as Uint8Array | null;
  return new NextResponse(body && body.length ? Buffer.from(body) : null, {
    status: body && body.length ? 200 : 204,
    headers: { "Content-Type": "application/vnd.mapbox-vector-tile", "Cache-Control": "private, max-age=300" },
  });
}
