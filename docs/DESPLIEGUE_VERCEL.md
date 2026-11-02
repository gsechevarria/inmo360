# Despliegue de la web en Vercel

Requisitos previos: proyecto Supabase configurado ([SUPABASE.md](SUPABASE.md)) y el repositorio en GitHub (privado). Plan **Hobby** de Vercel (gratuito, uso personal). No despliegue hasta haber completado el paso 4 de SUPABASE.md (sin registro público).

> **Estado**: `next build` compila sin errores (21 rutas). No se ha desplegado en Vercel desde la sesión de construcción: el despliegue público requiere su autorización expresa y su cuenta.

## 1. Importar el proyecto

1. <https://vercel.com/new> → *Import Git Repository* → el repositorio de Inmo360.
2. **Root Directory**: `apps/web`. Vercel detecta Next.js y el monorepo (npm workspaces); deje los comandos por defecto (`npm install`, `next build`).
3. **Node.js**: 20.x o 22.x (*Settings → General*).

## 2. Variables de entorno (*Settings → Environment Variables*)

| Variable | Valor | Tipo |
|---|---|---|
| `DATABASE_URL` | Cadena del pooler en modo transacción con el rol `inmo_web` (puerto 6543) | **Secreta** · solo servidor |
| `AUTH_MODE` | `supabase` | Servidor |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave `anon`/*publishable* | Pública (RLS protege los datos) |
| `NEXT_PUBLIC_BASEMAP_STYLE_URL` | Opcional: estilo MapLibre de un mapa base | Pública |
| `NEXT_PUBLIC_BASEMAP_ORIGIN` | Opcional: origen de ese mapa base (para la CSP) | Pública |
| `DB_POOL_MAX` | Opcional, por defecto 5 | Servidor |

Reglas: ninguna credencial privilegiada con prefijo `NEXT_PUBLIC_`; la clave `service_role` no se configura; `LOCAL_AUTH_SECRET` no se define en Vercel (el modo local se niega en Vercel aunque se configure).

## 3. Desplegar y comprobar

1. *Deploy*. Al terminar, añada la URL en Supabase → *Authentication → URL Configuration* (Site URL y `…/auth/callback`).
2. Abra la URL: debe redirigir a `/login`. Entre con el correo del propietario (enlace mágico).
3. Comprobaciones:
   - `/zonas` carga el mapa (límites desde la propia base, sin teselas externas).
   - Sin sesión, `/api/tiles/...` responde 401 y `/viviendas` redirige a `/login`.
   - Las cabeceras incluyen `Content-Security-Policy` con `img-src 'self' data: blob:` (la web no carga imágenes de terceros).

## 4. Dominio propio (opcional)

*Settings → Domains*. Si usa un dominio propio, añádalo también en las *Redirect URLs* de Supabase.

## Notas de funcionamiento

- La web no depende del PC: lee de Supabase. Los trabajos encolados con el PC apagado quedan **pendientes** y se ven así en *Importaciones*.
- Las rutas dinámicas usan el runtime Node.js (necesario para `postgres`). El tiempo máximo de sentencia por petición es 25 s.
- Previsualizaciones de rama (*Preview deployments*): usan las mismas variables; si no quiere que accedan a la base real, limite `DATABASE_URL` al entorno *Production*.
