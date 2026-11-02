"""Correspondencias recurso → indicador (con mapeo de dimensiones y estado)."""

M = []


def m(resource, indicator, status="partial", dims=None, transformation="ninguna", coverage=None, notes=None):
    M.append(dict(resource_code=resource, indicator_code=indicator, match_status=status, dims_mapping=dims or {},
                  transformation=transformation, coverage=coverage, notes=notes))


SEXO = {"Sexo": {"Hombres": {"sex": "male"}, "Mujeres": {"sex": "female"}}}
m("ine.dpop.29005", "pop.padron", "exact", {"Sexo": {"Total": {}}}, coverage="municipio · 1996–2025")
m("ine.dpop.29005", "pop.padron.by_sex", "exact", SEXO, coverage="municipio · 1996–2025")
ADRH = {"SALDOS CONTABLES": {}}
for ind, label in [("inc.net_mean_person", "Renta neta media por persona"), ("inc.net_mean_household", "Renta neta media por hogar"),
                   ("inc.mean_consumption_unit", "Media de la renta por unidad de consumo"),
                   ("inc.median_consumption_unit", "Mediana de la renta por unidad de consumo"),
                   ("inc.gross_mean_person", "Renta bruta media por persona"), ("inc.gross_mean_household", "Renta bruta media por hogar")]:
    m("ine.adrh.renta", ind, "exact", {"SALDOS CONTABLES": {label: {}}}, coverage="municipio/distrito/sección")
m("ine.adrh.fuentes", "inc.source_share")
m("ine.adrh.umbrales", "inc.pop_below_threshold", notes="Solo umbrales publicados.")
m("ine.adrh.umbrales", "inc.pop_above_threshold", notes="Solo umbrales publicados.")
m("ine.adrh.gini", "inc.gini", "exact")
m("ine.adrh.gini", "inc.p80_p20", "exact")
for i in ["pop.mean_age", "hh.mean_size", "hh.share_single", "pop.share.by_age"]:
    m("ine.adrh.demograficos", i, notes="Indicadores demográficos del ADRH; universo y fecha propios.")
for i in ["pop.by_age", "pop.by_age_sex"]:
    m("ine.dpop.prov_edad", i)
for i in ["pop.by_nationality", "pop.by_birthplace", "pop.mean_age.by_sex"]:
    m("ine.dpop.prov_nacionalidad", i)
for i in ["pop.census", "edu.attainment", "edu.attainment_share", "pers.activity_status", "pers.marital_status",
          "edu.students_resident", "emp.census_rates", "hh.total", "hh.by_size", "pers.disability_pension"]:
    m("ine.censo2021.poblacion", i, "ambiguous" if i in ("hh.total", "hh.by_size") else "partial")
for i in ["hou.dwellings", "hou.main_by_tenure"]:
    m("ine.censo2021.viviendas", i)
m("ine.emcr.69696", "mig.immigration_external", "exact", SEXO)
m("ine.emcr.69711", "mig.emigration_external", "exact", SEXO)
m("ine.emcr.69743", "mig.immigration_internal", "partial", SEXO)
m("ine.emcr.69743", "mig.internal_flows_foreign", "partial")
for i in ["mig.net_internal", "mig.net_external", "mig.net_total"]:
    m("ine.emcr.69767", i, "exact")
m("ine.vte.39363", "tour.dwellings", "exact")
m("ine.vte.39363", "tour.places", "exact")
m("ine.vte.39363", "tour.places_per_dwelling", "exact")
m("ine.vte.39366", "tour.dwellings_share", "exact")
m("ine.ipva.59060", "mkt.price_index_rent", "exact", coverage="municipios > 10.000 hab")
m("ine.ipv", "mkt.price_index_sale", "exact", coverage="CCAA")
m("ine.etdp", "mkt.transactions", "partial", coverage="provincia")
m("mivau.transacciones", "mkt.transactions", "exact", coverage="municipios > 25.000 hab")
m("notariado.portal", "mkt.transactions", "ambiguous", notes="Universo notarial; reutilización no confirmada.")
m("mivau.tasaciones", "mkt.appraisal_value_m2", "exact")
m("mivau.alquiler_tributario", "mkt.declared_rent", "exact")
m("mivau.serpavi", "mkt.rent_reference_official", "exact")
m("mivau.construccion", "con.dwellings_stage")
m("mivau.licencias", "con.licences")
m("mivau.vivienda_libre", "con.dwellings_stage")
m("mivau.vpo", "con.protected_housing")
m("mivau.vpo", "hou.protected_stock", "ambiguous")
m("ayto.ordenanzas_urbanismo", "con.dwellings_created")
for i in ["irpf.returns", "irpf.returns_by_component", "irpf.amount", "irpf.mean_per_return"]:
    m("aeat.irpf_municipal", i, "exact", coverage="territorio común; municipios > 1.000 hab")
    m("forales.irpf", i, "ambiguous", notes="Conceptos forales no equivalentes sin validación.")
for i in ["emp.registered_unemployment", "emp.registered_unemployment.by_sex", "emp.contracts", "emp.contracts.by_sex"]:
    m("sepe.paro_municipal", i)
m("seg_social.afiliacion_municipal", "emp.affiliations")
m("ine.dirce", "emp.firms_by_activity")
for i in ["tour.travellers", "tour.overnights", "tour.occupancy"]:
    m("ine.eot", i, notes="Alojamientos reglados; no extrapolable a viviendas.")
m("turismo.registros", "tour.registry_entries")
m("catastro.inspire", "cad.parcel_attributes")
m("catastro.estadistica", "cad.parcel_attributes")
m("cnig.lineas_limite", "geo.boundaries_addresses", "exact")
m("es_atlas.municipalities.0.6.0", "geo.boundaries_addresses", "partial", notes="Derivado simplificado.")
m("cartociudad.geocoder", "geo.boundaries_addresses")
m("energia.registros", "ene.certificate")
m("sanidad.regcess", "svc.facilities")
m("educacion.rcd_ruct", "svc.facilities")
m("educacion.rcd_ruct", "edu.enrolment")
m("nap.gtfs", "trn.transit")
m("ine.movilidad", "mob.commuting")
m("bde.tipos_hipotecarios", "fin.interest_rates", "exact")
m("ine.hpt", "fin.mortgages", "exact")
m("ine.ipc", "fin.cpi", "exact")
m("ine.irav", "fin.cpi", "partial", notes="IRAV: índice específico de actualización de arrendamientos.")
m("hacienda.itp_ajd", "tax.acquisition")
m("ccaa.normativa", "tax.acquisition")
m("hacienda.ibi_tipos", "tax.ibi_rules")
m("ayto.ordenanzas_urbanismo", "tax.fees_bonuses")
for i in ["urb.planning", "urb.heritage", "urb.ite_iee"]:
    m("ayto.ordenanzas_urbanismo", i)
m("boe.legislacion", "reg.regulation")
m("ccaa.normativa", "reg.regulation")
m("hacienda.conprel", "loc.budget_investment")
m("placsp.atom", "loc.public_procurement")
m("estudios.varios", "study.public")

DERIVED = ["pop.share.by_sex", "pop.share.by_age", "pop.share.by_age_sex", "demo.density", "demo.masculinity_index",
           "demo.ageing_index", "demo.dependency_youth", "demo.dependency_old", "demo.dependency_total", "demo.pop_growth_1y",
           "demo.pop_growth_5y", "demo.pop_growth_10y", "demo.pop_cagr_5y", "demo.pop_cagr_10y", "mig.net_per_1000",
           "hh.growth", "emp.registered_unemployment_yoy", "emp.affiliations_yoy", "hou.dwellings_share", "hou.tenure_share",
           "tour.seasonality", "con.licences_5y_per_1000", "der.rent_effort", "der.price_to_income", "der.tourism_weight",
           "der.sector_concentration", "der.percentile", "der.change_abs", "der.change_pct", "svc.distance", "trn.access_time"]
for i in DERIVED:
    m("derived.inmo360", i, "exact", transformation="ver fórmula del indicador")
for i in ["mkt.offer_price_sale_m2", "mkt.offer_rent_m2", "mkt.active_listings", "mkt.listing_events", "der.gross_yield_zone"]:
    m("market.inmo360", i, "exact", transformation="estadística sobre inmuebles únicos deduplicados")
for i in ["risk.flood", "risk.radon", "risk.fire", "risk.geological", "risk.other_physical", "risk.crime", "risk.evictions"]:
    m("excluded.product_decision", i, "exact", transformation="no se importa")

# Añadidos por el adjunto original
for i in ["pop.share_of_total.by_age_sex", "pop.share.by_nationality", "pop.share.by_birthplace"]:
    m("derived.inmo360", i, "exact", transformation="ver fórmula del indicador")
m("ine.censo2021.poblacion", "pers.activity_share", "partial")
m("ine.censo2021.poblacion", "pers.marital_share", "partial")
m("ine.censo2021.poblacion", "pers.disability_pension_share", "ambiguous")
m("educacion.rcd_ruct", "edu.enrolment_share", "ambiguous")
