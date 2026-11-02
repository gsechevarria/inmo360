"""Normalización de valores estadísticos y de anuncios. Conserva SIEMPRE el literal original."""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

# --------------------------------------------------------------------------- estadísticas

CENSORED = re.compile(r"^\s*([<>]=?)\s*([\d.,]+)\s*$")


def parse_es_number(s: str) -> Decimal | None:
    """'1.234,5' → 1234.5 ; '1234.5' → 1234.5 ; '12' → 12. No adivina miles ambiguos sin coma."""
    t = s.strip().replace(" ", "").replace(" ", "")
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+", t):
        # Formato español con separador de miles (p. ej. '120.000'): convención documentada en CONECTORES.md
        t = t.replace(".", "")
    try:
        return Decimal(t)
    except InvalidOperation:
        return None


def parse_value(raw, tipo: str | None = None, secret: bool = False) -> tuple[str | None, Decimal | None, str]:
    """Devuelve (literal, número, estado). Nunca convierte '<5' en 0 ni en 2,5."""
    tipo_l = (tipo or "").lower()
    status_ok = "provisional" if tipo_l.startswith(("prov", "avance")) else "estimated" if tipo_l.startswith("estim") else "observed"
    if raw is None or (isinstance(raw, str) and raw.strip() in ("", "..", "-", "—")):
        return (None if raw is None else str(raw)), None, ("suppressed" if secret else "not_available")
    if isinstance(raw, (int, float, Decimal)) and not isinstance(raw, bool):
        return str(raw), Decimal(str(raw)), status_ok
    s = str(raw)
    if CENSORED.match(s):
        return s, None, "censored"
    n = parse_es_number(s)
    if n is None:
        return s, None, "pending_interpretation"
    return s, n, status_ok


def obs(resource: str, indicator: str, geo_level: str, geo_code: str, period: str, period_type: str, *, raw,
        tipo: str | None = None, secret: bool = False, dims: dict | None = None, ref_date: str | None = None,
        period_start: str | None = None, period_end: str | None = None, unit_raw: str | None = None,
        scale_raw: str | None = None, captured_at: str | None = None, capture_method: str = "worker",
        notes: str | None = None, published_at: str | None = None, synthetic: bool = False) -> dict:
    if not re.fullmatch(r"[0-9A-Za-z._-]+", geo_code or ""):
        raise ValueError(f"código territorial no válido: {geo_code!r}")
    literal, num, status = parse_value(raw, tipo, secret)
    return {
        "resource_code": resource, "indicator_code": indicator, "geography_level": geo_level, "geography_code": str(geo_code),
        "period": period, "period_type": period_type, "period_start": period_start, "period_end": period_end,
        "ref_date": ref_date, "published_at": published_at,
        "captured_at": captured_at or datetime.now(timezone.utc).isoformat(), "dims": dims or {},
        "value_raw": literal, "value_num": str(num) if num is not None else None, "value_status": status,
        "unit_raw": unit_raw, "scale_raw": scale_raw, "notes": notes, "capture_method": capture_method,
        "is_synthetic": synthetic,
    }


# --------------------------------------------------------------------------- anuncios

PRICE_UNITS = {"sale_total", "rent_month", "rent_room_month", "rent_night", "other"}
PROPERTY_TYPES = {
    "piso": "flat", "apartamento": "flat", "flat": "flat", "apartment": "flat", "casa": "house", "chalet": "house",
    "unifamiliar": "house", "adosado": "house", "house": "house", "villa": "house", "atico": "penthouse", "ático": "penthouse",
    "penthouse": "penthouse", "duplex": "duplex", "dúplex": "duplex", "estudio": "studio", "studio": "studio", "loft": "studio",
    "casa rural": "rural_house", "finca": "rural_house", "cortijo": "rural_house", "habitacion": "room", "habitación": "room",
    "room": "room",
}


class ListingInvalid(ValueError):
    pass


def norm_property_type(v: str | None) -> str:
    if not v:
        return "unknown"
    k = v.strip().lower()
    return PROPERTY_TYPES.get(k, next((t for w, t in PROPERTY_TYPES.items() if w in k), "other"))


def to_int(v) -> int | None:
    if v in (None, ""):
        return None
    try:
        return int(Decimal(str(v).replace(",", ".")))
    except (InvalidOperation, ValueError):
        return None


def to_num(v) -> float | None:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    n = parse_es_number(str(v))
    return float(n) if n is not None else None


def to_coord(v) -> float | None:
    """Coordenadas: punto o coma decimal, NUNCA separador de miles ('-3.703' es -3,703 grados)."""
    if v in (None, ""):
        return None
    try:
        x = float(str(v).strip().replace(",", "."))
    except ValueError:
        return None
    return x if -180 <= x <= 180 else None


def to_bool(v) -> bool | None:
    if v in (None, ""):
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    return True if s in {"1", "true", "si", "sí", "yes", "y"} else False if s in {"0", "false", "no", "n"} else None


def listing(source_code: str, external_id: str, *, operation: str, price_amount, price_unit: str, url: str | None = None,
            price_unit_note: str | None = None, **f) -> dict:
    """Construye el contrato de anuncio de ingest.worker_submit_listings y valida unidades de precio.

    No deduce un precio total multiplicando unidades ambiguas: si la unidad no es clara → 'other' + nota.
    """
    if not external_id:
        raise ListingInvalid("sin identificador externo")
    if operation not in ("sale", "rent"):
        raise ListingInvalid(f"operación desconocida {operation!r}")
    if price_unit not in PRICE_UNITS:
        raise ListingInvalid(f"unidad de precio desconocida {price_unit!r}")
    if operation == "sale" and price_unit not in ("sale_total", "other"):
        raise ListingInvalid("venta con unidad de alquiler")
    if operation == "rent" and price_unit == "sale_total":
        raise ListingInvalid("alquiler con unidad de venta")
    amount = to_num(price_amount)
    if amount is not None and amount < 0:
        raise ListingInvalid("precio negativo")
    if price_unit == "other" and not price_unit_note:
        raise ListingInvalid("unidad 'other' requiere nota explicativa")
    loc = f.pop("location", None) or {}
    muni = loc.get("municipality_code")
    if muni is not None and not re.fullmatch(r"\d{5}", str(muni)):
        raise ListingInvalid(f"código de municipio no válido {muni!r} (debe ser texto de 5 cifras)")
    item = {
        "source_code": source_code, "external_id": str(external_id), "url": url, "operation": operation,
        "price": {"amount": amount, "unit": price_unit, "unit_note": price_unit_note},
        "property_type": norm_property_type(f.pop("property_type", None)),
        "location": {k: loc.get(k) for k in ("lat", "lon", "precision", "address_text", "postal_code", "municipality_code")},
    }
    item["location"]["lat"], item["location"]["lon"] = to_coord(loc.get("lat")), to_coord(loc.get("lon"))
    if item["location"]["lat"] is not None and not -90 <= item["location"]["lat"] <= 90:
        raise ListingInvalid("latitud fuera de rango")
    item["location"]["precision"] = loc.get("precision") or ("exact" if item["location"]["lat"] is not None else "unknown")
    for k in ("built_area_m2", "useful_area_m2", "plot_area_m2"):
        item[k] = to_num(f.pop(k, None))
    for k in ("rooms", "bathrooms", "year_built", "image_count"):
        item[k] = to_int(f.pop(k, None))
    for k in ("has_elevator", "has_terrace", "has_parking", "has_storage", "has_pool", "has_ac"):
        item[k] = to_bool(f.pop(k, None))
    for k in ("title", "description", "floor_text", "condition", "energy_rating", "agency_reference", "published_at_declared",
              "observed_at", "withdrawal_evidence"):
        v = f.pop(k, None)
        item[k] = str(v) if v not in (None, "") else None
    if item["condition"] not in (None, "new", "good", "to_renovate", "unknown"):
        item["condition"] = "unknown"
    # Desde CSV llegan cadenas: «false» NO es verdadero (bool("false") lo sería)
    item["withdrawn_confirmed"] = bool(to_bool(f.pop("withdrawn_confirmed", False)))
    item["is_synthetic"] = bool(to_bool(f.pop("is_synthetic", False)))
    if "agency" in f:
        item["agency"] = f.pop("agency")
    item["extra"] = f.pop("extra", {}) or {}
    if f:
        item["extra"]["unmapped"] = {k: str(v)[:200] for k, v in f.items()}
    return item


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def iso_date(v) -> str | None:
    if v in (None, ""):
        return None
    if isinstance(v, (date, datetime)):
        return v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None
