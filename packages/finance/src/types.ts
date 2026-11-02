import type { ISODate } from "./dates";

export const ENGINE_VERSION = "finance-1.0.0";

/** Estado de cada importe. `unknown` NUNCA se convierte en cero. */
export type ValueStatus =
  | "confirmed"
  | "published_unconfirmed"
  | "estimated"
  | "user_input"
  | "unknown"
  | "not_applicable"
  | "confirmed_zero";

export type Periodicity = "once" | "monthly" | "quarterly" | "annual";

export type Component =
  | "price" | "acquisition" | "renovation" | "equipment" | "income" | "opex" | "capex"
  | "financing" | "reserve" | "exit" | "tax";

export interface Bracket { from: number; to: number | null; rate: number }

/** Partida económica con trazabilidad. */
export interface Item {
  id: string;
  concept: string;
  /** Importe en euros (kind=fixed). Para porcentajes se usa `rate`. */
  amount?: number | null;
  kind?: "fixed" | "percent_of_price" | "percent_of_sale" | "percent_of_principal" | "percent_of_income" | "brackets_of_price";
  rate?: number | null;
  brackets?: Bracket[];
  bracketMode?: "marginal" | "whole_base";
  periodicity: Periodicity;
  date?: ISODate;          // partidas únicas
  start?: ISODate;         // partidas recurrentes
  end?: ISODate;           // exclusiva
  status: ValueStatus;
  origin?: string;         // 'usuario', 'anuncio', 'regla fiscal …', 'supuesto por defecto'
  notes?: string;
  /** Partidas con el mismo grupo se consideran el mismo concepto → error de duplicado. */
  group?: string;
  /** Actualización anual (p. ej. IPC supuesto) para partidas recurrentes. */
  annualIndexation?: number | null;
  currency?: "EUR";
}

export interface RenovationLine {
  id: string;
  concept: string;
  quantity: number;
  unitPrice: number | null;
  date?: ISODate;
  status: ValueStatus;
  phase?: "initial" | "later";
  origin?: string;
}

export interface Renovation {
  mode: "none" | "itemized" | "simplified";
  lines?: RenovationLine[];
  simplified?: Item & { basis?: string };   // estimación simplificada identificada como tal
  durationMonths?: number;                    // la operación empieza después de la reforma
}

export interface RateScenario {
  type: "fixed" | "schedule";
  annualRate?: number;                         // fijo
  /** Variable o mixto como escenario explícito: tipo anual desde el mes n del préstamo. */
  schedule?: { fromMonth: number; annualRate: number }[];
  label?: string;
}

export interface Loan {
  id: string;
  label?: string;
  principal?: number | null;
  ltv?: { ratio: number; base: "price" | "appraisal"; appraisal?: number | null } | null;
  status: ValueStatus;
  rate: RateScenario;
  termMonths: number;
  paymentFrequency: "monthly" | "quarterly";
  /** Disposiciones. Por defecto, todo en la fecha de compra. `share` = fracción del principal. */
  disbursements?: { date: ISODate; share: number }[];
  graceMonths?: number;
  graceType?: "interest_only" | "capitalized";
  fees?: Item[];
  prepayments?: { date: ISODate; amount: number; mode: "reduce_term" | "reduce_payment"; feeRate?: number }[];
  earlyRepaymentFeeRate?: number;              // sobre el pendiente al cancelar en la venta
}

export interface Financing { loans: Loan[] }

export interface Reserve {
  initial: number | null;
  status: ValueStatus;
  /** Usos de la reserva para pagar partidas (no son gasto: el gasto ya está en su partida). */
  uses?: { date: ISODate; amount: number; concept: string }[];
  releaseAtEnd: boolean;
}

export interface VacancySpec {
  mode: "none" | "percent" | "calendar";
  percent?: number | null;                     // 0.05 = 5 % de meses sin ingresos (media)
  gaps?: { start: ISODate; end: ISODate }[];   // periodos sin inquilino explícitos
}

export interface RentLongOp {
  kind: "rent_long";
  rentMonthly: number | null;
  rentStatus: ValueStatus;
  leaseStart: ISODate;
  vacancy: VacancySpec;
  annualIndexation?: number | null;            // actualización supuesta (p. ej. IRAV/IPC)
}

export interface Room {
  id: string;
  label: string;
  features?: string;
  rentMonthly: number | null;
  status: ValueStatus;
  start: ISODate;
  occupancy?: number | null;                   // fracción media ocupada (0–1). 1 si no se indica
  expenses?: Item[];                           // gastos específicos de la habitación
}

export interface RoomsOp {
  kind: "rooms";
  term: "long" | "temporary";
  rooms: Room[];
  annualIndexation?: number | null;
}

export interface Stay {
  id: string;
  start: ISODate;
  end: ISODate;                                // exclusiva
  monthlyRate?: number | null;                 // tarifa mensual (prorrateada por días)
  totalAmount?: number | null;                 // o importe total del contrato
  status: ValueStatus;
  roomId?: string;                             // temporal por habitaciones
  cleaningFeeCharged?: number | null;          // limpieza cobrada al ocupante
  commissionRate?: number | null;              // comisión sobre el importe del contrato
  commissionFixed?: number | null;
}

export interface TemporaryOp {
  kind: "temporary";
  stays: Stay[];
  turnoverCost?: number | null;                // limpieza/puesta a punto pagada por cambio de ocupante
  turnoverStatus?: ValueStatus;
}

export interface TouristMonth {
  month: number;                               // 1–12 (año tipo)
  availableNights: number;
  occupiedNights: number | null;
  adr: number | null;                          // tarifa media por noche ocupada
  avgStayNights?: number | null;               // para estimar número de estancias
  extraIncome?: number | null;
  cleaningFeeChargedPerStay?: number | null;
}

export interface TouristOp {
  kind: "tourist";
  months: TouristMonth[];
  operationStart: ISODate;
  platformCommissionRate: number | null;       // sobre ingresos brutos
  payoutsAreNet: boolean;                      // si los cobros ya vienen netos de comisión
  managementRate?: number | null;              // gestión sobre ingresos netos de comisión
  cleaningCostPerStay?: number | null;
  laundryCostPerStay?: number | null;
  annualAdrIndexation?: number | null;
  assumptions?: string;                        // hipótesis de ocupación y tarifa (texto visible)
}

export interface ResaleOp {
  kind: "resale";
  marketing?: Item[];                          // comercialización
}

export type Operation = RentLongOp | RoomsOp | TemporaryOp | TouristOp | ResaleOp;

export interface Exit {
  date: ISODate;
  price: number | null;
  priceStatus: ValueStatus;
  saleCosts: Item[];                           // percent_of_sale o fixed
}

export interface InvestorTax {
  mode: "none" | "manual";
  items?: (Item & { kind?: "fixed" })[];
  /** Impuesto sobre el beneficio de la venta (manual, tipo efectivo declarado por el usuario). */
  profitTaxRate?: number | null;
  label?: string;
}

export type Strategy = "resale" | "rent_long" | "rooms" | "temporary" | "tourist";

export interface ScenarioInput {
  strategy: Strategy;
  name?: string;
  purchase: { price: number | null; priceStatus: ValueStatus; date: ISODate };
  horizonMonths: number;                       // horizonte del análisis (si no hay salida)
  acquisitionCosts: Item[];
  renovation: Renovation;
  equipment: Item[];
  financing: Financing;
  reserve: Reserve;
  operation: Operation;
  operatingExpenses: Item[];                   // gastos del propietario / de tenencia (compartidos una sola vez)
  capex: Item[];                               // reposiciones e inversiones posteriores
  exit?: Exit | null;
  investorTax?: InvestorTax;
  discountRate?: number | null;                // tasa explícita para VAN
}

// --------------------------------------------------------------------------- resultados

export type Layer = "asset" | "financing" | "reserve" | "tax";

export interface LedgerEntry {
  date: ISODate;
  layer: Layer;
  component: Component;
  category: string;
  concept: string;
  amount: number;                              // + cobro / − pago (desde el inversor)
  itemId?: string;
  unknown?: boolean;                           // la partida es desconocida: importe no incluido
}

export type MetricStatus = "ok" | "not_computable" | "not_applicable" | "no_solution" | "multiple_solutions" | "not_converged";

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: "EUR" | "EUR/mes" | "EUR/año" | "%" | "años" | "meses" | "ratio";
  status: MetricStatus;
  denominator?: string;
  period?: string;
  convention?: string;
  missing?: string[];
  notes?: string[];
  values?: number[];                           // p. ej. varias TIR posibles
}

export interface MissingItem { itemId: string; concept: string; component: Component; affects: string[] }

export interface AmortRow {
  loanId: string;
  date: ISODate;
  rate: number;
  interest: number;
  principal: number;
  payment: number;
  disbursement: number;
  fee: number;
  outstanding: number;
  kind: "disbursement" | "grace" | "installment" | "prepayment" | "payoff";
}

export interface MonthRow {
  month: string;
  income: number;
  opex: number;
  noi: number;
  capex: number;
  assetFlow: number;
  financingFlow: number;
  reserveFlow: number;
  taxFlow: number;
  equityFlow: number;
  cumulativeEquity: number;
}

export interface RoomResult { roomId: string; label: string; grossIncome12m: number | null; specificExpenses12m: number | null; contribution12m: number | null }

export interface ScenarioResult {
  engineVersion: string;
  inputsHash: string;
  strategy: Strategy;
  status: "complete" | "partial";
  missing: MissingItem[];
  warnings: string[];
  errors: string[];
  metrics: Record<string, Metric>;
  ledger: LedgerEntry[];
  months: MonthRow[];
  amortization: AmortRow[];
  rooms?: RoomResult[];
  windows: { firstYear: { from: string; to: string }; stabilized: { from: string; to: string } | null };
}
