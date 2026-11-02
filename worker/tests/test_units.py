"""Pruebas sin base de datos: normalización, parser INE con respuesta real, TopoJSON, almacenamiento, HTTP, conectores."""
import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from inmo_worker.connectors import geo, ine_tempus
from inmo_worker.connectors.listings import extract_jsonld_listing, parse_kyero, row_to_listing
from inmo_worker.http import PoliteClient, UnsafeURL, assert_public_url
from inmo_worker.normalize import ListingInvalid, listing, parse_value
from inmo_worker.queue import RetryableError, SourceBlocked
from inmo_worker.storage import LocalStorage, MigrationItem, StorageError, SupabaseStorage, migrate, validate_key

FIX = Path(__file__).parent / "fixtures"
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000002000000030806000000") + b"\x00" * 40


# ------------------------------------------------------------------ valores
@pytest.mark.parametrize("raw,expected", [
    ("<5", ("<5", None, "censored")), ("..", ("..", None, "not_available")), (None, (None, None, "not_available")),
    ("1.234,5", ("1.234,5", Decimal("1234.5"), "observed")), (0, ("0", Decimal("0"), "observed")),
    ("abc", ("abc", None, "pending_interpretation")),
])
def test_parse_value_keeps_literal_and_never_invents(raw, expected):
    assert parse_value(raw) == expected


def test_secret_and_provisional():
    assert parse_value(None, secret=True)[2] == "suppressed"
    assert parse_value(10, tipo="Provisional")[2] == "provisional"


# ------------------------------------------------------------------ INE (respuesta real capturada)
def test_ine_parser_with_real_response():
    doc = json.loads((FIX / "real/ine_tempus_29005_subset.json").read_text(encoding="utf-8"))
    assert doc["_capture"]["synthetic"] is False
    obs, issues = ine_tempus.parse_series(doc["series"], ine_tempus.PRESETS["padron_municipal_sexo"], captured_at="2026-11-02T00:00:00Z")
    ababuj = [o for o in obs if o["geography_code"] == "44001" and o["period"] == "2025"]
    assert {(o["indicator_code"], json.dumps(o["dims"]), o["value_num"]) for o in ababuj} == {
        ("pop.padron", "{}", "73"), ("pop.padron.by_sex", '{"sex": "male"}', "45"), ("pop.padron.by_sex", '{"sex": "female"}', "28")}
    assert all(o["ref_date"] == "2025-01-01" and o["unit_raw"] == "Personas" for o in ababuj)
    assert any(i["code"] == "NO_DATA" and i["geo"] == "36011" for i in issues)   # Cerdedo: histórico sin datos
    assert all(isinstance(o["geography_code"], str) and len(o["geography_code"]) == 5 for o in obs)


# ------------------------------------------------------------------ TopoJSON
def test_topojson_decoding_and_hierarchy():
    topo = {"type": "Topology", "transform": {"scale": [1, 1], "translate": [0, 0]},
            "arcs": [[[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]],
            "objects": {"autonomous_regions": {"geometries": [{"type": "Polygon", "arcs": [[0]], "id": "08", "properties": {"name": "CLM"}},
                                                              {"type": "Polygon", "arcs": [[0]], "id": "20", "properties": {"name": "Gibraltar"}}]},
                        "provinces": {"geometries": [{"type": "Polygon", "arcs": [[0]], "id": "02", "properties": {"name": "Albacete"}}]},
                        "municipalities": {"geometries": [{"type": "Polygon", "arcs": [[0]], "id": "02003", "properties": {"name": "Albacete"}},
                                                          {"type": "Polygon", "arcs": [[0]], "id": "53001", "properties": {"name": "Condominio"}},
                                                          {"type": "Polygon", "arcs": [[0]], "id": "54006", "properties": {"name": "Gibraltar"}}]}}}
    geos, issues = geo.build_geographies(topo)
    levels = {(g["level"], g["code"]) for g in geos}
    assert ("municipality", "02003") in levels and ("non_municipal_area", "53001") in levels
    assert ("municipality", "54006") not in levels and ("ccaa", "20") not in levels
    m = next(g for g in geos if g["code"] == "02003")
    assert m["parent_code"] == "02"
    ring = json.loads(m["geometry_geojson"])["coordinates"][0][0]
    assert ring[0] == ring[-1] and len(ring) == 5
    assert any(i["code"] == "EXCLUDED" for i in issues)


# ------------------------------------------------------------------ almacenamiento local
def test_local_storage_atomic_dedup_and_validation(tmp_path):
    st = LocalStorage(tmp_path)
    a = st.put_bytes(PNG, "image/png")
    assert a.key.startswith("media/") and not a.deduplicated and (a.width, a.height) == (2, 3)
    assert st.put_bytes(PNG, "image/png").deduplicated
    assert st.verify(a.key, a.sha256)
    assert not list((tmp_path / "tmp").iterdir())                      # sin restos temporales
    with pytest.raises(StorageError):
        st.put_bytes(b"<script>alert(1)</script>", "image/png")         # el tipo real no coincide
    with pytest.raises(StorageError):
        st.put_bytes(b"", "image/png")
    for bad in ["C:\\fotos\\a.jpg", "/etc/passwd", "media/../../x", ""]:
        with pytest.raises(StorageError):
            validate_key(bad)


def test_media_migration_is_resumable_and_verifies(tmp_path):
    src = LocalStorage(tmp_path / "src")
    o = src.put_bytes(PNG, "image/png")
    store: dict[str, bytes] = {}

    def handler(req: httpx.Request):
        key = req.url.path.split("/object/inmo-media/")[1]
        if req.method == "POST":
            store[key] = req.content
            return httpx.Response(200)
        return httpx.Response(200, content=store[key]) if key in store else httpx.Response(404)

    dst = SupabaseStorage("https://x.supabase.co", "test-key", "inmo-media", transport=httpx.MockTransport(handler))
    items = [MigrationItem("m1", o.key, o.sha256, o.mime_type)]
    journal = tmp_path / "journal.jsonl"
    assert migrate(items, src, dst, journal, dry_run=True)["pending"] == 1 and not store
    assert migrate(items, src, dst, journal, dry_run=False)["verified"] == 1
    assert migrate(items, src, dst, journal, dry_run=False)["skipped"] == 1     # reanudación
    assert src.exists(o.key)                                                     # el original no se borra


# ------------------------------------------------------------------ HTTP seguro
@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "http://10.0.0.5/", "http://169.254.169.254/latest", "file:///etc/passwd",
                                 "ftp://example.com/", "https://localhost:8443/"])
def test_ssrf_guard(url):
    with pytest.raises((UnsafeURL, RetryableError)):
        assert_public_url(url)


def test_robots_and_blocked_sources():
    def handler(req: httpx.Request):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /privado\n")
        if req.url.path == "/login":
            return httpx.Response(403)
        return httpx.Response(200, text="ok")
    c = PoliteClient("TestUA", min_interval_s=0, transport=httpx.MockTransport(handler), check_public=False)
    assert c.get("https://agencia.example/anuncios").status_code == 200
    with pytest.raises(SourceBlocked):
        c.get("https://agencia.example/privado/1")
    with pytest.raises(SourceBlocked):
        c.get("https://agencia.example/login")


def test_retry_on_429_then_success(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(429) if calls["n"] < 3 else httpx.Response(200, text="ok")
    c = PoliteClient("TestUA", 0, transport=httpx.MockTransport(handler), check_public=False, respect_robots=False)
    assert c.get("https://api.example/x", robots=False).text == "ok" and calls["n"] == 3


# ------------------------------------------------------------------ anuncios
def test_listing_price_units_are_explicit():
    with pytest.raises(ListingInvalid):
        listing("file_import", "a", operation="sale", price_amount=900, price_unit="rent_month")
    with pytest.raises(ListingInvalid):
        listing("file_import", "a", operation="rent", price_amount=50, price_unit="other")   # 'other' exige nota
    with pytest.raises(ListingInvalid):
        listing("file_import", "a", operation="sale", price_amount=1, price_unit="sale_total", location={"municipality_code": 2003})
    it = listing("file_import", "a", operation="rent", price_amount="45", price_unit="rent_night")
    assert it["price"] == {"amount": 45.0, "unit": "rent_night", "unit_note": None}   # sin multiplicar a mensual


def test_coordinates_are_never_thousands():
    it = row_to_listing("file_import", {"external_id": "c", "operation": "sale", "price_amount": "1", "price_unit": "sale_total",
                                        "lat": "40.4168", "lon": "-3.703"}, "t")
    assert (it["location"]["lat"], it["location"]["lon"]) == (40.4168, -3.703)


def test_csv_row_keeps_leading_zeros():
    it = row_to_listing("file_import", {"external_id": "x1", "operation": "sale", "price_amount": "120.000", "price_unit": "sale_total",
                                        "municipality_code": "2003", "rooms": "3"}, "2026-11-02T00:00:00Z")
    assert it["location"]["municipality_code"] == "02003" and it["price"]["amount"] == 120000.0


def test_jsonld_extraction_sale_and_rent():
    html_sale = (FIX / "agency_sale.html").read_text(encoding="utf-8")
    it = extract_jsonld_listing("https://agencia.example/inmueble/123", html_sale, {"source_agency_id": "agencia-demo", "name": "Agencia Demo"},
                                "agency_web", "2026-11-02T00:00:00Z")
    assert it["operation"] == "sale" and it["price"]["amount"] == 185000.0 and it["rooms"] == 3
    assert it["external_id"] == "agencia-demo:REF-123" and it["extra"]["images"][0].startswith("https://agencia.example/")
    rent = html_sale.replace('"price": "185000"', '"price": "950", "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"')
    r = extract_jsonld_listing("https://agencia.example/inmueble/124", rent, {"source_agency_id": "agencia-demo"}, "agency_web", "t")
    assert r["operation"] == "rent" and r["price"]["unit"] == "rent_month"
    assert extract_jsonld_listing("https://a.example/x", "<html><body>sin datos</body></html>", {"source_agency_id": "a"}, "agency_web", "t") is None


def test_kyero_feed():
    items, errs = parse_kyero((FIX / "kyero_feed.xml").read_bytes(), "feed", {"source_agency_id": "costa"}, "2026-11-02T00:00:00Z")
    assert len(items) == 2 and not errs
    assert {i["price"]["unit"] for i in items} == {"sale_total", "rent_month"}


def test_boolean_flags_from_csv_strings():
    from inmo_worker.normalize import listing
    base = dict(operation="sale", price_amount="100000", price_unit="sale_total", location={"municipality_code": "02003"})
    assert listing("s", "1", is_synthetic="false", **base)["is_synthetic"] is False
    assert listing("s", "2", is_synthetic="true", **base)["is_synthetic"] is True
    assert listing("s", "3", is_synthetic="", **base)["is_synthetic"] is False
    assert listing("s", "4", withdrawn_confirmed="no", **base)["withdrawn_confirmed"] is False
