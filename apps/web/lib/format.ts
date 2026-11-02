// Formato español de cifras. La unidad siempre visible; null → "—" (nunca 0).

const nf = (d: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" as never });
const cache = new Map<number, Intl.NumberFormat>();
const f = (d: number) => cache.get(d) ?? (cache.set(d, nf(d)), cache.get(d)!);

export function n(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return f(decimals).format(v);
}
export const eur = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${n(v, d)} €`);
export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${n(v, d)} %`);
export const signed = (v: number | null | undefined, d = 1, unit = " %") =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${n(Math.abs(v), d)}${unit}`;

export function fmtUnit(v: number | null | undefined, unit: string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  switch (unit) {
    case "EUR": return eur(v);
    case "%": return pct(v, 2);
    case "personas": case "hogares": case "viviendas": case "plazas": return n(v);
    case "hab/km²": return `${n(v, 1)} hab/km²`;
    case "EUR/m2": return `${n(v)} €/m²`;
    case "EUR/m2/mes": return `${n(v, 1)} €/m²/mes`;
    case "‰": return `${n(v, 2)} ‰`;
    default: return `${n(v, Math.abs(v) < 100 ? 2 : 0)}${unit ? ` ${unit}` : ""}`;
  }
}

export function dateEs(iso: string | Date | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso) : iso;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Madrid",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(d);
}

export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return "nunca";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
}

export function periodLabel(p: string | null | undefined): string {
  if (!p) return "—";
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split("-");
    return `${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m) - 1]} ${y}`;
  }
  return p;
}

const DIM_VALUES: Record<string, string> = {
  male: "hombres", female: "mujeres", total: "total", foreign: "extranjera", spanish: "española", abroad: "extranjero",
  sale: "venta", rent: "alquiler", properties: "inmuebles únicos", listings: "anuncios",
};
const DIM_KEYS: Record<string, string> = { sex: "sexo", age_group: "edad", nationality: "nacionalidad", birthplace: "nacimiento",
  operation: "operación", count_unit: "unidad", tenure: "tenencia", dwelling_type: "tipo" };

/** "operation=sale|sex=male" → "operación: venta · sexo: hombres" */
export function dimsLabel(key: string): string {
  if (!key) return "";
  return key.split("|").map((kv) => { const [k, v] = kv.split("="); return `${DIM_KEYS[k!] ?? k}: ${DIM_VALUES[v!] ?? v}`; }).join(" · ");
}
