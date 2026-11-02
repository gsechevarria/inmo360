-- SOLO BD AISLADA: crea el usuario propietario de desarrollo (equivalente a invitar al propietario en Supabase Auth).
insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000000001', 'propietario@inmo360.local') on conflict do nothing;
insert into app.user_profiles(user_id, role, display_name) values ('00000000-0000-4000-8000-000000000001', 'owner', 'Propietario (dev)')
  on conflict (user_id) do update set role = 'owner';
