import { describe, expect, it } from "vitest";
import { annuity, buildSchedule, maxPurchasePrice, simulate, xirr, type Item, type ScenarioInput } from "../src";

const fixed = (id: string, concept: string, amount: number, periodicity: Item["periodicity"] = "monthly", extra: Partial<Item> = {}): Item =>
  ({ id, concept, amount, periodicity, status: "confirmed", ...extra });

function rentLong(over: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    strategy: "rent_long",
    purchase: { price: 100_000, priceStatus: "confirmed", date: "2026-01-01" },
    horizonMonths: 24,
    acquisitionCosts: [
      { id: "itp", concept: "ITP", kind: "percent_of_price", rate: 0.1, periodicity: "once", status: "confirmed", group: "acq_tax" },
      fixed("notary", "Notaría y registro", 2_000, "once"),
    ],
    renovation: { mode: "none" },
    equipment: [],
    financing: { loans: [] },
    reserve: { initial: 0, status: "confirmed_zero", releaseAtEnd: true },
    operation: { kind: "rent_long", rentMonthly: 800, rentStatus: "confirmed", leaseStart: "2026-01-01", vacancy: { mode: "none" } },
    operatingExpenses: [fixed("community", "Comunidad", 50), fixed("ibi", "IBI", 400, "annual"), fixed("ins", "Seguro", 200, "annual")],
    capex: [],
    exit: null,
    ...over,
  };
}

const v = (r: ReturnType<typeof simulate>, k: string) => r.metrics[k]?.value ?? null;

describe("compra al contado · alquiler de vivienda completa", () => {
  const r = simulate(rentLong());
  it("inversión inicial = compra + adquisición + reforma + equipamiento", () => expect(v(r, "assetInitialInvestment")).toBeCloseTo(112_000, 6));
  it("rentabilidad bruta declara su denominador", () => {
    expect(v(r, "grossYieldOnPrice")).toBeCloseTo(9.6, 9);
    expect(r.metrics.grossYieldOnPrice!.denominator).toBe("precio de compra");
  });
  it("resultado operativo y rentabilidad neta operativa", () => {
    expect(v(r, "noiStabilized")).toBeCloseTo(8_400, 6);
    expect(v(r, "netOperatingYield")).toBeCloseTo(7.5, 9);
  });
  it("flujo mensual y cash-on-cash sin financiación", () => {
    expect(v(r, "cashflowMonthly")).toBeCloseTo(700, 6);
    expect(v(r, "cashOnCash")).toBeCloseTo(7.5, 9);
    expect(r.status).toBe("complete");
  });
  it("primer año y doce meses estabilizados se distinguen", () => {
    const late = simulate(rentLong({ operation: { kind: "rent_long", rentMonthly: 800, rentStatus: "confirmed", leaseStart: "2026-04-16", vacancy: { mode: "none" } } }));
    expect(late.windows.stabilized?.from).toBe("2026-05");
    expect(v(late, "noiFirstYear")!).toBeLessThan(v(late, "noiStabilized")!);
  });
  it("la vacancia por porcentaje no se descuenta dos veces de la renta potencial", () => {
    const vac = simulate(rentLong({ operation: { kind: "rent_long", rentMonthly: 800, rentStatus: "confirmed", leaseStart: "2026-01-01", vacancy: { mode: "percent", percent: 0.05 } } }));
    expect(v(vac, "grossYieldOnPrice")).toBeCloseTo(9.6, 9);                 // bruta: sin vacancia
    expect(v(vac, "noiStabilized")).toBeCloseTo(9_600 * 0.95 - 1_200, 6);    // neta: vacancia una sola vez
  });
  it("calendario y porcentaje a la vez es un error de vacancia duplicada", () => {
    const bad = simulate(rentLong({ operation: { kind: "rent_long", rentMonthly: 800, rentStatus: "confirmed", leaseStart: "2026-01-01",
      vacancy: { mode: "percent", percent: 0.05, gaps: [{ start: "2026-03-01", end: "2026-04-01" }] } } }));
    expect(bad.errors[0]).toMatch(/Vacancia duplicada/);
  });
});

describe("financiación", () => {
  it("cuota francesa y primer cuadro", () => {
    expect(annuity(80_000, 0.03 / 12, 300)).toBeCloseTo(379.37, 2);
    const s = buildSchedule({ id: "h", status: "confirmed", rate: { type: "fixed", annualRate: 0.03 }, termMonths: 300, paymentFrequency: "monthly" }, 80_000, "2026-01-01");
    const first = s.rows.find((x) => x.kind === "installment")!;
    expect(first.interest).toBe(200);
    expect(first.principal).toBeCloseTo(179.37, 2);
    expect(s.rows.at(-1)!.outstanding).toBe(0);
    const totalPrincipal = s.rows.filter((x) => x.kind === "installment").reduce((a, x) => a + x.principal, 0);
    expect(totalPrincipal).toBeCloseTo(80_000, 2);
  });
  it("compra financiada: capital propio y flujo después de deuda", () => {
    const r = simulate(rentLong({ financing: { loans: [{ id: "h", status: "confirmed", principal: 80_000, rate: { type: "fixed", annualRate: 0.03 }, termMonths: 300, paymentFrequency: "monthly" }] } }));
    expect(v(r, "equityInitial")).toBeCloseTo(32_000, 6);
    expect(v(r, "cashflowAnnual")).toBeCloseTo(8_400 - 12 * 379.37, 1);
    expect(v(r, "cashOnCash")).toBeCloseTo(((8_400 - 12 * 379.37) / 32_000) * 100, 2);
    // los intereses no están en los gastos de explotación (no se cuentan dos veces)
    expect(v(r, "noiStabilized")).toBeCloseTo(8_400, 6);
  });
  it("interés cero: amortización lineal", () => {
    const s = buildSchedule({ id: "z", status: "confirmed", rate: { type: "fixed", annualRate: 0 }, termMonths: 12, paymentFrequency: "monthly" }, 12_000, "2026-01-01");
    const inst = s.rows.filter((x) => x.kind === "installment");
    expect(inst).toHaveLength(12);
    expect(inst.every((x) => x.interest === 0 && x.payment === 1_000)).toBe(true);
  });
  it("carencia de intereses y carencia capitalizada", () => {
    const loan = { id: "c", status: "confirmed" as const, rate: { type: "fixed" as const, annualRate: 0.06 }, termMonths: 120, paymentFrequency: "monthly" as const, graceMonths: 6 };
    const io = buildSchedule({ ...loan, graceType: "interest_only" }, 100_000, "2026-01-01");
    expect(io.rows.filter((x) => x.kind === "grace").map((x) => x.payment)).toEqual([500, 500, 500, 500, 500, 500]);
    expect(io.rows.find((x) => x.kind === "installment")!.payment).toBeCloseTo(annuity(100_000, 0.005, 114), 2);
    const cap = buildSchedule({ ...loan, graceType: "capitalized" }, 100_000, "2026-01-01");
    expect(cap.rows.filter((x) => x.kind === "grace").at(-1)!.outstanding).toBeGreaterThan(103_000);
  });
  it("disposiciones escalonadas: intereses solo sobre lo dispuesto y aportaciones posteriores", () => {
    const s = buildSchedule({ id: "d", status: "confirmed", rate: { type: "fixed", annualRate: 0.06 }, termMonths: 120, paymentFrequency: "monthly",
      disbursements: [{ date: "2026-01-01", share: 0.5 }, { date: "2026-04-01", share: 0.5 }] }, 100_000, "2026-01-01");
    expect(s.rows.find((x) => x.kind === "installment")!.interest).toBe(250);
    expect(s.rows.filter((x) => x.kind === "disbursement")).toHaveLength(2);
  });
  it("tipo variable/mixto como escenario explícito cambia la cuota en el tramo", () => {
    const s = buildSchedule({ id: "m", status: "confirmed", rate: { type: "schedule", schedule: [{ fromMonth: 0, annualRate: 0.02 }, { fromMonth: 12, annualRate: 0.04 }] },
      termMonths: 240, paymentFrequency: "monthly" }, 100_000, "2026-01-01");
    const inst = s.rows.filter((x) => x.kind === "installment");
    expect(inst[12]!.payment).toBeGreaterThan(inst[11]!.payment);
    expect(inst[12]!.rate).toBe(0.04);
  });
});

describe("reventa", () => {
  const resale = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
    strategy: "resale",
    purchase: { price: 150_000, priceStatus: "confirmed", date: "2026-01-15" },
    horizonMonths: 12,
    acquisitionCosts: [{ id: "itp", concept: "ITP", kind: "percent_of_price", rate: 0.1, periodicity: "once", status: "confirmed" }],
    renovation: { mode: "simplified", simplified: { id: "reno", concept: "Reforma integral", amount: 30_000, periodicity: "once", status: "estimated", date: "2026-02-01" } },
    equipment: [],
    financing: { loans: [{ id: "h", status: "confirmed", ltv: { ratio: 0.7, base: "price" }, rate: { type: "fixed", annualRate: 0.025 }, termMonths: 360, paymentFrequency: "monthly",
                           fees: [{ id: "apertura", concept: "Comisión de apertura", kind: "percent_of_principal", rate: 0.005, periodicity: "once", status: "confirmed" }] }] },
    reserve: { initial: 0, status: "confirmed_zero", releaseAtEnd: true },
    operation: { kind: "resale", marketing: [fixed("mk", "Comercialización", 1_500, "once")] },
    operatingExpenses: [fixed("community", "Comunidad", 60)],
    capex: [],
    exit: { date: "2026-10-15", price: 230_000, priceStatus: "estimated",
            saleCosts: [{ id: "sale", concept: "Honorarios de venta", kind: "percent_of_sale", rate: 0.03, periodicity: "once", status: "estimated" }] },
    ...over,
  });
  const r = simulate(resale());
  it("cancela la deuda pendiente en la venta", () => {
    const payoff = r.amortization.find((x) => x.kind === "payoff")!;
    expect(payoff.date).toBe("2026-10-15");
    expect(payoff.principal).toBeGreaterThan(100_000);
    expect(r.ledger.some((e) => e.category === "cancelación")).toBe(true);
  });
  it("beneficio antes y después de financiación, margen y retorno sobre coste", () => {
    const pbf = 230_000 - 150_000 - 15_000 - 30_000 - 1_500 - 0.03 * 230_000 - 60 * 10;
    expect(v(r, "profitBeforeFinancing")).toBeCloseTo(pbf, 6);
    expect(v(r, "profitAfterFinancing")!).toBeLessThan(pbf);
    expect(v(r, "marginOnSale")).toBeCloseTo((pbf / 230_000) * 100, 6);
    expect(r.metrics.returnOnCost!.convention).toMatch(/no anual/);
    expect(r.metrics.profitAfterTax!.status).toBe("not_applicable");
  });
  it("TIR por fechas y aviso de operación corta", () => {
    expect(r.metrics.irrEquity!.status).toBe("ok");
    expect(r.metrics.irrEquity!.notes?.join(" ")).toMatch(/Operación corta/);
  });
  it("fiscalidad manual: beneficio después de impuestos", () => {
    const t = simulate(resale({ investorTax: { mode: "manual", profitTaxRate: 0.25 } }));
    expect(v(t, "profitAfterTax")).toBeCloseTo(v(t, "profitAfterFinancing")! * 0.75, 4);
  });
});

describe("costes desconocidos", () => {
  it("un coste desconocido no es cero: bloquea las métricas que dependen de él y deja calcular el resto", () => {
    const r = simulate(rentLong({ operatingExpenses: [fixed("community", "Comunidad", 50), { id: "ibi", concept: "IBI", amount: null, periodicity: "annual", status: "unknown" }] }));
    expect(r.status).toBe("partial");
    expect(r.metrics.grossYieldOnPrice!.status).toBe("ok");
    for (const k of ["noiStabilized", "netOperatingYield", "cashflowMonthly", "cashOnCash"]) {
      expect(r.metrics[k]!.status).toBe("not_computable");
      expect(r.metrics[k]!.value).toBeNull();
    }
    const ibi = r.missing.find((m) => m.itemId === "ibi")!;
    expect(ibi.affects).toContain("Rentabilidad neta operativa");
    expect(r.ledger.filter((e) => e.itemId === "ibi").every((e) => e.unknown && e.amount === 0)).toBe(true);
  });
  it("un préstamo sin tipo de interés no se calcula al 0 %: queda pendiente y bloquea métricas financiadas", () => {
    const r = simulate(rentLong({ financing: { loans: [{ id: "h", label: "Hipoteca", ltv: { ratio: 0.7, base: "price" }, status: "user_input",
      rate: { type: "fixed", annualRate: null as unknown as number }, termMonths: 300, paymentFrequency: "monthly" }] } }));
    expect(r.missing.map((m) => m.itemId)).toContain("loan:h:rate");
    expect(r.metrics.cashflowMonthly!.status).toBe("not_computable");
    expect(r.metrics.netOperatingYield!.status).toBe("ok");          // la rentabilidad del activo no depende de la financiación
    expect(r.ledger.some((e) => !Number.isFinite(e.amount))).toBe(false);
  });
  it("partidas duplicadas se rechazan", () => {
    const r = simulate(rentLong({ operatingExpenses: [fixed("a", "Comunidad", 50, "monthly", { group: "community" }), fixed("b", "Gastos de comunidad", 50, "monthly", { group: "community" })] }));
    expect(r.errors[0]).toMatch(/duplicada/);
  });
});

describe("habitaciones", () => {
  it("gastos compartidos una sola vez y resultados por habitación", () => {
    const r = simulate(rentLong({
      strategy: "rooms",
      operation: { kind: "rooms", term: "long", rooms: [
        { id: "h1", label: "H1", rentMonthly: 400, status: "confirmed", start: "2026-01-01", expenses: [fixed("h1x", "Cerradura y mantenimiento H1", 10)] },
        { id: "h2", label: "H2", rentMonthly: 450, status: "confirmed", start: "2026-01-01" },
        { id: "h3", label: "H3", rentMonthly: 500, status: "confirmed", start: "2026-01-01" }] },
      operatingExpenses: [fixed("util", "Suministros", 150)],
    }));
    expect(v(r, "grossIncomeAnnual")).toBeCloseTo(16_200, 6);
    expect(v(r, "noiStabilized")).toBeCloseTo(16_200 - 150 * 12 - 10 * 12, 6);
    expect(r.ledger.filter((e) => e.itemId === "util" && e.date < "2027-01-01")).toHaveLength(12);
    expect(r.rooms!.find((x) => x.roomId === "h1")!.contribution12m).toBeCloseTo(4_800 - 120, 6);
  });
});

describe("alquiler temporal", () => {
  it("ingresos según calendario de estancias, no 12 × mensualidad", () => {
    const r = simulate(rentLong({
      strategy: "temporary",
      purchase: { price: 100_000, priceStatus: "confirmed", date: "2026-01-01" },
      operation: { kind: "temporary", turnoverCost: 120, stays: [
        { id: "e1", start: "2026-02-01", end: "2026-07-01", monthlyRate: 1_200, status: "confirmed", commissionRate: 0.1 },
        { id: "e2", start: "2026-08-01", end: "2026-12-01", monthlyRate: 1_300, status: "confirmed" }] },
    }));
    const inc = r.months.slice(1, 13).reduce((s, m) => s + m.income, 0);
    expect(inc).toBeCloseTo(5 * 1_200 + 4 * 1_300, 6);
    expect(r.months.find((m) => m.month === "2026-07")!.income).toBe(0);
    expect(r.ledger.filter((e) => e.category === "cambio de ocupante")).toHaveLength(2);
  });
  it("estancias solapadas en la misma unidad son un error", () => {
    const r = simulate(rentLong({ strategy: "temporary", operation: { kind: "temporary", stays: [
      { id: "a", start: "2026-02-01", end: "2026-05-01", monthlyRate: 1_000, status: "confirmed" },
      { id: "b", start: "2026-04-01", end: "2026-06-01", monthlyRate: 1_000, status: "confirmed" }] } }));
    expect(r.errors.join(" ")).toMatch(/solapadas/);
  });
});

describe("turístico", () => {
  const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const months = [3, 5, 10, 18, 20, 25, 29, 30, 22, 12, 6, 8].map((occ, i) => ({ month: i + 1, availableNights: DIM[i]!, occupiedNights: occ, adr: i >= 5 && i <= 8 ? 120 : 80, avgStayNights: 4, cleaningFeeChargedPerStay: 40 }));
  const tourist = (over: object = {}) => rentLong({
    strategy: "tourist",
    operation: { kind: "tourist", operationStart: "2026-01-01", platformCommissionRate: 0.15, payoutsAreNet: false, managementRate: 0.2,
                 cleaningCostPerStay: 35, laundryCostPerStay: 10, months, ...over },
    operatingExpenses: [fixed("u", "Suministros", 90)],
  });
  it("estacionalidad: ingreso de alojamiento = noches ocupadas × tarifa media", () => {
    const r = simulate(tourist());
    const accom = months.reduce((s, m) => s + m.occupiedNights * m.adr, 0);
    const stays = months.reduce((s, m) => s + m.occupiedNights / 4, 0);
    expect(v(r, "grossIncomeAnnual")).toBeCloseTo(accom + stays * 40, 6);
    expect(r.months[6]!.income).toBeGreaterThan(r.months[0]!.income * 5);
    // limpieza cobrada y pagada se registran por separado
    expect(r.ledger.some((e) => e.concept.startsWith("Limpieza cobrada"))).toBe(true);
    expect(r.ledger.some((e) => e.category === "limpieza")).toBe(true);
  });
  it("cobros netos: la comisión no se descuenta dos veces", () => {
    const gross = simulate(tourist());
    const net = simulate(tourist({ payoutsAreNet: true }));
    expect(net.ledger.some((e) => e.category === "comisiones")).toBe(false);
    expect(net.warnings.join(" ")).toMatch(/no se descuenta otra vez/);
    expect(v(net, "noiStabilized")!).toBeGreaterThan(v(gross, "noiStabilized")!);
  });
  it("noches ocupadas por encima de las disponibles es un error", () => {
    const r = simulate(tourist({ months: [{ month: 1, availableNights: 20, occupiedNights: 25, adr: 80 }] }));
    expect(r.errors.join(" ")).toMatch(/superan las disponibles/);
  });
});

describe("reserva de liquidez y aportaciones", () => {
  it("la reserva no es gasto: no cambia el resultado operativo y se libera", () => {
    const r = simulate(rentLong({ reserve: { initial: 5_000, status: "user_input", releaseAtEnd: true, uses: [{ date: "2026-06-01", amount: 1_000, concept: "Avería" }] } }));
    expect(v(r, "noiStabilized")).toBeCloseTo(8_400, 6);
    expect(r.ledger.filter((e) => e.layer === "reserve").reduce((s, e) => s + e.amount, 0)).toBeCloseTo(0, 6);
    expect(v(r, "equityInitial")).toBeCloseTo(112_000, 6);
    expect(v(r, "peakEquity")).toBeGreaterThanOrEqual(117_000 - 1e-6 - 8_400);
  });
  it("una inversión posterior aumenta la necesidad máxima de aportaciones", () => {
    const r = simulate(rentLong({
      operation: { kind: "rent_long", rentMonthly: 800, rentStatus: "confirmed", leaseStart: "2026-09-01", vacancy: { mode: "none" } },
      capex: [fixed("cocina", "Cocina", 20_000, "once", { date: "2026-06-01" })] }));
    expect(v(r, "peakEquity")!).toBeGreaterThan(v(r, "equityInitial")! + 19_000);
  });
});

describe("TIR robusta", () => {
  it("sin solución cuando no hay cambio de signo", () => {
    expect(xirr([{ date: "2026-01-01", amount: -100 }, { date: "2027-01-01", amount: -10 }]).status).toBe("insufficient");
    expect(xirr([{ date: "2026-01-01", amount: -100 }, { date: "2027-01-01", amount: 1 }, { date: "2028-01-01", amount: -1 }]).status).toBe("no_solution");
  });
  it("varias soluciones: no elige una arbitraria", () => {
    const r = xirr([{ date: "2026-01-01", amount: -100 }, { date: "2027-01-01", amount: 230 }, { date: "2028-01-01", amount: -132 }]);
    expect(r.status).toBe("multiple_solutions");
    expect(r.rate).toBeNull();
    expect(r.roots.length).toBe(2);
    expect(r.roots[0]).toBeCloseTo(0.1, 2);
    expect(r.roots[1]).toBeCloseTo(0.2, 2);
  });
  it("caso simple: 10 % anual", () => {
    expect(xirr([{ date: "2026-01-01", amount: -100 }, { date: "2027-01-01", amount: 110 }]).rate).toBeCloseTo(0.1, 6);
  });
});

describe("precio máximo de compra", () => {
  it("impuesto por tramos de base completa (no lineal) y capital máximo", () => {
    const s = rentLong({ acquisitionCosts: [
      { id: "itp", concept: "ITP por tramos", kind: "brackets_of_price", bracketMode: "whole_base", periodicity: "once", status: "user_input",
        brackets: [{ from: 0, to: 200_000, rate: 0.06 }, { from: 200_000, to: null, rate: 0.08 }] },
      fixed("notary", "Notaría", 3_000, "once")], reserve: { initial: 0, status: "confirmed_zero", releaseAtEnd: false } });
    const r = maxPurchasePrice(s, { maxEquity: 230_000 }, { min: 50_000, max: 400_000, tolerance: 100 });
    expect(r.status).toBe("calculated");
    // 1,08 p + 3.000 ≤ 230.000 → p ≤ 210.185,18 → redondeo a 100 €
    expect(r.price).toBe(210_100);
    expect(r.binding).toBe("Capital propio máximo");
    expect(r.notes.join(" ")).toMatch(/no es una tasación/);
  });
  it("datos insuficientes si la renta es desconocida", () => {
    const s = rentLong({ operation: { kind: "rent_long", rentMonthly: null, rentStatus: "unknown", leaseStart: "2026-01-01", vacancy: { mode: "none" } } });
    expect(maxPurchasePrice(s, { minNetYield: 5 }).status).toBe("insufficient_data");
  });
  it("inviable y límite de búsqueda", () => {
    const s = rentLong();
    expect(maxPurchasePrice(s, { minNetYield: 90 }, { min: 50_000, max: 200_000 }).status).toBe("infeasible");
    expect(maxPurchasePrice(s, { minNetYield: 0.1 }, { min: 50_000, max: 200_000 }).status).toBe("search_limit");
  });
  it("sin límite superior explícito amplía la búsqueda en lugar de quedarse en el borde", () => {
    const s = rentLong();     // precio 100.000 → búsqueda inicial hasta 300.000
    const r = maxPurchasePrice(s, { minNetYield: 2 });
    expect(r.status).toBe("calculated");
    expect(r.price!).toBeGreaterThan(300_000);
    expect(r.notes.join(" ")).toMatch(/ampliado automáticamente/);
    const at = simulate({ ...s, purchase: { ...s.purchase, price: r.price! } }).metrics.netOperatingYield!.value!;
    const above = simulate({ ...s, purchase: { ...s.purchase, price: r.price! + 200 } }).metrics.netOperatingYield!.value!;
    expect(at).toBeGreaterThanOrEqual(2);
    expect(above).toBeLessThan(2);
  });
  it("objetivo de rentabilidad neta con financiación por LTV", () => {
    const s = rentLong({ financing: { loans: [{ id: "h", status: "confirmed", ltv: { ratio: 0.8, base: "price" }, rate: { type: "fixed", annualRate: 0.03 }, termMonths: 300, paymentFrequency: "monthly" }] } });
    const r = maxPurchasePrice(s, { minNetYield: 6, minMonthlyCashflow: 150 }, { min: 40_000, max: 300_000, tolerance: 100 });
    expect(r.status).toBe("calculated");
    const check = simulate(s, r.price!);
    expect(check.metrics.netOperatingYield!.value!).toBeGreaterThanOrEqual(6);
    expect(check.metrics.cashflowMonthly!.value!).toBeGreaterThanOrEqual(150);
    const above = simulate(s, r.price! + 500);
    expect(above.metrics.netOperatingYield!.value! < 6 || above.metrics.cashflowMonthly!.value! < 150).toBe(true);
  });
});
