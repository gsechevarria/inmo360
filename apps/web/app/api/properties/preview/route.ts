import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { num, withUser } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });
  const d = await withUser(user.id, async (tx) => {
    const ls = await tx`
      select l.id, l.source_code, l.external_id, l.url, l.operation, l.price_amount::float8 as price, l.price_unit, l.property_type, l.title,
             l.built_area_m2::float8 as area, l.rooms, l.bathrooms, l.floor_text, l.has_elevator, l.has_terrace, l.condition, l.energy_rating,
             l.location_precision, l.last_checked_at, l.first_seen_at, l.published_at_declared, l.is_synthetic, g.code as muni, g.name as muni_name
        from market.property_listings pl join market.listings l on l.id = pl.listing_id left join geo.geographies g on g.id = l.geography_id
       where pl.property_id = ${id} and pl.unlinked_at is null order by l.last_seen_at desc`;
    if (!ls.length) return null;
    const main = ls[0]!;
    const zone = await tx`select indicator_code, value_num::float8 as v, period from stats.latest_values lv join geo.geographies g on g.id = lv.geography_id
                          where g.code = ${main.muni} and g.level = 'municipality' and lv.dims_key = ''
                            and indicator_code in ('mkt.offer_price_sale_m2','mkt.offer_rent_m2','inc.net_mean_household','pop.padron')`;
    const opp = await tx`select status from app.opportunities where property_id = ${id}`;
    const missing = [!main.area && "superficie", main.rooms === null && "habitaciones", main.bathrooms === null && "baños",
                     main.condition === "unknown" && "estado", main.location_precision !== "exact" && "ubicación exacta", main.has_elevator === null && "ascensor"].filter(Boolean);
    return { id, listings: ls, zone: Object.fromEntries(zone.map((z) => [z.indicator_code, { v: num(z.v), p: z.period }])), opportunity: opp[0]?.status ?? null, missing };
  });
  return d ? NextResponse.json(d) : NextResponse.json({ error: "No encontrado" }, { status: 404 });
}
