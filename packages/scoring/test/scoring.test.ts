import { describe, expect, it } from "vitest";
import { buildUniverse, combine, EXPERIMENTAL_PROFILES, percentileOf, ProfileError, scoreSubject, validateProfile,
  type CatalogInfo, type ProfileConfig } from "../src";

const base: ProfileConfig = {
  profileId: "t", name: "Prueba", version: 1, strategy: "rent_long", block: "zone", experimental: true, description: "",
  missingPolicy: "partial_explicit", minCoverage: 0.5,
  universe: { level: "municipality", minPopulation: 1000, description: "municipios ≥ 1.000 hab" }, validFrom: "2026-11-02",
  factors: [
    { id: "a", label: "Crecimiento", source: "indicator", key: "demo.pop_cagr_5y", transform: "percentile", direction: "higher_better", weight: 60 },
    { id: "b", label: "Renta", source: "indicator", key: "inc.net_mean_household", transform: "thresholds", direction: "higher_better", weight: 40,
      thresholds: [{ value: 20000, score: 0 }, { value: 40000, score: 100 }] },
  ],
};
const U = { a: [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7] };

describe("contribuciones y pesos", () => {
  it("la suma de aportaciones es la puntuación y cada factor se explica", () => {
    const r = scoreSubject(base, { a: { value: 3, period: "2025" }, b: { value: 30000, period: "2024" } }, U);
    expect(r.status).toBe("scored");
    expect(r.contributions.reduce((s, c) => s + (c.points ?? 0), 0)).toBeCloseTo(r.score!, 1);
    expect(r.contributions[0]!.score).toBeCloseTo(55, 6);       // percentil de rango medio de 3 en U
    expect(r.contributions[1]!.score).toBeCloseTo(50, 6);
    expect(r.score).toBeCloseTo(0.6 * 55 + 0.4 * 50, 1);
    expect(r.notes.join(" ")).toMatch(/experimental/);
  });
  it("cambiar la versión del perfil cambia la huella de entradas", () => {
    const a = scoreSubject(base, { a: { value: 3 }, b: { value: 30000 } }, U);
    const b = scoreSubject({ ...base, version: 2 }, { a: { value: 3 }, b: { value: 30000 } }, U);
    expect(a.inputsHash).not.toBe(b.inputsHash);
    expect(b.profileVersion).toBe(2);
  });
});

describe("ausencia de datos", () => {
  it("un dato ausente no es cero ni se redistribuye en silencio", () => {
    const r = scoreSubject(base, { a: { value: 3 }, b: { value: null } }, U);
    expect(r.status).toBe("partial");
    expect(r.coverage).toBeCloseTo(0.6, 9);
    expect(r.score).toBeCloseTo(55, 1);
    expect(r.notes.join(" ")).toMatch(/parcial.*60 %/);
    expect(r.contributions[1]!.points).toBeNull();
  });
  it("política de bloqueo y factores imprescindibles", () => {
    expect(scoreSubject({ ...base, missingPolicy: "block" }, { a: { value: 3 }, b: { value: null } }, U).status).toBe("not_scorable");
    const req = { ...base, factors: base.factors.map((f) => (f.id === "b" ? { ...f, required: true } : f)) };
    expect(scoreSubject(req, { a: { value: 3 }, b: { value: null } }, U).status).toBe("not_scorable");
  });
  it("cobertura mínima", () => {
    expect(scoreSubject({ ...base, minCoverage: 0.7 }, { a: { value: 3 }, b: { value: null } }, U).status).toBe("not_scorable");
  });
  it("sin perfil activo: pendiente de configuración", () => {
    expect(scoreSubject(null, {}).status).toBe("pending_configuration");
  });
});

describe("exclusiones", () => {
  const catalog = new Map<string, CatalogInfo>([
    ["demo.pop_cagr_5y", { code: "demo.pop_cagr_5y", isProtected: false, isExcluded: false, scoringRole: "eligible" }],
    ["inc.net_mean_household", { code: "inc.net_mean_household", isProtected: false, isExcluded: false, scoringRole: "eligible" }],
    ["pop.by_nationality", { code: "pop.by_nationality", isProtected: true, isExcluded: false, scoringRole: "excluded_protected" }],
    ["risk.flood", { code: "risk.flood", isProtected: false, isExcluded: true, scoringRole: "excluded_risk" }],
  ]);
  it("rechaza atributos protegidos, dimensiones protegidas y riesgos", () => {
    const bad = (f: Partial<ProfileConfig["factors"][number]>) => validateProfile({ ...base, factors: [{ ...base.factors[0]!, ...f }] }, catalog);
    expect(bad({ key: "pop.by_nationality" }).join(" ")).toMatch(/protegido/);
    expect(bad({ dims: { sex: "female" } }).join(" ")).toMatch(/dimensión protegida/);
    expect(bad({ key: "risk.flood" }).join(" ")).toMatch(/riesgo/);
    expect(() => scoreSubject({ ...base, factors: [{ ...base.factors[0]!, dims: { nationality: "foreign" } }] }, {}, U)).toThrow(ProfileError);
  });
  it("no cuenta dos veces señales correlacionadas", () => {
    const p = { ...base, factors: [{ ...base.factors[0]!, signalGroup: "income" }, { ...base.factors[1]!, signalGroup: "income" }] };
    expect(validateProfile(p).join(" ")).toMatch(/correlacionada/);
  });
});

describe("universo estable", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ population: i < 10 ? 500 : 5000, value: i }));
  it("un filtro de pantalla no altera la nota del mismo municipio", () => {
    const universe = buildUniverse(rows, base.universe!);
    const before = scoreSubject(base, { a: { value: 30 }, b: { value: 30000 } }, { a: universe });
    const screenFiltered = rows.filter((r) => r.value > 40);            // lo que ve el usuario en pantalla
    const universeAgain = buildUniverse(rows, base.universe!);          // el universo NO usa ese filtro
    const after = scoreSubject(base, { a: { value: 30 }, b: { value: 30000 } }, { a: universeAgain });
    expect(screenFiltered.length).toBeLessThan(rows.length);
    expect(after.score).toBe(before.score);
    expect(universe.length).toBe(40);                                   // excluye < 1.000 hab por definición
  });
  it("percentil de rango medio", () => {
    expect(percentileOf([1, 2, 2, 3], 2)).toBeCloseTo(50, 9);
  });
});

describe("global y perfiles experimentales", () => {
  it("la global exige combinación explícita y bloques completos", () => {
    const z = scoreSubject(base, { a: { value: 3 }, b: { value: 30000 } }, U);
    expect(combine({ zone: z }, null).status).toBe("pending_configuration");
    expect(combine({ zone: z }, { weights: { zone: 1, property: 1 }, label: "x" }).status).toBe("not_scorable");
    expect(combine({ zone: z }, { weights: { zone: 1 }, label: "x" }).score).toBe(z.score);
  });
  it("todos los perfiles entregados son experimentales y válidos", () => {
    for (const p of EXPERIMENTAL_PROFILES) {
      expect(p.experimental).toBe(true);
      expect(validateProfile(p)).toEqual([]);
    }
  });
  it("un requisito imprescindible incumplido se informa aunque la nota sea alta", () => {
    const op = EXPERIMENTAL_PROFILES.find((p) => p.block === "operation")!;
    const r = scoreSubject(op, { net_yield: { value: 9 }, coc: { value: 14 } }, {}, { cashflowMonthly: -50 });
    expect(r.score).toBe(100);
    expect(r.requirements[0]!.status).toBe("not_met");
    expect(r.notes.join(" ")).toMatch(/no lo compensa/);
  });
});
