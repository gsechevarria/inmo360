-- SOLO BD AISLADA: crea el usuario propietario de desarrollo (equivalente a invitar al propietario en Supabase Auth).
insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000000001', 'propietario@inmo360.local') on conflict do nothing;
insert into app.user_profiles(user_id, role, display_name) values ('00000000-0000-4000-8000-000000000001', 'owner', 'Propietario (dev)')
  on conflict (user_id) do update set role = 'owner';
-- SOLO BD AISLADA: búsqueda de usuario para el modo de acceso local (no existe en Supabase).
create or replace function app.dev_local_user(p_email text) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select u.id from auth.users u join app.user_profiles p on p.user_id = u.id where lower(u.email) = lower(p_email)
$$;
revoke execute on function app.dev_local_user(text) from public;
grant usage on schema app to inmo_web;
grant execute on function app.dev_local_user(text) to inmo_web;
