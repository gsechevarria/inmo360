"""Importación de capturas reales hechas desde el navegador del propietario (recodificación sin pérdida).

Uso previsto: arranque de la base cuando el trabajador aún no puede llegar a la fuente, o validación.
Cada observación queda marcada con capture_method='browser_capture' y la URL/fecha de captura en notas.
Los ficheros se leen solo desde <INMO_DATA_DIR>/captures/<dataset>/ (sin rutas arbitrarias).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..normalize import obs
from ..queue import JobContext, Outcome

DATASETS = {
    # dataset: (recurso, parser)
    "ine_29005": "ine.dpop.29005",
    "ine_adrh": "ine.adrh.renta",
    "ine_vte": "ine.vte.39363",
}

# Municipios presentes en el padrón 2025 o históricos que no están en la geometría IGN de es-atlas.
# Nombres copiados de las respuestas reales del INE capturadas el 2026-11-02.
INE_ONLY_MUNICIPALITIES = {
    "48916": "Usansolo", "36011": "Cerdedo", "15026": "Cesuras", "36012": "Cotobade", "12066": "Gatova",
    "15063": "Oza dos Ríos", "17122": "Palmerola",
}


def read_chunks(root: Path, dataset: str) -> tuple[dict, list[str]]:
    d = (root / "captures" / dataset).resolve()
    if (root / "captures").resolve() not in d.parents:
        raise ValueError("dataset fuera del directorio de capturas")
    files = sorted(d.glob("chunk_*.txt"))
    if not files:
        raise FileNotFoundError(f"no hay capturas para {dataset} en {d}")
    meta, lines, seen = {}, [], set()
    for f in files:
        head, *body = f.read_text(encoding="utf-8").splitlines()
        m = json.loads(head[len("#INMO360-CAPTURE "):])
        seen.add(m["chunk"])
        meta = meta or m
        lines += [l for l in body if l and not l.startswith("#")]
    expected = set(range(meta["of"]))
    if seen != expected:
        raise ValueError(f"faltan fragmentos de {dataset}: {sorted(expected - seen)}")
    return meta, lines


def _points(blob: str):
    for part in blob.split(";"):
        if not part:
            continue
        bits = part.split(":")
        yield bits


TIPOS = {"D": "Definitivo", "P": "Provisional", "A": "Avance", "E": "Estimación"}


def parse(dataset: str, meta: dict, lines: list[str]) -> tuple[list[dict], dict[str, int]]:
    res = DATASETS[dataset]
    cap = meta["captured_at"]   # la URL y la fecha de captura se guardan en la ejecución (no se repiten por fila)
    out: list[dict] = []
    last_year: dict[str, int] = {}
    for line in lines:
        f = line.split("|")
        if dataset == "ine_29005":
            cod, muni, sex, data = f
            ind, dims = {"0": ("pop.padron", {}), "1": ("pop.padron.by_sex", {"sex": "male"}),
                         "2": ("pop.padron.by_sex", {"sex": "female"})}[sex]
            for b in _points(data):
                y, v, t = b[0], b[1], b[2]
                fecha = b[3] if len(b) > 3 else f"{y}-01-01"
                out.append(obs(res, ind, "municipality", muni, y, "year", raw=(int(v) if v != "" else None),
                               tipo=TIPOS.get(t, t), dims=dims, ref_date=fecha, unit_raw="Personas", captured_at=cap,
                               capture_method="browser_capture", notes=f"serie {cod}"))
                if sex == "0" and v != "":
                    last_year[muni] = max(last_year.get(muni, 0), int(y))
        elif dataset == "ine_adrh":
            tabla, cod, muni, hp, unit, data = f
            ind = {"H": "inc.net_mean_household", "P": "inc.net_mean_person"}[hp]
            for b in _points(data):
                y, v, t = b[0], b[1], b[2]
                out.append(obs(res, ind, "municipality", muni, y, "year", raw=(int(v) if re.fullmatch(r"-?\d+", v) else (v or None)),
                               tipo=TIPOS.get(t, t), unit_raw=unit or "Euros", captured_at=cap, capture_method="browser_capture",
                               notes=f"tabla {tabla} serie {cod}"))
        elif dataset == "ine_vte":
            cod, muni, vp, data = f
            ind = {"V": "tour.dwellings", "P": "tour.places"}[vp]
            for b in _points(data):
                ym, v, t = b[0], b[1], b[2]
                out.append(obs(res, ind, "municipality", muni, ym, "month", raw=(int(v) if re.fullmatch(r"-?\d+", v) else (v or None)),
                               tipo=TIPOS.get(t, t), ref_date=f"{ym}-01", unit_raw="Viviendas" if vp == "V" else "Plazas",
                               captured_at=cap, capture_method="browser_capture", notes=f"serie {cod}"))
    return out, last_year


def handle(ctx: JobContext) -> Outcome:
    dataset = ctx.claim.params.get("dataset")
    if dataset not in DATASETS:
        raise ValueError(f"dataset desconocido: {dataset!r}")
    meta, lines = read_chunks(ctx.settings.data_dir, dataset)
    observations, last_year = parse(dataset, meta, lines)
    stats: dict = {"lines": len(lines), "observations": len(observations)}
    if dataset == "ine_29005":
        # Municipios del padrón sin geometría IGN y municipios históricos (sin cifra en el último padrón)
        latest = max(last_year.values())
        geos = []
        for code, name in INE_ONLY_MUNICIPALITIES.items():
            ly = last_year.get(code)
            g = {"level": "municipality", "code": code, "name": name, "parent_level": "province", "parent_code": code[:2],
                 "only_if_missing": True, "version_label": "INE padrón (tabla 29005)", "resource_code": DATASETS[dataset]}
            if ly is None or ly < latest:
                g["valid_to"] = f"{(ly or 1995) + 1}-01-01"
                g["notes"] = ("Municipio histórico: sin cifra desde ese padrón (fecha inferida de la tabla 29005; "
                              "pendiente de confirmar con el registro de variaciones del INE).")
            else:
                g["notes"] = "Presente en el padrón vigente; sin geometría en la cartografía cargada."
            geos.append(g)
        stats["geographies"] = ctx.submit("geographies", geos)
    done = int(ctx.claim.checkpoints.get("offset", 0))
    step = 5000
    for i in range(done, len(observations), step):
        r = ctx.submit("observations", observations[i:i + step])
        for k, v in r.items():
            stats[k] = stats.get(k, 0) + v
        ctx.checkpoint("offset", i + step)
        ctx.set_progress(done=min(i + step, len(observations)), total=len(observations))
    return Outcome("completed", stats, {"dataset": dataset, "captured_at": meta["captured_at"], "source_url": meta.get("url"),
                                        "method": meta.get("method")}, True)
