/** Tipos de trabajo que el panel permite encolar. Deben coincidir con worker/inmo_worker/registry.py. */
export const JOB_TYPES = [
  { type: "geo.es_atlas", source: "es_atlas", label: "Geografía: municipios y provincias (es-atlas, IGN vía npm)",
    params: {}, note: "Descarga pública; geometrías simplificadas para el mapa." },
  { type: "geo.cnig", source: "cnig", label: "Geografía oficial CNIG (líneas límite)", params: {},
    note: "Pendiente: requiere descarga manual del CNIG y colocar el ZIP en la bandeja de entrada del trabajador." },
  { type: "stats.ine_tempus", source: "ine", label: "INE API Tempus (directo desde el PC)",
    params: { preset: "padron_municipal_sexo", tables: ["29005"], nult: 3 }, note: "Presets: padron_municipal_sexo, adrh_renta, vte_municipal. El PC debe tener acceso a servicios.ine.es." },
  { type: "stats.browser_capture", source: "ine", label: "INE: importar capturas del navegador",
    params: { dataset: "ine_29005" }, note: "Datasets: ine_29005, ine_adrh, ine_vte. Los ficheros deben estar en <datos>/captures." },
  { type: "stats.derive", source: "derived", label: "Recalcular indicadores derivados y agregados",
    params: {}, note: "Crecimientos, densidad, ratios y estadísticas de oferta (mín. 5 anuncios). Refresca el «último dato disponible»." },
  { type: "listings.file_import", source: "mi_fuente", label: "Anuncios: importar CSV/JSON de la bandeja",
    params: { file: "anuncios.csv", complete_snapshot: false }, note: "Solo marque complete_snapshot si el fichero es una exportación TOTAL de esa fuente." },
  { type: "listings.feed_kyero", source: "agencia_feed", label: "Anuncios: feed XML Kyero de una agencia (autorizado)",
    params: { file: "feed.xml", agency_id: "agencia-1", agency_name: "Agencia", complete_feed: false }, note: "Solo con feed facilitado o autorizado por la agencia." },
  { type: "listings.agency_jsonld", source: "agencias_web", label: "Anuncios: webs de agencias con datos estructurados (schema.org)",
    params: { agencies: [{ source_agency_id: "agencia-1", name: "Agencia", website: "https://example.com", start_url: "https://example.com/venta" }], max_pages_per_agency: 5 },
    note: "Respeta robots.txt y límites de ritmo. No elude bloqueos ni captchas." },
  { type: "listings.idealista_api", source: "idealista_api", label: "Idealista API oficial (requiere credenciales concedidas)",
    params: { center: "40.4168,-3.7038", distance: 2000, operation: "sale", propertyType: "homes" }, note: "Bloqueado sin IDEALISTA_API_KEY/SECRET en el PC." },
] as const;
export const JOB_TYPE_IDS = JOB_TYPES.map((j) => j.type) as unknown as [string, ...string[]];
