import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { bbox } from "@/lib/queries/zones";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const level = req.nextUrl.searchParams.get("level") ?? "province";
  const codes = (req.nextUrl.searchParams.get("codes") ?? "").split(",").filter((c) => /^\d{2,5}$/.test(c)).slice(0, 200);
  if (!["province", "ccaa", "municipality"].includes(level) || !codes.length) return NextResponse.json({ bbox: null });
  return NextResponse.json({ bbox: await withUser(user.id, (tx) => bbox(tx, level, codes)) });
}
