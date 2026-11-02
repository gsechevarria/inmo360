import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { DEFAULT_COLUMNS, ZONE_COLUMNS } from "@/lib/domain";
import { parseZoneQuery, regions, zoneTable, PAGE } from "@/lib/queries/zones";
import { PageHeader } from "@/components/ui";
import { ZoneExplorer } from "./ZoneExplorer";

export const metadata = { title: "Explorador de zonas" };

export default async function ZonesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = parseZoneQuery(sp, DEFAULT_COLUMNS);
  const layer = typeof sp.layer === "string" && ZONE_COLUMNS.some((c) => c.code === sp.layer) ? sp.layer : "demo.pop_cagr_5y";
  const [table, regs, saved] = await withUser(user.id, async (tx) => Promise.all([
    zoneTable(tx, q), regions(tx),
    tx`select id, name, array_length(geography_ids, 1) as n from app.zone_selections order by created_at desc limit 20`,
  ]));
  const sel = typeof sp.sel === "string" && /^\d{5}$/.test(sp.sel) ? sp.sel : null;
  return (
    <div>
      <PageHeader title="Explorador de zonas" subtitle="España → comunidad → provincia → municipio. Cada cifra con su periodo y su fuente; los datos que faltan se muestran como pendientes." />
      <ZoneExplorer query={q} layer={layer} rows={table.rows} counts={table.counts} pageSize={PAGE} regions={regs} selected={sel}
        savedSelections={saved.map((s) => ({ id: s.id as string, name: s.name as string, n: Number(s.n ?? 0) }))} />
    </div>
  );
}
