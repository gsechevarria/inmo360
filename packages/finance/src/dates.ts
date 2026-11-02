// Utilidades de fechas en formato ISO 'YYYY-MM-DD' (sin zona horaria: fechas civiles).

export type ISODate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parse(d: ISODate): { y: number; m: number; d: number } {
  const r = RE.exec(d);
  if (!r) throw new Error(`Fecha no válida: ${d}`);
  return { y: Number(r[1]), m: Number(r[2]), d: Number(r[3]) };
}

export function fmt(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Suma meses conservando el día cuando existe (31-ene + 1 mes = 28/29-feb). */
export function addMonths(date: ISODate, n: number): ISODate {
  const { y, m, d } = parse(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(date: ISODate, n: number): ISODate {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function toEpochDays(date: ISODate): number {
  const { y, m, d } = parse(date);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return toEpochDays(b) - toEpochDays(a);
}

/** Índice de mes relativo: 0 = mes de `origin`. */
export function monthIndex(origin: ISODate, date: ISODate): number {
  const o = parse(origin);
  const t = parse(date);
  return (t.y - o.y) * 12 + (t.m - o.m);
}

export function firstOfMonth(date: ISODate): ISODate {
  const { y, m } = parse(date);
  return fmt(y, m, 1);
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function compare(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Noches entre dos fechas (salida - entrada). */
export function nights(checkIn: ISODate, checkOut: ISODate): number {
  return daysBetween(checkIn, checkOut);
}

/** Días de un intervalo [start, end) que caen dentro del mes `monthStart`. */
export function overlapDaysInMonth(start: ISODate, end: ISODate, monthStart: ISODate): number {
  const ms = firstOfMonth(monthStart);
  const me = addMonths(ms, 1);
  const s = start > ms ? start : ms;
  const e = end < me ? end : me;
  return Math.max(0, daysBetween(s, e));
}
