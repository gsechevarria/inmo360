# Estado real de las fuentes

Generado desde el catálogo de la base aislada el 2026-11-02 (`catalog.resources`; también visible en *Fuentes e indicadores*). El **estado técnico** solo avanza con evidencia: encontrar la web de una fuente no la convierte en integración. El **estado de reutilización** se evalúa por separado.

Escala técnica: catalogado → recurso identificado (URL comprobada) → descarga probada → esquema validado → importación probada (cargado por el trabajador en la base aislada) → operativo (en uso con ejecución recurrente).

## Datos realmente importados (base aislada, 2026-11-02)

Universo: 8.132 municipios vigentes (8.131 con geometría es-atlas 0.6.0; 48916 Usansolo sin geometría). Algunos recuentos superan esa cifra porque incluyen municipios históricos del padrón (vigentes en años anteriores).

| Indicador | Municipios con dato | Último periodo | Sintético |
|---|---|---|---|
| `demo.density` | 8.119 | 2025 | no |
| `demo.masculinity_index` | 8.134 | 2025 | no |
| `demo.pop_cagr_10y` | 8.117 | 2025 | no |
| `demo.pop_cagr_5y` | 8.131 | 2025 | no |
| `demo.pop_growth_10y` | 8.117 | 2025 | no |
| `demo.pop_growth_1y` | 8.134 | 2025 | no |
| `demo.pop_growth_5y` | 8.131 | 2025 | no |
| `inc.net_mean_household` | 8.126 | 2024 | no |
| `inc.net_mean_person` | 8.126 | 2024 | no |
| `mkt.offer_price_sale_m2` | 6 | 2026-11 | **sí** |
| `mkt.offer_rent_m2` | 6 | 2026-11 | **sí** |
| `pop.padron` | 8.134 | 2025 | no |
| `tour.dwellings` | 8.135 | 2026-05 | no |
| `tour.places` | 8.135 | 2026-05 | no |
| `tour.places_per_dwelling` | 6.254 | 2026-05 | no |

Origen: padrón municipal (INE 29005, 2015–2025), renta neta media ADRH (INE, 2015–2024; la tabla provincial 30824 llegó truncada en la captura y no se importó; 8 municipios pequeños sin dato), viviendas turísticas (INE 39363, 2020-08 → 2026-05). Descargados con el navegador del propietario (la red de la sesión de construcción no alcanzaba el INE) e importados por el trabajador real (`stats.browser_capture`), con método de captura registrado en cada observación. Derivados calculados con `stats.derive`.

Los indicadores `mkt.*` proceden de los **507 anuncios sintéticos** de prueba (6 municipios) y están marcados como sintéticos en toda la web. **No se ha importado ningún anuncio real**: no hay todavía una fuente de anuncios autorizada (ver *Bloqueado*).

## Recursos por estado técnico

### Operativo (3)

| Recurso | Fuente | Reutilización | Evidencia / motivo / notas |
|---|---|---|---|
| **Indicadores derivados calculados por Inmo360**<br>`derived.inmo360` | Cálculos derivados de Inmo360 | No aplica | Funciones SQL stats.derive_* y market.compute_offer_stats con pruebas en BD aislada (worker/tests); ejecutadas sobre los datos INE importados. |
| **Estadísticas de oferta observada (anuncios deduplicados)**<br>`market.inmo360` | Cálculos derivados de Inmo360 | No aplica | Cobertura de anuncios separada de la cobertura estadística. |
| **Valores introducidos por el usuario**<br>`user.input` | Aportaciones del usuario | No aplica | — |

### Importación probada (5)

| Recurso | Fuente | Reutilización | Evidencia / motivo / notas |
|---|---|---|---|
| **es-atlas 0.6.0 · municipios, provincias y CCAA (TopoJSON)**<br>`es_atlas.municipalities.0.6.0` | es-atlas (TopoJSON derivado de IGN/CNIG) | Licencia abierta | 2026-11-02: 8.213 recintos cargados (8.131 municipios + 81 condominios + Gibraltar excluido); 48916 Usansolo sin geometría. |
| **CSV/JSON de anuncios (contrato documentado)**<br>`file_import.listings` | Importación de archivos CSV/JSON del propietario | No aplica | Pruebas del trabajador contra BD aislada (idempotencia, unidades de precio, errores). |
| **ADRH · Indicadores de renta media y mediana (una tabla por provincia)**<br>`ine.adrh.renta` | Instituto Nacional de Estadística | Licencia abierta | 2026-11-02: descarga real de las tablas provinciales desde el navegador; importadas renta neta media por persona y por hogar a nivel municipal en BD aislada. Media/mediana por UC y renta bruta: mapeadas, no importadas aún. |
| **Cifras oficiales del padrón por municipio (y sexo)**<br>`ine.dpop.29005` | Instituto Nacional de Estadística | Licencia abierta | 2026-11-02: descarga real desde el navegador del propietario (24.414 series); parser validado con fixture literal; importación probada en BD aislada. Pendiente ejecución directa del trabajador en el PC → 'operational'. |
| **Viviendas turísticas, plazas y plazas por vivienda turística por municipio**<br>`ine.vte.39363` | Instituto Nacional de Estadística | Licencia abierta | 2026-11-02: descarga real desde el navegador del propietario; viviendas turísticas y plazas por municipio (2020-08 → 2026-05) importadas en BD aislada por el trabajador (captura de navegador). Pendiente ejecución directa desde el PC. |

### Recurso identificado (20)

| Recurso | Fuente | Reutilización | Evidencia / motivo / notas |
|---|---|---|---|
| **Líneas límite municipales (SHP ETRS89/REGCAN95)**<br>`cnig.lineas_limite` | CNIG / IGN · Líneas límite y cartografía | Licencia abierta | Conector oficial pendiente: la descarga exige aceptar la licencia en el centro de descargas. Mientras tanto se usa es-atlas (derivado del mismo producto). |
| **ADRH · Indicadores demográficos (edad media, hogares, tamaño medio…)**<br>`ine.adrh.demograficos` | Instituto Nacional de Estadística | Licencia abierta | — |
| **ADRH · Distribución por fuente de ingresos**<br>`ine.adrh.fuentes` | Instituto Nacional de Estadística | Licencia abierta | Operación 353 listada en la API (540 tablas). |
| **ADRH · Índice de Gini y distribución P80/P20**<br>`ine.adrh.gini` | Instituto Nacional de Estadística | Licencia abierta | — |
| **ADRH · Población por umbrales de ingresos por unidad de consumo**<br>`ine.adrh.umbrales` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Censo de Población 2021+ (CENSOP) · tablas municipales**<br>`ine.censo2021.poblacion` | Instituto Nacional de Estadística | Licencia abierta | — |
| **DIRCE · empresas y locales por actividad**<br>`ine.dirce` | Instituto Nacional de Estadística | Licencia abierta | La operación 43 (DIR) no expone tablas municipales en la API; puede requerir descarga de ficheros. |
| **Inmigraciones procedentes del extranjero por municipio, año y sexo**<br>`ine.emcr.69696` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Emigraciones con destino al extranjero por municipio, año y sexo**<br>`ine.emcr.69711` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Inmigraciones intermunicipales por municipio de destino, año, sexo y nacionalidad**<br>`ine.emcr.69743` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Saldos migratorios por municipio, año, sexo y tipo de saldo**<br>`ine.emcr.69767` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Encuestas de ocupación turística (hoteles, apartamentos, rural)**<br>`ine.eot` | Instituto Nacional de Estadística | Licencia abierta | Universo: establecimientos reglados, no viviendas. |
| **Estadística de Transmisiones de Derechos de la Propiedad**<br>`ine.etdp` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Estadística de Hipotecas**<br>`ine.hpt` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Índice de Precios de Consumo (IPC)**<br>`ine.ipc` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Índice de Precios de Vivienda (IPV)**<br>`ine.ipv` | Instituto Nacional de Estadística | Licencia abierta | — |
| **IPVA · índices por municipio (> 10.000 habitantes)**<br>`ine.ipva.59060` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Índice de Referencia de Arrendamientos de Vivienda (IRAV)**<br>`ine.irav` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Proyecciones de población y hogares**<br>`ine.proyecciones` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Porcentaje de viviendas turísticas sobre el total de viviendas censadas**<br>`ine.vte.39366` | Instituto Nacional de Estadística | Licencia abierta | — |

### Catalogado (47)

| Recurso | Fuente | Reutilización | Evidencia / motivo / notas |
|---|---|---|---|
| **Estadística de declarantes del IRPF por municipios**<br>`aeat.irpf_municipal` | Agencia Tributaria · Estadística de declarantes del IRPF | Con condiciones | Renta por declaración ≠ renta por hogar. Excluye País Vasco y Navarra. |
| **Redes de agencias (franquicias)**<br>`agency_network.franquicias` | Redes de agencias (franquicias) | Por verificar | Revisar condiciones y robots de cada red antes de activar. |
| **Webs de agencias con datos estructurados (JSON-LD schema.org / sitemap)**<br>`agency_web.jsonld` | Webs de inmobiliarias independientes | Por verificar | Conector genérico implementado y probado con páginas de prueba; requiere lista de agencias y ejecución en el PC. |
| **Ordenanzas fiscales, planeamiento, protección patrimonial, ITE/IEE**<br>`ayto.ordenanzas_urbanismo` | Ayuntamientos · ordenanzas, urbanismo y conservación | Por verificar | — |
| **Rendimiento del bono español a 10 años**<br>`bde.bono10` | Banco de España | Con condiciones | — |
| **Tipos de interés de préstamos para vivienda y Euríbor**<br>`bde.tipos_hipotecarios` | Banco de España | Con condiciones | — |
| **BOE · legislación consolidada (API)**<br>`boe.legislacion` | BOE · datos abiertos | Licencia abierta | — |
| **CartoCiudad · geocodificador y direcciones**<br>`cartociudad.geocoder` | CartoCiudad | Licencia abierta | — |
| **Estadística catastral municipal (urbana)**<br>`catastro.estadistica` | Dirección General del Catastro (datos no protegidos) | Con condiciones | — |
| **Catastro INSPIRE · parcelas, edificios y direcciones (ATOM/WFS)**<br>`catastro.inspire` | Dirección General del Catastro (datos no protegidos) | Con condiciones | — |
| **Normativa autonómica de vivienda, turismo y tributos**<br>`ccaa.normativa` | Administraciones autonómicas · normativa y tributos cedidos | Por verificar | — |
| **Registro de centros docentes y universidades (RCD/RUCT) y matrícula (SIIU)**<br>`educacion.rcd_ruct` | Ministerio de Educación / Universidades · centros y matrícula | Por verificar | — |
| **Registros autonómicos de certificados de eficiencia energética**<br>`energia.registros` | Registros autonómicos de certificados energéticos | Por verificar | — |
| **Estudios públicos pertinentes**<br>`estudios.varios` | Estudios públicos pertinentes | Por verificar | — |
| **Eustat · renta personal y familiar por municipio**<br>`eustat.renta` | Eustat | Licencia abierta | — |
| **Feeds XML formato Kyero aportados por agencias**<br>`feed.kyero_xml` | Feeds XML/JSON aportados por agencias | Por verificar | Parser implementado y probado con XML de prueba. |
| **IRPF de las haciendas forales**<br>`forales.irpf` | Haciendas y catastros forales (Álava, Bizkaia, Gipuzkoa, Navarra) | Por verificar | — |
| **Descubrimiento de agencias con Google Places**<br>`google_places.discovery` | Google Places (descubrimiento opcional de agencias) | Restringido | Opcional, no implementado: no es dependencia del MVP. |
| **Presupuestos y liquidaciones de entidades locales**<br>`hacienda.conprel` | Ministerio de Hacienda · tributos, IBI, finanzas locales | Por verificar | — |
| **Tipos de gravamen del IBI por municipio**<br>`hacienda.ibi_tipos` | Ministerio de Hacienda · tributos, IBI, finanzas locales | Por verificar | El tipo no basta para conocer el recibo individual. |
| **Tipos autonómicos de ITP y AJD (normativa y 'Tributación autonómica')**<br>`hacienda.itp_ajd` | Ministerio de Hacienda · tributos, IBI, finanzas locales | Por verificar | Las reglas se cargan en invest.tax_rules con vigencia y fuente; nunca se aplican sin confirmar. |
| **IGN · WFS INSPIRE Unidades administrativas**<br>`ign.wfs_au` | CNIG / IGN · Líneas límite y cartografía | Licencia abierta | — |
| **Censo de Viviendas 2021 · tenencia y uso por municipio**<br>`ine.censo2021.viviendas` | Instituto Nacional de Estadística | Licencia abierta | Pendiente localizar el recurso estructurado municipal de viviendas principales/no principales/vacías y tenencia. |
| **Padrón · población por municipio, sexo y edad (quinquenal)**<br>`ine.dpop.prov_edad` | Instituto Nacional de Estadística | Licencia abierta | Identificar tablas provinciales de la operación DPOP/ECP con desglose de edad. |
| **Padrón · población por municipio, nacionalidad y lugar de nacimiento**<br>`ine.dpop.prov_nacionalidad` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Indicadores urbanos (Urban Audit)**<br>`ine.indicadores_urbanos` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Movilidad residencia-trabajo / estudios de movilidad**<br>`ine.movilidad` | Instituto Nacional de Estadística | Licencia abierta | — |
| **Sistema estatal de referencia del precio del alquiler / rentas declaradas (IRPF)**<br>`mivau.alquiler_tributario` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | Rentas declaradas por arrendadores; no son precios de oferta. |
| **Construcción de edificios (visados) y certificados fin de obra**<br>`mivau.construccion` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **Licencias municipales de obra**<br>`mivau.licencias` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **Observatorio de Vivienda y Suelo (boletines)**<br>`mivau.observatorio` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **SERPAVI · índice de referencia de alquiler**<br>`mivau.serpavi` | Ministerio de Vivienda y Agenda Urbana | Solo consulta | No se presupone API masiva. |
| **Precio del suelo urbano**<br>`mivau.suelo` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **Valor tasado de la vivienda libre**<br>`mivau.tasaciones` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | Tasación ≠ precio de cierre. |
| **Estadística de transacciones inmobiliarias**<br>`mivau.transacciones` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **Vivienda libre iniciada y terminada**<br>`mivau.vivienda_libre` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **Vivienda protegida · calificaciones y actuaciones de rehabilitación**<br>`mivau.vpo` | Ministerio de Vivienda y Agenda Urbana | Con condiciones | — |
| **Feeds GTFS/NeTEx del NAP**<br>`nap.gtfs` | Punto de Acceso Nacional de transporte (GTFS/NeTEx) | Con condiciones | — |
| **Nastat · renta y estadísticas municipales de Navarra**<br>`nastat.renta` | Nastat · Instituto de Estadística de Navarra | Por verificar | — |
| **Portal estadístico notarial (compraventas y precios)**<br>`notariado.portal` | Consejo General del Notariado · portal estadístico | Solo consulta | — |
| **Licitaciones y contratos (ATOM)**<br>`placsp.atom` | Plataforma de Contratación del Sector Público | Licencia abierta | — |
| **Estadística Registral Inmobiliaria**<br>`registradores.eri` | Colegio de Registradores · Estadística Registral | Solo consulta | — |
| **Registro de centros, servicios y establecimientos sanitarios**<br>`sanidad.regcess` | Ministerio de Sanidad · REGCESS | Por verificar | — |
| **Afiliación a la Seguridad Social por municipio y régimen**<br>`seg_social.afiliacion_municipal` | Seguridad Social · Afiliación | Con condiciones | Afiliaciones ≠ personas únicas (pluriempleo). |
| **Paro registrado y contratos por municipio**<br>`sepe.paro_municipal` | Servicio Público de Empleo Estatal | Con condiciones | Paro registrado ≠ tasa de paro; contratos ≠ personas. |
| **Registros de viviendas de uso turístico por CCAA y registro único**<br>`turismo.registros` | Registros turísticos autonómicos y registro único de arrendamientos | Por verificar | — |
| **Referencias 'OVV' e indicadores específicos de València**<br>`valencia.ovv` | Estudios públicos pertinentes | Por verificar | Pendiente identificar organismo, territorio y metodología. No se extiende al resto de España. |

### Bloqueado (2)

| Recurso | Fuente | Reutilización | Evidencia / motivo / notas |
|---|---|---|---|
| **Fotocasa**<br>`fotocasa.web` | Fotocasa | Restringido | Sin API o feed autorizado. No se implementa extracción HTML ni se eluden protecciones. |
| **Idealista · API de búsqueda de inmuebles**<br>`idealista_api.search` | Idealista · API oficial | Restringido | Requiere credenciales (API key/secret) concedidas por Idealista. Conector implementado sin activar. |

### No disponible (1)

| Recurso | Fuente | Reutilización | Evidencia / motivo / notas |
|---|---|---|---|
| **Bloques excluidos por decisión de producto (§9.13)**<br>`excluded.product_decision` | Bloques excluidos por decisión de producto | No aplica | — |
