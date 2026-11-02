import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { withUser } from "@/lib/db";

const LEVEL = { municipality: "Municipio", province: "Provincia", ccaa: "Comunidad" } as Record<string, string>;

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ hits: [] }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const rows = await withUser(user.id, (tx) => tx`
    select g.level, g.code, g.name, p.name as parent
      from geo.geographies g left join geo.geographies p on p.id = g.parent_id
     where g.valid_to is null and g.level in ('municipality','province','ccaa')
       and (g.code = ${q} or g.name_search like ${"%" + q.toLowerCase() + "%"})
     order by (g.code = ${q}) desc, (g.name_search like ${q.toLowerCase() + "%"}) desc,
              case g.level when 'ccaa' then 0 when 'province' then 1 else 2 end, length(g.name)
     limit 12`);
  return NextResponse.json({ hits: rows.map((r) => ({
    kind: "geo", id: `${r.level}:${r.code}`, label: r.name, sub: `${LEVEL[r.level]} · ${r.code}${r.parent ? ` · ${r.parent}` : ""}`,
    href: `/zonas/${r.level}/${r.code}` })) });
}
