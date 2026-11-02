"""Conectores de anuncios.

- listings.file_import   CSV/JSON del propietario (contrato en docs/CONECTORES.md). Solo desde <data>/inbox.
- listings.agency_jsonld Webs de agencias con datos estructurados schema.org (JSON-LD). Respeta robots.txt,
                         recorre solo el dominio de la agencia y páginas declaradas (sitemap o URL índice).
- listings.feed_kyero    Feed XML formato Kyero aportado por una agencia.
- listings.idealista_api API oficial de Idealista: requiere credenciales concedidas; sin ellas → fuente bloqueada.
Fotocasa: sin canal autorizado → no hay conector (ver catálogo).
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import etree, html as lhtml

from ..normalize import ListingInvalid, iso_date, listing, to_num, url_hash
from ..queue import JobContext, Outcome, SourceBlocked

# ------------------------------------------------------------------------------------------- archivo
CSV_FIELDS = ["external_id", "url", "operation", "price_amount", "price_unit", "price_unit_note", "property_type", "title",
              "description", "built_area_m2", "useful_area_m2", "rooms", "bathrooms", "floor_text", "has_elevator",
              "has_terrace", "has_parking", "condition", "energy_rating", "year_built", "lat", "lon", "location_precision",
              "address_text", "postal_code", "municipality_code", "published_at_declared", "agency_name", "agency_reference",
              "is_synthetic"]


def _inbox_file(ctx: JobContext, rel: str) -> Path:
    root = ctx.settings.inbox_dir.resolve()
    p = (root / rel).resolve()
    if root not in p.parents or not p.is_file():
        raise ValueError(f"archivo fuera del buzón o inexistente: {rel!r}")
    return p


def rows_from_file(path: Path) -> list[dict]:
    text = path.read_bytes().decode("utf-8-sig")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        return data["listings"] if isinstance(data, dict) else data
    sample = text[:4096]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    return list(csv.DictReader(io.StringIO(text), delimiter=delim))


def row_to_listing(source: str, row: dict, observed_at: str) -> dict:
    loc = {"lat": to_num(row.get("lat")), "lon": to_num(row.get("lon")), "precision": row.get("location_precision") or None,
           "address_text": row.get("address_text") or None, "postal_code": row.get("postal_code") or None,
           "municipality_code": (str(row["municipality_code"]).zfill(5) if row.get("municipality_code") not in (None, "") else None)}
    agency = None
    if row.get("agency_name"):
        agency = {"source_agency_id": re.sub(r"\W+", "-", row["agency_name"].lower()).strip("-"), "name": row["agency_name"],
                  "discovered_via": "file_import"}
    return listing(source, row.get("external_id"), operation=(row.get("operation") or "").strip(),
                   price_amount=row.get("price_amount"), price_unit=(row.get("price_unit") or "").strip(),
                   price_unit_note=row.get("price_unit_note") or None, url=row.get("url") or None, location=loc,
                   agency=agency, observed_at=observed_at,
                   **{k: row.get(k) for k in ("property_type", "title", "description", "built_area_m2", "useful_area_m2", "rooms",
                                              "bathrooms", "floor_text", "has_elevator", "has_terrace", "has_parking", "condition",
                                              "energy_rating", "year_built", "published_at_declared", "agency_reference",
                                              "is_synthetic")})


def handle_file_import(ctx: JobContext) -> Outcome:
    p = ctx.claim.params
    path = _inbox_file(ctx, p["file"])
    source = ctx.claim.source_code
    now = datetime.now(timezone.utc).isoformat()
    good, bad = [], 0
    for n, row in enumerate(rows_from_file(path), 1):
        try:
            good.append(row_to_listing(source, row, now))
        except (ListingInvalid, ValueError, KeyError) as e:
            bad += 1
            if bad <= 50:
                ctx.issue("warning", "ROW_INVALID", f"fila {n}: {e}", row=n)
    stats = ctx.submit("listings", good)
    stats.update(rows=len(good) + bad, invalid_rows=bad)
    # Un archivo es una foto completa de la fuente solo si el propietario lo declara (p. ej. exportación total del feed).
    complete = bool(p.get("complete_snapshot"))
    scope = {"municipality_codes": sorted({g["location"]["municipality_code"] for g in good if g["location"]["municipality_code"]}),
             "operations": sorted({g["operation"] for g in good})} if complete else {}
    return Outcome("completed" if bad == 0 else "partial", stats, scope, coverage_complete=complete and bad == 0)


# ------------------------------------------------------------------------------------------- JSON-LD
RE_TYPES = {"Apartment": "flat", "House": "house", "SingleFamilyResidence": "house", "Residence": "unknown",
            "Accommodation": "unknown", "Room": "room"}


def _jsonld_blocks(doc) -> list[dict]:
    out = []
    for s in doc.xpath('//script[@type="application/ld+json"]/text()'):
        try:
            data = json.loads(s)
        except json.JSONDecodeError:
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            d = stack.pop()
            if isinstance(d, dict):
                if "@graph" in d:
                    stack.extend(d["@graph"])
                out.append(d)
            elif isinstance(d, list):
                stack.extend(d)
    return out


def _types(d: dict) -> set[str]:
    t = d.get("@type")
    return set(t if isinstance(t, list) else [t]) if t else set()


def extract_jsonld_listing(page_url: str, html_text: str, agency: dict, source: str, observed_at: str) -> dict | None:
    """Extrae un anuncio de una ficha con schema.org. Devuelve None si la página no declara una oferta clara."""
    doc = lhtml.fromstring(html_text)
    blocks = _jsonld_blocks(doc)
    offer_holder = next((b for b in blocks if _types(b) & {"RealEstateListing", "Offer", "Product"} or "offers" in b), None)
    place = next((b for b in blocks if _types(b) & set(RE_TYPES)), None)
    if not offer_holder and not place:
        return None
    offers = (offer_holder or {}).get("offers") or ((offer_holder or {}) if "price" in (offer_holder or {}) else None)
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if not isinstance(offers, dict) or offers.get("price") in (None, ""):
        return None
    if (offers.get("priceCurrency") or "EUR").upper() != "EUR":
        return None
    item = place or (offer_holder or {}).get("itemOffered") or {}
    business = (offers.get("businessFunction") or "").lower()
    spec = offers.get("priceSpecification") or {}
    unit_text = (spec.get("unitText") or spec.get("unitCode") or "").upper() if isinstance(spec, dict) else ""
    if "lease" in business or "rent" in business or unit_text in ("MON", "MONTH"):
        operation, unit = "rent", "rent_month" if unit_text in ("MON", "MONTH", "") else "other"
    elif unit_text in ("DAY", "NIGHT"):
        operation, unit = "rent", "rent_night"
    else:
        operation, unit = "sale", "sale_total"
    floor = item.get("floorSize") or {}
    addr = item.get("address") or {}
    geo = item.get("geo") or {}
    ext = str(item.get("identifier") or offers.get("sku") or (offer_holder or {}).get("identifier") or url_hash(page_url)[:24])
    imgs = item.get("image") or (offer_holder or {}).get("image") or []
    imgs = [i.get("url") if isinstance(i, dict) else i for i in (imgs if isinstance(imgs, list) else [imgs])]
    imgs = [urljoin(page_url, i) for i in imgs if isinstance(i, str) and i][:30]
    return listing(source, f"{agency['source_agency_id']}:{ext}", operation=operation, price_amount=offers.get("price"),
                   price_unit=unit, price_unit_note=None if unit != "other" else f"unidad declarada {unit_text!r}",
                   url=page_url, title=(offer_holder or item).get("name"), description=(offer_holder or item).get("description"),
                   property_type=RE_TYPES.get(next(iter(_types(item) & set(RE_TYPES)), ""), "unknown") if item else None,
                   built_area_m2=floor.get("value") if isinstance(floor, dict) else None,
                   rooms=item.get("numberOfRooms") or item.get("numberOfBedrooms"),
                   bathrooms=item.get("numberOfBathroomsTotal"),
                   location={"lat": to_num(geo.get("latitude")), "lon": to_num(geo.get("longitude")),
                             "precision": "street" if geo.get("latitude") else "unknown",
                             "address_text": ", ".join(x for x in [addr.get("streetAddress"), addr.get("addressLocality")] if x) or None,
                             "postal_code": addr.get("postalCode")},
                   published_at_declared=iso_date((offer_holder or {}).get("datePosted")),
                   agency={**agency, "discovered_via": agency.get("discovered_via", "csv_propietario")},
                   agency_reference=str(ext), observed_at=observed_at, image_count=len(imgs) or None,
                   extra={"images": imgs} if imgs else {})


def discover_listing_urls(client, start_url: str, link_pattern: str | None, max_pages: int) -> list[str]:
    """URLs de fichas a partir de un sitemap.xml o de una página índice. Solo mismo dominio."""
    host = urlsplit(start_url).netloc
    r = client.get(start_url)
    if r.status_code != 200:
        return []
    urls: list[str] = []
    if start_url.endswith(".xml") or r.headers.get("content-type", "").startswith(("application/xml", "text/xml")):
        tree = etree.fromstring(r.content)
        urls = [e.text.strip() for e in tree.iter("{*}loc") if e.text]
    else:
        doc = lhtml.fromstring(r.text)
        urls = [urljoin(start_url, h) for h in doc.xpath("//a/@href")]
    pat = re.compile(link_pattern) if link_pattern else None
    seen, out = set(), []
    for u in urls:
        if urlsplit(u).netloc != host or u in seen:
            continue
        if pat and not pat.search(u):
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= max_pages:
            break
    return out


def handle_agency_jsonld(ctx: JobContext, client=None) -> Outcome:
    """params: {agencies:[{source_agency_id,name,website,start_url,link_pattern?}], max_pages_per_agency?}"""
    from ..http import PoliteClient
    p = ctx.claim.params
    own = client is None
    client = client or PoliteClient(ctx.settings.user_agent, ctx.settings.http_min_interval_s)
    done = set(ctx.claim.checkpoints.get("agencies_done", []))
    complete_agencies, stats = [], {"pages": 0, "listings": 0, "no_structured_data": 0}
    try:
        for ag in p.get("agencies", []):
            aid = ag["source_agency_id"]
            if aid in done:
                continue
            ctx.check()
            try:
                urls = discover_listing_urls(client, ag["start_url"], ag.get("link_pattern"), int(p.get("max_pages_per_agency", 200)))
            except SourceBlocked as e:
                ctx.issue("warning", "AGENCY_BLOCKED", str(e), agency=aid)
                done.add(aid); continue
            items, now = [], datetime.now(timezone.utc).isoformat()
            for u in urls:
                ctx.check()
                try:
                    r = client.get(u)
                except SourceBlocked as e:
                    ctx.issue("info", "PAGE_BLOCKED", str(e), url=u); continue
                stats["pages"] += 1
                if r.status_code in (404, 410):
                    continue  # sin otra evidencia no se confirma retirada de un anuncio concreto
                if r.status_code != 200:
                    continue
                try:
                    it = extract_jsonld_listing(u, r.text, {"source_agency_id": aid, "name": ag.get("name", aid),
                                                            "website": ag.get("website")}, ctx.claim.source_code, now)
                except ListingInvalid as e:
                    ctx.issue("info", "LISTING_INVALID", str(e), url=u); it = None
                if it is None:
                    stats["no_structured_data"] += 1
                else:
                    items.append(it)
            r = ctx.submit("listings", items)
            for k, v in r.items():
                stats[k] = stats.get(k, 0) + v
            stats["listings"] += len(items)
            if ctx.settings.download_media:
                from ..storage import LocalStorage
                from .media import download_images
                store = LocalStorage(ctx.settings.media_dir, ctx.settings.max_media_bytes)
                for it in items:
                    m = download_images(ctx, client, store, it["external_id"], it["extra"].get("images", []))
                    for k, v in m.items():
                        stats[f"media_{k}"] = stats.get(f"media_{k}", 0) + v
            if len(urls) < int(p.get("max_pages_per_agency", 200)):
                complete_agencies.append(aid)        # se recorrió todo el índice de la agencia
            done.add(aid)
            ctx.checkpoint("agencies_done", sorted(done))
    finally:
        if own:
            client.close()
    # 'agency_ids' en el ámbito se resuelven en servidor a los UUID de market.agencies
    return Outcome("completed", stats, {"agency_source_ids": complete_agencies}, coverage_complete=bool(complete_agencies))


# ------------------------------------------------------------------------------------------- Kyero
def parse_kyero(xml_bytes: bytes, source: str, agency: dict, observed_at: str) -> tuple[list[dict], list[str]]:
    root = etree.fromstring(xml_bytes)
    out, errs = [], []
    for p in root.iter("property"):
        g = lambda tag: (p.findtext(tag) or "").strip() or None  # noqa: E731
        try:
            freq = (g("price_freq") or "sale").lower()
            operation, unit = ("sale", "sale_total") if freq == "sale" else ("rent", {"month": "rent_month", "week": "other",
                                                                                         "night": "rent_night"}.get(freq, "other"))
            out.append(listing(source, f"{agency['source_agency_id']}:{g('id')}", operation=operation, price_amount=g("price"),
                               price_unit=unit, price_unit_note=None if unit != "other" else f"price_freq={freq}",
                               url=p.findtext("url/es") or p.findtext("url/en"), property_type=g("type"), rooms=g("beds"),
                               bathrooms=g("baths"), built_area_m2=p.findtext("surface_area/built"),
                               description=p.findtext("desc/es") or p.findtext("desc/en"), agency_reference=g("ref"),
                               location={"lat": to_num(p.findtext("location/latitude")), "lon": to_num(p.findtext("location/longitude")),
                                         "precision": "zone", "address_text": g("town")},
                               agency=agency, observed_at=observed_at, has_pool=g("pool"),
                               condition="new" if g("new_build") == "1" else None))
        except ListingInvalid as e:
            errs.append(f"{p.findtext('id')}: {e}")
    return out, errs


def handle_feed_kyero(ctx: JobContext) -> Outcome:
    p = ctx.claim.params
    path = _inbox_file(ctx, p["file"])
    agency = {"source_agency_id": p["agency_id"], "name": p.get("agency_name", p["agency_id"]), "discovered_via": "feed"}
    items, errs = parse_kyero(path.read_bytes(), ctx.claim.source_code, agency, datetime.now(timezone.utc).isoformat())
    for e in errs[:50]:
        ctx.issue("warning", "FEED_ITEM_INVALID", e)
    stats = ctx.submit("listings", items)
    # Un feed completo de una agencia sí permite marcar como no observados sus anuncios ausentes.
    return Outcome("completed", stats, {"agency_source_ids": [p["agency_id"]]}, coverage_complete=bool(p.get("complete_feed")) and not errs)


# ------------------------------------------------------------------------------------------- Idealista
IDEALISTA_TOKEN_URL = "https://api.idealista.com/oauth/token"
IDEALISTA_SEARCH_URL = "https://api.idealista.com/3.5/es/search"


def handle_idealista(ctx: JobContext, client=None) -> Outcome:
    s = ctx.settings
    if not (s.idealista_key and s.idealista_secret):
        raise SourceBlocked("Idealista: faltan IDEALISTA_API_KEY/IDEALISTA_API_SECRET. El acceso requiere alta y credenciales "
                            "concedidas por Idealista; el conector no se activa sin ellas.")
    # Implementación según la documentación pública de la API (OAuth2 client credentials + búsqueda paginada).
    # Pendiente de verificar con credenciales reales: el mapeo de campos se valida en esa primera ejecución.
    import base64
    import httpx
    p = ctx.claim.params
    http = client or httpx.Client(timeout=30)
    tok = http.post(IDEALISTA_TOKEN_URL, data={"grant_type": "client_credentials", "scope": "read"},
                    headers={"Authorization": "Basic " + base64.b64encode(f"{s.idealista_key}:{s.idealista_secret}".encode()).decode()})
    if tok.status_code != 200:
        raise SourceBlocked(f"Idealista OAuth respondió {tok.status_code}")
    token = tok.json()["access_token"]
    page, items, stats = int(ctx.claim.checkpoints.get("page", 1)), [], {"pages": 0}
    now = datetime.now(timezone.utc).isoformat()
    while True:
        ctx.check()
        r = http.post(IDEALISTA_SEARCH_URL, headers={"Authorization": f"Bearer {token}"},
                      data={"country": "es", "operation": p.get("operation", "sale"), "propertyType": p.get("propertyType", "homes"),
                            "center": p["center"], "distance": p.get("distance", 2000), "maxItems": 50, "numPage": page,
                            "locale": "es"})
        if r.status_code != 200:
            raise SourceBlocked(f"Idealista búsqueda respondió {r.status_code}")
        data = r.json()
        for e in data.get("elementList", []):
            try:
                items.append(listing("idealista_api", str(e.get("propertyCode")), operation=data.get("operation", p.get("operation", "sale")),
                                     price_amount=e.get("price"), price_unit="sale_total" if p.get("operation", "sale") == "sale" else "rent_month",
                                     url=e.get("url"), property_type=e.get("propertyType"), built_area_m2=e.get("size"),
                                     rooms=e.get("rooms"), bathrooms=e.get("bathrooms"), floor_text=e.get("floor"),
                                     has_elevator=e.get("hasLift"), location={"lat": e.get("latitude"), "lon": e.get("longitude"),
                                     "precision": "zone" if e.get("showAddress") is False else "street", "address_text": e.get("address")},
                                     observed_at=now, image_count=e.get("numPhotos")))
            except ListingInvalid as ex:
                ctx.issue("info", "LISTING_INVALID", str(ex))
        stats["pages"] += 1
        ctx.checkpoint("page", page + 1)
        if page >= int(data.get("totalPages", page)):
            break
        page += 1
    stats.update(ctx.submit("listings", items))
    return Outcome("completed", stats, {}, coverage_complete=False)
