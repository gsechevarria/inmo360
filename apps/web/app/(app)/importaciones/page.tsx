import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { num, withUser } from "@/lib/db";
import { ago, dateEs, n } from "@/lib/format";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { CancelButton, EnqueueForm, RefreshButton } from "./ImportControls";

const JOB_ST: Record<string, { l: string; c: string }> = {
  pending: { l: "Pendiente", c: "bg-line-2 text-ink-2" }, running: { l: "En curso", c: "bg-info-50 text-info" }, completed: { l: "Completado", c: "bg-pos-50 text-pos" },
  partial: { l: "Parcial", c: "bg-warn-50 text-warn" }, failed: { l: "Fallido", c: "bg-neg-50 text-neg" }, cancelled: { l: "Cancelado", c: "bg-line-2 text-ink-3" },
  lease_lost: { l: "Concesión perdida", c: "bg-warn-50 text-warn" },
};
const Chip = ({ s }: { s: string }) => <span className={`chip ${JOB_ST[s]?.c ?? "bg-line-2"}`}>{JOB_ST[s]?.l ?? s}</span>;

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const user = await requireOwner();
  const sp = await searchParams;
  const d = await withUser(user.id, async (tx) => {
    const [workers, jobs, issues, sources, media, candidates, obs] = await Promise.all([
      tx`select * from ingest.worker_status order by last_heartbeat_at desc nulls last`,
      tx`select j.*, w.name as worker_name, (select count(*) from ingest.runs r where r.job_id = j.id) as n_runs,
                (select count(*) from ingest.issues i where i.job_id = j.id) as n_issues
           from ingest.jobs j left join ingest.workers w on w.id = j.worker_id order by j.created_at desc limit 40`,
      tx`select i.*, j.job_type, j.source_code from ingest.issues i left join ingest.jobs j on j.id = i.job_id order by i.created_at desc limit 25`,
      tx`select l.source_code, count(*) filter (where l.status = 'active') as active, count(*) filter (where l.status = 'not_observed') as not_observed,
                count(*) filter (where l.status = 'withdrawn_confirmed') as withdrawn, count(*) filter (where l.is_synthetic) as synthetic,
                count(distinct l.geography_id) as munis, max(l.last_seen_at) as last_seen, count(*) filter (where l.location_precision in ('exact','street')) as located
           from market.listings l group by 1 order by 2 desc`,
      tx`select status, storage_provider, count(*) as n, coalesce(sum(byte_size), 0) as bytes from market.media_assets group by 1, 2`,
      tx`select status, count(*) as n from market.match_candidates group by 1`,
      tx`select resource_code, capture_method, count(*) as n, count(distinct geography_id) as geos, max(period) as last_period, max(captured_at) as at
           from stats.observations where is_current group by 1, 2 order by 1`,
    ]);
    const runs = sp.job && /^[0-9a-f-]{36}$/.test(sp.job)
      ? await tx`select r.*, w.name as worker_name from ingest.runs r join ingest.workers w on w.id = r.worker_id where r.job_id = ${sp.job} order by r.started_at desc` : null;
    const jobIssues = runs ? await tx`select * from ingest.issues where job_id = ${sp.job!} order by created_at desc limit 100` : null;
    return { workers, jobs, issues, sources, media, candidates, obs, runs, jobIssues };
  });
  const online = d.workers.some((w) => w.connection === "online");
  const pendingJobs = d.jobs.filter((j) => j.status === "pending").length;
  const pendingCand = num(d.candidates.find((c) => c.status === "pending")?.n) ?? 0;
  return (
    <div className="pb-8">
      <PageHeader title="Importaciones" subtitle="Cola de trabajos del trabajador local (PC del propietario). La web funciona con el PC apagado; los trabajos quedan pendientes hasta que el trabajador se conecte."
        actions={<><Link className="btn" href="/importaciones/duplicados">Duplicados {pendingCand > 0 && <span className="chip bg-warn-50 text-warn">{pendingCand}</span>}</Link><RefreshButton /></>} />
      <div className="space-y-3 px-4 md:px-6">
        {!online && <Notice kind="warn">Ningún trabajador conectado ahora{d.workers[0]?.last_heartbeat_at ? ` (último latido ${ago(d.workers[0].last_heartbeat_at)})` : ""}. {pendingJobs > 0 ? `${pendingJobs} trabajo(s) esperan.` : ""} Para procesar la cola, arranque el trabajador en el PC: <code>python -m inmo_worker.cli run</code> (ver docs/GUIA_WINDOWS.md).</Notice>}
        <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="min-w-0 space-y-3">
            <Panel title="Trabajadores">
              <div className="overflow-x-auto p-2">
                <table className="tbl"><thead><tr><th>Nombre</th><th>Estado</th><th>Último latido</th><th>Versión</th><th>Capacidades</th><th className="text-right">Activos</th></tr></thead>
                  <tbody>{d.workers.length === 0 ? <tr><td colSpan={6} className="meta">Ningún trabajador registrado todavía.</td></tr> : d.workers.map((w) => (
                    <tr key={w.id}><td>{w.name}<div className="meta">{w.hostname}</div></td>
                      <td><span className={`chip ${w.connection === "online" ? "bg-pos-50 text-pos" : w.connection === "revoked" ? "bg-neg-50 text-neg" : "bg-line-2 text-ink-2"}`}>{w.connection === "online" ? "Conectado" : w.connection === "revoked" ? "Revocado" : "Desconectado"}</span></td>
                      <td className="meta">{w.last_heartbeat_at ? `${dateEs(w.last_heartbeat_at, true)} (${ago(w.last_heartbeat_at)})` : "nunca"}</td><td className="meta">{w.version}</td>
                      <td className="meta">{(w.capabilities as string[]).length} tipos</td><td className="text-right num">{n(num(w.active_jobs))}</td></tr>))}</tbody></table>
              </div>
            </Panel>
            <Panel title="Trabajos recientes">
              <div className="overflow-x-auto p-2">
                <table className="tbl"><thead><tr><th>Tipo · fuente</th><th>Estado</th><th>Intentos</th><th>Progreso / resultado</th><th>Creado</th><th>Fin</th><th></th></tr></thead>
                  <tbody>{d.jobs.map((j) => {
                    const prog = j.progress as Record<string, unknown>;
                    return (
                      <tr key={j.id} className={sp.job === j.id ? "bg-brand-50" : ""}>
                        <td><Link className="hover:underline" href={`/importaciones?job=${j.id}#ejecuciones`}><code>{j.job_type}</code></Link><div className="meta">{j.source_code}{j.worker_name ? ` · ${j.worker_name}` : ""}</div></td>
                        <td><Chip s={j.status} />{j.cancel_requested_at && j.status === "running" && <div className="meta">cancelación solicitada</div>}</td>
                        <td className="num">{j.attempts}/{j.max_attempts}{j.next_retry_at && j.status === "pending" && <div className="meta">reintento {ago(j.next_retry_at)}</div>}</td>
                        <td className="meta max-w-[340px]">{Object.keys(prog).length ? Object.entries(prog).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : v}`).join(" · ") : "—"}
                          {j.last_error && <div className="text-neg">{String(j.last_error).slice(0, 200)}</div>}{Number(j.n_issues) > 0 && <div>{n(num(j.n_issues))} incidencia(s)</div>}</td>
                        <td className="meta whitespace-nowrap">{dateEs(j.created_at, true)}</td><td className="meta whitespace-nowrap">{j.finished_at ? dateEs(j.finished_at, true) : "—"}</td>
                        <td>{["pending", "running"].includes(j.status) && <CancelButton id={j.id} />}</td>
                      </tr>
                    );
                  })}</tbody></table>
              </div>
            </Panel>
            {d.runs && (
              <Panel title="Ejecuciones del trabajo seleccionado" id="ejecuciones">
                <div className="overflow-x-auto p-2">
                  <table className="tbl"><thead><tr><th>Intento</th><th>Trabajador</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Cobertura</th><th>Estadísticas</th></tr></thead>
                    <tbody>{d.runs.map((r) => (
                      <tr key={r.id}><td className="num">{r.attempt}</td><td>{r.worker_name}</td><td><Chip s={r.status} />{r.error && <div className="meta text-neg">{String(r.error).slice(0, 160)}</div>}</td>
                        <td className="meta">{dateEs(r.started_at, true)}</td><td className="meta">{r.finished_at ? dateEs(r.finished_at, true) : "—"}</td>
                        <td className="meta">{r.coverage_complete ? "completa (permite marcar no observados)" : "parcial (no retira anuncios no visitados)"}</td>
                        <td className="meta code max-w-[320px] break-all">{JSON.stringify(r.stats).slice(0, 300)}</td></tr>))}</tbody></table>
                  {d.jobIssues && d.jobIssues.length > 0 && <ul className="mt-2 text-[13px]">{d.jobIssues.map((i) => <li key={i.id}><span className={i.severity === "error" ? "text-neg" : i.severity === "warning" ? "text-warn" : "meta"}>{i.severity}</span> · <code>{i.code}</code> · {i.message}</li>)}</ul>}
                </div>
              </Panel>
            )}
            <Panel title="Datos estadísticos importados (vigentes)">
              <div className="overflow-x-auto p-2">
                <table className="tbl"><thead><tr><th>Recurso</th><th>Método de captura</th><th className="text-right">Observaciones</th><th className="text-right">Territorios</th><th>Último periodo</th><th>Importado</th></tr></thead>
                  <tbody>{d.obs.map((o, i) => <tr key={i}><td><Link className="hover:underline" href={`/catalogo?recurso=${o.resource_code}`}><code>{o.resource_code}</code></Link></td><td className="meta">{o.capture_method}</td>
                    <td className="text-right num">{n(num(o.n))}</td><td className="text-right num">{n(num(o.geos))}</td><td className="meta">{o.last_period}</td><td className="meta">{dateEs(o.at)}</td></tr>)}</tbody></table>
              </div>
            </Panel>
            <Panel title="Anuncios por fuente">
              <div className="overflow-x-auto p-2">
                <table className="tbl"><thead><tr><th>Fuente</th><th className="text-right">Activos</th><th className="text-right">No observados</th><th className="text-right">Retirada confirmada</th><th className="text-right">Con ubicación precisa</th><th className="text-right">Municipios</th><th>Última observación</th></tr></thead>
                  <tbody>{d.sources.map((s) => <tr key={s.source_code}><td><code>{s.source_code}</code>{Number(s.synthetic) > 0 && <span className="chip ml-1 bg-warn-50 text-warn">sintética</span>}</td>
                    <td className="text-right num">{n(num(s.active))}</td><td className="text-right num">{n(num(s.not_observed))}</td><td className="text-right num">{n(num(s.withdrawn))}</td>
                    <td className="text-right num">{n(num(s.located))}</td><td className="text-right num">{n(num(s.munis))}</td><td className="meta">{dateEs(s.last_seen, true)}</td></tr>)}</tbody></table>
              </div>
            </Panel>
          </div>
          <aside className="min-w-0 space-y-3">
            <Panel title="Encolar trabajo"><div className="p-3"><EnqueueForm workerOnline={online} /></div></Panel>
            <Panel title="Fotos y capturas (inventario)">
              <div className="p-3 text-[13px]">
                {d.media.length === 0 ? <p className="meta">Sin medios registrados.</p> : d.media.map((m, i) => (
                  <div key={i} className="flex justify-between"><span>{m.status} · {m.storage_provider === "local" ? "disco local" : "Supabase Storage"}</span><span className="num">{n(num(m.n))} · {n((num(m.bytes) ?? 0) / 1e6, 1)} MB</span></div>))}
                <p className="meta mt-2">Los archivos viven en el disco del PC (almacén de contenido por hash). La web solo ve el inventario: no muestra fotos ni las solicita a los portales. Ver docs/MIGRACION_MEDIOS.md.</p>
              </div>
            </Panel>
            <Panel title="Incidencias recientes">
              <ul className="max-h-[420px] overflow-auto p-3 text-[13px] space-y-1">{d.issues.length === 0 ? <li className="meta">Sin incidencias.</li> : d.issues.map((i) => (
                <li key={i.id}><span className={i.severity === "error" ? "text-neg" : i.severity === "warning" ? "text-warn" : "meta"}>{i.severity}</span> · <code>{i.job_type}</code> · {i.message.slice(0, 160)} <span className="meta">{ago(i.created_at)}</span></li>))}</ul>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
