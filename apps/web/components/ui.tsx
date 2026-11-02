import Link from "next/link";
import { TECH_STATUS, VALUE_STATUS } from "@/lib/domain";
import { dateEs, fmtUnit, n, periodLabel } from "@/lib/format";
import { IconInfo, IconWarn } from "./icons";

export function PageHeader({ title, subtitle, actions, crumbs }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-4 pb-3 pt-4 md:px-6">
      <div className="min-w-0 flex-1">
        {crumbs && (
          <nav aria-label="Ruta" className="meta mb-1 flex flex-wrap gap-1">
            {crumbs.map((c, i) => <span key={c.href}>{i > 0 && " › "}<Link className="hover:underline" href={c.href}>{c.label}</Link></span>)}
          </nav>
        )}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="meta mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className = "", id }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} aria-labelledby={id ? `${id}-t` : undefined} id={id}>
      {(title || actions) && <div className="panel-h"><h2 id={id ? `${id}-t` : undefined} className="panel-t">{title}</h2>{actions}</div>}
      <div>{children}</div>
    </section>
  );
}

export function StatusChip({ status, title }: { status: string; title?: string }) {
  const s = VALUE_STATUS[status] ?? { label: status, icon: "·", cls: "bg-line-2 text-ink-2" };
  return <span className={`chip ${s.cls}`} title={title ?? s.label}><span aria-hidden>{s.icon}</span>{s.label}</span>;
}

export function TechChip({ status }: { status: string }) {
  const s = TECH_STATUS[status] ?? { label: status, cls: "bg-line-2" };
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

export function SyntheticBadge() {
  return <span className="chip bg-warn-50 text-warn" title="Dato sintético de prueba: no es un anuncio real">≈ SINTÉTICO</span>;
}

/** Cifra con unidad, periodo, fuente y estado. Jerarquía: resultado › supuesto › fuente. */
export function Metric({ label, value, unit, period, source, status, hint, big = false, href }: {
  label: string; value: number | null; unit?: string | null; period?: string | null; source?: string | null; status?: string | null;
  hint?: string | null; big?: boolean; href?: string;
}) {
  const body = (
    <div className="min-w-0">
      <div className="meta">{label}</div>
      <div className={`${big ? "kpi" : "text-[16px] font-semibold"} num`}>{value === null ? <span className="text-ink-3" title="Sin dato">—</span> : fmtUnit(value, unit)}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 meta">
        {period && <span>{periodLabel(period)}</span>}
        {status && status !== "observed" && <StatusChip status={status} />}
        {source && <span className="truncate" title={source}>· {source}</span>}
      </div>
      {hint && <div className="meta mt-0.5">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-md p-1 -m-1 hover:bg-canvas">{body}</Link> : body;
}

export function CoverageBar({ n: have, of, label }: { n: number; of: number; label?: string }) {
  const pct = of ? (have / of) * 100 : 0;
  return (
    <div className="min-w-[120px]" title={`${n(have)} de ${n(of)}`}>
      <div className="flex justify-between meta"><span>{label ?? "Cobertura"}</span><span className="num">{n(have)} / {n(of)}</span></div>
      <div className="mt-0.5 h-1.5 w-full rounded bg-line-2" role="img" aria-label={`Cobertura ${n(pct, 0)} %`}>
        <div className="h-1.5 rounded bg-brand-2" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "neg" | "pos"; children: React.ReactNode }) {
  const cls = { info: "bg-info-50 text-info", warn: "bg-warn-50 text-warn", neg: "bg-neg-50 text-neg", pos: "bg-pos-50 text-pos" }[kind];
  return <div role={kind === "neg" ? "alert" : "note"} className={`flex gap-2 rounded-md px-3 py-2 text-[13px] ${cls}`}>{kind === "info" ? <IconInfo /> : <IconWarn />}<div>{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[15px] font-medium text-ink-2">{title}</div>
      {children && <div className="meta mx-auto mt-1 max-w-md">{children}</div>}
    </div>
  );
}

export function Tabs({ items, active }: { items: { id: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Secciones" className="flex gap-1 overflow-x-auto border-b border-line px-4 md:px-6">
      {items.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${t.id === active ? "border-brand font-semibold text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}>
          {t.label}{t.count !== undefined && <span className="ml-1 meta">{n(t.count)}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function SourceLine({ resource, asOf, method }: { resource?: string | null; asOf?: string | null; method?: string | null }) {
  return (
    <span className="meta">
      Fuente: <code>{resource ?? "—"}</code>{asOf && <> · captura {dateEs(asOf)}</>}{method && method !== "worker" && <> · {method === "browser_capture" ? "captura desde navegador" : method}</>}
    </span>
  );
}
