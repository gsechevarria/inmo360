-- Inmo360 · 0005 · Supuestos, escenarios, comparables, scoring y datos del usuario
-- Todo lo que pertenece a un usuario lleva owner_id (RLS en 0007).

-- ---------------------------------------------------------------------------
-- Usuarios de la aplicación (acceso privado; sin registro público)
-- ---------------------------------------------------------------------------
create table app.user_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner','member')),
  display_name  text,
  created_at    timestamptz not null default now()
);

create or replace function app.is_owner() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from app.user_profiles where user_id = auth.uid() and role = 'owner')
$$;
create or replace function app.is_member() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from app.user_profiles where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Inversión
-- ---------------------------------------------------------------------------
create table invest.assumption_sets (
  id          uuid primary key default extensions.gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  strategy    text not null check (strategy in ('resale','rent_long','rooms','temporary','tourist','any')),
  values      jsonb not null,               -- partidas con estado/origen (contrato @inmo360/contracts)
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_assump_upd before update on invest.assumption_sets for each row execute function app.touch_updated_at();

-- Reglas fiscales fechadas por territorio y perfil. Nunca se aplican automáticamente sin confirmar.
create table invest.tax_rules (
  id                 uuid primary key default extensions.gen_random_uuid(),
  owner_id           uuid default auth.uid() references auth.users(id) on delete cascade, -- null = regla del sistema
  territory_level    text not null check (territory_level in ('country','ccaa','province','municipality')),
  territory_code     text not null,
  tax_type           text not null check (tax_type in ('ITP','AJD','IVA','IGIC','IPSI','IBI','IIVTNU','IRPF','IS','tasa','otro')),
  profile            text not null default 'general',
  description        text not null,
  base_description   text not null,
  rate               numeric,                 -- tipo único (0,06 = 6 %)
  brackets           jsonb,                   -- [{"from":0,"to":1000000,"rate":0.10}, …] tramos marginales
  fixed_amount       numeric,
  conditions         jsonb not null default '{}'::jsonb,
  valid_from         date not null,
  valid_to           date,
  payment_moment     text,                    -- 'compra','anual','venta'
  source_name        text,
  source_url         text,
  verification_status text not null default 'published_unconfirmed'
    check (verification_status in ('confirmed','published_unconfirmed','user_input')),
  auto_apply         boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now(),
  check (not auto_apply or verification_status in ('confirmed','user_input'))
);
create index on invest.tax_rules(territory_level, territory_code, tax_type);

create table invest.scenarios (
  id                 uuid primary key default extensions.gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id        uuid references market.properties(id) on delete set null,
  listing_id         uuid references market.listings(id) on delete set null,
  parent_scenario_id uuid references invest.scenarios(id) on delete set null,
  name               text not null,
  strategy           text not null check (strategy in ('resale','rent_long','rooms','temporary','tourist')),
  inputs             jsonb not null,
  inputs_hash        text not null,
  engine_version     text not null,
  listing_price_at_save numeric,             -- para avisar si el anuncio cambió de precio
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz
);
create index on invest.scenarios(owner_id, property_id);
create trigger trg_scen_upd before update on invest.scenarios for each row execute function app.touch_updated_at();

create table invest.calculation_results (
  id             uuid primary key default extensions.gen_random_uuid(),
  scenario_id    uuid references invest.scenarios(id) on delete cascade,
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text not null default 'scenario' check (kind in ('scenario','max_price')),
  engine_version text not null,
  inputs_hash    text not null,
  status         text not null,
  metrics        jsonb not null,
  missing        jsonb not null default '[]'::jsonb,
  computed_at    timestamptz not null default now(),
  unique (scenario_id, kind, inputs_hash, engine_version)
);

create table invest.cashflow_entries (
  id           bigint generated always as identity primary key,
  result_id    uuid not null references invest.calculation_results(id) on delete cascade,
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_date  date not null,
  layer        text not null check (layer in ('asset','financing','tax','reserve')),
  category     text not null,
  concept      text not null,
  amount       numeric not null,
  item_ref     text
);
create index on invest.cashflow_entries(result_id, period_date);

create table invest.comparable_sets (
  id                 uuid primary key default extensions.gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_property_id uuid references market.properties(id) on delete cascade,
  mode               text not null check (mode in ('sale','rent_long','rooms','temporary','tourist')),
  criteria           jsonb not null,
  stats              jsonb not null,
  expanded_search    boolean not null default false,
  method_version     text not null,
  computed_at        timestamptz not null default now()
);
create table invest.comparable_items (
  id                   bigint generated always as identity primary key,
  set_id               uuid not null references invest.comparable_sets(id) on delete cascade,
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id          uuid references market.properties(id) on delete set null,
  listing_id           uuid references market.listings(id) on delete set null,
  distance_m           numeric,
  similarity           numeric,
  inclusion_reason     text not null,
  excluded_by_rule     text,
  excluded_by_user     boolean not null default false,
  user_exclusion_reason text
);
create index on invest.comparable_items(set_id);

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
create table scoring.profiles (
  id             uuid primary key default extensions.gen_random_uuid(),
  owner_id       uuid references auth.users(id) on delete cascade, -- null = plantilla del sistema
  name           text not null,
  strategy       text not null check (strategy in ('resale','rent_long','rooms','temporary','tourist','any')),
  block          text not null check (block in ('zone','property','operation','global')),
  description    text,
  is_experimental boolean not null default true,
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create table scoring.profile_versions (
  id           uuid primary key default extensions.gen_random_uuid(),
  profile_id   uuid not null references scoring.profiles(id) on delete cascade,
  version      int not null,
  config       jsonb not null,              -- contrato ScoringProfileConfig (@inmo360/scoring)
  valid_from   timestamptz not null default now(),
  created_by   uuid,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (profile_id, version)
);
-- Universo estable de referencia para percentiles (no depende de filtros de pantalla).
create table scoring.universes (
  id              uuid primary key default extensions.gen_random_uuid(),
  definition      jsonb not null,
  definition_hash text not null,
  indicator_code  text not null,
  period          text,
  size            int not null,
  sorted_values   numeric[] not null,
  computed_at     timestamptz not null default now(),
  unique (definition_hash, indicator_code, period)
);
create table scoring.score_results (
  id                 uuid primary key default extensions.gen_random_uuid(),
  profile_version_id uuid not null references scoring.profile_versions(id) on delete cascade,
  owner_id           uuid references auth.users(id) on delete cascade,
  subject_type       text not null check (subject_type in ('geography','property','scenario')),
  subject_id         text not null,
  score              numeric,
  status             text not null,
  coverage           numeric,
  contributions      jsonb not null,
  missing            jsonb not null default '[]'::jsonb,
  inputs             jsonb not null,
  inputs_hash        text not null,
  universe_ids       uuid[] not null default '{}',
  computed_at        timestamptz not null default now(),
  unique (profile_version_id, subject_type, subject_id, inputs_hash)
);

-- ---------------------------------------------------------------------------
-- Datos del usuario
-- ---------------------------------------------------------------------------
create table app.preferences (
  user_id                uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  active_strategy        text not null default 'rent_long' check (active_strategy in ('resale','rent_long','rooms','temporary','tourist')),
  active_profile_versions jsonb not null default '{}'::jsonb,  -- {"zone:rent_long": "<version uuid>", …}
  global_combination     jsonb,                                 -- null = sin puntuación global
  default_assumption_set uuid references invest.assumption_sets(id) on delete set null,
  ui                     jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now()
);

create table app.saved_searches (
  id             uuid primary key default extensions.gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('listings','zones')),
  name           text not null,
  params         jsonb not null,
  notify_in_app  boolean not null default true,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);
create table app.saved_search_hits (
  search_id       uuid not null references app.saved_searches(id) on delete cascade,
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  listing_id      uuid not null references market.listings(id) on delete cascade,
  first_matched_at timestamptz not null default now(),
  seen_at         timestamptz,
  primary key (search_id, listing_id)
);

create table app.favorites (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('property','listing','geography')),
  target_id   text not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, target_type, target_id)
);

create table app.notes (
  id          uuid primary key default extensions.gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('property','listing','geography','scenario')),
  target_id   text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on app.notes(owner_id, target_type, target_id);
create trigger trg_notes_upd before update on app.notes for each row execute function app.touch_updated_at();

create table app.opportunities (
  id               uuid primary key default extensions.gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id      uuid not null references market.properties(id) on delete cascade,
  status           text not null default 'saved' check (status in ('saved','to_analyze','analyzed','visit_pending',
                                                                    'offer_prepared','negotiating','discarded','closed')),
  planned_offer    numeric,
  main_scenario_id uuid references invest.scenarios(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (owner_id, property_id)
);
create trigger trg_opp_upd before update on app.opportunities for each row execute function app.touch_updated_at();

create table app.opportunity_events (
  id             bigint generated always as identity primary key,
  opportunity_id uuid not null references app.opportunities(id) on delete cascade,
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  note           text,
  created_at     timestamptz not null default now()
);

create table app.zone_selections (
  id            uuid primary key default extensions.gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  geography_ids bigint[] not null,
  filters       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
