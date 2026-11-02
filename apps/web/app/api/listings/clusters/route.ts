import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clusters, parseListingQuery } from "@/lib/queries/listings";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const zoom = Math.max(0, Math.min(18, Number(sp.z ?? 6) || 6));
  const q = parseListingQuery(sp);
  const data = await withUser(user.id, (tx) => clusters(tx, q, zoom));
  return NextResponse.json({ clusters: data }, { headers: { "Cache-Control": "private, max-age=30" } });
}
