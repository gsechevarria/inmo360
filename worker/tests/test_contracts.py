"""Contrato compartido: lo que el trabajador envía a la base cumple los esquemas generados desde packages/contracts."""
import json
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")

from inmo_worker.connectors.listings import row_to_listing, rows_from_file
from inmo_worker.normalize import listing, obs

GEN = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "generated"
LISTING = json.loads((GEN / "ListingItem.schema.json").read_text(encoding="utf-8"))
OBS = json.loads((GEN / "ObservationItem.schema.json").read_text(encoding="utf-8"))


def test_listing_items_match_contract(tmp_path):
    csv = tmp_path / "a.csv"
    csv.write_text("external_id;operation;price_amount;price_unit;municipality_code;lat;lon;built_area_m2;rooms;has_elevator;condition;agency_name;is_synthetic\n"
                   "X1;sale;120.000;sale_total;02003;38.99;-1.85;90;3;sí;good;Agencia Uno;false\n"
                   "X2;rent;850;rent_month;2003;;;;;;;;\n", encoding="utf-8")
    items = [row_to_listing("file_import", r, "2026-11-02T00:00:00Z") for r in rows_from_file(csv)]
    for it in items:
        jsonschema.validate(it, LISTING)
    assert items[0]["price"]["amount"] == 120000 and items[1]["location"]["municipality_code"] == "02003"
    jsonschema.validate(listing("idealista_api", "9", operation="sale", price_amount=1, price_unit="sale_total",
                                location={"lat": "40.41", "lon": "-3.70", "precision": "zone"}), LISTING)


def test_observation_items_match_contract():
    for raw, tipo in [(175400, "Definitivo"), ("<5", None), (None, None), ("12,5", "Provisional")]:
        jsonschema.validate(obs("ine.dpop.29005", "pop.padron", "municipality", "02003", "2025", "year", raw=raw, tipo=tipo,
                                ref_date="2025-01-01", captured_at="2026-11-02T00:00:00Z"), OBS)
