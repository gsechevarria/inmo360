// Valores canónicos de un inmueble a partir de sus publicaciones y de las correcciones del usuario (función pura).

export const CANON_FIELDS = ["property_type", "built_area_m2", "useful_area_m2", "rooms", "bathrooms", "floor_text", "has_elevator", "has_terrace",
  "has_parking", "condition", "energy_rating", "year_built", "address_text"] as const;

/** Valores canónicos explicables: corrección del usuario > valor más reciente no nulo; discrepancias visibles. */
export function canonical(listings: Record<string, unknown>[], corrections: Record<string, unknown>[]) {
  const out: Record<string, { value: unknown; origin: string; discrepancies: { source: string; value: unknown }[]; correction?: Record<string, unknown> }> = {};
  for (const f of CANON_FIELDS) {
    const corr = corrections.find((c) => c.field === f);
    const vals = listings.filter((l) => l[f] !== null && l[f] !== undefined && l[f] !== "unknown").map((l) => ({ source: `${l.source_code}`, value: l[f] }));
    const distinct = Array.from(new Set(vals.map((v) => JSON.stringify(v.value))));
    out[f] = corr
      ? { value: corr.value, origin: "corrección del usuario", discrepancies: vals, correction: corr }
      : { value: vals[0]?.value ?? null, origin: vals[0] ? `publicación más reciente (${vals[0].source})` : "sin dato", discrepancies: distinct.length > 1 ? vals : [] };
  }
  return out;
}

