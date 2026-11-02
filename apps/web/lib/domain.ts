// Vocabulario compartido de la interfaz.

export const STRATEGIES = [
  { id: "rent_long", label: "Alquiler vivienda completa", short: "Alquiler" },
  { id: "rooms", label: "Alquiler por habitaciones", short: "Habitaciones" },
  { id: "temporary", label: "Alquiler temporal", short: "Temporal" },
  { id: "tourist", label: "Alquiler turístico", short: "Turístico" },
  { id: "resale", label: "Comprar para revender", short: "Reventa" },
] as const;
export type StrategyId = (typeof STRATEGIES)[number]["id"];
export const strategyLabel = (s: string) => STRATEGIES.find((x) => x.id === s)?.label ?? s;

export const OPPORTUNITY_STATUSES = [
  { id: "saved", label: "Guardada" }, { id: "to_analyze", label: "Por analizar" }, { id: "analyzed", label: "Analizada" },
  { id: "visit_pending", label: "Visita pendiente" }, { id: "offer_prepared", label: "Oferta preparada" },
  { id: "negotiating", label: "En negociación" }, { id: "discarded", label: "Descartada" }, { id: "closed", label: "Cerrada" },
] as const;

export const VALUE_STATUS: Record<string, { label: string; icon: string; cls: string }> = {
  observed: { label: "Observado", icon: "●", cls: "bg-brand-50 text-brand" },
  provisional: { label: "Provisional", icon: "◐", cls: "bg-info-50 text-info" },
  revised: { label: "Revisado", icon: "●", cls: "bg-brand-50 text-brand" },
  estimated: { label: "Estimado", icon: "≈", cls: "bg-warn-50 text-warn" },
  censored: { label: "Censurado", icon: "‹", cls: "bg-line-2 text-ink-2" },
  suppressed: { label: "Suprimido", icon: "×", cls: "bg-line-2 text-ink-2" },
  absent: { label: "Ausente", icon: "—", cls: "bg-line-2 text-ink-3" },
  not_applicable: { label: "No aplicable", icon: "n/a", cls: "bg-line-2 text-ink-3" },
  not_available: { label: "No disponible", icon: "—", cls: "bg-line-2 text-ink-3" },
  pending_interpretation: { label: "Pendiente de interpretar", icon: "?", cls: "bg-warn-50 text-warn" },
  // Calculadora
  confirmed: { label: "Confirmado", icon: "✓", cls: "bg-pos-50 text-pos" },
  published_unconfirmed: { label: "Publicado, sin confirmar", icon: "?", cls: "bg-info-50 text-info" },
  user_input: { label: "Introducido", icon: "✎", cls: "bg-brand-50 text-brand" },
  unknown: { label: "Desconocido", icon: "—", cls: "bg-neg-50 text-neg" },
  confirmed_zero: { label: "Cero confirmado", icon: "0✓", cls: "bg-pos-50 text-pos" },
};

export const TECH_STATUS: Record<string, { label: string; cls: string }> = {
  catalogued: { label: "Catalogado", cls: "bg-line-2 text-ink-2" },
  resource_identified: { label: "Recurso identificado", cls: "bg-info-50 text-info" },
  download_tested: { label: "Descarga probada", cls: "bg-info-50 text-info" },
  schema_validated: { label: "Esquema validado", cls: "bg-info-50 text-info" },
  import_tested: { label: "Importación probada", cls: "bg-pos-50 text-pos" },
  operational: { label: "Operativo", cls: "bg-pos-50 text-pos" },
  blocked: { label: "Bloqueado", cls: "bg-neg-50 text-neg" },
  not_available: { label: "No disponible", cls: "bg-line-2 text-ink-3" },
  obsolete: { label: "Obsoleto", cls: "bg-line-2 text-ink-3" },
};

export const FAMILY_LABELS: Record<string, string> = {
  poblacion: "Población y estructura", demografia_derivada: "Derivados demográficos", migraciones: "Migraciones", renta: "Renta",
  hogares: "Hogares", educacion: "Educación y situación personal", empleo: "Empleo y actividad", irpf: "IRPF",
  vivienda: "Vivienda", mercado: "Mercado residencial", turismo: "Turismo", construccion: "Construcción",
  complementarios: "Datos complementarios", derivados: "Indicadores derivados", excluidos: "Excluidos por decisión de producto",
};

/** Secciones de la ficha territorial → familias del catálogo */
export const ZONE_SECTIONS = [
  { id: "poblacion", title: "Población y hogares", families: ["poblacion", "demografia_derivada", "hogares", "migraciones"] },
  { id: "economia", title: "Economía y empleo", families: ["renta", "empleo", "irpf", "educacion"] },
  { id: "mercado", title: "Mercado residencial", families: ["vivienda", "mercado", "derivados"] },
  { id: "construccion", title: "Construcción", families: ["construccion"] },
  { id: "servicios", title: "Servicios y movilidad", families: ["complementarios"] },
  { id: "turismo", title: "Turismo", families: ["turismo"] },
];

/** Indicadores disponibles como columna/capa en el explorador de zonas (filtrables; nunca protegidos). */
export const ZONE_COLUMNS = [
  { code: "pop.padron", label: "Población", unit: "personas", short: "Población" },
  { code: "demo.pop_growth_1y", label: "Crecimiento 1 año", unit: "%", short: "Δ 1 a" },
  { code: "demo.pop_cagr_5y", label: "Crecimiento anual compuesto 5 años", unit: "%", short: "CAGR 5 a" },
  { code: "demo.pop_cagr_10y", label: "Crecimiento anual compuesto 10 años", unit: "%", short: "CAGR 10 a" },
  { code: "demo.density", label: "Densidad", unit: "hab/km²", short: "Densidad" },
  { code: "inc.net_mean_household", label: "Renta neta media por hogar", unit: "EUR", short: "Renta hogar" },
  { code: "inc.net_mean_person", label: "Renta neta media por persona", unit: "EUR", short: "Renta persona" },
  { code: "tour.dwellings", label: "Viviendas turísticas", unit: "viviendas", short: "Viv. turísticas" },
  { code: "tour.places_per_dwelling", label: "Plazas por vivienda turística", unit: "plazas/vivienda", short: "Plazas/viv." },
  { code: "mkt.offer_price_sale_m2", label: "Precio de oferta (venta)", unit: "EUR/m2", short: "Venta €/m²" },
  { code: "mkt.offer_rent_m2", label: "Renta de oferta", unit: "EUR/m2/mes", short: "Alquiler €/m²" },
] as const;
export const DEFAULT_COLUMNS = ["pop.padron", "demo.pop_cagr_5y", "demo.pop_cagr_10y", "inc.net_mean_household", "tour.dwellings"];

export const TYPE_LABEL: Record<string, string> = { flat: "Piso", house: "Casa/chalet", penthouse: "Ático", duplex: "Dúplex", studio: "Estudio", rural_house: "Casa rural", room: "Habitación", other: "Otro", unknown: "Sin especificar" };
export const COND_LABEL: Record<string, string> = { new: "Nuevo", good: "Buen estado", to_renovate: "A reformar", unknown: "Estado desconocido" };
