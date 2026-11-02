# Guía en Windows: trabajador local (y web en local, opcional)

El **trabajador** se ejecuta en su PC: recoge los trabajos encolados desde la web, descarga datos públicos, importa ficheros de su buzón y guarda fotos (si las activa) en disco local. La **web** vive en Vercel y no necesita el PC.

## 1. Requisitos

- Windows 10/11.
- **Python 3.12 o superior** (<https://www.python.org/downloads/windows/>, marque *Add python.exe to PATH*). Compruebe en PowerShell: `py --version`.
- **Git** (para clonar/actualizar el repositorio) y, si quiere ejecutar la web en local, **Node.js 22 LTS**.

## 2. Instalar el trabajador

En PowerShell, dentro de la carpeta del repositorio (por ejemplo `C:\Users\<usuario>\Documents\Claude\inmo360`):

```powershell
cd worker
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1          # si PowerShell lo bloquea: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -e .
copy .env.example .env
notepad .env                          # rellene INMO_WORKER_DATABASE_URL e INMO_DATA_DIR
```

La contraseña de `inmo_worker` la fijó usted en Supabase ([SUPABASE.md §3](SUPABASE.md#3-credenciales-de-los-roles-de-la-aplicación)). El fichero `.env` no sale del PC.

## 3. Comprobar y arrancar

```powershell
inmo-worker check      # muestra la configuración (sin secretos), conecta y registra el equipo
inmo-worker drain      # procesa la cola hasta vaciarla y termina
inmo-worker run        # bucle continuo con latido; Ctrl+C para parar de forma ordenada
```

En la web, *Importaciones → Trabajadores* debe aparecer el equipo como **Conectado** (latido de menos de 2 minutos).

Comportamiento ante cortes: si cierra el trabajador o se apaga el PC a mitad de un trabajo, la reserva caduca y el trabajo se retoma desde su último punto de control al volver a arrancar. Una ejecución con la reserva caducada no puede escribir (protección contra «trabajadores zombis»).

## 4. Carpeta de datos (`INMO_DATA_DIR`)

```
Inmo360Data\
  inbox\          ficheros CSV/JSON/XML que usted deja para importar (solo se leen desde aquí)
  captures\       capturas de respuestas públicas descargadas con el navegador (si se usan)
  media-store\    fotos y capturas por hash (solo si INMO_DOWNLOAD_MEDIA=true)
```

Inclúyala en sus copias de seguridad ([COPIAS_SEGURIDAD.md](COPIAS_SEGURIDAD.md)). No la ponga dentro del repositorio.

## 5. Arranque automático (opcional)

*Programador de tareas* → *Crear tarea*:

- Desencadenador: *Al iniciar sesión*.
- Acción: programa `C:\…\inmo360\worker\.venv\Scripts\inmo-worker.exe`, argumentos `run`, «Iniciar en» `C:\…\inmo360\worker`.
- Configuración: *Si la tarea ya se está ejecutando, no iniciar una nueva instancia*.

## 6. Actualizar

```powershell
git pull
cd worker; .\.venv\Scripts\Activate.ps1; pip install -e .
```

Si la actualización incluye migraciones nuevas (`supabase/migrations`), aplíquelas en Supabase **antes** de arrancar el trabajador nuevo (`npx supabase@latest db push`).

## 7. Web en local contra Supabase (opcional)

```powershell
npm install                       # en la raíz del repositorio
copy apps\web\.env.example apps\web\.env.local
notepad apps\web\.env.local       # DATABASE_URL (rol inmo_web), AUTH_MODE=supabase, NEXT_PUBLIC_SUPABASE_URL/ANON_KEY
npm run dev                       # http://localhost:3000
```

## 8. Entorno de desarrollo aislado (solo para programar o probar)

La base aislada (PostgreSQL + PostGIS locales con `scripts/local/db-reset.sh`) y el modo `AUTH_MODE=local` existen para pruebas; se usan con WSL2/Linux. No son necesarios para operar Inmo360 y nunca apuntan a Supabase.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `Falta INMO_WORKER_DATABASE_URL` | No existe `worker\.env` o no está en la carpeta desde la que ejecuta. Use `--env ruta\.env`. |
| `password authentication failed` | Usuario sin el sufijo `.<project-ref>` o contraseña distinta de la fijada con `alter role`. |
| `WORKER_REVOKED` | El equipo fue revocado en `ingest.workers`. Cree otro nombre o limpie `revoked_at` si fue un error. |
| Trabajo en «Pendiente» que no avanza | El trabajador no está en marcha o `INMO_JOB_TYPES` excluye ese tipo. |
| Fuente «bloqueada» | Falta autorización o credencial (p. ej. Idealista). No se reintenta: es intencionado. |
