import { describe, expect, it } from "vitest";
import { ListingItem, ObservationItem } from "../src";

const listing = {
  source_code: "file_import", external_id: "A1", url: null, operation: "sale", price: { amount: 120000, unit: "sale_total", unit_note: null },
  property_type: "flat", location: { lat: 38.99, lon: -1.85, precision: "exact", address_text: null, postal_code: null, municipality_code: "02003" },
  built_area_m2: 90, useful_area_m2: null, plot_area_m2: null, rooms: 3, bathrooms: 2, year_built: null, image_count: null,
  has_elevator: true, has_terrace: null, has_parking: null, has_storage: null, has_pool: null, has_ac: null,
  title: null, description: null, floor_text: null, condition: "good", energy_rating: null, agency_reference: null, published_at_declared: null,
  observed_at: null, withdrawal_evidence: null, withdrawn_confirmed: false, is_synthetic: false, extra: {},
};
const observation = {
  resource_code: "ine.dpop.29005", indicator_code: "pop.padron", geography_level: "municipality", geography_code: "02003", period: "2025",
  period_type: "year", period_start: null, period_end: null, ref_date: "2025-01-01", published_at: null, captured_at: "2026-11-02T00:00:00Z",
  dims: {}, value_raw: "175400", value_num: "175400", value_status: "observed", unit_raw: "Personas", scale_raw: null, notes: "serie DPOP1",
  capture_method: "worker", is_synthetic: false,
};

describe("contratos", () => {
  it("acepta un anuncio y una observación válidos", () => {
    expect(ListingItem.safeParse(listing).success).toBe(true);
    expect(ObservationItem.safeParse(observation).success).toBe(true);
  });
  it("rechaza unidades de precio incoherentes y códigos INE numéricos", () => {
    expect(ListingItem.safeParse({ ...listing, price: { amount: 900, unit: "rent_month" } }).success).toBe(false);
    expect(ListingItem.safeParse({ ...listing, location: { ...listing.location, municipality_code: 2003 } }).success).toBe(false);
    expect(ListingItem.safeParse({ ...listing, price: { amount: 1, unit: "other", unit_note: null } }).success).toBe(false);
  });
  it("una observación sin número debe declarar por qué (nunca cero implícito)", () => {
    expect(ObservationItem.safeParse({ ...observation, value_num: null }).success).toBe(false);
    expect(ObservationItem.safeParse({ ...observation, value_raw: "<5", value_num: null, value_status: "censored" }).success).toBe(true);
  });
});
