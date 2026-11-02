-- Inmo360 · 0001 · Extensiones, esquemas y utilidades comunes
-- Compatible con Supabase Cloud (extensiones en el esquema "extensions").

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists catalog;   -- fuentes, recursos, indicadores, correspondencias
create schema if not exists geo;       -- territorios y geometrías
create schema if not exists stats;     -- observaciones estadísticas (formato largo)
create schema if not exists ingest;    -- cola de trabajos, ejecuciones, incidencias
create schema if not exists market;    -- anuncios, inmuebles, deduplicación, medios
create schema if not exists invest;    -- supuestos, escenarios, resultados, comparables
create schema if not exists scoring;   -- perfiles, versiones, universos, resultados
create schema if not exists app;       -- datos del usuario: favoritos, notas, búsquedas…

comment on schema catalog is 'Catálogo de fuentes, recursos, indicadores y matriz de correspondencias';
comment on schema ingest is 'Cola de importación. El trabajador solo accede mediante funciones ingest.worker_*';

-- Ningún acceso anónimo a los esquemas del producto.
revoke all on schema catalog, geo, stats, ingest, market, invest, scoring, app from public;
grant usage on schema catalog, geo, stats, market, invest, scoring, app to authenticated, service_role;
grant usage on schema ingest to service_role;

-- Utilidad: marca de actualización
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normalización de texto para búsquedas (no para unir territorios: ver geo.*)
create or replace function app.norm_text(t text) returns text
language sql immutable parallel safe set search_path = pg_catalog, extensions as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- Clave canónica de dimensiones: {"sex":"male","age":"0-4"} -> "age=0-4|sex=male"
create or replace function app.dims_key(d jsonb) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select coalesce(string_agg(key || '=' || value, '|' order by key), '')
  from jsonb_each_text(coalesce(d, '{}'::jsonb))
$$;
