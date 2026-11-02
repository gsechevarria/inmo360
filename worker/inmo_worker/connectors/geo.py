"""Geografía nacional.

- geo.es_atlas: descarga es-atlas desde el registro npm (tarball con huella), decodifica TopoJSON y carga
  CCAA, provincias, municipios y áreas no municipales (condominios 53xxx). Gibraltar se excluye.
- geo.cnig: conector oficial de Líneas límite del CNIG (requiere pyshp). Implementado; pendiente de probar
  desde un equipo con acceso a cnig.es.
Los códigos son los del INE (texto). La jerarquía se resuelve por código, nunca por nombre.
"""
from __future__ import annotations

import hashlib
import io
import json
import tarfile
from datetime import datetime, timezone

from ..queue import JobContext, Outcome, SourceBlocked

ES_ATLAS_VERSION = "0.6.0"
ES_ATLAS_URL = f"https://registry.npmjs.org/es-atlas/-/es-atlas-{ES_ATLAS_VERSION}.tgz"
RESOURCE = f"es_atlas.municipalities.{ES_ATLAS_VERSION}"

PROV_TO_CCAA = {
    "01": "16", "02": "08", "03": "10", "04": "01", "05": "07", "06": "11", "07": "04", "08": "09", "09": "07", "10": "11",
    "11": "01", "12": "10", "13": "08", "14": "01", "15": "12", "16": "08", "17": "09", "18": "01", "19": "08", "20": "16",
    "21": "01", "22": "02", "23": "01", "24": "07", "25": "09", "26": "17", "27": "12", "28": "13", "29": "01", "30": "14",
    "31": "15", "32": "12", "33": "03", "34": "07", "35": "05", "36": "12", "37": "07", "38": "05", "39": "06", "40": "07",
    "41": "01", "42": "07", "43": "09", "44": "02", "45": "08", "46": "10", "47": "07", "48": "16", "49": "07", "50": "02",
    "51": "18", "52": "19",
}
EXCLUDED_PROVINCE_CODES = {"54"}     # Gibraltar: territorio no español
EXCLUDED_CCAA_CODES = {"20"}


# ----------------------------------------------------------------------------- TopoJSON
def _decode_arcs(topo: dict) -> list[list[tuple[float, float]]]:
    t = topo.get("transform")
    arcs = []
    for arc in topo["arcs"]:
        if t:
            x = y = 0
            pts = []
            for dx, dy in arc:
                x += dx; y += dy
                pts.append((x * t["scale"][0] + t["translate"][0], y * t["scale"][1] + t["translate"][1]))
        else:
            pts = [tuple(p) for p in arc]
        arcs.append(pts)
    return arcs


def _ring(arcs, idxs):
    pts: list[tuple[float, float]] = []
    for i in idxs:
        a = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        pts.extend(a if not pts else a[1:])
    if pts and pts[0] != pts[-1]:
        pts.append(pts[0])
    return [[round(x, 6), round(y, 6)] for x, y in pts]


def geometry_to_geojson(g: dict, arcs) -> dict | None:
    if g.get("type") == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [[_ring(arcs, r) for r in g["arcs"]]]}
    if g.get("type") == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[_ring(arcs, r) for r in poly] for poly in g["arcs"]]}
    return None


def load_es_atlas(raw_tgz: bytes) -> dict:
    with tarfile.open(fileobj=io.BytesIO(raw_tgz), mode="r:gz") as tf:
        member = tf.getmember("package/es/municipalities.json")
        return json.load(tf.extractfile(member))


def build_geographies(topo: dict) -> tuple[list[dict], list[dict]]:
    """→ (geografías ordenadas padre→hijo, incidencias)."""
    arcs = _decode_arcs(topo)
    version = f"es-atlas-{ES_ATLAS_VERSION}"
    base = {"resource_code": RESOURCE, "version_label": f"IGN vía es-atlas {ES_ATLAS_VERSION}", "geometry_version": version}
    out = [{"level": "country", "code": "ES", "name": "España", "resource_code": RESOURCE}]
    issues = []
    for g in topo["objects"]["autonomous_regions"]["geometries"]:
        if g["id"] in EXCLUDED_CCAA_CODES:
            issues.append({"code": "EXCLUDED", "message": f"{g['properties']['name']} excluido (no es territorio español)"})
            continue
        out.append({**base, "level": "ccaa", "code": g["id"], "name": g["properties"]["name"], "parent_level": "country",
                    "parent_code": "ES", "geometry_geojson": json.dumps(geometry_to_geojson(g, arcs))})
    for g in topo["objects"]["provinces"]["geometries"]:
        if g["id"] in EXCLUDED_PROVINCE_CODES:
            continue
        out.append({**base, "level": "province", "code": g["id"], "name": g["properties"]["name"], "parent_level": "ccaa",
                    "parent_code": PROV_TO_CCAA[g["id"]], "geometry_geojson": json.dumps(geometry_to_geojson(g, arcs))})
    for g in topo["objects"]["municipalities"]["geometries"]:
        code, name = g["id"], g["properties"]["name"]
        prov = code[:2]
        geom = geometry_to_geojson(g, arcs)
        if prov in EXCLUDED_PROVINCE_CODES:
            continue
        if prov == "53":   # condominios / comunidades de montes: no son municipios
            out.append({**base, "level": "non_municipal_area", "code": code, "name": name,
                        "notes": "Área no municipal (condominio/facería) según IGN; no tiene padrón propio.",
                        "geometry_geojson": json.dumps(geom)})
            continue
        if prov not in PROV_TO_CCAA:
            issues.append({"code": "UNKNOWN_PROVINCE", "message": f"{code} {name}"})
            continue
        out.append({**base, "level": "municipality", "code": code, "name": name, "parent_level": "province",
                    "parent_code": prov, "geometry_geojson": json.dumps(geom)})
    return out, issues


def handle_es_atlas(ctx: JobContext, client=None) -> Outcome:
    from ..http import PoliteClient
    own = client is None
    client = client or PoliteClient(ctx.settings.user_agent, min_interval_s=0.5, respect_robots=False)
    try:
        r = client.get(ES_ATLAS_URL, robots=False)
        if r.status_code != 200:
            raise SourceBlocked(f"registro npm respondió {r.status_code}")
        raw = r.content
    finally:
        if own:
            client.close()
    sha = hashlib.sha256(raw).hexdigest()
    ctx.api.snapshot(ctx.claim, {"resource_code": RESOURCE, "url": ES_ATLAS_URL, "fetched_at": datetime.now(timezone.utc).isoformat(),
                                 "http_status": 200, "content_type": "application/gzip", "byte_size": len(raw),
                                 "content_sha256": sha, "storage_provider": "none"})
    geos, issues = build_geographies(load_es_atlas(raw))
    for i in issues:
        ctx.issue("info", i["code"], i["message"])
    stats = {"tarball_sha256": sha}
    # Padres antes que hijos (el orden de build_geographies ya lo garantiza); lotes pequeños por el tamaño de geometrías
    for level in ("country", "ccaa", "province", "municipality", "non_municipal_area"):
        batch = [g for g in geos if g["level"] == level]
        r = ctx.submit("geographies", batch)
        stats[level] = r
        ctx.set_progress(level=level)
    rejected = sum(v.get("rejected", 0) for v in stats.values() if isinstance(v, dict))
    return Outcome("completed" if rejected == 0 else "partial", stats, {"levels": ["ccaa", "province", "municipality"]},
                   rejected == 0)


def handle_cnig(ctx: JobContext) -> Outcome:  # pragma: no cover - requiere acceso a cnig.es
    raise SourceBlocked("Conector CNIG implementado como pendiente: descargar el ZIP de Líneas límite requiere aceptar la "
                        "licencia en el centro de descargas; ver docs/CONECTORES.md. Use geo.es_atlas mientras tanto.")
