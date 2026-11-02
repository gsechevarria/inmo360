# Supabase Cloud: configuración

Base de datos operativa, autenticación y (en el futuro) almacenamiento de fotos. Todo cabe en el **plan gratuito** con los datos actuales (ver «Presupuesto de almacenamiento»). No se contrata nada.

> **Estado (2026-11-02)**: instalado en el proyecto `inmo360` (`npilepdhviyzlenmycvv`, Frankfurt, Postgres 17.11, PostGIS 3.3.7) mediante la API de gestión desde el navegador del propietario. Migraciones 0001–0012, catálogo (140 indicadores, 78 recursos, 755 etiquetas) y 7 perfiles cargados; roles `inmo_web`/`inmo_worker` con acceso; registro público desactivado; propietario creado. Comprobado en Supabase: 0 tablas sin RLS; como propietario se ven los 140 indicadores y como usuario ajeno 0; `inmo_web` sin acceso directo a tablas; `inmo_worker` solo con funciones. **Pendiente de comprobar**: el primer inicio de sesión de `inmo_web` e `inmo_worker` a través del pooler (no hay red desde la sesión de construcción), y el proveedor de Google.

## 1. Crear el proyecto

1. <https://supabase.com/dashboard> → *New project*. Región **Europa (Frankfurt o París)**: los datos de usuario (notas, escenarios) quedan en la UE.
2. Guarde la contraseña de la base de datos en su gestor de contraseñas (no en ficheros del repositorio).
3. *Project Settings → API*: anote `Project URL` y la clave pública `anon`/*publishable* (es pública por diseño; RLS protege los datos). La clave `service_role` **no** se usa en Inmo360.

## 2. Aplicar migraciones y datos de catálogo

Opción A · CLI de Supabase (recomendada):

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <project-ref>
npx supabase@latest db push          # aplica supabase/migrations/*.sql en orden
```

Opción B · `psql` (cadena *Session pooler*, puerto 5432, usuario `postgres.<project-ref>`):

```bash
for f in supabase/migrations/*.sql; do psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

Después, en ambos casos, los seeds (idempotentes):

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/010_catalog.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/020_scoring_profiles.sql
```

> No aplique nunca `scripts/local/*.sql` en Supabase: son solo para la base aislada (emulan `auth` y crean un usuario de desarrollo).

`grant authenticated to inmo_web` (migración 0008) funciona: en Supabase el rol `postgres` tiene ADMIN OPTION sobre `authenticated` (comprobado).

## 3. Credenciales de los roles de la aplicación

En el *SQL Editor*, con contraseñas largas y aleatorias (generadas por su gestor). También se admite el **verificador SCRAM** en lugar de la contraseña (`password 'SCRAM-SHA-256$4096:…'`), que es lo que se usó en la instalación: así la contraseña en claro no pasa por el editor ni por el historial de consultas.

```sql
alter role inmo_web    with login password '<contraseña-web-48+caracteres>';
alter role inmo_worker with login password '<contraseña-trabajador-48+caracteres>';
```

- `inmo_web`: lo usa el servidor de la web. Sin privilegios propios: solo puede hacer `SET ROLE authenticated`, así que todo pasa por RLS.
- `inmo_worker`: lo usa el trabajador del PC. Sin acceso a tablas: solo ejecuta las funciones `ingest.worker_*`, que validan la reserva y el token de cada ejecución.
- Revocar el trabajador: `alter role inmo_worker nologin;` (o rotar la contraseña) y/o `update ingest.workers set revoked_at = now() where name = '…';`.

Cadenas de conexión (pooler Supavisor; IPv4):

| Uso | Modo | Cadena |
|---|---|---|
| Web (Vercel) | Transacción, 6543 | `postgresql://inmo_web.<project-ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
| Trabajador (PC) | Sesión, 5432 | `postgresql://inmo_worker.<project-ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres` |

Ambos clientes ya desactivan las sentencias preparadas (compatibles con el modo transacción). Copie el host exacto desde *Connect → Connection string* (en este proyecto: `aws-1-eu-central-1.pooler.supabase.com`).

## 4. Autenticación (acceso privado)

*Authentication → Sign In / Providers*:

- **Email** activado; **«Allow new users to sign up» desactivado** (no hay registro público).
- Enlace mágico / OTP por correo. *URL Configuration*: `Site URL` = URL de Vercel; *Redirect URLs*: `https://<su-app>.vercel.app/auth/callback` y `http://localhost:3000/auth/callback`. En este proyecto: `https://inmo360-two.vercel.app` y `https://inmo360-two.vercel.app/auth/callback`.
- El SMTP integrado de Supabase solo entrega a correos de miembros del equipo del proyecto y con un límite bajo por hora: suficiente para el propietario; para más usuarios, configure un SMTP propio (*Authentication → Emails → SMTP*).

Acceso con Google (opcional, recomendado si usa Google SSO):

1. Google Cloud Console → *APIs y servicios → Pantalla de consentimiento OAuth* (tipo «Externo» o «Interno» si es Workspace) → *Credenciales → Crear ID de cliente OAuth → Aplicación web*.
2. *URI de redireccionamiento autorizado*: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → *Authentication → Sign In / Providers → Google*: activar y pegar *Client ID* y *Client Secret* (el secreto lo introduce el propietario).
4. Con el registro público desactivado, la cuenta de Google debe existir antes en *Users* con el **mismo correo** (Supabase vincula la identidad de Google a ese usuario). Una cuenta autenticada sin perfil en `app.user_profiles` no entra: la web cierra su sesión.
5. Vercel → variable `AUTH_GOOGLE=1` y *Redeploy*. Sin ella el botón de Google no aparece (evita un error de «proveedor no activado» mientras no esté configurado).

Alta del propietario (una vez):

1. *Authentication → Users → Add user* (o *Invite*) con su correo.
2. *SQL Editor*:

```sql
insert into app.user_profiles(user_id, role, display_name)
select id, 'owner', 'Propietario' from auth.users where email = 'su-correo@dominio.es'
on conflict (user_id) do update set role = 'owner';
```

Otros usuarios (futuro): mismo procedimiento con `role = 'member'`. Cada usuario ve solo sus escenarios, notas, búsquedas y oportunidades (RLS por `owner_id`); los datos de referencia y de mercado son de lectura para miembros; la cola y las importaciones solo para el propietario.

## 5. Comprobaciones tras instalar

```sql
-- RLS activo en todas las tablas del producto
select schemaname, tablename from pg_tables
 where schemaname in ('catalog','geo','stats','ingest','market','invest','scoring','app') and not rowsecurity;   -- debe devolver 0 filas
-- El rol web no lee nada sin SET ROLE
set role inmo_web; select count(*) from app.notes;   -- debe fallar por permisos
reset role;
-- Catálogo cargado
select count(*) from catalog.indicators;   -- 140
```

Después: arranque el trabajador ([GUIA_WINDOWS.md](GUIA_WINDOWS.md)) y encole la geografía y los datos del INE ([IMPORTACIONES.md](IMPORTACIONES.md)).

## Presupuesto de almacenamiento

El plan gratuito permite **500 MB** de base de datos. Medido en la base aislada con todos los datos reales importados (padrón 2015-2025, renta ADRH 2015-2024, viviendas turísticas 2020-2026, 8.131 municipios con geometría) y 507 anuncios sintéticos: **322 MB** tras `VACUUM FULL`.

| Tabla | Tamaño |
|---|---|
| `stats.observations` (641.815 observaciones con su serie completa) | 206 MB |
| `stats.derived_observations` (último periodo por indicador y territorio) | 42 MB |
| `stats.latest_values_mv` (agregado para la web) | 33 MB |
| Geografía (8.265 territorios y geometrías simplificadas) | 15 MB |

Reglas para no superar el límite: los derivados se guardan solo como foto del último periodo (son recalculables desde las observaciones); no se guardan fotos ni HTML en la base; las notas por fila son cortas. Vigile *Reports → Database* y, si una importación grande deja hinchazón, ejecute `vacuum (analyze) stats.observations;` (Supabase no permite `VACUUM FULL` en todos los planes).
