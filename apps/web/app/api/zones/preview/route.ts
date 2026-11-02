import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";

const KEYS = ["pop.padron", "demo.pop_cagr_5y", "demo.pop_growth_1y", "inc.net_mean_household", "tour.dwellings", "mkt.offer_price_sale_m2", "mkt.offer_rent_m2"];

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!/^\d{5}$/.test(code)) return NextResponse.json({ error: "Código no válido" }, { status: 400 });
  const data = await withUser(user.id, async (tx) => {
    const g = await tx`select g.id, g.code, g.name, p.name as prov, g.has_geometry from geo.geographies g left join geo.geographies p on p.id = g.parent_id
                        where g.level = 'municipality' and g.code = ${code} and g.valid_to is null`;
    if (!g[0]) return null;
    const vals = await tx`select indicator_code, value_num, period, value_status, resource_code from stats.latest_values
                           where geography_id = ${g[0].id} and dims_key = '' and indicator_code = any(${KEYS})`;
    const mk = await tx`select count(distinct pl.property_id) as props, count(*) as listings, bool_or(l.is_synthetic) as synth
                          from market.listings l join market.property_listings pl on pl.listing_id = l.id and pl.unlinked_at is null
                         where l.geography_id = ${g[0].id} and l.status = 'active'`;
    return { code: g[0].code, name: g[0].name, prov: g[0].prov, hasGeometry: g[0].has_geometry,
             values: Object.fromEntries(vals.map((v) => [v.indicator_code, { v: num(v.value_num), p: v.period, s: v.value_status, r: v.resource_code }])),
             market: { properties: num(mk[0]?.props) ?? 0, listings: num(mk[0]?.listings) ?? 0, synthetic: !!mk[0]?.synth } };
  });
  return data ? NextResponse.json(data) : NextResponse.json({ error: "No encontrado" }, { status: 404 });
}
