import { addMonths, type ISODate } from "./dates";
import type { Item, ScenarioInput, Strategy } from "./types";

const DEF = "supuesto por defecto Inmo360 v1 (editable)";

/**
 * Plantillas de partida por modalidad. Lo que depende del inmueble o del territorio queda como
 * DESCONOCIDO (nunca cero): impuesto de adquisición, IBI, comunidad, seguro, renta. Los supuestos genéricos
 * se marcan como ESTIMADOS con su origen.
 */
export function templates(strategy: Strategy, opts: { price?: number | null; date: ISODate; rent?: number | null }): ScenarioInput {
  const d = opts.date;
  const acquisition: Item[] = [
    { id: "itp", concept: "Impuesto de adquisición (ITP/IVA+AJD)", kind: "percent_of_price", rate: null, periodicity: "once",
      status: "unknown", group: "acq_tax", notes: "Depende de la comunidad, el tipo de inmueble y el perfil. Confirme la regla aplicable." },
    { id: "notary", concept: "Notaría, registro y gestoría", kind: "percent_of_price", rate: 0.015, periodicity: "once",
      status: "estimated", origin: DEF, group: "notary" },
    { id: "agency_fee", concept: "Honorarios de intermediación (compra)", amount: null, periodicity: "once", status: "not_applicable", group: "buy_agency" },
  ];
  const opex: Item[] = [
    { id: "community", concept: "Comunidad de propietarios", amount: null, periodicity: "monthly", status: "unknown", group: "community" },
    { id: "ibi", concept: "IBI", amount: null, periodicity: "annual", status: "unknown", group: "ibi",
      notes: "El tipo municipal no basta para conocer el recibo: use el recibo o el valor catastral." },
    { id: "insurance", concept: "Seguro de hogar", amount: null, periodicity: "annual", status: "unknown", group: "insurance" },
  ];
  const base: Omit<ScenarioInput, "operation" | "strategy"> = {
    purchase: { price: opts.price ?? null, priceStatus: opts.price ? "published_unconfirmed" : "unknown", date: d },
    horizonMonths: 120,
    acquisitionCosts: acquisition,
    renovation: { mode: "none" },
    equipment: [],
    financing: { loans: [] },
    reserve: { initial: 0, status: "confirmed_zero", releaseAtEnd: true },
    operatingExpenses: opex,
    capex: [],
    exit: null,
    investorTax: { mode: "none" },
    discountRate: null,
  };
  const leaseStart = addMonths(d, 1);
  switch (strategy) {
    case "resale":
      return { ...base, strategy, horizonMonths: 12,
        operation: { kind: "resale", marketing: [{ id: "marketing", concept: "Comercialización", amount: null, periodicity: "once", status: "unknown" }] },
        exit: { date: addMonths(d, 9), price: null, priceStatus: "unknown",
                saleCosts: [{ id: "sale_agency", concept: "Honorarios de venta", kind: "percent_of_sale", rate: 0.03, periodicity: "once", status: "estimated", origin: DEF },
                            { id: "plusvalia", concept: "Plusvalía municipal (IIVTNU)", amount: null, periodicity: "once", status: "unknown" }] },
        operatingExpenses: [...opex, { id: "utilities_holding", concept: "Suministros durante la tenencia", amount: null, periodicity: "monthly", status: "unknown" }] };
    case "rent_long":
      return { ...base, strategy,
        operation: { kind: "rent_long", rentMonthly: opts.rent ?? null, rentStatus: opts.rent ? "estimated" : "unknown", leaseStart,
                     vacancy: { mode: "percent", percent: 0.04 }, annualIndexation: null },
        operatingExpenses: [...opex,
          { id: "maintenance", concept: "Mantenimiento", kind: "percent_of_income", rate: 0.05, periodicity: "monthly", status: "estimated", origin: DEF },
          { id: "default_insurance", concept: "Seguro de impago", kind: "percent_of_income", rate: null, periodicity: "monthly", status: "not_applicable" }] };
    case "rooms":
      return { ...base, strategy,
        operation: { kind: "rooms", term: "long", rooms: [1, 2, 3].map((n) => ({ id: `h${n}`, label: `H${n}`, rentMonthly: null, status: "unknown" as const,
                                                                                 start: leaseStart, occupancy: 0.92 })) },
        equipment: [{ id: "furniture", concept: "Mobiliario y equipamiento", amount: null, periodicity: "once", status: "unknown", date: d }],
        operatingExpenses: [...opex,
          { id: "utilities", concept: "Suministros e internet (compartidos)", amount: null, periodicity: "monthly", status: "unknown", group: "utilities" },
          { id: "cleaning_common", concept: "Limpieza de zonas comunes", amount: null, periodicity: "monthly", status: "unknown" },
          { id: "maintenance", concept: "Mantenimiento", kind: "percent_of_income", rate: 0.07, periodicity: "monthly", status: "estimated", origin: DEF }] };
    case "temporary":
      return { ...base, strategy,
        operation: { kind: "temporary", stays: [], turnoverCost: null, turnoverStatus: "unknown" },
        equipment: [{ id: "furniture", concept: "Mobiliario y equipamiento", amount: null, periodicity: "once", status: "unknown", date: d }],
        operatingExpenses: [...opex, { id: "utilities", concept: "Suministros (a cargo del propietario)", amount: null, periodicity: "monthly", status: "unknown", group: "utilities" }] };
    case "tourist":
      return { ...base, strategy,
        operation: { kind: "tourist", operationStart: leaseStart, platformCommissionRate: null, payoutsAreNet: false, managementRate: null,
                     cleaningCostPerStay: null, laundryCostPerStay: null, annualAdrIndexation: null,
                     months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, availableNights: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]!,
                                                                    occupiedNights: null, adr: null, avgStayNights: null })),
                     assumptions: "Ocupación y tarifa por mes pendientes: indique sus hipótesis y su fuente." },
        equipment: [{ id: "furniture", concept: "Mobiliario y equipamiento", amount: null, periodicity: "once", status: "unknown", date: d }],
        operatingExpenses: [...opex,
          { id: "utilities", concept: "Suministros", amount: null, periodicity: "monthly", status: "unknown", group: "utilities" },
          { id: "replacements", concept: "Reposiciones (menaje, textil)", amount: null, periodicity: "monthly", status: "unknown" },
          { id: "licence", concept: "Tasas y registro turístico", amount: null, periodicity: "annual", status: "unknown" }] };
  }
}
