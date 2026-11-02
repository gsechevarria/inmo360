import { addMonths, compare, daysBetween, type ISODate } from "./dates";
import type { AmortRow, Loan, RateScenario } from "./types";

const cents = (x: number) => Math.round(x * 100) / 100;

/** Cuota de un préstamo francés. Con tipo 0: amortización lineal. */
export function annuity(principal: number, periodicRate: number, periods: number): number {
  if (periods <= 0) return principal;
  if (Math.abs(periodicRate) < 1e-12) return principal / periods;
  return (principal * periodicRate) / (1 - Math.pow(1 + periodicRate, -periods));
}

export function rateAt(rate: RateScenario, loanMonth: number): number {
  if (rate.type === "fixed") return rate.annualRate ?? NaN;
  const s = [...(rate.schedule ?? [])].sort((a, b) => a.fromMonth - b.fromMonth);
  let r = s[0]?.annualRate ?? NaN;
  for (const p of s) if (p.fromMonth <= loanMonth) r = p.annualRate;
  return r;
}

export interface LoanSchedule {
  rows: AmortRow[];
  principal: number;
  outstandingAt: (date: ISODate) => number;
  firstDisbursement: ISODate;
}

/**
 * Cuadro de amortización con disposiciones escalonadas, carencia, tipos por tramos (escenario explícito),
 * amortizaciones anticipadas y cancelación en `payoffDate` (si existe).
 * Convención: tipo nominal anual / periodos al año; cuotas e intereses redondeados a céntimos; la última
 * cuota ajusta el residuo. Disposición a mitad de periodo: intereses prorrateados por días.
 */
export function buildSchedule(loan: Loan, principal: number, purchaseDate: ISODate, payoffDate?: ISODate | null): LoanSchedule {
  const pm = loan.paymentFrequency === "quarterly" ? 3 : 1;
  const disb = (loan.disbursements?.length ? loan.disbursements : [{ date: purchaseDate, share: 1 }])
    .map((d) => ({ date: d.date, amount: cents(principal * d.share) }))
    .sort((a, b) => compare(a.date, b.date));
  // el redondeo de las fracciones se ajusta en la última disposición
  const diff = cents(principal - disb.reduce((s, d) => s + d.amount, 0));
  if (disb.length) disb[disb.length - 1]!.amount = cents(disb[disb.length - 1]!.amount + diff);
  const first = disb[0]!.date;
  const totalPeriods = Math.round(loan.termMonths / pm);
  const gracePeriods = Math.round((loan.graceMonths ?? 0) / pm);
  const prepay = [...(loan.prepayments ?? [])].sort((a, b) => compare(a.date, b.date));
  const rows: AmortRow[] = [];
  let outstanding = 0;
  let installment: number | null = null;
  let lastRate = NaN;
  let pendingDisb = [...disb];
  let pendingPrepay = [...prepay];
  let periodStart = first;

  for (let k = 1; k <= totalPeriods && (outstanding > 0.004 || pendingDisb.length); k++) {
    const periodEnd = addMonths(first, k * pm);
    if (payoffDate && compare(periodEnd, payoffDate) > 0) break;
    const periodDays = daysBetween(periodStart, periodEnd);
    const annual = rateAt(loan.rate, (k - 1) * pm);
    const r = (annual * pm) / 12;
    // Disposiciones dentro del periodo: intereses prorrateados desde la fecha de disposición
    let interest = outstanding * r;
    let newMoney = false;
    while (pendingDisb.length && compare(pendingDisb[0]!.date, periodEnd) < 0) {
      const d = pendingDisb.shift()!;
      const days = Math.max(0, daysBetween(compare(d.date, periodStart) < 0 ? periodStart : d.date, periodEnd));
      interest += d.amount * r * (periodDays ? days / periodDays : 0);
      outstanding = cents(outstanding + d.amount);
      rows.push({ loanId: loan.id, date: d.date, rate: annual, interest: 0, principal: 0, payment: 0, disbursement: d.amount,
                  fee: 0, outstanding, kind: "disbursement" });
      newMoney = true;
    }
    interest = cents(interest);
    const remaining = totalPeriods - k + 1;
    if (k <= gracePeriods) {
      if (loan.graceType === "capitalized") {
        outstanding = cents(outstanding + interest);
        rows.push({ loanId: loan.id, date: periodEnd, rate: annual, interest, principal: -interest, payment: 0, disbursement: 0,
                    fee: 0, outstanding, kind: "grace" });
      } else {
        rows.push({ loanId: loan.id, date: periodEnd, rate: annual, interest, principal: 0, payment: interest, disbursement: 0,
                    fee: 0, outstanding, kind: "grace" });
      }
    } else {
      if (installment === null || newMoney || annual !== lastRate) {
        installment = cents(annuity(outstanding, r, remaining));
      }
      let principalPart = cents(installment - interest);
      if (principalPart > outstanding || remaining === 1) principalPart = outstanding;
      const payment = cents(principalPart + interest);
      outstanding = cents(outstanding - principalPart);
      rows.push({ loanId: loan.id, date: periodEnd, rate: annual, interest, principal: principalPart, payment, disbursement: 0,
                  fee: 0, outstanding, kind: "installment" });
    }
    lastRate = annual;
    // Amortizaciones anticipadas con fecha ≤ fin del periodo (se aplican tras la cuota)
    while (pendingPrepay.length && compare(pendingPrepay[0]!.date, periodEnd) <= 0) {
      const p = pendingPrepay.shift()!;
      const amt = Math.min(p.amount, outstanding);
      const fee = cents(amt * (p.feeRate ?? 0));
      outstanding = cents(outstanding - amt);
      rows.push({ loanId: loan.id, date: p.date, rate: annual, interest: 0, principal: amt, payment: amt, disbursement: 0, fee,
                  outstanding, kind: "prepayment" });
      if (p.mode === "reduce_payment") installment = cents(annuity(outstanding, r, totalPeriods - k));
    }
    periodStart = periodEnd;
  }

  if (payoffDate && outstanding > 0.004) {
    // Intereses devengados desde la última liquidación hasta la cancelación
    const last = rows.filter((x) => x.kind !== "disbursement").at(-1)?.date ?? first;
    const annual = rateAt(loan.rate, Math.max(0, Math.round(daysBetween(first, payoffDate) / 30.4375)));
    const accrued = cents(outstanding * annual * (Math.max(0, daysBetween(last, payoffDate)) / 365));
    const fee = cents(outstanding * (loan.earlyRepaymentFeeRate ?? 0));
    rows.push({ loanId: loan.id, date: payoffDate, rate: annual, interest: accrued, principal: outstanding,
                payment: cents(outstanding + accrued), disbursement: 0, fee, outstanding: 0, kind: "payoff" });
    outstanding = 0;
  }

  const outstandingAt = (date: ISODate) => {
    let o = 0;
    for (const row of rows) if (compare(row.date, date) <= 0) o = row.outstanding;
    return o;
  };
  return { rows, principal, outstandingAt, firstDisbursement: first };
}
