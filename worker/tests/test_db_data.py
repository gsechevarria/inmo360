"""Datos: observaciones con revisiones, anuncios idempotentes, no observados sin retirada falsa, deduplicación
reversible, medios y aislamiento entre usuarios (RLS)."""
import json

import psycopg
import pytest

from inmo_worker.db import WorkerAPI
from inmo_worker.normalize import listing, obs
from inmo_worker.queue import Runner, Outcome

from .conftest import WORKER, OWNER, OTHER, as_user

pytestmark = pytest.mark.db


def claim(enqueue, job_type, source, params=None):
    enqueue(job_type, source, params)
    a = WorkerAPI(WORKER)
    w = a.register("w-data", "h", "t", [])
    return a, a.claim(w, [job_type], 120)


# ------------------------------------------------------------------ observaciones
def test_observations_revisions_censored_and_validation(db, admin, enqueue, clean_queue):
    a, c = claim(enqueue, "stats.test", "ine")
    base = dict(resource="ine.dpop.29005", indicator="pop.padron", geo_level="municipality", geo_code="02001", period="2025",
                period_type="year", ref_date="2025-01-01", captured_at="2026-11-02T00:00:00Z")
    r1 = a.submit_observations(c, [obs(base["resource"], base["indicator"], "municipality", "02001", "2025", "year", raw=760,
                                       ref_date="2025-01-01", captured_at=base["captured_at"])])
    r2 = a.submit_observations(c, [obs(base["resource"], base["indicator"], "municipality", "02001", "2025", "year", raw=760,
                                       ref_date="2025-01-01", captured_at=base["captured_at"])])
    r3 = a.submit_observations(c, [obs(base["resource"], base["indicator"], "municipality", "02001", "2025", "year", raw=761,
                                       ref_date="2025-01-01", captured_at=base["captured_at"])])
    assert (r1["inserted"], r2["unchanged"], r3["revised"]) == (1, 1, 1)
    rows = admin.execute("select value_num, revision, is_current from stats.observations o join geo.geographies g on g.id=o.geography_id "
                         "where g.code='02001' and indicator_code='pop.padron' order by revision").fetchall()
    assert [(float(r["value_num"]), r["revision"], r["is_current"]) for r in rows] == [(760, 1, False), (761, 2, True)]
    # censurado: literal conservado, sin número
    a.submit_observations(c, [obs("ine.dpop.29005", "pop.padron.by_sex", "municipality", "02001", "2025", "year", raw="<5",
                                  dims={"sex": "male"}, captured_at=base["captured_at"])])
    cen = admin.execute("select value_raw, value_num, value_status, dims_key from stats.observations where value_raw='<5'").fetchone()
    assert cen == {"value_raw": "<5", "value_num": None, "value_status": "censored", "dims_key": "sex=male"}
    # territorio inexistente y correspondencia no declarada → rechazadas con incidencia
    bad = a.submit_observations(c, [obs("ine.dpop.29005", "pop.padron", "municipality", "99999", "2025", "year", raw=1, captured_at=base["captured_at"]),
                                    obs("ine.dpop.29005", "inc.gini", "municipality", "02001", "2025", "year", raw=1, captured_at=base["captured_at"])])
    assert bad["rejected"] == 2
    codes = {r["message"].split(" ")[0] for r in admin.execute("select message from ingest.issues where run_id=%s", (c.run_id,)).fetchall()}
    assert {"GEOGRAPHY_NOT_FOUND", "MAPPING_NOT_DECLARED"} <= codes
    # el código con ceros iniciales se guarda como texto
    assert admin.execute("select code from geo.geographies where code='02001'").fetchone()["code"] == "02001"
    a.finish(c, "completed", {}, {}, True)


# ------------------------------------------------------------------ anuncios
def L(ext, price=120000, source="file_import", **kw):
    loc = kw.pop("location", {"municipality_code": "02003", "lat": 38.9943, "lon": -1.8585, "precision": "exact"})
    return listing(source, ext, operation=kw.pop("operation", "sale"), price_amount=price, price_unit=kw.pop("price_unit", "sale_total"),
                   location=loc, built_area_m2=kw.pop("area", 90), rooms=kw.pop("rooms", 3), bathrooms=kw.pop("bathrooms", 2),
                   description=kw.pop("description", "Piso luminoso con terraza en zona centro, reformado, cerca de servicios y transporte. " * 2),
                   agency={"source_agency_id": "ag1", "name": "Agencia 1"}, is_synthetic=True, **kw)


def test_listings_idempotent_price_change_and_not_observed(db, admin, enqueue, clean_queue):
    a, c = claim(enqueue, "listings.file_import", "file_import")
    first = a.submit_listings(c, [L("A1"), L("A2", 99000)])
    again = a.submit_listings(c, [L("A1"), L("A2", 99000)])
    assert (first["new"], again["unchanged"], again["new"]) == (2, 2, 0)
    assert admin.execute("select count(*) n from market.listing_events e join market.listings l on l.id=e.listing_id "
                         "where l.external_id in ('A1','A2') and event_type='new'").fetchone()["n"] == 2
    a.finish(c, "completed", {}, {}, False)
    # Recorrido PARCIAL: A2 no aparece, pero no se marca como no observado
    a, c = claim(enqueue, "listings.file_import", "file_import")
    a.submit_listings(c, [L("A1", 115000)])
    a.finish(c, "partial", {}, {"municipality_codes": ["02003"]}, False)
    st = {r["external_id"]: r["status"] for r in admin.execute("select external_id, status from market.listings where external_id in ('A1','A2')")}
    assert st == {"A1": "active", "A2": "active"}
    ev = admin.execute("select old_value, new_value from market.listing_events e join market.listings l on l.id=e.listing_id "
                       "where l.external_id='A1' and event_type='price_change'").fetchone()
    assert (ev["old_value"]["price"], ev["new_value"]["price"]) == (120000, 115000)
    # Recorrido COMPLETO del ámbito: A2 pasa a no observado (no 'retirado' ni 'vendido')
    a, c = claim(enqueue, "listings.file_import", "file_import")
    a.submit_listings(c, [L("A1", 115000)])
    a.finish(c, "completed", {}, {"municipality_codes": ["02003"], "operations": ["sale"]}, True)
    assert admin.execute("select status from market.listings where external_id='A2'").fetchone()["status"] == "not_observed"
    # Reaparece → evento de reaparición (posible republicación)
    a, c = claim(enqueue, "listings.file_import", "file_import")
    a.submit_listings(c, [L("A2", 99000)])
    a.finish(c, "partial", {}, {}, False)
    assert admin.execute("select count(*) n from market.listing_events e join market.listings l on l.id=e.listing_id "
                         "where l.external_id='A2' and event_type='reappeared'").fetchone()["n"] == 1


def test_cross_source_candidates_and_reversible_merge(db, admin, enqueue, clean_queue):
    a, c = claim(enqueue, "listings.file_import", "file_import")
    a.submit_listings(c, [L("X1", 200000, agency_reference="REF-9")])
    a.finish(c, "completed", {}, {}, False)
    a, c = claim(enqueue, "listings.feed_kyero", "feed")
    r = a.submit_listings(c, [L("feed:X1", 199000, source="feed", agency_reference="REF-9", area=91),
                              # misma dirección/edificio pero distinta superficie y habitaciones → no es candidato
                              L("feed:OTRO", 200000, source="feed", area=60, rooms=1, bathrooms=1, description="Estudio")])
    a.finish(c, "completed", {}, {}, False)
    assert r["match_candidates"] >= 1
    cand = admin.execute("""select mc.* from market.match_candidates mc join market.listings la on la.id = mc.listing_a join market.listings lb on lb.id = mc.listing_b
                            where {la.external_id, lb.external_id} is not null and (la.external_id in ('X1','feed:X1') and lb.external_id in ('X1','feed:X1'))""".replace("{la.external_id, lb.external_id} is not null and ", "")).fetchone()
    assert cand["status"] == "pending" and cand["strong_signals"] >= 2 and "agency_reference" in cand["signals"]
    assert not admin.execute("""select 1 from market.match_candidates mc join market.listings l on l.id in (mc.listing_a, mc.listing_b)
                                where l.external_id = 'feed:OTRO'""").fetchone()
    with psycopg.connect(db, autocommit=True) as u:
        as_user(u, OWNER)
        kept = u.execute("select market.confirm_match(%s)", (cand["id"],)).fetchone()[0]
        n = u.execute("select count(*) from market.property_listings where property_id=%s and unlinked_at is null", (kept,)).fetchone()[0]
        assert n == 2
        u.execute("select market.undo_match(%s, 'prueba')", (cand["id"],))
        n2 = u.execute("select count(*) from market.property_listings where property_id=%s and unlinked_at is null", (kept,)).fetchone()[0]
        assert n2 == 1
        hist = u.execute("select count(*) from market.property_listings where unlink_reason like %s", (f"%candidate:{cand['id']}",)).fetchone()[0]
        assert hist >= 2                                                       # trazabilidad: nada se borra
        as_user(u, OTHER)
        with pytest.raises(psycopg.errors.RaiseException):
            u.execute("select market.confirm_match(%s)", (cand["id"],))          # solo el propietario revisa


def test_media_registration_rules(db, admin, enqueue, clean_queue):
    a, c = claim(enqueue, "listings.file_import", "file_import")
    a.submit_listings(c, [L("M1")])
    r = a.register_media(c, [
        {"listing_external_id": "M1", "status": "available", "storage_key": "media/ab/" + "a" * 64 + ".jpg", "sha256": "a" * 64,
         "byte_size": 10, "mime_type": "image/jpeg"},
        {"listing_external_id": "M1", "status": "available", "storage_key": "C:\\Users\\x\\foto.jpg", "sha256": "b" * 64, "byte_size": 1, "mime_type": "image/jpeg"},
        {"listing_external_id": "M1", "status": "available", "storage_key": "media/x.jpg", "sha256": None, "byte_size": 1, "mime_type": "image/jpeg"},
        {"listing_external_id": "M1", "status": "failed", "error": "HTTP 404"},
    ])
    assert (r["registered"], r["rejected"]) == (2, 2)
    a.finish(c, "completed", {}, {}, False)


# ------------------------------------------------------------------ aislamiento entre usuarios
def test_rls_user_isolation(db, admin):
    with psycopg.connect(db, autocommit=True) as u:
        as_user(u, OWNER)
        u.execute("insert into app.notes(target_type, target_id, body) values ('geography','02003','nota privada del propietario')")
        u.execute("insert into invest.scenarios(name, strategy, inputs, inputs_hash, engine_version) values ('esc', 'rent_long', '{}', 'h', 'v')")
        as_user(u, OTHER)
        assert u.execute("select count(*) from app.notes").fetchone()[0] == 0
        assert u.execute("select count(*) from invest.scenarios").fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            u.execute("insert into app.user_profiles(user_id, role) values (%s, 'owner')", (OTHER,))   # sin auto-ascenso
        u.execute("reset role")
        u.execute("set role anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            u.execute("select count(*) from geo.geographies")                                        # sin acceso anónimo


def test_member_can_read_reference_data_but_not_write(db):
    with psycopg.connect(db, autocommit=True) as u:
        as_user(u, OTHER)
        assert u.execute("select count(*) from catalog.indicators").fetchone()[0] > 100
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            u.execute("update catalog.indicators set name='x'")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            u.execute("insert into market.listings(source_code, external_id, operation, price_unit, first_seen_at, last_seen_at, last_checked_at, content_hash) "
                      "values ('x','y','sale','sale_total',now(),now(),now(),'h')")


def test_offer_stats_from_synthetic_listings_are_marked_synthetic(db, admin, enqueue, clean_queue):
    """Un derivado calculado con anuncios sintéticos hereda la marca «sintético» (la web lo señala)."""
    a, c = claim(enqueue, "listings.file_import", "file_import")
    loc = lambda i: {"municipality_code": "02001", "lat": 39.0 + i / 100, "lon": -1.5 - i / 100, "precision": "exact"}
    a.submit_listings(c, [L(f"S{i}", 100000 + i * 1000, area=80 + i * 3, location=loc(i)) for i in range(6)])
    a.finish(c, "completed", {}, {}, False)
    admin.execute("select market.compute_offer_stats()")
    admin.execute("select stats.refresh_latest()")
    row = admin.execute("""select lv.value_num, lv.is_synthetic from stats.latest_values_mv lv join geo.geographies g on g.id = lv.geography_id
                            where g.code = '02001' and lv.indicator_code = 'mkt.offer_price_sale_m2'""").fetchone()
    assert row["value_num"] is not None and row["is_synthetic"] is True
    with psycopg.connect(db, autocommit=True) as u:
        as_user(u, OTHER)   # miembro: lo ve marcado también en la vista unificada (security_invoker + RLS)
        r = u.execute("""select bool_or(is_synthetic) from stats.current_values v join geo.geographies g on g.id = v.geography_id
                         where g.code = '02001' and v.indicator_code = 'mkt.offer_price_sale_m2'""").fetchone()
        assert r[0] is True


def test_derived_are_latest_snapshot_with_explanations(db, admin, enqueue, clean_queue):
    """Derivados: fórmula correcta, foto del último periodo, explicación cuando no son calculables y poda de periodos viejos."""
    a, c = claim(enqueue, "stats.test", "ine")
    pts = {"2014": 1000, "2019": 1100, "2024": 1210}
    a.submit_observations(c, [obs("ine.dpop.29005", "pop.padron", "municipality", "02003", y, "year", raw=v, ref_date=f"{y}-01-01",
                                  captured_at="2026-11-02T00:00:00Z") for y, v in pts.items()])
    a.finish(c, "completed", {}, {}, True)
    codes = ["demo.pop_growth_1y", "demo.pop_growth_5y", "demo.pop_cagr_10y"]

    def derived():
        rows = admin.execute("""select indicator_code, period, value_num, warnings from stats.derived_observations d
                                  join geo.geographies g on g.id = d.geography_id where g.code = '02003' and indicator_code = any(%s)
                                 order by indicator_code, period""", (codes,)).fetchall()
        return {(r["indicator_code"], r["period"]): (None if r["value_num"] is None else round(float(r["value_num"]), 4), r["warnings"]) for r in rows}

    a, c = claim(enqueue, "stats.derive", "derived")
    a.compute_derived(c, codes)
    a.finish(c, "completed", {}, {}, True)
    d = derived()
    assert d[("demo.pop_growth_5y", "2024")][0] == 10.0                       # 1210 / 1100 − 1
    assert d[("demo.pop_cagr_10y", "2024")][0] == round((1.21 ** 0.1 - 1) * 100, 4)
    assert d[("demo.pop_growth_1y", "2024")] == (None, ["sin dato del año inicial"])   # nunca 0
    assert {k[1] for k in d} == {"2024"}                                      # solo el último periodo

    # Llega 2025: se recalcula y se podan los periodos superados (se conserva el último con valor si el nuevo no lo tiene)
    a, c = claim(enqueue, "stats.test", "ine")
    a.submit_observations(c, [obs("ine.dpop.29005", "pop.padron", "municipality", "02003", "2025", "year", raw=1250,
                                  ref_date="2025-01-01", captured_at="2026-11-02T00:00:00Z")])
    a.finish(c, "completed", {}, {}, True)
    a, c = claim(enqueue, "stats.derive", "derived")
    a.compute_derived(c, codes)
    a.finish(c, "completed", {}, {}, True)
    d = derived()
    assert d[("demo.pop_growth_1y", "2025")][0] == round((1250 / 1210 - 1) * 100, 4)
    assert ("demo.pop_growth_1y", "2024") not in d
    assert d[("demo.pop_growth_5y", "2025")][0] is None and d[("demo.pop_growth_5y", "2024")][0] == 10.0
