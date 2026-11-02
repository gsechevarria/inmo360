"""Correspondencia del adjunto original del proyecto (catalog/original/texto.txt) con el modelo normalizado.

Reglas EXPLÍCITAS por patrón (sin similitud difusa de nombres). Cada etiqueta produce una fila:
- indicador normalizado + dimensiones + estado de correspondencia + nota;
- o 'unresolved' si ninguna regla la cubre (no se descarta).
El archivo original se conserva tal cual en catalog/original/texto.txt.
"""
from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "original", "texto.txt")

SEX = {"hombres": "male", "mujeres": "female"}
COMP = {
    "rentas del trabajo": "work", "trabajo personal": "work_personal", "rentas del capital mobiliario": "movable_capital",
    "rentas de bienes inmuebles no afectos a actividades económicas": "real_estate_not_business",
    "rentas de actividades económicas": "business", "otras rentas": "other_income",
    "ganancias patrimoniales netas": "capital_gains_net", "rentas exentas": "exempt_income",
    "maternidad, familias numerosas y dependencia": "family_benefits", "renta bruta": "gross_income",
    "renta bruta sujeta": "gross_income_subject", "renta bruta exenta": "gross_income_exempt", "renta disponible": "disposable_income",
    "renta disponible sujeta": "disposable_subject", "renta disponible exenta": "disposable_exempt",
    "deducciones generales": "general_deductions", "deducción por vivienda": "housing_deduction",
    "deducción por actividades económicas": "business_deduction", "otras deducciones": "other_deductions",
    "deducción por alquiler de vivienda habitual": "rent_deduction",
}
BIRTH = {"el mismo municipio": "same_municipality", "otro municipio de la misma provincia": "other_municipality_same_province",
         "otra provincia de la misma comunidad autónoma": "other_province_same_ccaa", "otra comunidad autónoma": "other_ccaa",
         "el extranjero": "abroad"}


def age(a: str, b: str | None) -> str:
    return f"{a}+" if b is None else f"{a}-{b}"


# (patrón, función → (indicador, dims, estado, nota))
RULES: list[tuple[str, object]] = [
    (r"^Población total del padrón$", lambda m: ("pop.padron", {}, "exact", None)),
    (r"^Población total censal$", lambda m: ("pop.census", {}, "exact", "Universo censal: no se mezcla con el padrón.")),
    (r"^(Hombres|Mujeres)$", lambda m: ("pop.padron.by_sex", {"sex": SEX[m[1].lower()]}, "exact", None)),
    (r"^Porcentaje de (hombres|mujeres)$", lambda m: ("pop.share.by_sex", {"sex": SEX[m[1]]}, "exact", None)),
    (r"^Edad media de la población$", lambda m: ("pop.mean_age", {}, "exact", None)),
    (r"^Edad media de los hombres$", lambda m: ("pop.mean_age.by_sex", {"sex": "male"}, "exact", None)),
    (r"^Edad media de las mujeres$", lambda m: ("pop.mean_age.by_sex", {"sex": "female"}, "exact", None)),
    (r"^(Hombres|Mujeres) de nacionalidad extranjera$", lambda m: ("pop.by_nationality", {"nationality": "foreign", "sex": SEX[m[1].lower()]}, "exact", None)),
    (r"^(Hombres|Mujeres) nacid[oa]s en el extranjero$", lambda m: ("pop.by_birthplace", {"birthplace": "abroad", "sex": SEX[m[1].lower()]}, "exact", None)),
    (r"^(Hombres|Mujeres) menores de 16 años$", lambda m: ("pop.by_age_sex", {"age_group": "0-15", "sex": SEX[m[1].lower()]}, "exact", None)),
    (r"^(Hombres|Mujeres) de 16 a 64 años$", lambda m: ("pop.by_age_sex", {"age_group": "16-64", "sex": SEX[m[1].lower()]}, "exact", None)),
    (r"^Porcentaje de población menor de (\d+) años$", lambda m: ("pop.share.by_age", {"age_group": f"0-{int(m[1]) - 1}"}, "exact",
        "Menores de 18: indicador demográfico del ADRH; universo y fecha propios." if m[1] == "18" else None)),
    (r"^Porcentaje de población de (\d+) a (\d+) años$", lambda m: ("pop.share.by_age", {"age_group": age(m[1], m[2])}, "exact", None)),
    (r"^Porcentaje de población de (\d+) (?:años )?y más(?: años)?$", lambda m: ("pop.share.by_age", {"age_group": age(m[1], None)}, "exact", None)),
    (r"^Porcentaje de población de nacionalidad (extranjera|española)$",
     lambda m: ("pop.share.by_nationality", {"nationality": "foreign" if m[1] == "extranjera" else "spanish"}, "exact", None)),
    (r"^Porcentaje de población nacida en (.+)$", lambda m: ("pop.share.by_birthplace", {"birthplace": BIRTH[m[1]]}, "exact", None)),
    (r"^Población nacida en (.+)$", lambda m: ("pop.by_birthplace", {"birthplace": BIRTH[m[1]], "sex": "total"}, "exact", None)),
    (r"^Índice de masculinidad$", lambda m: ("demo.masculinity_index", {}, "exact", None)),
    (r"^Índice de envejecimiento$", lambda m: ("demo.ageing_index", {}, "exact", None)),
    (r"^Tasa de dependencia (juvenil|de mayores|total)$",
     lambda m: ({"juvenil": "demo.dependency_youth", "de mayores": "demo.dependency_old", "total": "demo.dependency_total"}[m[1]], {}, "exact", None)),
    (r"^Crecimiento de la población en (un|cinco|diez) años?$",
     lambda m: ({"un": "demo.pop_growth_1y", "cinco": "demo.pop_growth_5y", "diez": "demo.pop_growth_10y"}[m[1]], {}, "exact", None)),
    (r"^Crecimiento anual compuesto de la población en (cinco|diez) años$",
     lambda m: ({"cinco": "demo.pop_cagr_5y", "diez": "demo.pop_cagr_10y"}[m[1]], {}, "exact", None)),
    (r"^(Inmigraciones|Emigraciones) interiores de personas de nacionalidad extranjera$",
     lambda m: ("mig.internal_flows_foreign", {"nationality": "foreign", "direction": "in" if m[1] == "Inmigraciones" else "out"}, "exact", None)),
    (r"^Inmigraciones interiores$", lambda m: ("mig.immigration_internal", {}, "exact", None)),
    (r"^Emigraciones interiores$", lambda m: ("mig.emigration_internal", {}, "exact", None)),
    (r"^Inmigraciones exteriores$", lambda m: ("mig.immigration_external", {}, "exact", None)),
    (r"^Emigraciones exteriores$", lambda m: ("mig.emigration_external", {}, "exact", None)),
    (r"^Saldo migratorio (interior|exterior|total) por 1\.000 habitantes$",
     lambda m: ("mig.net_per_1000", {"balance_type": {"interior": "internal", "exterior": "external", "total": "total"}[m[1]]}, "exact",
                "Denominador: población a 1 de enero del año del flujo (convención Inmo360; validar con la fuente).")),
    (r"^Saldo migratorio (interior|exterior|total)$",
     lambda m: ({"interior": "mig.net_internal", "exterior": "mig.net_external", "total": "mig.net_total"}[m[1]], {}, "exact", None)),
    (r"^(Hombres|Mujeres) de (\d+) (?:a (\d+) )?años(?: y más)?$",
     lambda m: ("pop.by_age_sex", {"age_group": age(m[2], m[3]), "sex": SEX[m[1].lower()]}, "exact", None)),
    (r"^Porcentaje de (hombres|mujeres) de (\d+) (?:a (\d+) )?años(?: y más)? sobre la población total$",
     lambda m: ("pop.share_of_total.by_age_sex", {"age_group": age(m[2], m[3]), "sex": SEX[m[1]]}, "exact",
                "Denominador: población TOTAL (no la del mismo sexo).")),
    (r"^Renta neta media por persona$", lambda m: ("inc.net_mean_person", {}, "exact", None)),
    (r"^Renta neta media por hogar$", lambda m: ("inc.net_mean_household", {}, "exact", None)),
    (r"^Renta media por unidad de consumo$", lambda m: ("inc.mean_consumption_unit", {}, "exact", None)),
    (r"^Renta mediana por unidad de consumo$", lambda m: ("inc.median_consumption_unit", {}, "exact", None)),
    (r"^Renta bruta media por persona$", lambda m: ("inc.gross_mean_person", {}, "exact", None)),
    (r"^Renta bruta media por hogar$", lambda m: ("inc.gross_mean_household", {}, "exact", None)),
    (r"^Porcentaje de renta procedente de (salarios|pensiones|prestaciones por desempleo|otras prestaciones|otras fuentes)$",
     lambda m: ("inc.source_share", {"income_source": {"salarios": "salaries", "pensiones": "pensions", "prestaciones por desempleo": "unemployment_benefits",
                                                       "otras prestaciones": "other_benefits", "otras fuentes": "other_sources"}[m[1]]}, "exact", None)),
    (r"^Porcentaje de población con renta por unidad de consumo inferior a ([\d.]+) euros$",
     lambda m: ("inc.pop_below_threshold", {"threshold": f"abs_{m[1].replace('.', '')}"}, "partial", "Pendiente validar etiqueta exacta del INE.")),
    (r"^Porcentaje de población con renta (inferior|superior) al (\d+) % de la mediana$",
     lambda m: ("inc.pop_below_threshold" if m[1] == "inferior" else "inc.pop_above_threshold", {"threshold": f"rel_{m[2]}"}, "partial",
                "Solo umbrales publicados; sin interpolación.")),
    (r"^Índice de Gini$", lambda m: ("inc.gini", {}, "exact", None)),
    (r"^Relación entre los percentiles 80 y 20 de renta$", lambda m: ("inc.p80_p20", {}, "exact", None)),
    (r"^Tamaño medio del hogar$", lambda m: ("hh.mean_size", {}, "exact", None)),
    (r"^Porcentaje de hogares unipersonales$", lambda m: ("hh.share_single", {}, "exact", None)),
    (r"^Población de (15|16) años y más$", lambda m: ("pop.by_age", {"age_group": f"{m[1]}+"}, "exact", None)),
    (r"^Paro registrado$", lambda m: ("emp.registered_unemployment", {}, "exact", None)),
    (r"^Contratos registrados$", lambda m: ("emp.contracts", {}, "exact", "Contratos ≠ personas.")),
    (r"^Afiliaciones a la Seguridad Social$", lambda m: ("emp.affiliations", {}, "exact", "Afiliaciones ≠ personas únicas.")),
    (r"^Variación interanual del paro registrado$", lambda m: ("emp.registered_unemployment_yoy", {}, "exact", None)),
    (r"^Variación interanual de las afiliaciones a la Seguridad Social$", lambda m: ("emp.affiliations_yoy", {}, "exact", None)),
    (r"^Número total de declaraciones del IRPF$", lambda m: ("irpf.returns", {}, "exact", None)),
    (r"^Tasa de (paro|empleo|actividad) censal$",
     lambda m: ("emp.census_rates", {"rate": {"paro": "unemployment", "empleo": "employment", "actividad": "activity"}[m[1]]}, "exact", None)),
    (r"^Porcentaje de población matriculada en (educación superior|estudios universitarios)$",
     lambda m: ("edu.enrolment_share", {"level": "tertiary" if m[1] == "educación superior" else "university"}, "ambiguous",
                "Denominador no indicado en el original; matriculados residentes ≠ alumnado de centros del municipio.")),
    (r"^Porcentaje de población con educación superior completada$",
     lambda m: ("edu.attainment_share", {"level": "tertiary"}, "partial", "Universo (15 y más) supuesto; validar.")),
    (r"^Porcentaje de población con pensión por discapacidad$", lambda m: ("pers.disability_pension_share", {}, "ambiguous", "Universo no indicado.")),
    (r"^Porcentaje de población con pensión de jubilación$", lambda m: ("pers.activity_share", {"activity": "retired"}, "ambiguous", "Universo no indicado.")),
    (r"^Porcentaje de otras personas inactivas$", lambda m: ("pers.activity_share", {"activity": "other_inactive"}, "ambiguous", "Universo no indicado.")),
    (r"^Porcentaje de estudiantes$", lambda m: ("pers.activity_share", {"activity": "student"}, "ambiguous",
                                                "Universo no indicado (¿población total o 16 y más?); distinto de 'Porcentaje de población de 16 años y más estudiante'.")),
    (r"^Porcentaje de población (soltera|casada|viuda|divorciada o separada|con estado civil desconocido)$",
     lambda m: ("pers.marital_share", {"marital_status": {"soltera": "single", "casada": "married", "viuda": "widowed", "divorciada o separada": "divorced_separated",
                                                          "con estado civil desconocido": "unknown"}[m[1]]}, "exact", None)),
    (r"^Número de hogares$", lambda m: ("hh.total", {}, "exact", "Hogar ≠ vivienda.")),
    (r"^Hogares de (una|dos|tres|cuatro|cinco) personas?( o más)?$",
     lambda m: ("hh.by_size", {"household_size": {"una": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5+"}[m[1]]}, "exact", None)),
    (r"^Número de viviendas$", lambda m: ("hou.dwellings", {"dwelling_type": "total"}, "exact", None)),
    (r"^Viviendas (principales|no principales|vacías)$",
     lambda m: ("hou.dwellings", {"dwelling_type": {"principales": "main", "no principales": "non_main", "vacías": "empty"}[m[1]]}, "exact",
                "Vacía no significa disponible para alquilar." if m[1] == "vacías" else None)),
    (r"^Viviendas principales (en propiedad|en alquiler|con otra forma de tenencia)$",
     lambda m: ("hou.main_by_tenure", {"tenure": {"en propiedad": "owned", "en alquiler": "rented", "con otra forma de tenencia": "other"}[m[1]]}, "exact", None)),
    (r"^Porcentaje de viviendas (no principales|vacías)$",
     lambda m: ("hou.dwellings_share", {"dwelling_type": {"no principales": "non_main", "vacías": "empty"}[m[1]]}, "exact", None)),
    (r"^Porcentaje de viviendas principales (en propiedad|en alquiler)$",
     lambda m: ("hou.tenure_share", {"tenure": {"en propiedad": "owned", "en alquiler": "rented"}[m[1]]}, "exact", None)),
    (r"^Viviendas turísticas$", lambda m: ("tour.dwellings", {}, "exact", "Universo INE VTE (plataformas).")),
    (r"^Plazas en viviendas turísticas$", lambda m: ("tour.places", {}, "exact", None)),
    (r"^Plazas por vivienda turística$", lambda m: ("tour.places_per_dwelling", {}, "exact", None)),
    (r"^Porcentaje de viviendas turísticas$", lambda m: ("tour.dwellings_share", {}, "exact", "Denominador: viviendas censadas (INE 39366).")),
    (r"^Viviendas en proyectos visados$", lambda m: ("con.dwellings_stage", {"stage": "permits_visa"}, "exact", None)),
    (r"^Viviendas con certificado final de obra$", lambda m: ("con.dwellings_stage", {"stage": "completion_certificate"}, "exact", None)),
    (r"^Paro registrado: (hombres|mujeres) (menores de 25|de 25 a 44|de 45) años( y más)?$",
     lambda m: ("emp.registered_unemployment.by_sex", {"sex": SEX[m[1]], "age_group": {"menores de 25": "<25", "de 25 a 44": "25-44", "de 45": "45+"}[m[2]]}, "exact", None)),
    (r"^Contratos (iniciales indefinidos|iniciales temporales|convertidos en indefinidos): (hombres|mujeres)$",
     lambda m: ("emp.contracts.by_sex", {"contract_type": {"iniciales indefinidos": "initial_permanent", "iniciales temporales": "initial_temporary",
                                                           "convertidos en indefinidos": "conversion_permanent"}[m[1]], "sex": SEX[m[2]]}, "exact", None)),
    (r"^Paro registrado (en agricultura|en industria|en construcción|en servicios|sin empleo anterior)$",
     lambda m: ("emp.registered_unemployment", {"sector": {"en agricultura": "agriculture", "en industria": "industry", "en construcción": "construction",
                                                            "en servicios": "services", "sin empleo anterior": "no_previous_job"}[m[1]]}, "exact", None)),
    (r"^Contratos registrados en (agricultura|industria|construcción|servicios)$",
     lambda m: ("emp.contracts", {"sector": {"agricultura": "agriculture", "industria": "industry", "construcción": "construction", "servicios": "services"}[m[1]]}, "exact", None)),
    (r"^Afiliaciones a la Seguridad Social en el (régimen general sin sistemas especiales|sistema especial agrario|sistema especial del hogar|régimen del mar|régimen de autónomos|régimen del carbón)$",
     lambda m: ("emp.affiliations", {"regime": {"régimen general sin sistemas especiales": "general_excl_special", "sistema especial agrario": "agrarian",
                                                "sistema especial del hogar": "household", "régimen del mar": "sea", "régimen de autónomos": "self_employed",
                                                "régimen del carbón": "coal"}[m[1]]}, "exact", None)),
    (r"^(Porcentaje de p|P)oblación de 15 años y más con (educación primaria o inferior|primera etapa de educación secundaria|segunda etapa de educación secundaria|educación superior)$",
     lambda m: ("edu.attainment_share" if m[1].startswith("Porcentaje") else "edu.attainment",
                {"level": {"educación primaria o inferior": "primary_or_less", "primera etapa de educación secundaria": "lower_secondary",
                           "segunda etapa de educación secundaria": "upper_secondary", "educación superior": "tertiary"}[m[2]]}, "exact", None)),
    (r"^(Porcentaje de p|P)oblación de 16 años y más (ocupada|parada según el censo|pensionista|estudiante|inactiva por otras causas)$",
     lambda m: ("pers.activity_share" if m[1].startswith("Porcentaje") else "pers.activity_status",
                {"activity": {"ocupada": "employed", "parada según el censo": "unemployed", "pensionista": "pensioner", "estudiante": "student",
                              "inactiva por otras causas": "other_inactive"}[m[2]]}, "exact", None)),
    (r"^Declaraciones del IRPF con (.+)$", lambda m: ("irpf.returns_by_component", {"component": COMP[m[1]]}, "exact", None)),
    (r"^Importe medio de (.+) por declaración del IRPF$", lambda m: ("irpf.mean_per_return", {"component": COMP[m[1]]}, "exact", None)),
    (r"^Importe de (.+) en las declaraciones del IRPF$", lambda m: ("irpf.amount", {"component": COMP[m[1]]}, "exact", None)),
    (r"^Viviendas previstas (de nueva planta|en rehabilitación|para demolición)$",
     lambda m: ("con.dwellings_stage", {"stage": {"de nueva planta": "planned_new", "en rehabilitación": "planned_rehab", "para demolición": "planned_demolition"}[m[1]]}, "exact", None)),
    (r"^Licencias de (obra mayor|nueva planta|rehabilitación|demolición total), todos los usos$",
     lambda m: ("con.licences", {"licence_type": {"obra mayor": "major_all_uses", "nueva planta": "new_build", "rehabilitación": "rehab", "demolición total": "total_demolition"}[m[1]]}, "exact", None)),
    (r"^Viviendas a crear (por rehabilitación|en locales)$",
     lambda m: ("con.dwellings_created", {"origin": "rehab" if m[1] == "por rehabilitación" else "commercial_premises"}, "exact", None)),
    (r"^Licencias de vivienda nueva, quinquenio por 1\.000 habitantes$",
     lambda m: ("con.licences_5y_per_1000", {}, "partial", "El original se limita a vivienda nueva; la fórmula del catálogo debe restringirse a ese tipo.")),
    (r"^Viviendas libres (iniciadas|terminadas), estimación MIVAU$",
     lambda m: ("con.dwellings_stage", {"stage": "free_started" if m[1] == "iniciadas" else "free_completed"}, "exact", "Estimación publicada por el MIVAU.")),
    (r"^Viviendas protegidas con calificación (provisional|definitiva)$",
     lambda m: ("con.protected_housing", {"measure": f"{'provisional' if m[1] == 'provisional' else 'final'}_qualification"}, "exact", None)),
    (r"^Viviendas con licencia de (construcción|primera ocupación)$",
     lambda m: ("con.licences", {"licence_type": "construction" if m[1] == "construcción" else "first_occupation"}, "partial",
                "El original cuenta viviendas, no licencias: requiere unidad 'viviendas' al importar.")),
    (r"^Actuaciones protegidas de rehabilitación iniciadas$", lambda m: ("con.protected_housing", {"measure": "protected_rehab"}, "exact", None)),
]
UNRESOLVED = [
    (r"OVV", "Referencia «OVV»: pendiente identificar organismo, territorio y metodología (no se extiende al resto de España)."),
    (r"València$", "Indicador específico de València: pendiente de identificar fuente y metodología; no se extiende al resto de España."),
]


def load_original() -> list[dict]:
    if not os.path.exists(SRC):
        return []
    raw = open(SRC, "rb").read().decode("utf-8")
    labels = [l.strip().strip('"') for l in re.split(r"\r\n|\r|\n", raw) if l.strip()]
    if labels and labels[0].lower() == "nombre_indicador":
        labels = labels[1:]
    out = []
    for pos, label in enumerate(labels, 1):
        row = dict(origin="texto.txt", section="original", block=None, original_label=label, indicator_code=None, dims={},
                   match_status="unresolved", is_excluded=False, exclusion_reason=None, notes=None, position=pos)
        for pat, note in UNRESOLVED:
            if re.search(pat, label):
                row["notes"] = note
                break
        else:
            for pat, fn in RULES:
                m = re.match(pat, label)
                if m:
                    try:
                        code, dims, status, note = fn(m)  # type: ignore[operator]
                    except KeyError:
                        continue
                    row.update(indicator_code=code, dims=dims, match_status=status, notes=note)
                    break
        out.append(row)
    return out


ORIGINAL_ITEMS = load_original()

if __name__ == "__main__":
    from collections import Counter
    print(len(ORIGINAL_ITEMS), Counter(i["match_status"] for i in ORIGINAL_ITEMS))
    for i in ORIGINAL_ITEMS:
        if i["match_status"] == "unresolved":
            print("SIN RESOLVER:", i["position"], i["original_label"])
