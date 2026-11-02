import { addMonths, compare, daysBetween, daysInMonth, firstOfMonth, monthIndex, monthKey, overlapDaysInMonth, parse,
  type ISODate } from "./dates";
import { xirr, npv, type Flow } from "./irr";
import { buildSchedule } from "./loan";
import { ENGINE_VERSION, type Bracket, type Component, type Item, type LedgerEntry, type Metric, type MetricStatus,
  type MissingItem, type MonthRow, type RoomResult, type ScenarioInput, type ScenarioResult } from "./types";

// ----------------------------------------------------------------------------- utilidades

export function bracketsAmount(base: number, brackets: Bracket[], mode: "marginal" | "whole_base" = "marginal"): number {
  const bs = [...brackets].sort((a, b) => a.from - b.from);
  if (mode === "whole_base") {
    const b = bs.filter((x) => base >= x.from && (x.to === null || base < x.to)).at(-1) ?? bs.at(-1)!;
    return base * b.rate;
  }
  let t = 0;
  for (const b of bs) {
    if (base <= b.from) break;
    const top = b.to === null ? base : Math.min(base, b.to);
    t += (top - b.from) * b.rate;
  }
  return t;
}

/** Hash determinista de las entradas (clave de caché con versión del motor). */
export function hashInputs(v: unknown): string {
  const canon = (x: unknown): string =>
    x === null || typeof x !== "object" ? JSON.stringify(x)
      : Array.isArray(x) ? `[${x.map(canon).join(",")}]`
      : `{${Object.keys(x as object).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined)
          .map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(",")}}`;
  const s = canon(v);
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${ENGINE_VERSION}:${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

interface Bases { price: number | null; sale: number | null; principal: number | null; income?: number | null }

/** Resuelve el importe de una partida. null = desconocido (nunca cero por defecto). */
export function resolveItem(item: Item, b: Bases): { amount: number | null; na: boolean } {
  if (item.status === "not_applicable") return { amount: 0, na: true };
  if (item.status === "confirmed_zero") return { amount: 0, na: false };
  if (item.status === "unknown") return { amount: null, na: false };
  const kind = item.kind ?? "fixed";
  const rate = item.rate ?? null;
  switch (kind) {
    case "fixed": return { amount: item.amount ?? null, na: false };
    case "percent_of_price": return { amount: rate === null || b.price === null ? null : rate * b.price, na: false };
    case "percent_of_sale": return { amount: rate === null || b.sale === null ? null : rate * b.sale, na: false };
    case "percent_of_principal": return { amount: rate === null || b.principal === null ? null : rate * b.principal, na: false };
    case "percent_of_income": return { amount: rate === null || b.income === undefined || b.income === null ? null : rate * b.income, na: false };
    case "brackets_of_price":
      return { amount: !item.brackets?.length || b.price === null ? null : bracketsAmount(b.price, item.brackets, item.bracketMode), na: false };
  }
}

// ----------------------------------------------------------------------------- dependencias de métricas

const DEPS: Record<string, Component[]> = {
  assetInitialInvestment: ["price", "acquisition", "renovation", "equipment"],
  acquisitionCosts: ["price", "acquisition"],
  renovationTotal: ["renovation"],
  equityInitial: ["price", "acquisition", "renovation", "equipment", "financing"],
  reserveInitial: ["reserve"],
  peakEquity: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "financing", "reserve"],
  grossIncomeAnnual: ["income"],
  grossYieldOnPrice: ["income", "price"],
  grossYieldOnInvestment: ["income", "price", "acquisition", "renovation", "equipment"],
  noiFirstYear: ["income", "opex"],
  noiStabilized: ["income", "opex"],
  netOperatingYield: ["income", "opex", "price", "acquisition", "renovation", "equipment"],
  cashflowAnnual: ["income", "opex", "capex", "financing"],
  cashflowMonthly: ["income", "opex", "capex", "financing"],
  cashOnCash: ["income", "opex", "capex", "financing", "price", "acquisition", "renovation", "equipment"],
  irrAsset: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "exit"],
  irrEquity: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "financing", "reserve", "exit"],
  npvEquity: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "financing", "reserve", "exit"],
  profitBeforeFinancing: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "exit"],
  profitAfterFinancing: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "financing", "exit"],
  profitAfterTax: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "financing", "exit", "tax"],
  marginOnSale: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "exit"],
  returnOnCost: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "exit"],
  totalReturnOnEquity: ["price", "acquisition", "renovation", "equipment", "income", "opex", "capex", "financing", "reserve", "exit"],
};

// ----------------------------------------------------------------------------- motor

export function validate(s: ScenarioInput): string[] {
  const e: string[] = [];
  const groups = new Map<string, string>();
  const all: Item[] = [...s.acquisitionCosts, ...s.equipment, ...s.operatingExpenses, ...s.capex,
    ...s.financing.loans.flatMap((l) => l.fees ?? []), ...(s.exit?.saleCosts ?? []),
    ...(s.operation.kind === "resale" ? s.operation.marketing ?? [] : []),
    ...(s.operation.kind === "rooms" ? s.operation.rooms.flatMap((r) => r.expenses ?? []) : [])];
  for (const it of all) {
    if (it.group) {
      if (groups.has(it.group)) e.push(`Partida duplicada: «${it.concept}» y «${groups.get(it.group)}» representan el mismo concepto (${it.group}).`);
      else groups.set(it.group, it.concept);
    }
    if (it.kind && it.kind !== "fixed" && it.amount != null && it.rate != null)
      e.push(`«${it.concept}»: indique importe o porcentaje, no ambos.`);
  }
  if (s.exit && compare(s.exit.date, s.purchase.date) <= 0) e.push("La fecha de venta debe ser posterior a la compra.");
  const op = s.operation;
  if (op.kind === "rent_long" && op.vacancy.mode === "percent" && op.vacancy.gaps?.length)
    e.push("Vacancia duplicada: use calendario de periodos vacíos o porcentaje, no ambos.");
  if (op.kind === "tourist") {
    for (const m of op.months) {
      if (m.month < 1 || m.month > 12) e.push(`Mes turístico no válido: ${m.month}`);
      if (m.occupiedNights !== null && m.occupiedNights > m.availableNights)
        e.push(`Mes ${m.month}: noches ocupadas (${m.occupiedNights}) superan las disponibles (${m.availableNights}).`);
      if (m.availableNights > 31) e.push(`Mes ${m.month}: más de 31 noches disponibles.`);
    }
  }
  if (op.kind === "temporary") {
    const byUnit = new Map<string, { start: string; end: string; id: string }[]>();
    for (const st of op.stays) {
      if (compare(st.end, st.start) <= 0) e.push(`Estancia ${st.id}: la salida debe ser posterior a la entrada.`);
      if (st.monthlyRate != null && st.totalAmount != null) e.push(`Estancia ${st.id}: indique tarifa mensual o importe total, no ambos.`);
      const k = st.roomId ?? "_whole";
      const list = byUnit.get(k) ?? [];
      for (const o of list) if (st.start < o.end && o.start < st.end) e.push(`Estancias solapadas en ${k === "_whole" ? "la vivienda" : k}: ${o.id} y ${st.id}.`);
      list.push({ start: st.start, end: st.end, id: st.id });
      byUnit.set(k, list);
    }
  }
  for (const l of s.financing.loans) {
    if (l.principal != null && l.ltv) e.push(`Préstamo ${l.id}: indique principal o LTV, no ambos.`);
    if (l.termMonths <= 0) e.push(`Préstamo ${l.id}: plazo no válido.`);
    const sh = (l.disbursements ?? []).reduce((a, d) => a + d.share, 0);
    if (l.disbursements?.length && Math.abs(sh - 1) > 1e-6) e.push(`Préstamo ${l.id}: las disposiciones deben sumar el 100 %.`);
  }
  return e;
}

interface Ctx {
  s: ScenarioInput;
  start: ISODate;            // fecha de compra
  M: number;                 // nº de meses del calendario
  endDate: ISODate;          // fin exclusivo del calendario
  ledger: LedgerEntry[];
  missing: Map<string, MissingItem>;
  warnings: string[];
  incomeByMonth: number[];
  potentialIncomeByMonth: number[];
}

function monthDate(c: Ctx, m: number): ISODate {
  return m === 0 ? c.start : addMonths(firstOfMonth(c.start), m);
}

function push(c: Ctx, e: LedgerEntry) {
  c.ledger.push(e);
}

function miss(c: Ctx, itemId: string, concept: string, component: Component) {
  if (!c.missing.has(itemId)) c.missing.set(itemId, { itemId, concept, component, affects: [] });
}

function addOnce(c: Ctx, it: Item, component: Component, category: string, bases: Bases, defDate: ISODate, sign = -1,
                 layer: LedgerEntry["layer"] = "asset") {
  const { amount, na } = resolveItem(it, bases);
  if (na) return;
  const date = it.date ?? defDate;
  if (amount === null) {
    miss(c, it.id, it.concept, component);
    push(c, { date, layer, component, category, concept: it.concept, amount: 0, itemId: it.id, unknown: true });
    return;
  }
  push(c, { date, layer, component, category, concept: it.concept, amount: sign * amount, itemId: it.id });
}

/** Partidas recurrentes (mensual/trimestral/anual/% de ingresos) dentro del calendario. */
function addRecurring(c: Ctx, it: Item, component: Component, category: string, bases: Bases, defStart: ISODate) {
  if (it.periodicity === "once") return addOnce(c, it, component, category, bases, defStart);
  if (it.status === "not_applicable") return;
  const s0 = monthIndex(c.start, it.start ?? defStart);
  const e0 = it.end ? monthIndex(c.start, it.end) : c.M;
  const step = it.periodicity === "monthly" ? 1 : it.periodicity === "quarterly" ? 3 : 12;
  for (let m = Math.max(0, s0); m < Math.min(c.M, e0); m++) {
    if ((m - s0) % step !== 0) continue;
    const factor = Math.pow(1 + (it.annualIndexation ?? 0), Math.floor((m - s0) / 12));
    const { amount, na } = resolveItem(it, { ...bases, income: c.incomeByMonth[m] ?? 0 });
    if (na) return;
    const date = monthDate(c, m);
    if (amount === null) {
      miss(c, it.id, it.concept, component);
      push(c, { date, layer: "asset", component, category, concept: it.concept, amount: 0, itemId: it.id, unknown: true });
    } else {
      push(c, { date, layer: "asset", component, category, concept: it.concept, amount: -amount * factor, itemId: it.id });
    }
  }
}

function addIncome(c: Ctx, m: number, amount: number | null, concept: string, itemId: string, potential?: number | null) {
  const date = monthDate(c, m);
  if (amount === null) {
    miss(c, itemId, concept, "income");
    push(c, { date, layer: "asset", component: "income", category: "ingresos", concept, amount: 0, itemId, unknown: true });
    return;
  }
  c.incomeByMonth[m] = (c.incomeByMonth[m] ?? 0) + amount;
  c.potentialIncomeByMonth[m] = (c.potentialIncomeByMonth[m] ?? 0) + (potential ?? amount);
  if (amount !== 0) push(c, { date, layer: "asset", component: "income", category: "ingresos", concept, amount, itemId });
}

export interface Windows { firstYear: [number, number]; stabilized: [number, number] | null; stabilizedReason?: string }

function operationIncome(c: Ctx): { stableStart: number | null; rooms?: RoomResult[]; conventions: string } {
  const op = c.s.operation;
  if (op.kind === "resale") return { stableStart: null, conventions: "" };
  if (op.kind === "rent_long") {
    const L = op.leaseStart;
    const mL = monthIndex(c.start, L);
    for (let m = Math.max(0, mL); m < c.M; m++) {
      const md = firstOfMonth(monthDate(c, m));
      const { y, m: mm } = parse(md);
      const dim = daysInMonth(y, mm);
      const firstFrac = m === mL ? (dim - (parse(L).d - 1)) / dim : 1;
      const idx = Math.pow(1 + (op.annualIndexation ?? 0), Math.floor((m - mL) / 12));
      const potential = op.rentMonthly === null || op.rentStatus === "unknown" ? null : op.rentMonthly * idx * firstFrac;
      let eff = potential;
      if (eff !== null && op.vacancy.mode === "percent") {
        if (op.vacancy.percent == null) { miss(c, "vacancy", "Vacancia esperada", "income"); eff = null; }
        else eff = eff * (1 - op.vacancy.percent);
      }
      if (eff !== null && op.vacancy.mode === "calendar") {
        let gapDays = 0;
        for (const g of op.vacancy.gaps ?? []) gapDays += overlapDaysInMonth(g.start, g.end, md);
        eff = eff * (1 - Math.min(dim, gapDays) / dim);
      }
      addIncome(c, m, eff, "Renta mensual", "rent", potential);
    }
    const stable = parse(L).d === 1 ? mL : mL + 1;
    return { stableStart: stable, conventions: "Vivienda completa · renta potencial = 12 × renta mensual estabilizada (sin vacancia)" };
  }
  if (op.kind === "rooms") {
    const rooms: RoomResult[] = [];
    let latest = 0;
    for (const r of op.rooms) {
      const mR = monthIndex(c.start, r.start);
      latest = Math.max(latest, parse(r.start).d === 1 ? mR : mR + 1);
      for (let m = Math.max(0, mR); m < c.M; m++) {
        const md = firstOfMonth(monthDate(c, m));
        const { y, m: mm } = parse(md);
        const dim = daysInMonth(y, mm);
        const frac = m === mR ? (dim - (parse(r.start).d - 1)) / dim : 1;
        const idx = Math.pow(1 + (op.annualIndexation ?? 0), Math.floor((m - mR) / 12));
        const pot = r.rentMonthly === null || r.status === "unknown" ? null : r.rentMonthly * idx * frac;
        const eff = pot === null ? null : pot * (r.occupancy ?? 1);
        addIncome(c, m, eff, `Habitación ${r.label}`, `room:${r.id}`, pot);
      }
      for (const it of r.expenses ?? []) addRecurring(c, it, "opex", `habitación ${r.label}`, { price: null, sale: null, principal: null }, r.start);
    }
    return { stableStart: latest, rooms, conventions: "Habitaciones · renta potencial = Σ rentas de habitaciones × 12 (sin ocupación)" };
  }
  if (op.kind === "temporary") {
    let firstStart: number | null = null;
    for (const st of op.stays) {
      const mS = monthIndex(c.start, st.start);
      firstStart = firstStart === null ? mS : Math.min(firstStart, mS);
      const stayDays = daysBetween(st.start, st.end);
      const unknown = st.status === "unknown" || (st.monthlyRate == null && st.totalAmount == null);
      const mE = monthIndex(c.start, st.end);
      for (let m = Math.max(0, mS); m <= Math.min(c.M - 1, mE); m++) {
        const md = firstOfMonth(monthDate(c, m));
        const d = overlapDaysInMonth(st.start, st.end, md);
        if (d <= 0) continue;
        const { y, m: mm } = parse(md);
        const amt = unknown ? null : st.monthlyRate != null ? st.monthlyRate * d / daysInMonth(y, mm) : st.totalAmount! * d / stayDays;
        addIncome(c, m, amt, `Estancia ${st.id}${st.roomId ? ` (${st.roomId})` : ""}`, `stay:${st.id}`);
      }
      if (mS >= 0 && mS < c.M) {
        if (st.cleaningFeeCharged) addIncome(c, mS, st.cleaningFeeCharged, `Limpieza cobrada ${st.id}`, `stay:${st.id}:cleaning_fee`);
        const contractTotal = st.totalAmount ?? (st.monthlyRate != null ? st.monthlyRate * stayDays / 30.4375 : null);
        if (st.commissionRate != null) {
          push(c, contractTotal === null
            ? { date: st.start, layer: "asset", component: "opex", category: "comisiones", concept: `Comisión estancia ${st.id}`, amount: 0, itemId: `stay:${st.id}:commission`, unknown: true }
            : { date: st.start, layer: "asset", component: "opex", category: "comisiones", concept: `Comisión estancia ${st.id}`, amount: -st.commissionRate * contractTotal, itemId: `stay:${st.id}:commission` });
        }
        if (st.commissionFixed) push(c, { date: st.start, layer: "asset", component: "opex", category: "comisiones", concept: `Comisión estancia ${st.id}`, amount: -st.commissionFixed, itemId: `stay:${st.id}:commission_fixed` });
        if (op.turnoverCost != null || op.turnoverStatus === "unknown") {
          if (op.turnoverCost == null) { miss(c, "turnover", "Coste por cambio de ocupante", "opex"); }
          else push(c, { date: st.start, layer: "asset", component: "opex", category: "cambio de ocupante", concept: `Puesta a punto ${st.id}`, amount: -op.turnoverCost, itemId: `stay:${st.id}:turnover` });
        }
      }
    }
    return { stableStart: firstStart, conventions: "Temporal · ingresos según calendario de estancias (no 12 × mensualidad)" };
  }
  // turístico
  const t = op;
  const m0 = monthIndex(c.start, t.operationStart);
  if (t.payoutsAreNet && (t.platformCommissionRate ?? 0) > 0)
    c.warnings.push("Cobros netos de comisión: la comisión de plataforma indicada no se descuenta otra vez.");
  for (let m = Math.max(0, m0); m < c.M; m++) {
    const md = firstOfMonth(monthDate(c, m));
    const cal = parse(md).m;
    const tm = t.months.find((x) => x.month === cal);
    if (!tm) { addIncome(c, m, null, `Alojamiento ${monthKey(md)}`, `tourist:month:${cal}`); continue; }
    const years = Math.floor((m - m0) / 12);
    const adr = tm.adr === null ? null : tm.adr * Math.pow(1 + (t.annualAdrIndexation ?? 0), years);
    const accom = tm.occupiedNights === null || adr === null ? null : tm.occupiedNights * adr;
    addIncome(c, m, accom, `Alojamiento ${monthKey(md)}`, `tourist:month:${cal}`);
    const stays = tm.occupiedNights === null ? null : tm.avgStayNights ? tm.occupiedNights / tm.avgStayNights : null;
    let cleaningCharged = 0;
    if (tm.cleaningFeeChargedPerStay) {
      if (stays === null) miss(c, `tourist:stays:${cal}`, `Estancia media mes ${cal}`, "income");
      else { cleaningCharged = stays * tm.cleaningFeeChargedPerStay; addIncome(c, m, cleaningCharged, `Limpieza cobrada ${monthKey(md)}`, `tourist:cleaning_fee:${cal}`); }
    }
    if (tm.extraIncome) addIncome(c, m, tm.extraIncome, `Otros ingresos ${monthKey(md)}`, `tourist:extra:${cal}`);
    const date = monthDate(c, m);
    const gross = accom === null ? null : accom + cleaningCharged;
    const commission = t.payoutsAreNet ? 0 : t.platformCommissionRate === null || gross === null ? null : t.platformCommissionRate * gross;
    const pushCost = (id: string, concept: string, v: number | null, category: string) =>
      push(c, v === null ? { date, layer: "asset", component: "opex", category, concept, amount: 0, itemId: id, unknown: true }
                         : { date, layer: "asset", component: "opex", category, concept, amount: -v, itemId: id });
    if (commission === null) miss(c, "tourist:commission", "Comisión de plataforma", "opex");
    if (commission) pushCost(`tourist:commission:${cal}`, `Comisión plataforma ${monthKey(md)}`, commission, "comisiones");
    if (t.managementRate != null) {
      const base = gross === null || commission === null ? null : gross - commission;
      if (base === null) miss(c, "tourist:management", "Gestión", "opex");
      pushCost(`tourist:management:${cal}`, `Gestión ${monthKey(md)}`, base === null ? null : t.managementRate * base, "gestión");
    }
    for (const [key, perStay, label] of [["cleaning", t.cleaningCostPerStay, "Limpieza pagada"], ["laundry", t.laundryCostPerStay, "Lavandería"]] as const) {
      if (perStay == null) continue;
      if (stays === null) miss(c, `tourist:stays:${cal}`, `Estancia media mes ${cal}`, "opex");
      pushCost(`tourist:${key}:${cal}`, `${label} ${monthKey(md)}`, stays === null ? null : stays * perStay, key === "cleaning" ? "limpieza" : "lavandería");
    }
  }
  return { stableStart: m0 <= 0 ? 0 : m0 + (parse(t.operationStart).d === 1 ? 0 : 1),
           conventions: "Turístico · ingresos = noches ocupadas × tarifa media (+ limpieza cobrada y extras); comisiones separadas" };
}

export function simulate(s: ScenarioInput, overridePrice?: number): ScenarioResult {
  const input = overridePrice === undefined ? s : { ...s, purchase: { ...s.purchase, price: overridePrice, priceStatus: "user_input" as const } };
  const errors = validate(input);
  const base: ScenarioResult = {
    engineVersion: ENGINE_VERSION, inputsHash: hashInputs(input), strategy: input.strategy, status: "partial", missing: [],
    warnings: [], errors, metrics: {}, ledger: [], months: [], amortization: [], windows: { firstYear: { from: "", to: "" }, stabilized: null },
  };
  if (errors.length) return base;

  const start = input.purchase.date;
  const endIdx = input.exit ? monthIndex(start, input.exit.date) : input.horizonMonths - 1;
  const M = Math.max(1, endIdx + 1);
  const c: Ctx = { s: input, start, M, endDate: addMonths(firstOfMonth(start), M), ledger: [], missing: new Map(), warnings: [],
                   incomeByMonth: Array(M).fill(0), potentialIncomeByMonth: Array(M).fill(0) };
  const price = input.purchase.priceStatus === "unknown" ? null : input.purchase.price;
  const sale = input.exit ? (input.exit.priceStatus === "unknown" ? null : input.exit.price) : null;
  const bases: Bases = { price, sale, principal: null };

  // Compra y adquisición
  if (price === null) { miss(c, "price", "Precio de compra", "price"); push(c, { date: start, layer: "asset", component: "price", category: "compra", concept: "Precio de compra", amount: 0, itemId: "price", unknown: true }); }
  else push(c, { date: start, layer: "asset", component: "price", category: "compra", concept: "Precio de compra", amount: -price, itemId: "price" });
  for (const it of input.acquisitionCosts) addOnce(c, it, "acquisition", "adquisición", bases, start);

  // Reforma
  const op = input.operation;
  const opStart = op.kind === "rent_long" ? op.leaseStart : op.kind === "tourist" ? op.operationStart
    : op.kind === "rooms" ? op.rooms.map((r) => r.start).sort()[0] ?? start
    : op.kind === "temporary" ? op.stays.map((x) => x.start).sort()[0] ?? start : start;
  const initialReno: string[] = [];
  if (input.renovation.mode === "itemized") {
    for (const l of input.renovation.lines ?? []) {
      const date = l.date ?? start;
      const initial = (l.phase ?? "initial") === "initial";
      if (initial) initialReno.push(l.id);
      const amt = l.status === "unknown" || l.unitPrice === null ? null : l.status === "not_applicable" ? 0 : l.quantity * l.unitPrice;
      if (amt === null) { miss(c, l.id, l.concept, "renovation"); push(c, { date, layer: "asset", component: "renovation", category: initial ? "reforma inicial" : "reforma posterior", concept: l.concept, amount: 0, itemId: l.id, unknown: true }); }
      else push(c, { date, layer: "asset", component: "renovation", category: initial ? "reforma inicial" : "reforma posterior", concept: `${l.concept} (${l.quantity} × ${l.unitPrice})`, amount: -amt, itemId: l.id });
      if (initial && compare(date, opStart) > 0) c.warnings.push(`La partida de reforma «${l.concept}» es posterior al inicio de la explotación.`);
    }
  } else if (input.renovation.mode === "simplified" && input.renovation.simplified) {
    const it = input.renovation.simplified;
    addOnce(c, { ...it, concept: `${it.concept} (estimación simplificada)` }, "renovation", "reforma inicial", bases, start);
    initialReno.push(it.id);
  }
  for (const it of input.equipment) addOnce(c, it, "equipment", "equipamiento", bases, opStart);

  // Ingresos y gastos de explotación
  const inc = operationIncome(c);
  if (op.kind === "resale") for (const it of op.marketing ?? []) addOnce(c, it, "opex", "comercialización", bases, input.exit?.date ?? start);
  for (const it of input.operatingExpenses) addRecurring(c, it, "opex", it.periodicity === "once" ? "gasto puntual" : "gastos de explotación", bases, start);
  for (const it of input.capex) addRecurring(c, it, "capex", "reposiciones e inversiones", bases, start);

  // Reserva de liquidez (dinero retenido, no gasto)
  const r = input.reserve;
  let reserveInitial: number | null = 0;
  if (r.status !== "not_applicable" && (r.initial ?? 0) !== 0 || r.status === "unknown") {
    reserveInitial = r.status === "unknown" ? null : r.initial;
    if (reserveInitial === null) miss(c, "reserve", "Reserva de liquidez", "reserve");
    else {
      push(c, { date: start, layer: "reserve", component: "reserve", category: "reserva", concept: "Constitución de la reserva", amount: -reserveInitial });
      let used = 0;
      for (const u of r.uses ?? []) {
        used += u.amount;
        push(c, { date: u.date, layer: "reserve", component: "reserve", category: "reserva", concept: `Uso de la reserva: ${u.concept}`, amount: u.amount });
      }
      if (used > reserveInitial + 1e-6) c.warnings.push("Los usos de la reserva superan su importe.");
      if (r.releaseAtEnd) {
        const relDate = input.exit?.date ?? addMonths(firstOfMonth(start), M);
        push(c, { date: relDate, layer: "reserve", component: "reserve", category: "reserva", concept: "Liberación de la reserva", amount: Math.max(0, reserveInitial - used) });
      }
    }
  }

  // Financiación
  let totalPrincipal: number | null = 0;
  for (const loan of input.financing.loans) {
    let principal: number | null = loan.status === "unknown" ? null : loan.principal ?? null;
    if (loan.ltv && loan.status !== "unknown") {
      const b = loan.ltv.base === "price" ? price : loan.ltv.appraisal ?? null;
      principal = b === null ? null : loan.ltv.ratio * (loan.ltv.base === "appraisal" && price !== null ? Math.min(b, price) : b);
    }
    if (principal === null) { miss(c, `loan:${loan.id}`, `Principal del préstamo ${loan.label ?? loan.id}`, "financing"); totalPrincipal = null; continue; }
    // Tipo de interés desconocido: nunca se supone 0 %
    const rateKnown = loan.rate.type === "fixed" ? loan.rate.annualRate != null && Number.isFinite(loan.rate.annualRate)
      : (loan.rate.schedule ?? []).length > 0 && loan.rate.schedule!.every((x) => x.annualRate != null && Number.isFinite(x.annualRate));
    if (!rateKnown) { miss(c, `loan:${loan.id}:rate`, `Tipo de interés del préstamo ${loan.label ?? loan.id}`, "financing"); totalPrincipal = null; continue; }
    totalPrincipal = totalPrincipal === null ? null : totalPrincipal + principal;
    const sched = buildSchedule(loan, principal, start, input.exit?.date ?? null);
    base.amortization.push(...sched.rows);
    for (const row of sched.rows) {
      if (row.disbursement) push(c, { date: row.date, layer: "financing", component: "financing", category: "disposición", concept: `Disposición ${loan.label ?? loan.id}`, amount: row.disbursement });
      if (row.interest && row.kind !== "grace" || (row.kind === "grace" && loan.graceType !== "capitalized" && row.interest))
        push(c, { date: row.date, layer: "financing", component: "financing", category: "intereses", concept: `Intereses ${loan.label ?? loan.id}`, amount: -row.interest });
      if (row.principal > 0) push(c, { date: row.date, layer: "financing", component: "financing", category: row.kind === "payoff" ? "cancelación" : "devolución de principal", concept: `${row.kind === "payoff" ? "Cancelación" : "Principal"} ${loan.label ?? loan.id}`, amount: -row.principal });
      if (row.fee) push(c, { date: row.date, layer: "financing", component: "financing", category: "comisiones", concept: `Comisión ${row.kind === "payoff" ? "cancelación" : "amortización anticipada"} ${loan.label ?? loan.id}`, amount: -row.fee });
    }
    for (const f of loan.fees ?? []) addOnce(c, f, "financing", "comisiones", { ...bases, principal }, sched.firstDisbursement, -1, "financing");
    if (!input.exit) {
      const o = sched.outstandingAt(addMonths(firstOfMonth(start), M));
      if (o > 0) c.warnings.push(`Deuda pendiente al final del horizonte (${loan.label ?? loan.id}): ${o.toFixed(2)} €.`);
    }
  }

  // Salida
  if (input.exit) {
    if (sale === null) { miss(c, "exit_price", "Precio de venta", "exit"); push(c, { date: input.exit.date, layer: "asset", component: "exit", category: "venta", concept: "Precio de venta", amount: 0, itemId: "exit_price", unknown: true }); }
    else push(c, { date: input.exit.date, layer: "asset", component: "exit", category: "venta", concept: "Precio de venta", amount: sale, itemId: "exit_price" });
    for (const it of input.exit.saleCosts) addOnce(c, it, "exit", "gastos de venta", bases, input.exit.date);
  }

  // Fiscalidad del inversor (solo si se configura; si no, resultados antes de impuestos)
  const tax = input.investorTax;
  const taxConfigured = tax?.mode === "manual";
  if (taxConfigured) {
    for (const it of tax!.items ?? []) {
      const { amount } = resolveItem(it, bases);
      if (amount === null) miss(c, it.id, it.concept, "tax");
      else push(c, { date: it.date ?? input.exit?.date ?? start, layer: "tax", component: "tax", category: "impuestos del inversor", concept: it.concept, amount: -amount, itemId: it.id });
    }
  }

  // ------------------------------------------------------------------ agregados mensuales
  c.ledger.sort((a, b) => compare(a.date, b.date));
  const months: MonthRow[] = [];
  let cum = 0;
  for (let m = 0; m < M; m++) {
    const key = monthKey(monthDate(c, m));
    const rows = c.ledger.filter((e) => monthKey(e.date) === key || (m === M - 1 && monthKey(e.date) > key));
    const sum = (f: (e: LedgerEntry) => boolean) => rows.filter(f).reduce((s, e) => s + e.amount, 0);
    const income = sum((e) => e.component === "income");
    const opex = sum((e) => e.component === "opex");
    const capex = sum((e) => e.component === "capex");
    const asset = sum((e) => e.layer === "asset");
    const fin = sum((e) => e.layer === "financing");
    const res = sum((e) => e.layer === "reserve");
    const tx = sum((e) => e.layer === "tax");
    cum += asset + fin + res + tx;
    months.push({ month: key, income, opex, noi: income + opex, capex, assetFlow: asset, financingFlow: fin, reserveFlow: res, taxFlow: tx,
                  equityFlow: asset + fin + res + tx, cumulativeEquity: cum });
  }

  // Ventanas: primer año y 12 meses estabilizados
  const fy: [number, number] = [0, Math.min(M, 12)];
  let st: [number, number] | null = null;
  if (inc.stableStart !== null) {
    const s0 = Math.max(0, inc.stableStart);
    if (s0 + 12 <= M) st = [s0, s0 + 12];
    else c.warnings.push("Horizonte insuficiente para calcular doce meses estabilizados.");
  }
  const winSum = (w: [number, number], f: (r: MonthRow) => number) => months.slice(w[0], w[1]).reduce((s, r) => s + f(r), 0);
  const winHas = (w: [number, number], comps: Component[]) =>
    c.ledger.some((e) => e.unknown && comps.includes(e.component) && monthIndex(start, e.date) >= w[0] && monthIndex(start, e.date) < w[1]);

  // ------------------------------------------------------------------ métricas
  const missingComps = new Set([...c.missing.values()].map((x) => x.component));
  const metrics: Record<string, Metric> = {};
  const def = (key: string, label: string, unit: Metric["unit"], value: number | null, extra: Partial<Metric> = {}) => {
    const deps = DEPS[key] ?? [];
    const blocked = deps.filter((d) => missingComps.has(d));
    const status: MetricStatus = extra.status ?? (blocked.length || value === null || !Number.isFinite(value) ? "not_computable" : "ok");
    metrics[key] = { key, label, unit, value: status === "ok" ? value : null, status,
      missing: blocked.length ? [...c.missing.values()].filter((x) => blocked.includes(x.component)).map((x) => x.concept) : undefined, ...extra, };
    if (extra.status && extra.status !== "ok") metrics[key]!.value = null;
  };
  const sumWhere = (f: (e: LedgerEntry) => boolean) => c.ledger.filter(f).reduce((s, e) => s + e.amount, 0);
  const acq = -sumWhere((e) => e.component === "acquisition");
  const renoInit = -sumWhere((e) => e.component === "renovation" && e.category === "reforma inicial");
  const renoAll = -sumWhere((e) => e.component === "renovation");
  const equipInit = -sumWhere((e) => e.component === "equipment");
  const assetInitial = price === null ? null : price + acq + renoInit + equipInit;
  def("acquisitionCosts", "Gastos e impuestos de adquisición", "EUR", acq);
  def("renovationTotal", "Reforma total", "EUR", renoAll);
  def("assetInitialInvestment", "Inversión inicial del activo", "EUR", assetInitial,
      { convention: "compra + adquisición + reforma inicial + equipamiento inicial" });

  // Capital propio inicial: pagos iniciales menos financiación dispuesta hasta el fin de la fase inicial
  const initialItemDates = c.ledger.filter((e) => e.layer === "asset" && (["price", "acquisition", "equipment"].includes(e.component)
    || (e.component === "renovation" && e.category === "reforma inicial"))).map((e) => e.date);
  const initialEnd = initialItemDates.sort().at(-1) ?? start;
  const finInitial = sumWhere((e) => e.layer === "financing" && compare(e.date, initialEnd) <= 0 && ["disposición", "comisiones"].includes(e.category));
  def("equityInitial", "Capital propio inicial (sin reserva)", "EUR", assetInitial === null ? null : assetInitial - finInitial,
      { convention: "inversión inicial del activo − financiación dispuesta + comisiones hasta el fin de la fase inicial", period: `hasta ${initialEnd}` });
  def("reserveInitial", "Reserva de liquidez", "EUR", reserveInitial, { notes: ["Dinero retenido; no es gasto. Se libera al final si así se indica."] });
  def("loanPrincipal", "Financiación total", "EUR", totalPrincipal);

  // Necesidad máxima de aportaciones (calendario real)
  let minCum = 0, cm = 0;
  for (const e of c.ledger) {
    if (e.layer === "tax" && !taxConfigured) continue;
    if (input.exit && e.date >= input.exit.date && sale === null) continue;
    cm += e.amount;
    minCum = Math.min(minCum, cm);
  }
  def("peakEquity", "Necesidad máxima de aportaciones", "EUR", -minCum,
      { convention: "mínimo del flujo acumulado del capital propio (incluye reserva) según el calendario de cobros, pagos y disposiciones" });

  // Explotación
  if (op.kind !== "resale") {
    const potentialAnnual = st ? months.slice(st[0], st[1]).reduce((s, _r, i) => s + (c.potentialIncomeByMonth[st![0] + i] ?? 0), 0) : null;
    const incomeStab = st ? winSum(st, (r) => r.income) : null;
    const opexStab = st ? -winSum(st, (r) => r.opex) : null;
    const noiStab = st && incomeStab !== null && opexStab !== null ? incomeStab - opexStab : null;
    const noiFy = winSum(fy, (r) => r.noi);
    const period = st ? `${months[st[0]]!.month} a ${months[st[1] - 1]!.month}` : undefined;
    const stUnknown = st ? winHas(st, ["income", "opex"]) : true;
    def("grossIncomeAnnual", "Ingresos brutos anuales (estabilizados)", "EUR/año", potentialAnnual, { period, convention: inc.conventions });
    def("grossYieldOnPrice", "Rentabilidad bruta sobre precio", "%", potentialAnnual !== null && price ? (potentialAnnual / price) * 100 : null,
        { denominator: "precio de compra", period, convention: inc.conventions });
    def("grossYieldOnInvestment", "Rentabilidad bruta sobre inversión", "%", potentialAnnual !== null && assetInitial ? (potentialAnnual / assetInitial) * 100 : null,
        { denominator: "inversión inicial del activo", period });
    def("noiFirstYear", "Resultado operativo · primer año", "EUR/año", noiFy, { period: `${months[0]!.month} a ${months[fy[1] - 1]!.month}`,
        convention: "ingresos efectivos − gastos de explotación (sin financiación ni impuestos del inversor)" });
    def("noiStabilized", "Resultado operativo · 12 meses estabilizados", "EUR/año", stUnknown ? null : noiStab, { period });
    def("netOperatingYield", "Rentabilidad neta operativa", "%", noiStab !== null && assetInitial ? (noiStab / assetInitial) * 100 : null,
        { denominator: "inversión inicial del activo", period, convention: "resultado operativo estabilizado / inversión inicial del activo" });
    // Servicio de la deuda de la ventana: las cuotas se liquidan al final de cada periodo (fechadas el mes siguiente),
    // así que se toman las 12 liquidaciones que corresponden a los 12 meses de la ventana. Sin disposiciones.
    const debtService = st ? c.ledger.filter((e) => e.layer === "financing" && e.category !== "disposición"
      && monthIndex(start, e.date) >= st![0] + 1 && monthIndex(start, e.date) < st![1] + 1).reduce((a, e) => a + e.amount, 0) : 0;
    const cfAnnual = st ? winSum(st, (r) => r.noi + r.capex) + debtService : null;
    const taxLbl = taxConfigured ? "después de impuestos configurados" : "antes de impuestos del inversor";
    def("cashflowAnnual", `Flujo de caja anual estabilizado (${taxLbl})`, "EUR/año", cfAnnual, { period,
        convention: "resultado operativo − reposiciones − intereses − principal − comisiones de la ventana estabilizada" });
    def("cashflowMonthly", "Flujo de caja mensual medio (estabilizado)", "EUR/mes", cfAnnual === null ? null : cfAnnual / 12, { period });
    const eq = metrics.equityInitial?.value ?? null;
    def("cashOnCash", "Cash-on-cash", "%", cfAnnual !== null && eq ? (cfAnnual / eq) * 100 : null,
        { denominator: "capital propio inicial (sin reserva)", period, convention: "flujo de caja anual estabilizado / capital propio inicial" });
  }

  // Salida, beneficios y TIR
  if (input.exit) {
    const assetFlows: Flow[] = c.ledger.filter((e) => e.layer === "asset").map((e) => ({ date: e.date, amount: e.amount }));
    const eqFlows: Flow[] = c.ledger.filter((e) => e.layer !== "tax" || taxConfigured).map((e) => ({ date: e.date, amount: e.amount }));
    const profitBF = assetFlows.reduce((s, f) => s + f.amount, 0);
    const profitAF = c.ledger.filter((e) => e.layer === "asset" || e.layer === "financing").reduce((s, e) => s + e.amount, 0);
    const totalCost = -c.ledger.filter((e) => e.layer === "asset" && e.amount < 0).reduce((s, e) => s + e.amount, 0);
    const dur = monthIndex(start, input.exit.date);
    const per = `${start} → ${input.exit.date} (${dur} meses)`;
    def("profitBeforeFinancing", "Beneficio antes de financiación", "EUR", profitBF, { period: per });
    def("profitAfterFinancing", "Beneficio después de financiación", "EUR", profitAF, { period: per,
        convention: taxConfigured ? undefined : "antes de impuestos del inversor" });
    let profitTax: number | null = null;
    if (taxConfigured) {
      const rate = tax!.profitTaxRate;
      const t = rate == null ? 0 : Math.max(0, profitAF) * rate;
      if (rate != null) push(c, { date: input.exit.date, layer: "tax", component: "tax", category: "impuestos del inversor", concept: tax!.label ?? "Impuesto sobre el beneficio (tipo efectivo declarado)", amount: -t });
      const otherTax = c.ledger.filter((e) => e.layer === "tax").reduce((s, e) => s + e.amount, 0);
      profitTax = profitAF + otherTax;
      def("profitAfterTax", "Beneficio después de impuestos", "EUR", profitTax, { period: per, convention: "con la fiscalidad configurada manualmente" });
    } else {
      def("profitAfterTax", "Beneficio después de impuestos", "EUR", null, { status: "not_applicable", notes: ["Fiscalidad del inversor no configurada: los resultados se muestran antes de impuestos."] });
    }
    def("marginOnSale", "Margen sobre venta", "%", sale ? (profitBF / sale) * 100 : null, { denominator: "precio de venta", period: per });
    def("returnOnCost", "Retorno sobre coste", "%", totalCost ? (profitBF / totalCost) * 100 : null,
        { denominator: "coste total del activo", period: per, convention: "retorno total de la operación, no anual" });
    const peak = metrics.peakEquity?.value ?? null;
    def("totalReturnOnEquity", "Retorno total sobre capital aportado", "%", peak ? (profitAF / peak) * 100 : null,
        { denominator: "necesidad máxima de aportaciones", period: per, convention: "retorno total, no anual" });
    metrics.durationMonths = { key: "durationMonths", label: "Plazo de la operación", unit: "meses", value: dur, status: "ok" };
    for (const [key, label, flows] of [["irrAsset", "TIR del activo (sin financiación)", assetFlows], ["irrEquity", "TIR del capital propio", eqFlows]] as const) {
      const r = xirr(flows);
      const st2: MetricStatus = r.status === "ok" ? "ok" : r.status === "multiple_solutions" ? "multiple_solutions"
        : r.status === "not_converged" ? "not_converged" : "no_solution";
      def(key, label, "%", r.rate === null ? null : r.rate * 100, { period: per, convention: "TIR por fechas (ACT/365)",
          values: r.roots.map((x) => x * 100), notes: r.note ? [r.note] : undefined, ...(st2 !== "ok" ? { status: st2 } : {}) });
      const dk = DEPS[key]!.filter((d) => missingComps.has(d));
      if (dk.length && metrics[key]) { metrics[key]!.status = "not_computable"; metrics[key]!.value = null; }
      if (dur < 12 && metrics[key]?.status === "ok") metrics[key]!.notes = [...(metrics[key]!.notes ?? []),
        "Operación corta: una TIR alta no implica que pueda repetirse durante el año. Léala junto al beneficio, el margen y el plazo."];
    }
    if (input.discountRate != null) {
      def("npvEquity", "VAN del capital propio", "EUR", npv(input.discountRate, eqFlows), { convention: `tasa de descuento ${(input.discountRate * 100).toFixed(2)} % anual (ACT/365)` });
    }
  }

  // Resultados por habitación
  if (op.kind === "rooms" && st) {
    base.rooms = op.rooms.map((r) => {
      const inc12 = c.ledger.filter((e) => e.itemId === `room:${r.id}` && monthIndex(start, e.date) >= st![0] && monthIndex(start, e.date) < st![1]);
      const exp12 = c.ledger.filter((e) => e.category === `habitación ${r.label}` && monthIndex(start, e.date) >= st![0] && monthIndex(start, e.date) < st![1]);
      const unknown = inc12.some((e) => e.unknown) || exp12.some((e) => e.unknown);
      const gi = inc12.reduce((s, e) => s + e.amount, 0);
      const ex = -exp12.reduce((s, e) => s + e.amount, 0);
      return { roomId: r.id, label: r.label, grossIncome12m: unknown ? null : gi, specificExpenses12m: unknown ? null : ex, contribution12m: unknown ? null : gi - ex };
    });
  }

  // Asociar métricas afectadas a cada partida pendiente
  const missingArr = [...c.missing.values()].map((mi) => ({ ...mi, affects: Object.entries(DEPS).filter(([k, d]) => d.includes(mi.component) && metrics[k]).map(([k]) => metrics[k]!.label) }));
  return {
    ...base,
    status: missingArr.length ? "partial" : "complete",
    missing: missingArr,
    warnings: c.warnings,
    metrics,
    ledger: c.ledger,
    months,
    windows: { firstYear: { from: months[0]!.month, to: months[fy[1] - 1]!.month },
               stabilized: st ? { from: months[st[0]]!.month, to: months[st[1] - 1]!.month } : null },
  };
}
