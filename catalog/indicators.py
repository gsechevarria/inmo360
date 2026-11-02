"""Indicadores normalizados e inventario original (sección 9 de la especificación).

Reglas:
- Cada etiqueta del inventario tiene una fila (o correspondencia dimensional explícita).
- Los desgloses por atributos personales protegidos (sexo, nacionalidad, origen, estado civil,
  discapacidad) son contexto agregado: sin filtro, sin scoring.
- La edad se usa en agregados demográficos (dependencia, envejecimiento) para pantalla y filtro,
  pero no participa en scoring.
- Los bloques de riesgos (§9.13) se registran como excluidos.
"""

INDICATORS = []
INVENTORY = []

CTX = ["pantalla", "contexto", "documentacion"]
STD = ["pantalla", "filtro", "contexto"]
SCR = ["pantalla", "filtro", "contexto", "scoring"]
CALC = ["pantalla", "calculo", "contexto"]


def ind(code, name, family, section, unit, stat_type, *, definition=None, original=None, dims=(), universe=None,
        denominator=None, formula=None, functions=STD, scoring="not_scored", protected=False, higher=None, notes=None,
        excluded=False, exclusion_reason=None, scale=1):
    if protected:
        functions, scoring = CTX, "excluded_protected"
    if excluded:
        functions, scoring = ["documentacion"], "excluded_risk"
    INDICATORS.append(dict(code=code, name=name, original_name=original or name, definition=definition, family=family,
                           catalog_section=section, unit=unit, scale=scale, stat_type=stat_type, dimensions=list(dims),
                           universe=universe, denominator=denominator, formula=formula, is_derived=formula is not None,
                           app_functions=functions, scoring_role=scoring, is_protected_attribute=protected,
                           is_excluded=excluded, exclusion_reason=exclusion_reason, higher_is=higher, notes=notes))
    return code


def inv(section, label, code, dims=None, status="exact", block=None, notes=None, excluded=False, reason=None):
    INVENTORY.append(dict(origin="especificacion", section=section, block=block, original_label=label, indicator_code=code,
                          dims=dims or {}, match_status=status, is_excluded=excluded, exclusion_reason=reason, notes=notes))


SEXES = [("total", "total"), ("male", "hombres"), ("female", "mujeres")]
QUINQ = [f"{a}-{a + 4}" for a in range(0, 100, 5)] + ["100+"]
BROAD = ["0-15", "16-24", "25-34", "35-44", "45-64", "65+", "80+"]

# ---------------------------------------------------------------- 9.1 Población y estructura
S = "9.1"
P = ind("pop.padron", "Población padronal", "poblacion", S, "personas", "stock", universe="Residentes empadronados a 1 de enero",
        definition="Cifra oficial de población del padrón municipal.", functions=SCR, scoring="eligible", higher="depends")
PC = ind("pop.census", "Población censal", "poblacion", S, "personas", "stock", universe="Población residente (censo)",
         definition="Población del Censo de Población; universo y fecha distintos del padrón: no se mezclan series.")
PS = ind("pop.padron.by_sex", "Población padronal por sexo", "poblacion", S, "personas", "stock", dims=["sex"], protected=True)
PSS = ind("pop.share.by_sex", "Porcentaje de población por sexo", "poblacion", S, "%", "share", dims=["sex"], protected=True,
          formula="pop.padron.by_sex / pop.padron × 100", denominator="pop.padron")
MA = ind("pop.mean_age", "Edad media", "poblacion", S, "años", "average", functions=STD)
MAS = ind("pop.mean_age.by_sex", "Edad media por sexo", "poblacion", S, "años", "average", dims=["sex"], protected=True)
NAT = ind("pop.by_nationality", "Población por nacionalidad", "poblacion", S, "personas", "stock", dims=["nationality", "sex"], protected=True)
BIR = ind("pop.by_birthplace", "Población por lugar de nacimiento", "poblacion", S, "personas", "stock", dims=["birthplace", "sex"], protected=True)
AGE = ind("pop.by_age", "Población por grupo de edad", "poblacion", S, "personas", "stock", dims=["age_group"],
          notes="Edad: solo pantalla, filtro y contexto; no participa en scoring.")
AGES = ind("pop.by_age_sex", "Población por grupo de edad y sexo", "poblacion", S, "personas", "stock", dims=["age_group", "sex"], protected=True)
AGEP = ind("pop.share.by_age", "Porcentaje de población por grupo de edad", "poblacion", S, "%", "share", dims=["age_group"],
           formula="pop.by_age / pop.padron × 100", denominator="pop.padron")
AGESP = ind("pop.share.by_age_sex", "Porcentaje por grupo de edad y sexo", "poblacion", S, "%", "share", dims=["age_group", "sex"],
            protected=True, formula="pop.by_age_sex / pop.padron.by_sex × 100", denominator="pop.padron.by_sex")

inv(S, "Población padronal", P)
inv(S, "Población censal", PC)
inv(S, "Hombres", PS, {"sex": "male"}, block="Hombres y mujeres")
inv(S, "Mujeres", PS, {"sex": "female"}, block="Hombres y mujeres")
inv(S, "Porcentaje de hombres", PSS, {"sex": "male"}, block="Porcentajes por sexo")
inv(S, "Porcentaje de mujeres", PSS, {"sex": "female"}, block="Porcentajes por sexo")
inv(S, "Edad media total", MA)
inv(S, "Edad media de hombres", MAS, {"sex": "male"})
inv(S, "Edad media de mujeres", MAS, {"sex": "female"})
for sx, lab in SEXES:
    inv(S, f"Nacionalidad extranjera · {lab}", NAT, {"nationality": "foreign", "sex": sx})
    inv(S, f"Nacimiento en el extranjero · {lab}", BIR, {"birthplace": "abroad", "sex": sx})
    inv(S, f"Menores de 16 · {lab}", AGES if sx != "total" else AGE, {"age_group": "0-15", **({"sex": sx} if sx != "total" else {})})
    inv(S, f"Población de 16 a 64 · {lab}", AGES if sx != "total" else AGE, {"age_group": "16-64", **({"sex": sx} if sx != "total" else {})})
inv(S, "Menores de 18", AGE, {"age_group": "0-17"})
inv(S, "Población de 15 y más", AGE, {"age_group": "15+"})
inv(S, "Población de 16 y más", AGE, {"age_group": "16+"})
for g in BROAD:
    inv(S, f"Grupo de edad {g.replace('+', ' y más')}", AGE, {"age_group": g}, block="Grupos amplios")
    inv(S, f"Porcentaje grupo de edad {g.replace('+', ' y más')}", AGEP, {"age_group": g}, block="Porcentajes correspondientes")
for sx, lab in SEXES:
    for g in QUINQ:
        code, pct = (AGE, AGEP) if sx == "total" else (AGES, AGESP)
        d = {"age_group": g, **({"sex": sx} if sx != "total" else {})}
        inv(S, f"Grupo quinquenal {g.replace('+', ' y más')} · {lab}", code, d, block="Grupos quinquenales")
        inv(S, f"Porcentaje grupo quinquenal {g.replace('+', ' y más')} · {lab}", pct, d, block="Porcentajes correspondientes")
inv(S, "Nacionalidad española", NAT, {"nationality": "spanish", "sex": "total"})
inv(S, "Nacionalidad extranjera", NAT, {"nationality": "foreign", "sex": "total"})
for k, lab in [("same_municipality", "Nacimiento en el mismo municipio"),
               ("other_municipality_same_province", "Nacimiento en otro municipio de la provincia"),
               ("other_province_same_ccaa", "Nacimiento en otra provincia de la comunidad"),
               ("other_ccaa", "Nacimiento en otra comunidad"), ("abroad", "Nacimiento en el extranjero")]:
    inv(S, lab, BIR, {"birthplace": k, "sex": "total"}, block="Lugar de nacimiento")

# ---------------------------------------------------------------- 9.2 Derivados demográficos
S = "9.2"
D = dict(family="demografia_derivada", section=S)
DEN = ind("demo.density", "Densidad de población", unit="hab/km²", stat_type="ratio", formula="pop.padron / área (km², geometría vigente)",
          denominator="área de la geometría 'full' del territorio", functions=STD, **D)
MASC = ind("demo.masculinity_index", "Índice de masculinidad", unit="hombres por 100 mujeres", stat_type="ratio",
           formula="hombres / mujeres × 100", protected=True, **D)
AGI = ind("demo.ageing_index", "Índice de envejecimiento", unit="%", stat_type="ratio", formula="pop 65+ / pop 0-15 × 100",
          notes="Convención: 0–15 y 65+.", **D)
DJ = ind("demo.dependency_youth", "Dependencia juvenil", unit="%", stat_type="ratio", formula="pop 0-15 / pop 16-64 × 100",
         notes="Convención INE de 16–64 años como población potencialmente activa.", **D)
DO = ind("demo.dependency_old", "Dependencia de mayores", unit="%", stat_type="ratio", formula="pop 65+ / pop 16-64 × 100", **D)
DT = ind("demo.dependency_total", "Dependencia total", unit="%", stat_type="ratio", formula="(pop 0-15 + pop 65+) / pop 16-64 × 100", **D)
G1 = ind("demo.pop_growth_1y", "Crecimiento de población a 1 año", unit="%", stat_type="rate",
         formula="(P[t] / P[t-1]) - 1", functions=SCR, scoring="eligible", higher="better", **D)
G5 = ind("demo.pop_growth_5y", "Crecimiento de población a 5 años", unit="%", stat_type="rate",
         formula="(P[t] / P[t-5]) - 1", functions=SCR, scoring="eligible", higher="better", **D)
G10 = ind("demo.pop_growth_10y", "Crecimiento de población a 10 años", unit="%", stat_type="rate",
          formula="(P[t] / P[t-10]) - 1", functions=SCR, scoring="eligible", higher="better", **D)
C5 = ind("demo.pop_cagr_5y", "Crecimiento anual compuesto a 5 años", unit="%", stat_type="rate",
         formula="(P[t] / P[t-5])^(1/5) - 1", functions=SCR, scoring="eligible", higher="better", **D)
C10 = ind("demo.pop_cagr_10y", "Crecimiento anual compuesto a 10 años", unit="%", stat_type="rate",
          formula="(P[t] / P[t-10])^(1/10) - 1", functions=SCR, scoring="eligible", higher="better", **D)
for lab, c in [("Densidad", DEN), ("Índice de masculinidad", MASC), ("Índice de envejecimiento", AGI),
               ("Dependencia juvenil", DJ), ("Dependencia de mayores", DO), ("Dependencia total", DT),
               ("Crecimiento a un año", G1), ("Crecimiento a cinco años", G5), ("Crecimiento a diez años", G10),
               ("Crecimiento anual compuesto a cinco años", C5), ("Crecimiento anual compuesto a diez años", C10)]:
    inv(S, lab, c)

# ---------------------------------------------------------------- 9.3 Migraciones
S = "9.3"
M = dict(family="migraciones", section=S)
II = ind("mig.immigration_internal", "Inmigración interior", unit="personas", stat_type="flow", dims=["sex"], **M)
EI = ind("mig.emigration_internal", "Emigración interior", unit="personas", stat_type="flow", dims=["sex"], **M)
FI = ind("mig.internal_flows_foreign", "Flujos interiores de nacionalidad extranjera", unit="personas", stat_type="flow",
         dims=["nationality", "direction"], protected=True, **M)
IE = ind("mig.immigration_external", "Inmigración exterior", unit="personas", stat_type="flow", dims=["sex"], **M)
EE = ind("mig.emigration_external", "Emigración exterior", unit="personas", stat_type="flow", dims=["sex"], **M)
NI = ind("mig.net_internal", "Saldo migratorio interior", unit="personas", stat_type="flow", formula="inmigración interior − emigración interior", **M)
NE = ind("mig.net_external", "Saldo migratorio exterior", unit="personas", stat_type="flow", formula="inmigración exterior − emigración exterior", **M)
NT = ind("mig.net_total", "Saldo migratorio total", unit="personas", stat_type="flow", formula="saldo interior + saldo exterior",
         functions=SCR, scoring="eligible", higher="better", **M)
NR = ind("mig.net_per_1000", "Saldo migratorio por 1.000 habitantes", unit="‰", stat_type="rate", dims=["balance_type"],
         formula="saldo / pop.padron a 1 de enero del año × 1000", denominator="pop.padron (1 de enero del año del flujo)",
         functions=SCR, scoring="eligible", higher="better", **M)
for lab, c, d in [("Inmigración interior", II, {}), ("Emigración interior", EI, {}),
                  ("Flujos interiores de nacionalidad extranjera", FI, {"nationality": "foreign"}),
                  ("Inmigración exterior", IE, {}), ("Emigración exterior", EE, {}), ("Saldo interior", NI, {}),
                  ("Saldo exterior", NE, {}), ("Saldo total", NT, {}),
                  ("Saldo interior por 1.000 habitantes", NR, {"balance_type": "internal"}),
                  ("Saldo exterior por 1.000 habitantes", NR, {"balance_type": "external"}),
                  ("Saldo total por 1.000 habitantes", NR, {"balance_type": "total"})]:
    inv(S, lab, c, d)

# ---------------------------------------------------------------- 9.4 Renta (ADRH)
S = "9.4"
R_ = dict(family="renta", section=S)
RNP = ind("inc.net_mean_person", "Renta neta media por persona", unit="EUR", stat_type="average", universe="Personas (ADRH)",
          functions=SCR, scoring="eligible", higher="depends", **R_)
RNH = ind("inc.net_mean_household", "Renta neta media por hogar", unit="EUR", stat_type="average", universe="Hogares (ADRH)",
          functions=SCR, scoring="eligible", higher="depends", **R_)
RUC = ind("inc.mean_consumption_unit", "Renta media por unidad de consumo", unit="EUR", stat_type="average", **R_)
RMUC = ind("inc.median_consumption_unit", "Renta mediana por unidad de consumo", unit="EUR", stat_type="median", **R_)
RBP = ind("inc.gross_mean_person", "Renta bruta media por persona", unit="EUR", stat_type="average", **R_)
RBH = ind("inc.gross_mean_household", "Renta bruta media por hogar", unit="EUR", stat_type="average", **R_)
SRC = ind("inc.source_share", "Peso de cada fuente de ingresos", unit="%", stat_type="share", dims=["income_source"], **R_)
BEL = ind("inc.pop_below_threshold", "Población bajo umbral de ingresos por unidad de consumo", unit="%", stat_type="share",
          dims=["threshold"], notes="Solo umbrales publicados por el INE; los no publicados quedan pendientes (sin interpolar).", **R_)
ABV = ind("inc.pop_above_threshold", "Población sobre umbral relativo a la mediana", unit="%", stat_type="share", dims=["threshold"], **R_)
GINI = ind("inc.gini", "Índice de Gini", unit="índice", stat_type="index", **R_)
P8020 = ind("inc.p80_p20", "Relación P80/P20", unit="ratio", stat_type="ratio", **R_)
for lab, c, d in [("Renta neta media por persona", RNP, {}), ("Renta neta media por hogar", RNH, {}),
                  ("Renta media por unidad de consumo", RUC, {}), ("Renta mediana por unidad de consumo", RMUC, {}),
                  ("Renta bruta media por persona", RBP, {}), ("Renta bruta media por hogar", RBH, {}),
                  ("Peso de salarios", SRC, {"income_source": "salaries"}), ("Peso de pensiones", SRC, {"income_source": "pensions"}),
                  ("Peso de prestaciones por desempleo", SRC, {"income_source": "unemployment_benefits"}),
                  ("Peso de otras prestaciones", SRC, {"income_source": "other_benefits"}),
                  ("Peso de otras fuentes", SRC, {"income_source": "other_sources"}),
                  ("Población bajo 5.000 € por unidad de consumo", BEL, {"threshold": "abs_5000"}),
                  ("Población bajo 7.500 € por unidad de consumo", BEL, {"threshold": "abs_7500"}),
                  ("Población bajo 10.000 € por unidad de consumo", BEL, {"threshold": "abs_10000"}),
                  ("Población bajo el 40 % de la mediana", BEL, {"threshold": "rel_40"}),
                  ("Población bajo el 50 % de la mediana", BEL, {"threshold": "rel_50"}),
                  ("Población bajo el 60 % de la mediana", BEL, {"threshold": "rel_60"}),
                  ("Población sobre el 140 % de la mediana", ABV, {"threshold": "rel_140"}),
                  ("Población sobre el 160 % de la mediana", ABV, {"threshold": "rel_160"}),
                  ("Población sobre el 200 % de la mediana", ABV, {"threshold": "rel_200"}),
                  ("Gini", GINI, {}), ("Relación P80/P20", P8020, {})]:
    inv(S, lab, c, d, status="exact" if c in (RNP, RNH) else "partial",
        notes=None if c in (RNP, RNH) else "Mapeado al recurso ADRH; pendiente validar la etiqueta exacta del INE para cada umbral.")

# ---------------------------------------------------------------- 9.5 Hogares
S = "9.5"
H_ = dict(family="hogares", section=S)
HT = ind("hh.total", "Número de hogares", unit="hogares", stat_type="stock", notes="Hogar ≠ vivienda.", **H_)
HS = ind("hh.by_size", "Hogares por número de miembros", unit="hogares", stat_type="stock", dims=["household_size"], **H_)
HM = ind("hh.mean_size", "Tamaño medio del hogar", unit="personas/hogar", stat_type="average", **H_)
HU = ind("hh.share_single", "Porcentaje de hogares unipersonales", unit="%", stat_type="share", formula="hogares de 1 miembro / hogares × 100", **H_)
HG = ind("hh.growth", "Evolución del número de hogares", unit="%", stat_type="rate", formula="(H[t] / H[t-k]) - 1",
         functions=SCR, scoring="eligible", higher="better", **H_)
inv(S, "Número total de hogares", HT)
for k in ["1", "2", "3", "4", "5+"]:
    inv(S, f"Hogares de {k.replace('+', ' o más')} miembros", HS, {"household_size": k})
inv(S, "Tamaño medio del hogar", HM)
inv(S, "Porcentaje unipersonal", HU)
inv(S, "Evolución del número de hogares", HG)

# ---------------------------------------------------------------- 9.6 Educación y situación personal
S = "9.6"
E_ = dict(family="educacion", section=S)
EDL = ind("edu.attainment", "Nivel de estudios completados (población de 15 y más)", unit="personas", stat_type="stock",
          dims=["level"], universe="Población de 15 y más años", **E_)
EDP = ind("edu.attainment_share", "Porcentaje por nivel de estudios (15 y más)", unit="%", stat_type="share", dims=["level"],
          denominator="población de 15 y más", **E_)
ENR = ind("edu.enrolment", "Matriculación", unit="personas", stat_type="stock", dims=["level"],
          notes="Alumnado matriculado en centros del municipio ≠ estudiantes residentes.", **E_)
STU = ind("edu.students_resident", "Estudiantes residentes", unit="personas", stat_type="stock", universe="Residentes (censo)",
          functions=SCR, scoring="eligible", higher="depends", **E_)
ACT = ind("pers.activity_status", "Situación de actividad (16 y más)", unit="personas", stat_type="stock", dims=["activity"],
          universe="Población de 16 y más (censo)", **E_)
DIS = ind("pers.disability_pension", "Pensión por discapacidad", unit="personas", stat_type="stock", protected=True, **E_)
MAR = ind("pers.marital_status", "Estado civil", unit="personas", stat_type="stock", dims=["marital_status"], protected=True, **E_)
for lab, lv in [("Primaria o inferior", "primary_or_less"), ("Primera etapa de secundaria", "lower_secondary"),
                ("Segunda etapa de secundaria", "upper_secondary"), ("Educación superior", "tertiary")]:
    inv(S, f"{lab} · recuento", EDL, {"level": lv})
    inv(S, f"{lab} · porcentaje de 15 y más", EDP, {"level": lv})
inv(S, "Matriculación en educación superior", ENR, {"level": "tertiary"})
inv(S, "Matriculación universitaria", ENR, {"level": "university"})
inv(S, "Educación superior completada", EDL, {"level": "tertiary"}, status="equivalent_validated", notes="Mismo concepto que 'Educación superior · recuento'.")
inv(S, "Pensión por discapacidad", DIS)
inv(S, "Jubilación", ACT, {"activity": "retired"})
inv(S, "Otras situaciones de inactividad", ACT, {"activity": "other_inactive"})
inv(S, "Estudiantes", STU)
for lab, k in [("Soltería", "single"), ("Matrimonio", "married"), ("Viudedad", "widowed"), ("Divorcio/separación", "divorced_separated"),
               ("Situación desconocida", "unknown")]:
    inv(S, lab, MAR, {"marital_status": k})
inv(S, "Ocupación (16 y más)", ACT, {"activity": "employed"})
inv(S, "Paro (16 y más)", ACT, {"activity": "unemployed"})
inv(S, "Pensiones (16 y más)", ACT, {"activity": "pensioner"})

# ---------------------------------------------------------------- 9.7 Empleo y actividad
S = "9.7"
J = dict(family="empleo", section=S)
UNR = ind("emp.registered_unemployment", "Paro registrado", unit="personas", stat_type="stock", dims=["sex", "age_group", "sector"],
          notes="Paro registrado (SEPE) ≠ tasa de paro (censo/EPA).", **J)
UNY = ind("emp.registered_unemployment_yoy", "Variación interanual del paro registrado", unit="%", stat_type="rate",
          formula="(paro[t] / paro[t-12m]) - 1", functions=SCR, scoring="eligible", higher="worse", **J)
CON = ind("emp.contracts", "Contratos registrados", unit="contratos", stat_type="flow", dims=["contract_type", "sector", "sex"],
          notes="Contratos ≠ personas.", **J)
AFI = ind("emp.affiliations", "Afiliaciones a la Seguridad Social", unit="afiliaciones", stat_type="stock", dims=["regime"],
          notes="Afiliaciones ≠ personas únicas.", **J)
AFY = ind("emp.affiliations_yoy", "Variación interanual de la afiliación", unit="%", stat_type="rate",
          formula="(afil[t] / afil[t-12m]) - 1", functions=SCR, scoring="eligible", higher="better", **J)
CUR = ind("emp.census_rates", "Tasas censales de paro, empleo y actividad", unit="%", stat_type="rate", dims=["rate"], **J)
FIR = ind("emp.firms_by_activity", "Empresas y locales por actividad", unit="unidades", stat_type="stock", dims=["unit_type", "sector"], **J)
UNS = ind("emp.registered_unemployment.by_sex", "Paro registrado por sexo", unit="personas", stat_type="stock", dims=["sex"], protected=True, **J)
CONS = ind("emp.contracts.by_sex", "Contratos por tipo y sexo", unit="contratos", stat_type="flow", dims=["contract_type", "sex"], protected=True, **J)
inv(S, "Paro registrado", UNR)
inv(S, "Variación interanual del paro", UNY)
inv(S, "Contratos", CON)
inv(S, "Afiliaciones", AFI)
inv(S, "Variación interanual de afiliación", AFY)
inv(S, "Paro de hombres", UNS, {"sex": "male"}, block="Paro por sexo")
inv(S, "Paro de mujeres", UNS, {"sex": "female"}, block="Paro por sexo")
for g in ["<25", "25-44", "45+"]:
    inv(S, f"Paro de {g} años", UNR, {"age_group": g}, block="Paro por edades")
for k, lab in [("agriculture", "agricultura"), ("industry", "industria"), ("construction", "construcción"), ("services", "servicios"),
               ("no_previous_job", "sin empleo anterior")]:
    inv(S, f"Paro en {lab}" if k != "no_previous_job" else "Paro sin empleo anterior", UNR, {"sector": k})
inv(S, "Contratos por actividad", CON, {"sector": "*"})
for ct, lab in [("initial_permanent", "iniciales indefinidos"), ("initial_temporary", "iniciales temporales"),
                ("conversion_permanent", "convertidos en indefinidos")]:
    for sx, slab in SEXES[1:]:
        inv(S, f"Contratos {lab} · {slab}", CONS, {"contract_type": ct, "sex": sx})
for rg, lab in [("general_excl_special", "Régimen general sin sistemas especiales"), ("agrarian", "Sistema especial agrario"),
                ("household", "Sistema especial de empleados del hogar"), ("sea", "Régimen especial del mar"),
                ("self_employed", "Autónomos"), ("coal", "Régimen de la minería del carbón")]:
    inv(S, f"Afiliaciones · {lab}", AFI, {"regime": rg})
for rt, lab in [("unemployment", "Tasa de paro censal"), ("employment", "Tasa de empleo censal"), ("activity", "Tasa de actividad censal")]:
    inv(S, lab, CUR, {"rate": rt})
inv(S, "Empresas por actividad", FIR, {"unit_type": "firm"})
inv(S, "Locales por actividad", FIR, {"unit_type": "establishment"})

# ---------------------------------------------------------------- 9.8 IRPF
S = "9.8"
I_ = dict(family="irpf", section=S)
DEC = ind("irpf.returns", "Número de declaraciones del IRPF", unit="declaraciones", stat_type="count", **I_,
          notes="Renta por declaración ≠ renta por hogar; no se asignan equivalencias por parecido de nombres.")
DCC = ind("irpf.returns_by_component", "Declaraciones con el componente", unit="declaraciones", stat_type="count", dims=["component"], **I_)
AMT = ind("irpf.amount", "Importe agregado del componente", unit="EUR", stat_type="amount", dims=["component"], **I_)
AVG = ind("irpf.mean_per_return", "Importe medio por declaración", unit="EUR", stat_type="average", dims=["component"],
          denominator="declaraciones con el componente", **I_)
inv(S, "Número de declaraciones", DEC)
COMPONENTS = [("work", "Trabajo"), ("work_personal", "Trabajo personal"), ("movable_capital", "Capital mobiliario"),
              ("real_estate_not_business", "Bienes inmuebles no afectos"), ("business", "Actividades económicas"),
              ("other_income", "Otras rentas"), ("capital_gains_net", "Ganancias patrimoniales netas"),
              ("exempt_income", "Rentas exentas"), ("family_benefits", "Maternidad, familias numerosas y dependencia"),
              ("gross_income", "Renta bruta"), ("gross_income_subject_exempt", "Renta bruta sujeta y exenta"),
              ("disposable_income", "Renta disponible"), ("disposable_subject_exempt", "Renta disponible sujeta y exenta"),
              ("general_deductions", "Deducciones generales"), ("housing_deduction", "Deducción por vivienda"),
              ("business_deduction", "Deducción por actividades económicas"), ("other_deductions", "Otras deducciones"),
              ("rent_deduction", "Deducción por alquiler habitual")]
for k, lab in COMPONENTS:
    inv(S, f"{lab} · declaraciones", DCC, {"component": k}, block="Declaraciones por componente")
    inv(S, f"{lab} · importe agregado", AMT, {"component": k}, block="Importe agregado")
    inv(S, f"{lab} · importe medio por declaración", AVG, {"component": k}, block="Importe medio")

# ---------------------------------------------------------------- 9.9 Vivienda y mercado
S = "9.9"
V = dict(family="vivienda", section=S)
DW = ind("hou.dwellings", "Viviendas por tipo", unit="viviendas", stat_type="stock", dims=["dwelling_type"],
         notes="Vivienda vacía no significa disponible para alquilar.", **V)
TEN = ind("hou.main_by_tenure", "Viviendas principales por régimen de tenencia", unit="viviendas", stat_type="stock", dims=["tenure"], **V)
DWS = ind("hou.dwellings_share", "Porcentaje de viviendas por tipo", unit="%", stat_type="share", dims=["dwelling_type"],
          denominator="viviendas totales", **V)
TENS = ind("hou.tenure_share", "Porcentaje de principales por tenencia", unit="%", stat_type="share", dims=["tenure"],
           denominator="viviendas principales", functions=SCR, scoring="eligible", higher="depends", **V)
OFS = ind("mkt.offer_price_sale_m2", "Precio de oferta de venta (mediana €/m²)", unit="EUR/m2", stat_type="median",
          family="mercado", section=S, universe="Inmuebles únicos con anuncio de venta activo (deduplicados)",
          notes="Oferta ≠ cierre. Muestra (n) y fecha obligatorias.", functions=SCR, scoring="eligible", higher="depends")
OFR = ind("mkt.offer_rent_m2", "Renta de oferta (mediana €/m²/mes)", unit="EUR/m2/mes", stat_type="median", family="mercado",
          section=S, universe="Inmuebles únicos con anuncio de alquiler activo", functions=SCR, scoring="eligible", higher="depends")
RREF = ind("mkt.rent_reference_official", "Referencia estadística oficial de alquiler", unit="EUR/m2/mes", stat_type="median",
           family="mercado", section=S, notes="SERPAVI/MIVAU: referencia agregada, no precio de un inmueble.")
RDEC = ind("mkt.declared_rent", "Rentas declaradas de alquiler", unit="EUR/mes", stat_type="median", family="mercado", section=S)
TRX = ind("mkt.transactions", "Compraventas de vivienda", unit="transacciones", stat_type="flow", dims=["dwelling_kind"],
          family="mercado", section=S, functions=SCR, scoring="eligible", higher="depends")
APR = ind("mkt.appraisal_value_m2", "Valor tasado (€/m²)", unit="EUR/m2", stat_type="average", family="mercado", section=S,
          notes="Tasación ≠ precio de cierre ≠ oferta.")
IPV = ind("mkt.price_index_sale", "Índice de precios de vivienda (venta)", unit="índice", stat_type="index", family="mercado", section=S)
IPVA = ind("mkt.price_index_rent", "Índice de precios de vivienda en alquiler", unit="índice", stat_type="index", family="mercado", section=S)
ACTV = ind("mkt.active_listings", "Oferta activa observada", unit="anuncios / inmuebles", stat_type="count", dims=["operation", "count_unit"],
           family="mercado", section=S, notes="Se distinguen anuncios publicados e inmuebles únicos.")
EVT = ind("mkt.listing_events", "Altas, cambios y bajas observadas de anuncios", unit="eventos", stat_type="flow", dims=["event_type"],
          family="mercado", section=S, notes="Una retirada no observada no significa venta.")
for lab, c, d in [("Viviendas totales", DW, {"dwelling_type": "total"}), ("Viviendas principales", DW, {"dwelling_type": "main"}),
                  ("Viviendas no principales", DW, {"dwelling_type": "non_main"}), ("Viviendas vacías", DW, {"dwelling_type": "empty"}),
                  ("Principales en propiedad", TEN, {"tenure": "owned"}), ("Principales en alquiler", TEN, {"tenure": "rented"}),
                  ("Otras formas de tenencia", TEN, {"tenure": "other"}),
                  ("Porcentaje de principales", DWS, {"dwelling_type": "main"}), ("Porcentaje de no principales", DWS, {"dwelling_type": "non_main"}),
                  ("Porcentaje de vacías", DWS, {"dwelling_type": "empty"}), ("Porcentaje en propiedad", TENS, {"tenure": "owned"}),
                  ("Porcentaje en alquiler", TENS, {"tenure": "rented"}), ("Porcentaje otras formas de tenencia", TENS, {"tenure": "other"}),
                  ("Precios de oferta (venta)", OFS, {}), ("Precios de oferta (alquiler)", OFR, {}),
                  ("Referencias estadísticas de alquiler", RREF, {}), ("Rentas declaradas", RDEC, {}), ("Transacciones", TRX, {}),
                  ("Tasaciones", APR, {}), ("Índice de precios de venta", IPV, {}), ("Índice de precios de alquiler", IPVA, {}),
                  ("Oferta activa observada", ACTV, {}), ("Altas observadas de anuncios", EVT, {"event_type": "new"}),
                  ("Cambios observados de anuncios", EVT, {"event_type": "price_change"}),
                  ("Bajas observadas de anuncios", EVT, {"event_type": "not_observed"})]:
    inv(S, lab, c, d, block="Precios y mercado" if c in (OFS, OFR, RREF, RDEC, TRX, APR, IPV, IPVA, ACTV, EVT) else "Parque y tenencia")

# ---------------------------------------------------------------- 9.10 Turismo
S = "9.10"
T = dict(family="turismo", section=S)
VT = ind("tour.dwellings", "Viviendas turísticas", unit="viviendas", stat_type="stock", universe="Viviendas anunciadas en plataformas (INE VTE)", **T)
VTP = ind("tour.places", "Plazas en viviendas turísticas", unit="plazas", stat_type="stock", **T)
VTPV = ind("tour.places_per_dwelling", "Plazas por vivienda turística", unit="plazas/vivienda", stat_type="ratio", **T)
VTS = ind("tour.dwellings_share", "Porcentaje de viviendas turísticas", unit="%", stat_type="share", denominator="viviendas censadas",
          functions=SCR, scoring="eligible", higher="depends", **T)
TRV = ind("tour.travellers", "Viajeros", unit="viajeros", stat_type="flow", dims=["accommodation_type"], **T)
NGT = ind("tour.overnights", "Pernoctaciones", unit="pernoctaciones", stat_type="flow", dims=["accommodation_type"], **T)
OCC = ind("tour.occupancy", "Ocupación", unit="%", stat_type="rate", dims=["accommodation_type", "measure"],
          notes="No se extrapola la ocupación de una categoría de alojamiento a cualquier vivienda.", **T)
SEA = ind("tour.seasonality", "Estacionalidad", unit="índice", stat_type="index", formula="máximo mensual / media mensual de pernoctaciones", **T)
REG = ind("tour.registry_entries", "Inscripciones en registros turísticos", unit="inscripciones", stat_type="stock", **T)
for lab, c in [("Viviendas turísticas", VT), ("Plazas", VTP), ("Plazas por vivienda", VTPV), ("Porcentaje de viviendas turísticas", VTS),
               ("Viajeros", TRV), ("Pernoctaciones", NGT), ("Ocupación", OCC), ("Estacionalidad", SEA),
               ("Inscripciones en registros", REG)]:
    inv(S, lab, c)

# ---------------------------------------------------------------- 9.11 Construcción
S = "9.11"
C = dict(family="construccion", section=S, notes="No se suman visados, inicios y terminaciones como viviendas independientes.")
CV = ind("con.dwellings_stage", "Viviendas por fase del proceso constructivo", unit="viviendas", stat_type="flow", dims=["stage"], **C)
CL = ind("con.licences", "Licencias de obra", unit="licencias", stat_type="flow", dims=["licence_type"], **C)
CR = ind("con.dwellings_created", "Viviendas creadas", unit="viviendas", stat_type="flow", dims=["origin"], **C)
CL5 = ind("con.licences_5y_per_1000", "Licencias quinquenales por 1.000 habitantes", unit="‰", stat_type="rate",
          formula="Σ licencias 5 años / pop.padron (año final) × 1000", denominator="pop.padron", **C)
CP = ind("con.protected_housing", "Vivienda protegida", unit="viviendas/actuaciones", stat_type="flow", dims=["measure"], **C)
for lab, c, d in [("Viviendas en proyectos visados", CV, {"stage": "permits_visa"}),
                  ("Viviendas con certificado final", CV, {"stage": "completion_certificate"}),
                  ("Viviendas previstas de nueva planta", CV, {"stage": "planned_new"}),
                  ("Viviendas previstas en rehabilitación", CV, {"stage": "planned_rehab"}),
                  ("Viviendas previstas para demolición", CV, {"stage": "planned_demolition"}),
                  ("Licencias de obra mayor de todos los usos", CL, {"licence_type": "major_all_uses"}),
                  ("Licencias de nueva planta", CL, {"licence_type": "new_build"}),
                  ("Licencias de rehabilitación", CL, {"licence_type": "rehab"}),
                  ("Licencias de demolición total", CL, {"licence_type": "total_demolition"}),
                  ("Viviendas creadas por rehabilitación", CR, {"origin": "rehab"}),
                  ("Viviendas creadas en locales", CR, {"origin": "commercial_premises"}),
                  ("Licencias quinquenales por 1.000 habitantes", CL5, {}),
                  ("Viviendas libres iniciadas", CV, {"stage": "free_started"}),
                  ("Viviendas libres terminadas", CV, {"stage": "free_completed"}),
                  ("Calificaciones provisionales de protegidas", CP, {"measure": "provisional_qualification"}),
                  ("Calificaciones definitivas de protegidas", CP, {"measure": "final_qualification"}),
                  ("Licencias de construcción", CL, {"licence_type": "construction"}),
                  ("Licencias de primera ocupación", CL, {"licence_type": "first_occupation"}),
                  ("Actuaciones protegidas de rehabilitación", CP, {"measure": "protected_rehab"})]:
    inv(S, lab, c, d)
inv(S, "Referencias 'OVV' e indicadores específicos de València", None, status="unresolved",
    notes="Pendiente identificar organismo, territorio y metodología; no se extienden al resto de España.")

# ---------------------------------------------------------------- 9.12 Datos complementarios
S = "9.12"
X = dict(family="complementarios", section=S)
DOC = ["pantalla", "calculo", "documentacion"]
for code, lab, unit, st, fn, note in [
    ("cad.parcel_attributes", "Catastro: referencia, uso, superficies, antigüedad, localización y geometrías", "varios", "category", DOC, None),
    ("geo.boundaries_addresses", "Cartografía: límites, direcciones y códigos territoriales", "varios", "category", DOC, None),
    ("ene.certificate", "Energía: certificado, fecha, ámbito, calificación, consumo y emisiones calculados", "varios", "category", DOC,
     "Consumo y emisiones son calculados por el certificador, no medidos."),
    ("svc.facilities", "Servicios: centros sanitarios, docentes y enseñanzas", "unidades", "count", STD, None),
    ("svc.distance", "Distancia a servicios", "m", "distance", STD, "Distancia euclídea salvo que se indique red."),
    ("trn.transit", "Transporte: paradas, líneas, horarios y calendarios", "varios", "count", STD, None),
    ("trn.access_time", "Tiempos de acceso", "min", "time", STD, "Solo con red y metodología adecuadas."),
    ("mob.commuting", "Movilidad residencia-trabajo", "personas", "flow", STD, None),
    ("fin.interest_rates", "Tipos de interés y financiación", "%", "rate", CALC, None),
    ("fin.mortgages", "Hipotecas", "hipotecas", "flow", STD, None),
    ("fin.cpi", "IPC y referencias de actualización", "índice", "index", CALC, None),
    ("tax.acquisition", "Tributos de adquisición", "%", "rate", DOC, "Reglas fechadas en invest.tax_rules."),
    ("tax.ibi_rules", "Tipos y reglas de IBI", "%", "rate", DOC, "El tipo no basta para conocer el recibo individual."),
    ("tax.fees_bonuses", "Tasas y bonificaciones", "varios", "category", DOC, "No se aplican bonificaciones sin comprobar condiciones."),
    ("reg.regulation", "Normativa aplicable, con fecha y ámbito", "texto", "category", ["documentacion"], None),
    ("urb.planning", "Planeamiento y usos publicados", "texto", "category", ["documentacion"], None),
    ("urb.heritage", "Protección patrimonial", "texto", "category", ["documentacion"], None),
    ("urb.ite_iee", "ITE/IEE y documentación de conservación", "texto", "category", ["documentacion"],
     "Documentación o entrada justificada; no genera puntuación de riesgos."),
    ("hou.protected_stock", "Vivienda protegida", "viviendas", "stock", STD, None),
    ("loc.budget_investment", "Presupuestos e inversión local", "EUR", "amount", STD, None),
    ("loc.public_procurement", "Contratación pública y estado de las actuaciones", "contratos", "count", STD, None),
    ("study.public", "Estudios públicos", "texto", "category", ["documentacion"], "Respetar metodología y posibilidades de reutilización."),
]:
    ind(code, lab, unit=unit, stat_type=st, functions=fn, notes=note, **X)
    inv(S, lab, code)

# Derivados adicionales (§13)
S = "13"
Z = dict(family="derivados", section=S)
RE = ind("der.rent_effort", "Esfuerzo de alquiler", unit="%", stat_type="ratio",
         formula="renta de oferta anual de una vivienda tipo / inc.net_mean_household × 100",
         denominator="Renta neta media por hogar (ADRH, mismo territorio; año más próximo, indicado)",
         notes="Universo compatible: hogar con hogar. No se divide entre renta por declaración o por persona.", functions=SCR,
         scoring="eligible", higher="worse", **Z)
PI = ind("der.price_to_income", "Relación precio/ingresos", unit="años", stat_type="ratio",
         formula="precio de oferta de una vivienda tipo (m² declarados) / inc.net_mean_household",
         denominator="Renta neta media por hogar", functions=SCR, scoring="eligible", higher="worse", **{k: v for k, v in Z.items()})
TW = ind("der.tourism_weight", "Peso turístico", unit="%", stat_type="share", formula="tour.dwellings / hou.dwellings total × 100",
         functions=SCR, scoring="eligible", higher="depends", **Z)
HHI = ind("der.sector_concentration", "Concentración sectorial (HHI)", unit="índice", stat_type="index",
          formula="Σ (cuota sectorial²) sobre afiliación o empresas", **Z)
PCT = ind("der.percentile", "Percentil en un universo estable", unit="percentil", stat_type="other", dims=["indicator", "universe"],
          formula="posición del valor en la distribución ordenada del universo declarado", **Z)
YLD = ind("der.gross_yield_zone", "Rentabilidad bruta estimada de la zona", unit="%", stat_type="ratio",
          formula="mediana renta oferta €/m²/mes × 12 / mediana precio oferta €/m² × 100",
          notes="Estimación con medianas de oferta; requiere n mínimo y misma fecha. No es un resultado de inversión.",
          functions=STD, **Z)
for lab, c in [("Esfuerzo de alquiler", RE), ("Relación precio/ingresos", PI), ("Peso turístico", TW),
               ("Distribución y concentración sectorial", HHI), ("Comparaciones territoriales y percentiles", PCT),
               ("Rentabilidad bruta estimada de la zona", YLD), ("Variación absoluta", None), ("Variación porcentual", None)]:
    if c:
        inv(S, lab, c)
GV = ind("der.change_abs", "Variación absoluta", unit="según indicador", stat_type="flow", formula="v[t] - v[t-k]", dims=["indicator", "k"], **Z)
GP = ind("der.change_pct", "Variación porcentual", unit="%", stat_type="rate", formula="(v[t] / v[t-k]) - 1", dims=["indicator", "k"], **Z)
inv(S, "Variación absoluta", GV)
inv(S, "Variación porcentual", GP)

# ---------------------------------------------------------------- 9.13 Exclusiones
S = "9.13"
for code, lab in [("risk.flood", "Inundación"), ("risk.radon", "Radón"), ("risk.fire", "Incendio"),
                  ("risk.geological", "Riesgos geológicos"), ("risk.other_physical", "Otros riesgos físicos del catálogo original"),
                  ("risk.crime", "Criminalidad"), ("risk.evictions", "Ejecuciones o lanzamientos como indicadores de riesgo")]:
    ind(code, lab, "excluidos", S, "—", "other", excluded=True, exclusion_reason="Excluido por decisión de producto (§2 y §9.13): sin módulo de riesgos.")
    inv(S, lab, code, excluded=True, reason="Decisión de producto: sin análisis, mapas ni puntuaciones de riesgos.")
