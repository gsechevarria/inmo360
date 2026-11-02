"""Conector INE Tempus (API JSON pública: https://servicios.ine.es/wstempus/js/ES/…).

Separado en dos pasos para poder probarlo con respuestas reales capturadas:
  fetch_table()  → JSON tal cual (instantánea registrada con huella)
  parse_series() → observaciones normalizadas según un "preset" de correspondencia declarado en el catálogo
Nunca une territorios por nombre: usa MetaData[...].Codigo.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Iterable

from ..normalize import obs
from ..queue import JobContext, Outcome, SourceBlocked

BASE = "https://servicios.ine.es/wstempus/js/ES"


@dataclass(frozen=True)
class Preset:
    resource_code: str
    geo_variable: str                       # 'Municipios'
    geo_level: str                          # 'municipality'
    # Devuelve (indicator_code, dims) o None si la serie no interesa
    classify: Callable[[dict[str, dict]], tuple[str, dict] | None]
    period_type: str = "year"
    unit_override: str | None = None
    exclude_variables: tuple[str, ...] = ()  # p. ej. ('Distritos','Secciones') para quedarse con municipios
    notes: str | None = None


def _sexo(md: dict[str, dict]) -> tuple[str, dict] | None:
    sx = md.get("Sexo", {}).get("Codigo")
    if sx == "0":
        return "pop.padron", {}
    if sx == "1":
        return "pop.padron.by_sex", {"sex": "male"}
    if sx == "2":
        return "pop.padron.by_sex", {"sex": "female"}
    return None


ADRH_MAP = {
    "Renta neta media por persona": "inc.net_mean_person", "Renta neta media por hogar": "inc.net_mean_household",
    "Media de la renta por unidad de consumo": "inc.mean_consumption_unit",
    "Mediana de la renta por unidad de consumo": "inc.median_consumption_unit",
    "Renta bruta media por persona": "inc.gross_mean_person", "Renta bruta media por hogar": "inc.gross_mean_household",
}

VTE_MAP = {"Viviendas turísticas": "tour.dwellings", "Plazas": "tour.places", "Plazas por vivienda turística": "tour.places_per_dwelling"}

PRESETS: dict[str, Preset] = {
    "padron_municipal_sexo": Preset("ine.dpop.29005", "Municipios", "municipality", _sexo,
                                    notes="Cifras oficiales a 1 de enero"),
    "adrh_renta": Preset("ine.adrh.renta", "Municipios", "municipality",
                         lambda md: (ADRH_MAP[n], {}) if (n := md.get("SALDOS CONTABLES", {}).get("Nombre")) in ADRH_MAP else None,
                         exclude_variables=("Distritos", "Secciones")),
    "vte_municipal": Preset("ine.vte.39363", "Municipios", "municipality",
                            lambda md: (VTE_MAP[n], {}) if (n := md.get("Concepto turístico", {}).get("Nombre")) in VTE_MAP else None,
                            period_type="month"),
}


def meta_index(series: dict) -> dict[str, dict]:
    return {m["T3_Variable"]: m for m in series.get("MetaData", [])}


def period_of(point: dict, period_type: str) -> tuple[str, str | None]:
    fecha = (point.get("Fecha") or "")[:10]
    if period_type == "year":
        return str(point["Anyo"]), fecha or f"{point['Anyo']}-01-01"
    if period_type == "month":
        return fecha[:7], fecha
    return fecha, fecha


def parse_series(series_list: Iterable[dict], preset: Preset, *, captured_at: str, capture_method: str = "worker",
                 snapshot_id: str | None = None) -> tuple[list[dict], list[dict]]:
    """→ (observaciones, incidencias). Las series sin código territorial o sin clasificar se ignoran explícitamente."""
    out, issues = [], []
    for s in series_list:
        md = meta_index(s)
        if any(v in md for v in preset.exclude_variables):
            continue
        geo = md.get(preset.geo_variable)
        if not geo or not geo.get("Codigo"):
            continue
        cls = preset.classify(md)
        if cls is None:
            continue
        indicator, dims = cls
        for p in s.get("Data") or []:
            period, ref = period_of(p, preset.period_type)
            try:
                o = obs(preset.resource_code, indicator, preset.geo_level, geo["Codigo"], period, preset.period_type,
                        raw=p.get("Valor"), tipo=p.get("T3_TipoDato"), secret=bool(p.get("Secreto")), dims=dims,
                        ref_date=ref, unit_raw=preset.unit_override or s.get("T3_Unidad"),
                        scale_raw=(s.get("T3_Escala") or "").strip() or None, captured_at=captured_at,
                        capture_method=capture_method, notes=f"serie {s.get('COD')}")
                if snapshot_id:
                    o["raw_snapshot_id"] = snapshot_id
                out.append(o)
            except ValueError as e:
                issues.append({"code": "PARSE", "message": str(e), "series": s.get("COD")})
        if not s.get("Data"):
            issues.append({"code": "NO_DATA", "message": "serie sin datos en el periodo solicitado", "series": s.get("COD"),
                           "geo": geo["Codigo"]})
    return out, issues


def fetch_table(client, table_id: str, date_range: str | None = None, nult: int | None = None) -> tuple[bytes, str]:
    if not str(table_id).isdigit():
        raise ValueError("table_id debe ser numérico")
    url = f"{BASE}/DATOS_TABLA/{table_id}?tip=AM"
    if date_range:
        url += f"&date={date_range}"
    if nult:
        url += f"&nult={int(nult)}"
    r = client.get(url, robots=False)  # API pública documentada; robots no aplica a la API
    if r.status_code != 200:
        raise SourceBlocked(f"INE respondió {r.status_code} para {url}")
    return r.content, url


def handle(ctx: JobContext, client=None) -> Outcome:
    """Trabajo stats.ine_tempus. params: {preset, tables:[id…], date_range?, nult?}"""
    from ..http import PoliteClient
    p = ctx.claim.params
    preset = PRESETS.get(p.get("preset", ""))
    if preset is None:
        raise ValueError(f"preset desconocido: {p.get('preset')!r}")
    tables = [str(t) for t in p.get("tables", [])]
    done = set(ctx.claim.checkpoints.get("tables_done", []))
    own = client is None
    client = client or PoliteClient(ctx.settings.user_agent, min_interval_s=1.0, check_public=True)
    stats = {"tables": 0, "observations": 0}
    try:
        for t in tables:
            if t in done:
                continue
            ctx.check()
            raw, url = fetch_table(client, t, p.get("date_range"), p.get("nult"))
            now = datetime.now(timezone.utc).isoformat()
            snap = ctx.api.snapshot(ctx.claim, {"resource_code": preset.resource_code, "url": url, "fetched_at": now,
                                                 "http_status": 200, "content_type": "application/json", "byte_size": len(raw),
                                                 "content_sha256": hashlib.sha256(raw).hexdigest(), "storage_provider": "none"})
            observations, issues = parse_series(json.loads(raw), preset, captured_at=now, snapshot_id=snap)
            r = ctx.submit("observations", observations)
            for i in issues[:20]:
                ctx.issue("info", i["code"], i["message"], **{k: v for k, v in i.items() if k not in ("code", "message")})
            stats["tables"] += 1
            stats["observations"] += len(observations)
            for k, v in r.items():
                stats[k] = stats.get(k, 0) + v
            done.add(t)
            ctx.checkpoint("tables_done", sorted(done))
            ctx.set_progress(tables_done=len(done), tables_total=len(tables))
    finally:
        if own:
            client.close()
    return Outcome("completed", stats, {"tables": sorted(done)}, coverage_complete=len(done) == len(tables))
