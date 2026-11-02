import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { IconBook, IconBookmark, IconCalc, IconCompare, IconImport, IconLogout, IconMap, IconHome, IconSliders, IconStar } from "./icons";
import { NavLink } from "./NavLink";
import { GlobalSearch } from "./GlobalSearch";
import { StrategySelect } from "./StrategySelect";

const NAV = [
  { href: "/zonas", label: "Zonas", Icon: IconMap },
  { href: "/viviendas", label: "Viviendas", Icon: IconHome },
  { href: "/comparar", label: "Comparar", Icon: IconCompare },
  { href: "/calculadora", label: "Calculadora", Icon: IconCalc },
  { href: "/oportunidades", label: "Mis oportunidades", Icon: IconStar },
  { href: "/busquedas", label: "Búsquedas guardadas", Icon: IconBookmark },
  { href: "/importaciones", label: "Importaciones", Icon: IconImport, owner: true },
  { href: "/catalogo", label: "Fuentes e indicadores", Icon: IconBook },
  { href: "/configuracion", label: "Supuestos y scoring", Icon: IconSliders },
];

export function Shell({ user, strategy, synthetic, children }: { user: SessionUser; strategy: string; synthetic: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[64px_1fr] lg:grid-cols-[208px_1fr]">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 btn">Saltar al contenido</a>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-brand md:sticky md:top-0 md:h-screen md:flex-col md:justify-start md:border-0 md:py-3">
        <Link href="/zonas" className="hidden md:flex items-center gap-2 px-4 pb-4 text-white">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/15 font-bold">i</span>
          <span className="hidden lg:inline text-[15px] font-semibold tracking-tight">Inmo360</span>
        </Link>
        {NAV.filter((n) => !n.owner || user.role === "owner").map(({ href, label, Icon }, i) => (
          <NavLink key={href} href={href} label={label} className={i > 4 ? "hidden md:flex" : ""}><Icon /></NavLink>
        ))}
        <form action={signOut} className="hidden md:block md:mt-auto px-2">
          <button className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-[13px] text-white/75 hover:bg-white/10 hover:text-white" title="Salir">
            <IconLogout /><span className="hidden lg:inline">Salir</span>
          </button>
        </form>
      </nav>
      <div className="flex min-h-screen min-w-0 flex-col pb-14 md:pb-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur md:px-4">
          <GlobalSearch />
          <StrategySelect value={strategy} />
          <span className="ml-auto hidden sm:inline meta" title={user.email ?? undefined}>{user.role === "owner" ? "Propietario" : "Miembro"}</span>
        </header>
        {synthetic && (
          <div role="note" className="border-b border-warn/30 bg-warn-50 px-4 py-1.5 text-[12.5px] text-warn">
            ≈ Esta base contiene <strong>anuncios sintéticos de prueba</strong> (marcados «SINTÉTICO»). No son anuncios reales.
          </div>
        )}
        <main id="contenido" className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
