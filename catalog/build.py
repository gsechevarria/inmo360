"""Genera el seed SQL del catálogo y los CSV de la matriz de correspondencias.

Uso:  python catalog/build.py
Salidas:
  supabase/seed/010_catalog.sql            (idempotente; aplicar tras las migraciones)
  catalog/generated/*.csv                  (indicadores, inventario, recursos, matriz)
  docs/CATALOGO_RESUMEN.md                 (recuentos por estado)
"""
import csv, json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from sources import SOURCES, RESOURCES  # noqa: E402
from indicators import INDICATORS, INVENTORY  # noqa: E402
from mappings import M  # noqa: E402

try:  # inventario original del propietario, si existe (texto.txt → catalog/original/)
    from original_inventory import ORIGINAL_ITEMS  # type: ignore
except ImportError:
    ORIGINAL_ITEMS = []


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict,)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    if isinstance(v, (list, tuple)):
        return "array[" + ",".join(lit(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"


def upsert(table, rows, key, cols):
    out = []
    for r in rows:
        vals = ", ".join(lit(r.get(c)) for c in cols)
        upd = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in key)
        out.append(f"insert into {table} ({', '.join(cols)}) values ({vals}) on conflict ({', '.join(key)}) do update set {upd};")
    return out


def validate():
    codes = {i["code"] for i in INDICATORS}
    res = {r["code"] for r in RESOURCES}
    src = {s["code"] for s in SOURCES}
    errs = []
    for r in RESOURCES:
        if r["source_code"] not in src:
            errs.append(f"recurso {r['code']}: fuente desconocida {r['source_code']}")
    for x in M:
        if x["indicator_code"] not in codes:
            errs.append(f"mapeo: indicador desconocido {x['indicator_code']}")
        if x["resource_code"] not in res:
            errs.append(f"mapeo: recurso desconocido {x['resource_code']}")
    for it in INVENTORY + ORIGINAL_ITEMS:
        if it.get("indicator_code") and it["indicator_code"] not in codes:
            errs.append(f"inventario: indicador desconocido {it['indicator_code']} ({it['original_label']})")
    for i in INDICATORS:
        if i["is_protected_attribute"] and i["scoring_role"] != "excluded_protected":
            errs.append(f"{i['code']}: atributo protegido con scoring")
        if i["is_protected_attribute"] and "filtro" in i["app_functions"]:
            errs.append(f"{i['code']}: atributo protegido usado como filtro")
    if errs:
        raise SystemExit("Catálogo inválido:\n  " + "\n  ".join(errs))


def main():
    validate()
    sql = ["-- GENERADO por catalog/build.py — no editar a mano.", "begin;"]
    sql += upsert("catalog.sources", SOURCES, ["code"],
                  ["code", "name", "family", "owner_org", "homepage_url", "license", "reuse_status", "reuse_notes", "scope_note"])
    sql += upsert("catalog.resources", RESOURCES, ["code"],
                  ["code", "source_code", "name", "url", "table_or_series", "format", "coverage_geo", "coverage_time", "frequency",
                   "definition", "units", "terms_of_use", "import_method", "connector_code", "tech_status", "reuse_status",
                   "status_evidence", "blocked_reason", "notes"])
    sql += upsert("catalog.indicators", INDICATORS, ["code"],
                  ["code", "name", "original_name", "definition", "family", "catalog_section", "unit", "scale", "stat_type",
                   "dimensions", "universe", "denominator", "formula", "is_derived", "app_functions", "scoring_role",
                   "is_protected_attribute", "is_excluded", "exclusion_reason", "higher_is", "notes"])
    sql += upsert("catalog.resource_indicators", M, ["resource_code", "indicator_code"],
                  ["resource_code", "indicator_code", "dims_mapping", "transformation", "coverage", "match_status", "notes"])
    items = [dict(it, position=n) for n, it in enumerate(INVENTORY + ORIGINAL_ITEMS, 1)]
    sql += upsert("catalog.inventory_items", items, ["origin", "section", "original_label"],
                  ["origin", "section", "block", "original_label", "position", "indicator_code", "dims", "match_status",
                   "is_excluded", "exclusion_reason", "notes"])
    for i in INDICATORS:
        sql.append(f"insert into catalog.indicator_aliases(indicator_code, alias, origin) values ({lit(i['code'])}, "
                   f"{lit(i['original_name'])}, 'especificacion') on conflict do nothing;")
    sql.append("commit;")
    os.makedirs(os.path.join(ROOT, "supabase", "seed"), exist_ok=True)
    with open(os.path.join(ROOT, "supabase", "seed", "010_catalog.sql"), "w", encoding="utf-8") as f:
        f.write("\n".join(sql) + "\n")

    gen = os.path.join(HERE, "generated")
    os.makedirs(gen, exist_ok=True)

    def dump(name, rows, cols):
        with open(os.path.join(gen, name), "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(cols)
            for r in rows:
                w.writerow([json.dumps(r.get(c), ensure_ascii=False) if isinstance(r.get(c), (dict, list)) else r.get(c) for c in cols])

    dump("indicadores.csv", INDICATORS, ["code", "name", "family", "catalog_section", "unit", "stat_type", "dimensions", "universe",
                                         "denominator", "formula", "app_functions", "scoring_role", "is_protected_attribute", "is_excluded", "notes"])
    dump("recursos.csv", RESOURCES, ["code", "source_code", "name", "url", "table_or_series", "format", "coverage_geo", "coverage_time",
                                     "frequency", "import_method", "connector_code", "tech_status", "reuse_status", "status_evidence",
                                     "blocked_reason", "notes"])
    by_ind = {}
    for x in M:
        by_ind.setdefault(x["indicator_code"], []).append(x)
    res = {r["code"]: r for r in RESOURCES}
    ind = {i["code"]: i for i in INDICATORS}
    matrix = []
    for it in items:
        maps = by_ind.get(it.get("indicator_code"), []) or [None]
        for mp in maps:
            r = res.get(mp["resource_code"]) if mp else None
            i = ind.get(it.get("indicator_code"), {})
            matrix.append(dict(
                origen=it["origin"], seccion=it["section"], bloque=it.get("block"), indicador_original=it["original_label"],
                dimensiones=it.get("dims") or {}, indicador_normalizado=it.get("indicator_code"),
                estado_etiqueta=it["match_status"], fuente=r["source_code"] if r else None, recurso=r["code"] if r else None,
                cobertura=(mp or {}).get("coverage") or (r or {}).get("coverage_geo"),
                transformacion=(mp or {}).get("transformation") or i.get("formula"),
                uso=",".join(i.get("app_functions", [])), scoring=i.get("scoring_role"),
                estado_correspondencia=(mp or {}).get("match_status", "unresolved"),
                estado_tecnico=(r or {}).get("tech_status", "sin_recurso"), estado_reutilizacion=(r or {}).get("reuse_status"),
                excluido=it.get("is_excluded")))
    dump("matriz_correspondencias.csv", matrix, list(matrix[0].keys()))
    dump("inventario.csv", items, ["position", "origin", "section", "block", "original_label", "indicator_code", "dims", "match_status",
                                   "is_excluded", "notes"])

    t = Counter(r["tech_status"] for r in RESOURCES)
    u = Counter(r["reuse_status"] for r in RESOURCES)
    ms = Counter(x["estado_correspondencia"] for x in matrix)
    md = [
        "# Catálogo · resumen generado", "",
        f"- Fuentes: {len(SOURCES)} · Recursos: {len(RESOURCES)} · Indicadores normalizados: {len(INDICATORS)} · "
        f"Etiquetas de inventario: {len(items)} (especificación: {len(INVENTORY)}, texto.txt: {len(ORIGINAL_ITEMS)})",
        f"- Indicadores con atributo protegido (solo contexto): {sum(i['is_protected_attribute'] for i in INDICATORS)}",
        f"- Indicadores excluidos por decisión de producto: {sum(i['is_excluded'] for i in INDICATORS)}", "",
        "## Estado técnico de recursos", "", "| Estado | Recursos |", "|---|---|",
        *[f"| {k} | {v} |" for k, v in sorted(t.items())], "",
        "## Estado de reutilización", "", "| Estado | Recursos |", "|---|---|", *[f"| {k} | {v} |" for k, v in sorted(u.items())], "",
        "## Estado de correspondencia (filas de la matriz)", "", "| Estado | Filas |", "|---|---|",
        *[f"| {k} | {v} |" for k, v in sorted(ms.items())], "",
        "La matriz completa está en `catalog/generated/matriz_correspondencias.csv` (separador `;`) y en la vista "
        "`catalog.correspondence_matrix`. La aplicación la muestra en *Catálogo → Matriz*.",
    ]
    with open(os.path.join(ROOT, "docs", "CATALOGO_RESUMEN.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    print(f"ok: {len(SOURCES)} fuentes, {len(RESOURCES)} recursos, {len(INDICATORS)} indicadores, {len(items)} etiquetas, "
          f"{len(M)} mapeos, {len(matrix)} filas de matriz")


if __name__ == "__main__":
    main()
