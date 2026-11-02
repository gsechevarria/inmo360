import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ago, dateEs, n } from "@/lib/format";
import { listProperties, parseListingQuery } from "@/lib/queries/listings";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { DeleteSearchButton, DeleteSelectionButton } from "./SearchControls";

const PARAM_LABEL: Record<string, string> = { muni: "Municipios", prov: "Provincias", ccaa: "CCAA", op: "Operación", types: "Tipos", pmin: "Precio mín.", pmax: "Precio máx.",
  amin: "m² mín.", amax: "m² máx.", rooms: "Hab. mín.", baths: "Baños mín.", cond: "Estado", elev: "Ascensor", terr: "Terraza", src: "Fuente", fresh: "Comprobado (días)",
  chg: "Cambios", complete: "Datos completos", synth: "Sintéticos", sort: "Orden", ymin: "Rent. bruta mín.", emax: "Capital propio máx.", bbox: "Área del mapa" };
const describe = (p: Record<string, string>) => Object.entries(p).filter(([k, v]) => v && k !== "page" && k !== "sel").map(([k, v]) =>
  `${PARAM_LABEL[k] ?? k}: ${k === "op" ? (v === "rent" ? "alquiler" : "venta") : k === "bbox" ? "sí" : v}`).join(" · ") || "Sin filtros";

/** Abre una búsqueda guardada: marca la visita (para contar novedades) y redirige al explorador. */
async function openSearch(formData: FormData) {
  "use server";
  const u = await requireUser();
  const id = z.string().uuid().parse(formData.get("id"));
  const row = await withUser(u.id, (tx) => tx`update app.saved_searches set last_viewed_at = now() where id = ${id} returning kind, params`);
  if (!row[0]) redirect("/busquedas");
  const params = new URLSearchParams(row[0].params as Record<string, string>);
  if (formData.get("onlyNew") && formData.get("since")) params.set("since", String(formData.get("since")));
  revalidatePath("/busquedas");
  redirect(`${row[0].kind === "zones" ? "/zonas" : "/viviendas"}?${params.toString()}`);
}

export default async function SavedSearchesPage() {
  const user = await requireUser();
  const { searches, selections } = await withUser(user.id, async (tx) => {
    const ss = await tx`select id, kind, name, params, last_viewed_at, created_at from app.saved_searches order by created_at desc`;
    const searches: { id: string; kind: string; name: string; params: Record<string, string>; last_viewed_at: Date | null; created_at: Date; total: number | null; fresh: number | null }[] = [];
    for (const row of ss) {
      const s = { id: row.id as string, kind: row.kind as string, name: row.name as string, last_viewed_at: row.last_viewed_at as Date | null, created_at: row.created_at as Date };
      const params = row.params as Record<string, string>;
      if (s.kind === "listings") {
        const q = parseListingQuery(params);
        const [all, fresh] = await Promise.all([listProperties(tx, { ...q, page: 1 }), listProperties(tx, { ...q, page: 1, since: s.last_viewed_at ? new Date(s.last_viewed_at).toISOString() : null })]);
        searches.push({ ...s, params, total: all.total, fresh: s.last_viewed_at ? fresh.total : null });
      } else searches.push({ ...s, params, total: null, fresh: null });
    }
    const selections = await tx`
      select z.id, z.name, z.filters, z.created_at, array_length(z.geography_ids, 1) as n,
             (select array_agg(g.code order by g.name) from geo.geographies g where g.id = any(z.geography_ids)) as codes,
             (select string_agg(g.name, ', ' order by g.name) from (select name from geo.geographies where id = any(z.geography_ids) order by name limit 6) g) as names
        from app.zone_selections z order by z.created_at desc`;
    return { searches, selections };
  });
  return (
    <div className="pb-8">
      <PageHeader title="Búsquedas guardadas" subtitle="Filtros de viviendas y selecciones de zonas. Las novedades son inmuebles observados por primera vez desde su última visita." />
      <div className="space-y-3 px-4 md:px-6">
        <Panel title={`Búsquedas de viviendas (${searches.length})`}>
          {searches.length === 0 ? <div className="p-3"><Empty title="Sin búsquedas guardadas">En el <Link className="underline" href="/viviendas">explorador de viviendas</Link>, aplique filtros y pulse «Guardar búsqueda».</Empty></div> : (
            <ul className="divide-y divide-line-2">
              {searches.map((s) => (
                <li key={s.id} id={`b-${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[240px] flex-1">
                    <div className="font-medium">{s.name}</div>
                    <div className="meta">{describe(s.params)}</div>
                    <div className="meta">Creada {dateEs(s.created_at)} · última visita {s.last_viewed_at ? ago(s.last_viewed_at) : "nunca"}</div>
                  </div>
                  <div className="text-right text-[13px]">
                    <div className="num">{s.total === null ? "—" : `${n(s.total)} inmuebles`}</div>
                    {s.fresh !== null && s.fresh > 0 ? <div className="chip bg-pos-50 text-pos">{n(s.fresh)} nuevos</div> : <div className="meta">{s.fresh === 0 ? "sin novedades" : ""}</div>}
                  </div>
                  <form action={openSearch} className="flex gap-1">
                    <input type="hidden" name="id" value={s.id} />
                    {s.fresh !== null && s.fresh > 0 && <><input type="hidden" name="since" value={new Date(s.last_viewed_at!).toISOString()} />
                      <button className="btn" name="onlyNew" value="1">Ver novedades</button></>}
                    <button className="btn-primary">Abrir</button>
                  </form>
                  <DeleteSearchButton id={s.id} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Selecciones de zonas (${selections.length})`}>
          {selections.length === 0 ? <div className="p-3"><Empty title="Sin selecciones">En el <Link className="underline" href="/zonas">explorador de zonas</Link>, marque municipios y pulse «Guardar selección».</Empty></div> : (
            <ul className="divide-y divide-line-2">
              {selections.map((z) => {
                const codes = (z.codes ?? []) as string[];
                return (
                  <li key={z.id} id={`sel-${z.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 target:bg-brand-50">
                    <div className="min-w-[240px] flex-1">
                      <div className="font-medium">{z.name}</div>
                      <div className="meta">{n(z.n)} municipio(s): {z.names}{Number(z.n) > 6 ? "…" : ""}</div>
                      <div className="meta">Guardada {dateEs(z.created_at)}</div>
                    </div>
                    <Link className="btn" href={`/comparar?modo=zonas&zonas=${codes.slice(0, 6).join(",")}`}>Comparar{codes.length > 6 ? " (6 primeros)" : ""}</Link>
                    <Link className="btn" href={`/viviendas?muni=${codes.join(",")}`}>Ver viviendas</Link>
                    <Link className="btn-primary" href={`/zonas?${new URLSearchParams(Object.entries((z.filters ?? {}) as Record<string, string>).filter(([k]) => k !== "sel")).toString()}`}
                      title="Abre el explorador con los filtros que tenía al guardar la selección">Abrir filtros en explorador</Link>
                    <DeleteSelectionButton id={z.id} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
