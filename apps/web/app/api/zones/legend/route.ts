import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ZONE_COLUMNS } from "@/lib/domain";
import { legend } from "@/lib/queries/zones";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const code = req.nextUrl.searchParams.get("ind") ?? "";
  if (!ZONE_COLUMNS.some((c) => c.code === code)) return NextResponse.json({ error: "Indicador no válido" }, { status: 400 });
  const data = await withUser(user.id, (tx) => legend(tx, code));
  return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=120" } });
}
