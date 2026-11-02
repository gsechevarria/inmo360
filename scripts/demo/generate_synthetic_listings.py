"""Genera anuncios SINTÉTICOS para desarrollo y pruebas (nunca para la base operativa salvo decisión expresa).

Todos llevan is_synthetic=true, fuente 'demo_sintetico_a'/'demo_sintetico_b' y referencias 'SINT-…'.
Uso: python scripts/demo/generate_synthetic_listings.py <dir_buzón> [semilla]
"""
import csv, json, math, random, sys
from pathlib import Path

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 42)
# código INE, nombre, lat, lon, €/m² venta, €/m²/mes alquiler (órdenes de magnitud plausibles, no observados)
CITIES = [("28079", "Madrid", 40.4168, -3.7038, 5400, 21), ("02003", "Albacete", 38.9943, -1.8585, 1350, 8.5),
          ("46250", "València", 39.4699, -0.3763, 2700, 14), ("29067", "Málaga", 36.7213, -4.4214, 3700, 15),
          ("28005", "Alcalá de Henares", 40.4820, -3.3635, 2850, 13), ("28065", "Getafe", 40.3057, -3.7329, 3100, 14)]
TYPES = ["piso"] * 7 + ["ático", "dúplex", "estudio", "chalet"]
FIELDS = ["external_id", "url", "operation", "price_amount", "price_unit", "price_unit_note", "property_type", "title", "description",
          "built_area_m2", "rooms", "bathrooms", "floor_text", "has_elevator", "has_terrace", "has_parking", "condition", "energy_rating",
          "year_built", "lat", "lon", "location_precision", "address_text", "postal_code", "municipality_code", "published_at_declared",
          "agency_name", "agency_reference", "is_synthetic"]
a_rows, b_rows = [], []
n = 0
for code, name, lat, lon, sale_m2, rent_m2 in CITIES:
    for i in range(70 if code != "28079" else 110):
        n += 1
        op = "sale" if i % 4 else "rent"
        t = rnd.choice(TYPES)
        area = rnd.randint(28, 50) if t == "estudio" else rnd.randint(130, 260) if t == "chalet" else rnd.randint(48, 135)
        rooms = 0 if t == "estudio" else max(1, min(5, round(area / 30)))
        baths = 1 if area < 80 else 2
        cond = rnd.choices(["good", "to_renovate", "new", "unknown"], [6, 3, 1, 1])[0]
        factor = {"good": 1, "to_renovate": 0.78, "new": 1.18, "unknown": 1}[cond] * rnd.uniform(0.82, 1.2)
        precision = rnd.choices(["exact", "zone", "municipality"], [7, 2, 1])[0]
        r = 0.035 if precision != "municipality" else 0
        la, lo = lat + rnd.uniform(-r, r), lon + rnd.uniform(-r, r) / math.cos(math.radians(lat))
        unit, price, note = ("sale_total", round(area * sale_m2 * factor, -3), "") if op == "sale" else ("rent_month", round(area * rent_m2 * factor, -1), "")
        if op == "rent" and i % 9 == 0:
            t, unit, price, rooms, note = "habitación", "rent_room_month", round(rnd.uniform(280, 650) * (rent_m2 / 14), -1), 1, ""
        if op == "rent" and i % 13 == 0:
            unit, price, note = "rent_night", round(rnd.uniform(60, 160) * (rent_m2 / 14)), ""
        ref = f"SINT-{code}-{i:03d}"
        row = dict(external_id=ref, url="", operation=op, price_amount=price, price_unit=unit, price_unit_note=note, property_type=t,
                   title=f"[SINTÉTICO] {t.capitalize()} en {name}", description=f"Anuncio sintético de prueba ({t}, {area} m², {rooms} hab.). No corresponde a ningún inmueble real. " * 2,
                   built_area_m2=area, rooms=rooms, bathrooms=baths, floor_text=rnd.choice(["bajo", "1º", "2º", "3º", "4º", "5º", ""]),
                   has_elevator=rnd.choice(["true", "false", ""]), has_terrace=rnd.choice(["true", "false"]), has_parking=rnd.choice(["true", "false", ""]),
                   condition=cond, energy_rating=rnd.choice(["A", "B", "C", "D", "E", "F", "G", ""]), year_built=rnd.choice([1965, 1978, 1990, 2005, 2018, ""]),
                   lat=round(la, 6) if precision != "municipality" else "", lon=round(lo, 6) if precision != "municipality" else "",
                   location_precision=precision, address_text="" if precision != "exact" else f"Calle Sintética {i}, {name}",
                   postal_code="", municipality_code=code, published_at_declared=rnd.choice(["2026-09-15", "2026-10-02", "2026-10-20", ""]),
                   agency_name=rnd.choice(["Agencia Demo Norte (SINTÉTICA)", "Agencia Demo Sur (SINTÉTICA)", "Agencia Demo Centro (SINTÉTICA)"]),
                   agency_reference=ref, is_synthetic="true")
        a_rows.append(row)
        if op == "sale" and i % 7 == 0:   # misma vivienda publicada en otra fuente con discrepancias leves
            b = dict(row, external_id=f"B-{ref}", price_amount=round(price * rnd.uniform(0.97, 1.03), -2),
                     built_area_m2=area + rnd.choice([0, 1, -1]), agency_name="Agencia Demo Oeste (SINTÉTICA)")
            b_rows.append(b)
for fname, rows in [("demo_sintetico_a.csv", a_rows), ("demo_sintetico_b.csv", b_rows)]:
    with open(OUT / fname, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, FIELDS, delimiter=";"); w.writeheader(); w.writerows(rows)
print(json.dumps({"a": len(a_rows), "b": len(b_rows)}))
