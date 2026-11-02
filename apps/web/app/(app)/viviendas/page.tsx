import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { listProperties, LPAGE, parseListingQuery } from "@/lib/queries/listings";
import { PageHeader } from "@/components/ui";
import { ListingExplorer } from "./ListingExplorer";

export const metadata = { title: "Explorador de viviendas" };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = parseListingQuery(sp);
  const { data, strategy, sources, assumptions } = await withUser(user.id, async (tx) => {
    const aset = await tx`select values from invest.assumption_sets where is_default order by updated_at desc limit 1`;
    const av = (aset[0]?.values ?? {}) as Record<string, { value: number | null; status: string }>;
    const known = (k: string) => (av[k] && av[k]!.status !== "unknown" && av[k]!.value !== null ? Number(av[k]!.value) : null);
    const [data, pref, sources, assumptions] = await Promise.all([
      listProperties(tx, q, { acq: known("acquisition_cost_rate"), ltv: known("ltv") }),
      tx`select active_strategy from app.preferences where user_id = ${user.id}`,
      tx`select source_code, count(*) as n from market.listings where status = 'active' group by 1 order by 2 desc`,
      tx`select values from invest.assumption_sets where is_default order by updated_at desc limit 1`,
    ]);
    return { data, strategy: (pref[0]?.active_strategy as string) ?? "rent_long", sources: sources.map((s) => ({ code: s.source_code as string, n: Number(s.n) })),
             assumptions: (assumptions[0]?.values ?? null) as Record<string, { value: number | null; status: string }> | null };
  });
  const sel = typeof sp.sel === "string" && /^[0-9a-f-]{36}$/.test(sp.sel) ? sp.sel : null;
  return (
    <div>
      <PageHeader title="Explorador de viviendas"
        subtitle="Inmuebles únicos (las publicaciones de un mismo inmueble se agrupan). El mapa y la lista comparten filtros; las ubicaciones aproximadas se dibujan como tales." />
      <ListingExplorer q={q} rows={JSON.parse(JSON.stringify(data.rows))} total={data.total} pageSize={LPAGE} strategy={strategy} sources={sources}
        assumptions={assumptions} selected={sel} />
    </div>
  );
}
