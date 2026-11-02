// Contratos de datos entre el trabajador (Python), la base de datos (funciones ingest.worker_*) y la web.
// Fuente única: estos esquemas zod. `npm run schemas -w @inmo360/contracts` genera JSON Schema en `generated/`,
// que el trabajador usa en sus pruebas para comprobar que lo que envía cumple el contrato.
import { z } from "zod";

export const ValueStatus = z.enum(["confirmed", "published_unconfirmed", "estimated", "user_input", "unknown", "not_applicable", "confirmed_zero"]);
export const ObservationStatus = z.enum(["observed", "provisional", "revised", "estimated", "censored", "suppressed", "absent",
  "not_applicable", "not_available", "pending_interpretation"]);
export const PriceUnit = z.enum(["sale_total", "rent_month", "rent_room_month", "rent_night", "other"]);
export const LocationPrecision = z.enum(["exact", "street", "zone", "municipality", "unknown"]);
export const PropertyType = z.enum(["flat", "house", "penthouse", "duplex", "studio", "rural_house", "room", "other", "unknown"]);
export const Condition = z.enum(["new", "good", "to_renovate", "unknown"]);
export const IneCode = z.string().regex(/^\d{5}$/, "código INE de municipio: 5 cifras como texto");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const num = z.number().finite();

/** Elemento de `ingest.worker_submit_listings` (lote ≤ 500). Ver worker/inmo_worker/normalize.py::listing. */
export const ListingItem = z.object({
  source_code: z.string().regex(/^[a-z0-9_]{2,60}$/),
  external_id: z.string().min(1).max(200),
  url: z.string().url().nullable().optional(),
  operation: z.enum(["sale", "rent"]),
  price: z.object({ amount: num.nonnegative().nullable(), unit: PriceUnit, unit_note: z.string().nullable().optional() }),
  property_type: PropertyType,
  location: z.object({
    lat: num.min(-90).max(90).nullable(), lon: num.min(-180).max(180).nullable(), precision: LocationPrecision,
    address_text: z.string().nullable().optional(), postal_code: z.string().nullable().optional(), municipality_code: IneCode.nullable().optional(),
  }),
  built_area_m2: num.nonnegative().nullable(), useful_area_m2: num.nonnegative().nullable(), plot_area_m2: num.nonnegative().nullable(),
  rooms: z.number().int().nonnegative().nullable(), bathrooms: z.number().int().nonnegative().nullable(),
  year_built: z.number().int().min(1500).max(2100).nullable(), image_count: z.number().int().nonnegative().nullable(),
  has_elevator: z.boolean().nullable(), has_terrace: z.boolean().nullable(), has_parking: z.boolean().nullable(),
  has_storage: z.boolean().nullable(), has_pool: z.boolean().nullable(), has_ac: z.boolean().nullable(),
  title: z.string().nullable(), description: z.string().nullable(), floor_text: z.string().nullable(), condition: Condition.nullable(),
  energy_rating: z.string().nullable(), agency_reference: z.string().nullable(), published_at_declared: z.string().nullable(),
  observed_at: z.string().nullable(), withdrawal_evidence: z.string().nullable(),
  withdrawn_confirmed: z.boolean(), is_synthetic: z.boolean(),
  agency: z.object({ source_agency_id: z.string().min(1), name: z.string().min(1), website: z.string().optional(), discovered_via: z.string().optional() }).nullable().optional(),
  extra: z.record(z.string(), z.unknown()),
}).superRefine((x, ctx) => {
  if (x.operation === "sale" && !["sale_total", "other"].includes(x.price.unit)) ctx.addIssue({ code: "custom", message: "venta con unidad de alquiler" });
  if (x.operation === "rent" && x.price.unit === "sale_total") ctx.addIssue({ code: "custom", message: "alquiler con unidad de venta" });
  if (x.price.unit === "other" && !x.price.unit_note) ctx.addIssue({ code: "custom", message: "unidad «other» sin nota" });
});
export type ListingItem = z.infer<typeof ListingItem>;

/** Elemento de `ingest.worker_submit_observations` (lote ≤ 5.000). Ver normalize.py::obs. */
export const ObservationItem = z.object({
  resource_code: z.string().min(3), indicator_code: z.string().min(3),
  geography_level: z.enum(["country", "ccaa", "province", "island", "comarca", "municipality", "district", "census_section", "non_municipal_area", "other"]),
  geography_code: z.string().regex(/^[0-9A-Za-z._-]+$/),
  period: z.string().min(4), period_type: z.enum(["year", "quarter", "month", "date", "range", "census"]),
  period_start: isoDate.nullable(), period_end: isoDate.nullable(), ref_date: isoDate.nullable(), published_at: isoDate.nullable(),
  captured_at: z.string().min(10),
  dims: z.record(z.string(), z.string()),
  value_raw: z.string().nullable(), value_num: z.string().regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/).nullable(), value_status: ObservationStatus,
  unit_raw: z.string().nullable(), scale_raw: z.string().nullable(), notes: z.string().max(300).nullable(),
  capture_method: z.enum(["worker", "browser_capture", "manual_upload", "fixture"]), is_synthetic: z.boolean(),
}).superRefine((x, ctx) => {
  // Desconocido nunca es cero: sin número, el estado debe explicarlo
  if (x.value_num === null && ["observed", "provisional", "revised", "estimated"].includes(x.value_status))
    ctx.addIssue({ code: "custom", message: "estado numérico sin valor" });
  for (const k of Object.keys(x.dims)) if (!/^[a-z_]+$/.test(k)) ctx.addIssue({ code: "custom", message: `dimensión no normalizada ${k}` });
});
export type ObservationItem = z.infer<typeof ObservationItem>;

export const SCHEMAS = { ListingItem, ObservationItem } as const;
