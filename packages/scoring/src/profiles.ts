import type { ProfileConfig } from "./index";

/**
 * Perfiles iniciales PROPUESTOS y EXPERIMENTALES. No son modelos validados.
 * El propietario debe seleccionarlos explícitamente en Configuración → Scoring.
 * Ninguno usa riesgos ni atributos personales protegidos; las señales correlacionadas comparten signalGroup.
 */
const UNIVERSE = { level: "municipality" as const, minPopulation: 1000,
                   description: "Municipios vigentes con al menos 1.000 habitantes (padrón más reciente); fijo, no depende de los filtros de pantalla" };
const VALID = "2026-11-02";

const zone = (strategy: ProfileConfig["strategy"], name: string, factors: ProfileConfig["factors"], description: string): ProfileConfig => ({
  profileId: `zone.${strategy}.v1`, name, version: 1, strategy, block: "zone", experimental: true, description,
  missingPolicy: "partial_explicit", minCoverage: 0.6, universe: UNIVERSE, factors, validFrom: VALID,
});

export const EXPERIMENTAL_PROFILES: ProfileConfig[] = [
  zone("rent_long", "Zona · alquiler de vivienda completa (experimental)", [
    { id: "growth", label: "Crecimiento de población a 5 años (anual compuesto)", source: "indicator", key: "demo.pop_cagr_5y",
      transform: "percentile", direction: "higher_better", weight: 30, signalGroup: "demand_growth",
      rationale: "Aproxima la evolución de la demanda residencial; no es demanda de una vivienda concreta." },
    { id: "income", label: "Renta neta media por hogar", source: "indicator", key: "inc.net_mean_household",
      transform: "percentile", direction: "higher_better", weight: 25, signalGroup: "income",
      rationale: "Capacidad de pago agregada; se usa una sola medida de renta para no contarla dos veces." },
    { id: "size", label: "Tamaño del mercado (población)", source: "indicator", key: "pop.padron",
      transform: "thresholds", direction: "higher_better", weight: 15,
      thresholds: [{ value: 1000, score: 10 }, { value: 10000, score: 50 }, { value: 50000, score: 80 }, { value: 200000, score: 100 }],
      rationale: "Más población = mercado de alquiler más profundo (con rendimientos decrecientes)." },
    { id: "rent_effort", label: "Esfuerzo de alquiler", source: "indicator", key: "der.rent_effort",
      transform: "target_band", direction: "target", weight: 30, target: { low: 20, high: 35, falloff: 25 },
      rationale: "Ni un esfuerzo muy alto (riesgo de impago no se puntúa; se usa como asequibilidad) ni muy bajo (rentas deprimidas)." },
  ], "Prioriza dinámica demográfica, renta de los hogares y asequibilidad. Experimental."),
  zone("rooms", "Zona · alquiler por habitaciones (experimental)", [
    { id: "growth", label: "Crecimiento de población a 5 años", source: "indicator", key: "demo.pop_cagr_5y", transform: "percentile",
      direction: "higher_better", weight: 30, signalGroup: "demand_growth" },
    { id: "size", label: "Tamaño del mercado (población)", source: "indicator", key: "pop.padron", transform: "thresholds",
      direction: "higher_better", weight: 35, thresholds: [{ value: 5000, score: 0 }, { value: 30000, score: 50 }, { value: 150000, score: 90 }, { value: 500000, score: 100 }] },
    { id: "students", label: "Estudiantes residentes", source: "indicator", key: "edu.students_resident", transform: "percentile",
      direction: "higher_better", weight: 20, rationale: "Proxy de demanda de habitaciones; pendiente de importar (censo)." },
    { id: "income", label: "Renta neta media por persona", source: "indicator", key: "inc.net_mean_person", transform: "percentile",
      direction: "higher_better", weight: 15, signalGroup: "income" },
  ], "Mercados grandes y dinámicos con demanda de habitaciones. Experimental."),
  zone("tourist", "Zona · alquiler turístico (experimental)", [
    { id: "tourism_weight", label: "Porcentaje de viviendas turísticas", source: "indicator", key: "tour.dwellings_share", transform: "target_band",
      direction: "target", weight: 40, target: { low: 2, high: 10, falloff: 15 },
      rationale: "Actividad turística acreditada sin saturación extrema. Universo INE VTE (plataformas)." },
    { id: "size", label: "Tamaño del mercado (población)", source: "indicator", key: "pop.padron", transform: "thresholds",
      direction: "higher_better", weight: 20, thresholds: [{ value: 2000, score: 20 }, { value: 20000, score: 70 }, { value: 100000, score: 100 }] },
    { id: "growth", label: "Crecimiento de población a 5 años", source: "indicator", key: "demo.pop_cagr_5y", transform: "percentile",
      direction: "higher_better", weight: 20, signalGroup: "demand_growth" },
    { id: "income", label: "Renta neta media por hogar", source: "indicator", key: "inc.net_mean_household", transform: "percentile",
      direction: "higher_better", weight: 20, signalGroup: "income" },
  ], "La normativa turística (registro, licencias) se documenta en la ficha; no puntúa. Experimental."),
  zone("resale", "Zona · comprar para revender (experimental)", [
    { id: "growth", label: "Crecimiento de población a 10 años", source: "indicator", key: "demo.pop_cagr_10y", transform: "percentile",
      direction: "higher_better", weight: 35, signalGroup: "demand_growth" },
    { id: "income", label: "Renta neta media por hogar", source: "indicator", key: "inc.net_mean_household", transform: "percentile",
      direction: "higher_better", weight: 35, signalGroup: "income" },
    { id: "size", label: "Tamaño del mercado (población)", source: "indicator", key: "pop.padron", transform: "thresholds",
      direction: "higher_better", weight: 30, thresholds: [{ value: 5000, score: 20 }, { value: 50000, score: 70 }, { value: 250000, score: 100 }] },
  ], "Liquidez del mercado y capacidad de compra. No proyecta revalorización. Experimental."),
  zone("temporary", "Zona · alquiler temporal (experimental)", [
    { id: "size", label: "Tamaño del mercado (población)", source: "indicator", key: "pop.padron", transform: "thresholds",
      direction: "higher_better", weight: 40, thresholds: [{ value: 20000, score: 20 }, { value: 100000, score: 70 }, { value: 500000, score: 100 }] },
    { id: "growth", label: "Crecimiento de población a 5 años", source: "indicator", key: "demo.pop_cagr_5y", transform: "percentile",
      direction: "higher_better", weight: 30, signalGroup: "demand_growth" },
    { id: "income", label: "Renta neta media por persona", source: "indicator", key: "inc.net_mean_person", transform: "percentile",
      direction: "higher_better", weight: 30, signalGroup: "income" },
  ], "Mercados con movilidad laboral y de estudios. Experimental."),
  {
    profileId: "property.any.v1", name: "Vivienda · características observables (experimental)", version: 1, strategy: "any", block: "property",
    experimental: true, description: "Adecuación del inmueble al uso. Estado actual distinto del estado tras reforma.",
    missingPolicy: "partial_explicit", minCoverage: 0.5, validFrom: VALID, factors: [
      { id: "area_per_room", label: "Superficie por habitación", source: "attribute", key: "area_per_room", transform: "target_band",
        direction: "target", weight: 25, target: { low: 18, high: 30, falloff: 15 } },
      { id: "bathrooms_ratio", label: "Baños por habitación", source: "attribute", key: "bathrooms_per_room", transform: "thresholds",
        direction: "higher_better", weight: 20, thresholds: [{ value: 0.25, score: 20 }, { value: 0.5, score: 70 }, { value: 1, score: 100 }] },
      { id: "elevator", label: "Ascensor", source: "attribute", key: "has_elevator", transform: "boolean", direction: "higher_better", weight: 15 },
      { id: "condition", label: "Estado actual", source: "attribute", key: "condition_score", transform: "thresholds", direction: "higher_better",
        weight: 25, thresholds: [{ value: 0, score: 20 }, { value: 1, score: 60 }, { value: 2, score: 100 }],
        rationale: "0 = a reformar, 1 = buen estado, 2 = nuevo. El estado tras reforma se evalúa en la operación." },
      { id: "terrace", label: "Terraza", source: "attribute", key: "has_terrace", transform: "boolean", direction: "higher_better", weight: 15 },
    ],
  },
  {
    profileId: "operation.rent_long.v1", name: "Operación · alquiler (experimental)", version: 1, strategy: "rent_long", block: "operation",
    experimental: true, description: "Separa resultado sin financiación (activo) y resultado financiado del inversor.",
    missingPolicy: "block", validFrom: VALID,
    factors: [
      { id: "net_yield", label: "Rentabilidad neta operativa", source: "metric", key: "netOperatingYield", transform: "thresholds",
        direction: "higher_better", weight: 50, subBlock: "unlevered", signalGroup: "yield",
        thresholds: [{ value: 2, score: 0 }, { value: 4, score: 40 }, { value: 6, score: 80 }, { value: 8, score: 100 }] },
      { id: "coc", label: "Cash-on-cash", source: "metric", key: "cashOnCash", transform: "thresholds", direction: "higher_better",
        weight: 50, subBlock: "levered", thresholds: [{ value: 0, score: 0 }, { value: 4, score: 50 }, { value: 8, score: 85 }, { value: 12, score: 100 }] },
    ],
    requirements: [{ id: "cf", label: "Flujo de caja mensual no negativo", metric: "cashflowMonthly", op: ">=", value: 0 }],
  },
];
