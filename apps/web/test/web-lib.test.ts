import { describe, expect, it } from "vitest";
import { simulate, templates } from "@inmo360/finance";
import { compStats, type Comp } from "@/lib/comparables";
import { canonical } from "@/lib/canonical";
import { applyAssumptions } from "@/lib/assumptions";
import { n } from "@/lib/format";
import { fmtMetric } from "@/lib/metrics";
import { parseEs } from "@/app/(app)/calculadora/fields";

const comp = (id: string, price: number, area: number | null, extra: Partial<Comp> = {}): Comp => ({
  listingId: id, propertyId: `p${id}`, price, area, rooms: 3, type: "flat", condition: "good", muni: "02003", distanceM: null,
  lastSeen: "2026-11-01T00:00:00Z", source: "s", synthetic: false, reason: "mismo municipio", ...extra });

describe("comparables", () => {
  it("menos de 5 comparables → calidad insuficiente, nunca un resultado sólido", () => {
    const s = compStats([comp("1", 100000, 80), comp("2", 110000, 80), comp("3", 90000, 80)]);
    expect(s.quality).toBe("insuficiente");
    expect(s.nUsed).toBe(3);
  });
  it("mediana de €/m² y atípicos por la regla de Tukey (≥ 8 casos), excluidos del cálculo y listados", () => {
    const cs = [1000, 1050, 1100, 1150, 1200, 1250, 1300, 5000].map((v, i) => comp(String(i), v * 100, 100));
    const s = compStats(cs);
    expect(s.outliers).toEqual(["7"]);
    expect(s.nUsed).toBe(7);
    expect(s.median).toBeCloseTo(1150, 6);
  });
  it("las exclusiones del usuario se aplican sin perder la lista original", () => {
    const cs = [1000, 1100, 1200, 1300, 1400, 1500].map((v, i) => comp(String(i), v * 100, 100));
    const s = compStats(cs, new Set(["0", "1"]));
    expect(s.n).toBe(6);
    expect(s.nUsed).toBe(4);
    expect(s.excluded).toEqual(["0", "1"]);
  });
  it("comparables sin superficie no entran en el €/m²; búsqueda ampliada y sintéticos rebajan o anotan la calidad", () => {
    const cs = [comp("a", 1, null), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => comp(String(i), 100000 + i * 100, 100, { synthetic: i === 1 }))];
    const s = compStats(cs, new Set(), true);
    expect(s.nUsed).toBe(10);
    expect(s.quality).toBe("media");
    expect(s.reasons.join(" ")).toMatch(/ampliada/);
    expect(s.reasons.join(" ")).toMatch(/sintéticos/);
  });
});

describe("valores canónicos", () => {
  const listings = [
    { source_code: "a", built_area_m2: 80, rooms: 3, condition: "unknown", has_elevator: null },
    { source_code: "b", built_area_m2: 82, rooms: 3, condition: "good", has_elevator: true },
  ];
  it("toma el valor más reciente no nulo y muestra discrepancias entre fuentes", () => {
    const c = canonical(listings, []);
    expect(c.built_area_m2!.value).toBe(80);
    expect(c.built_area_m2!.discrepancies).toHaveLength(2);
    expect(c.rooms!.discrepancies).toHaveLength(0);
    expect(c.condition!.value).toBe("good");          // «unknown» no es un valor
    expect(c.useful_area_m2!.origin).toBe("sin dato");
  });
  it("la corrección del usuario prevalece sin borrar los valores de las fuentes", () => {
    const c = canonical(listings, [{ field: "built_area_m2", value: 78, reason: "medido en visita", created_at: "2026-11-02" }]);
    expect(c.built_area_m2!.value).toBe(78);
    expect(c.built_area_m2!.origin).toBe("corrección del usuario");
    expect(c.built_area_m2!.discrepancies.map((d) => d.value)).toEqual([80, 82]);
  });
});

describe("supuestos y formato", () => {
  it("aplicar supuestos rellena solo lo conocido; lo desconocido sigue desconocido", () => {
    const s = applyAssumptions(templates("rent_long", { price: 100000, date: "2026-01-01", rent: 700 }),
      { notary_rate: { value: 0.012, status: "user_input" }, vacancy_rate: { value: null, status: "unknown" }, ltv: { value: 0.7, status: "user_input" },
        interest_rate: { value: 0.03, status: "user_input" }, term_years: { value: 25, status: "user_input" } }, "test");
    expect(s.acquisitionCosts.find((i) => i.id === "notary")!.rate).toBe(0.012);
    expect(s.acquisitionCosts.find((i) => i.id === "itp")!.status).toBe("unknown");
    expect(s.financing.loans[0]!.termMonths).toBe(300);
    expect(s.operation.kind === "rent_long" && s.operation.vacancy.percent).toBe(0.04); // plantilla intacta
    const r = simulate(s);
    expect(r.status).toBe("partial");
    expect(r.missing.map((m) => m.itemId)).toContain("itp");
  });
  it("números en formato español: «1.234,5», «120.000» y vacío = desconocido", () => {
    expect(parseEs("1.234,5")).toBe(1234.5);
    expect(parseEs("120.000")).toBe(120000);
    expect(parseEs("3,25 %")).toBe(3.25);
    expect(parseEs("")).toBeNull();
    expect(parseEs("abc")).toBeNull();
  });
  it("no muestra «-0» y las métricas no calculables nunca se pintan como cero", () => {
    expect(n(-0.0001)).toBe("0");
    expect(fmtMetric({ key: "x", label: "x", unit: "%", value: null, status: "not_computable" })).toBe("No calculable");
  });
});
