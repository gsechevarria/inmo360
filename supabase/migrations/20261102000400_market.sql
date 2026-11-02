-- Inmo360 · 0004 · Anuncios, inmuebles canónicos, deduplicación y medios

create table market.agencies (
  id                uuid primary key default extensions.gen_random_uuid(),
  source_code       text not null,                      -- fuente donde se observó ('agency_web', 'idealista_api'…)
  source_agency_id  text not null,                      -- id en la fuente o dominio normalizado
  name              text not null,
  website           text,
  website_domain    text,
  discovered_via    text,                               -- 'csv_propietario','google_places','portal'
  robots_allows     boolean,
  robots_checked_at timestamptz,
  sitemap_url       text,
  capabilities      jsonb not null default '{}'::jsonb, -- {"jsonld":true,"sitemap":true}
  enabled           boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (source_code, source_agency_id)
);
create trigger trg_agencies_upd before update on market.agencies for each row execute function app.touch_updated_at();

-- Inmueble canónico: una vivienda física. Puede tener varias publicaciones.
create table market.properties (
  id                uuid primary key default extensions.gen_random_uuid(),
  status            text not null default 'active' check (status in ('active','merged')),
  merged_into       uuid references market.properties(id),
  merged_at         timestamptz,
  geography_id      bigint references geo.geographies(id),
  location          extensions.geometry(Point, 4326),
  location_precision text not null default 'unknown' check (location_precision in ('exact','street','zone','municipality','unknown')),
  is_synthetic      boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index properties_geo on market.properties(geography_id) where status = 'active';
create index properties_loc on market.properties using gist(location);
create trigger trg_properties_upd before update on market.properties for each row execute function app.touch_updated_at();

-- Publicación (anuncio) tal y como la declara la fuente.
create table market.listings (
  id                  uuid primary key default extensions.gen_random_uuid(),
  source_code         text not null,
  external_id         text not null,
  url                 text,
  agency_id           uuid references market.agencies(id),
  agency_reference    text,
  operation           text not null check (operation in ('sale','rent')),
  price_amount        numeric check (price_amount is null or price_amount >= 0),
  price_unit          text not null check (price_unit in ('sale_total','rent_month','rent_room_month','rent_night','other')),
  price_unit_note     text,
  price_currency      text not null default 'EUR',
  property_type       text check (property_type in ('flat','house','penthouse','duplex','studio','rural_house','room','other','unknown')),
  title               text,
  description         text,
  built_area_m2       numeric check (built_area_m2 is null or built_area_m2 > 0),
  useful_area_m2      numeric check (useful_area_m2 is null or useful_area_m2 > 0),
  plot_area_m2        numeric,
  rooms               int check (rooms is null or rooms >= 0),
  bathrooms           int check (bathrooms is null or bathrooms >= 0),
  floor_text          text,
  has_elevator        boolean,
  has_terrace         boolean,
  has_parking         boolean,
  has_storage         boolean,
  has_pool            boolean,
  has_ac              boolean,
  condition           text check (condition in ('new','good','to_renovate','unknown')),
  energy_rating       text,
  year_built          int,
  location            extensions.geometry(Point, 4326),
  location_precision  text not null default 'unknown' check (location_precision in ('exact','street','zone','municipality','unknown')),
  address_text        text,
  postal_code         text,
  geography_id        bigint references geo.geographies(id),
  published_at_declared date,                    -- fecha declarada por la fuente (si la da)
  first_seen_at       timestamptz not null,       -- primera observación nuestra
  last_seen_at        timestamptz not null,       -- última vez que apareció en un recorrido
  last_checked_at     timestamptz not null,       -- última comprobación (aparezca o no)
  status              text not null default 'active' check (status in ('active','not_observed','withdrawn_confirmed')),
  status_changed_at   timestamptz not null default now(),
  content_hash        text not null,
  image_count         int,
  extra               jsonb not null default '{}'::jsonb,
  is_synthetic        boolean not null default false,
  created_run_id      uuid,
  last_run_id         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source_code, external_id)
);
create index listings_geo on market.listings(geography_id, status);
create index listings_loc on market.listings using gist(location);
create index listings_price on market.listings(operation, price_unit, price_amount);
create index listings_seen on market.listings(source_code, last_seen_at);
create index listings_desc_trgm on market.listings using gin (left(coalesce(description,''), 2000) extensions.gin_trgm_ops);
create trigger trg_listings_upd before update on market.listings for each row execute function app.touch_updated_at();

create table market.listing_snapshots (
  id            bigint generated always as identity primary key,
  listing_id    uuid not null references market.listings(id) on delete cascade,
  observed_at   timestamptz not null,
  run_id        uuid,
  content_hash  text not null,
  price_amount  numeric,
  price_unit    text,
  data          jsonb not null,
  unique (listing_id, content_hash, run_id)
);
create index on market.listing_snapshots(listing_id, observed_at);

create table market.listing_events (
  id            bigint generated always as identity primary key,
  listing_id    uuid not null references market.listings(id) on delete cascade,
  event_type    text not null check (event_type in ('new','price_change','attribute_change','not_observed',
                                                    'reappeared','withdrawn_confirmed','possible_republication')),
  occurred_at   timestamptz not null default now(),
  run_id        uuid,
  old_value     jsonb,
  new_value     jsonb
);
create index on market.listing_events(listing_id, occurred_at);
create index on market.listing_events(event_type, occurred_at);

-- Relación inmueble ↔ anuncio, reversible y trazable.
create table market.property_listings (
  id             bigint generated always as identity primary key,
  property_id    uuid not null references market.properties(id),
  listing_id     uuid not null references market.listings(id) on delete cascade,
  link_type      text not null check (link_type in ('initial','auto_high_confidence','user_confirmed')),
  candidate_id   bigint,
  linked_at      timestamptz not null default now(),
  linked_by      uuid,
  unlinked_at    timestamptz,
  unlinked_by    uuid,
  unlink_reason  text
);
create unique index property_listings_active_uq on market.property_listings(listing_id) where unlinked_at is null;
create index on market.property_listings(property_id) where unlinked_at is null;

-- Candidatos de coincidencia entre fuentes (nunca se fusiona por una sola señal).
create table market.match_candidates (
  id             bigint generated always as identity primary key,
  listing_a      uuid not null references market.listings(id) on delete cascade,
  listing_b      uuid not null references market.listings(id) on delete cascade,
  score          numeric not null,
  signals        jsonb not null,             -- {"area":{"a":80,"b":81,"diff_pct":1.2,"points":…}, …}
  strong_signals int not null default 0,
  status         text not null default 'pending' check (status in ('pending','confirmed','rejected','superseded','auto_linked','undone')),
  method_version text not null,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid,
  review_note    text,
  check (listing_a < listing_b),
  unique (listing_a, listing_b)
);
create index on market.match_candidates(status, score desc);

-- Inventario de medios. Los bytes viven en el almacén del trabajador (disco local).
create table market.media_assets (
  id               uuid primary key default extensions.gen_random_uuid(),
  listing_id       uuid references market.listings(id) on delete set null,
  resource_code    text references catalog.resources(code),
  kind             text not null check (kind in ('photo','screenshot','document','raw_page')),
  origin_host      text,
  origin_url_hash  text,                       -- hash de la URL de origen (no se re-solicita desde la web)
  storage_provider text not null default 'local' check (storage_provider in ('local','supabase')),
  storage_key      text,                       -- clave relativa: media/ab/abcdef….jpg (nunca ruta absoluta)
  byte_size        bigint,
  mime_type        text,
  width            int,
  height           int,
  sha256           text,
  captured_at      timestamptz,
  status           text not null default 'pending' check (status in ('pending','available','failed','migrating','migrated','missing')),
  error            text,
  run_id           uuid,
  migration        jsonb,                      -- {"target":"supabase","verified_at":…}
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint key_is_relative check (storage_key is null or (storage_key !~ '^[A-Za-z]:' and storage_key !~ '^[/\\]' and storage_key !~ '\.\.')),
  constraint available_has_hash check (status <> 'available' or (sha256 is not null and storage_key is not null and byte_size is not null))
);
create unique index media_listing_sha_uq on market.media_assets(listing_id, sha256) where sha256 is not null;
create index on market.media_assets(status);
create trigger trg_media_upd before update on market.media_assets for each row execute function app.touch_updated_at();

-- Aportaciones del usuario: corrigen sin sobrescribir el dato original.
create table market.attribute_corrections (
  id           bigint generated always as identity primary key,
  target_type  text not null check (target_type in ('listing','property')),
  target_id    uuid not null,
  field        text not null,
  value        jsonb not null,
  author_id    uuid not null,
  reason       text not null check (length(reason) >= 3),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create index on market.attribute_corrections(target_type, target_id) where revoked_at is null;

-- Vista: anuncios activos vinculados a cada inmueble
create view market.property_listing_view as
select pl.property_id, l.*
from market.property_listings pl
join market.listings l on l.id = pl.listing_id
where pl.unlinked_at is null;
