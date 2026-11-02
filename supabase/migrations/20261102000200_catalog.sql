-- Inmo360 · 0002 · Catálogo de fuentes, recursos, indicadores y correspondencias

create table catalog.sources (
  code              text primary key,                 -- 'ine', 'mivau', 'aeat', 'ign'…
  name              text not null,
  family            text not null,                    -- 'estadistica_oficial','cartografia','fiscal','registro','portal','agencia','usuario','derivado'
  owner_org         text,
  homepage_url      text,
  license           text,
  reuse_status      text not null default 'unknown'
    check (reuse_status in ('open_license','reuse_with_conditions','consult_only','restricted','unknown','not_applicable')),
  reuse_notes       text,
  scope_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_sources_upd before update on catalog.sources for each row execute function app.touch_updated_at();

-- Recurso: tabla, serie, fichero o endpoint concreto de una fuente.
create table catalog.resources (
  code               text primary key,                -- 'ine.dpop.29005'
  source_code        text not null references catalog.sources(code),
  name               text not null,
  url                text,                            -- URL real (null mientras no esté identificada)
  table_or_series    text,
  format             text,                            -- 'json-api','csv','xlsx','shp','wfs','html','pdf'
  coverage_geo       text,                            -- 'municipio·nacional', 'provincia'…
  coverage_time      text,
  frequency          text,
  definition         text,
  units              text,
  reference_dates    text,
  terms_of_use       text,
  import_method      text,                            -- 'worker:ine_tempus', 'manual', 'none'
  connector_code     text,                            -- conector del trabajador que lo importa
  tech_status        text not null default 'catalogued'
    check (tech_status in ('catalogued','resource_identified','download_tested','schema_validated',
                           'import_tested','operational','blocked','not_available','obsolete')),
  reuse_status       text not null default 'unknown'
    check (reuse_status in ('open_license','reuse_with_conditions','consult_only','restricted','unknown','not_applicable')),
  status_evidence    text,                            -- qué prueba sostiene el estado técnico
  blocked_reason     text,
  last_verified_at   timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on catalog.resources(source_code);
create trigger trg_resources_upd before update on catalog.resources for each row execute function app.touch_updated_at();

-- Indicador normalizado.
create table catalog.indicators (
  code               text primary key,                -- 'pop.padron.total'
  name               text not null,                   -- nombre normalizado (es)
  original_name      text,                            -- etiqueta original más representativa
  definition         text,
  family             text not null,                   -- 'poblacion','demografia_derivada','migraciones','renta','hogares','educacion','empleo','irpf','vivienda','turismo','construccion','complementarios','mercado'
  catalog_section    text,                            -- '9.1'…'9.13'
  unit               text,                            -- 'personas','EUR','%','EUR/m2','indice'…
  scale              numeric not null default 1,      -- multiplicador sobre la unidad
  stat_type          text not null
    check (stat_type in ('stock','flow','rate','ratio','share','average','median','index','count','amount','category','distance','time','other')),
  dimensions         text[] not null default '{}',    -- dimensiones admitidas: sex, age_group, nationality…
  universe           text,                            -- universo estadístico (población de 16 y más…)
  denominator        text,                            -- denominador explícito
  formula            text,                            -- si es derivado
  is_derived         boolean not null default false,
  app_functions      text[] not null default '{}'     -- 'pantalla','filtro','calculo','scoring','contexto','documentacion'
    check (app_functions <@ array['pantalla','filtro','calculo','scoring','contexto','documentacion']::text[]),
  scoring_role       text not null default 'not_scored'
    check (scoring_role in ('eligible','not_scored','excluded_protected','excluded_risk')),
  is_protected_attribute boolean not null default false,
  is_excluded        boolean not null default false,  -- excluido por decisión de producto (§9.13)
  exclusion_reason   text,
  higher_is          text check (higher_is in ('better','worse','depends','not_applicable')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint protected_never_scored check (not is_protected_attribute or scoring_role = 'excluded_protected'),
  constraint excluded_has_reason check (not is_excluded or exclusion_reason is not null)
);
create index on catalog.indicators(family);
create trigger trg_indicators_upd before update on catalog.indicators for each row execute function app.touch_updated_at();

create table catalog.indicator_aliases (
  id                 bigint generated always as identity primary key,
  indicator_code     text not null references catalog.indicators(code) on delete cascade,
  alias              text not null,
  origin             text not null,                   -- 'especificacion','texto.txt','ine','referencia'
  note               text,
  unique (indicator_code, alias, origin)
);

-- Correspondencia recurso → indicador (con mapeo de dimensiones y transformación).
create table catalog.resource_indicators (
  id                 bigint generated always as identity primary key,
  resource_code      text not null references catalog.resources(code) on delete cascade,
  indicator_code     text not null references catalog.indicators(code) on delete cascade,
  dims_mapping       jsonb not null default '{}'::jsonb,  -- {"Sexo":{"Hombres":{"sex":"male"}}}
  transformation     text,                                -- 'ninguna', 'escala x1000', …
  coverage           text,
  match_status       text not null default 'unresolved'
    check (match_status in ('exact','equivalent_validated','partial','ambiguous','unresolved')),
  notes              text,
  unique (resource_code, indicator_code)
);

-- Inventario original (sección 9 de la especificación y, si existe, texto.txt).
-- Cada etiqueta tiene una fila: nunca se elimina silenciosamente.
create table catalog.inventory_items (
  id                 bigint generated always as identity primary key,
  origin             text not null,                   -- 'especificacion' | 'texto.txt'
  section            text not null,                   -- '9.1'…
  block              text,                            -- bloque original
  original_label     text not null,
  position           int,
  indicator_code     text references catalog.indicators(code),
  dims               jsonb not null default '{}'::jsonb, -- correspondencia dimensional explícita
  match_status       text not null default 'unresolved'
    check (match_status in ('exact','equivalent_validated','partial','ambiguous','unresolved')),
  is_excluded        boolean not null default false,
  exclusion_reason   text,
  notes              text,
  unique (origin, section, original_label)
);
create index on catalog.inventory_items(indicator_code);

-- Matriz de correspondencias: etiqueta original → indicador → fuente/recurso → estado.
create view catalog.correspondence_matrix as
select
  ii.id                    as inventory_id,
  ii.origin,
  ii.section,
  ii.block,
  ii.original_label,
  ii.dims                  as label_dims,
  ii.match_status          as label_match_status,
  ii.is_excluded,
  ii.exclusion_reason,
  i.code                   as indicator_code,
  i.name                   as indicator_name,
  i.unit,
  i.app_functions,
  i.scoring_role,
  ri.resource_code,
  r.source_code,
  r.name                   as resource_name,
  r.coverage_geo,
  r.coverage_time,
  ri.transformation,
  ri.match_status          as resource_match_status,
  r.tech_status,
  r.reuse_status
from catalog.inventory_items ii
left join catalog.indicators i on i.code = ii.indicator_code
left join catalog.resource_indicators ri on ri.indicator_code = i.code
left join catalog.resources r on r.code = ri.resource_code;
