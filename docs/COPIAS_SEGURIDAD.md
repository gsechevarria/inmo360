# Copias de seguridad y restauración

Qué hay que proteger:

| Activo | Dónde vive | Recuperable sin copia |
|---|---|---|
| Escenarios, notas, oportunidades, búsquedas, correcciones, supuestos, reglas fiscales, perfiles propios | Supabase (`invest`, `app`, `scoring`, `market.attribute_corrections`) | **No**: es trabajo del usuario |
| Anuncios observados, historial de precios y eventos, uniones de duplicados | Supabase (`market`) | Solo en parte (el historial no se puede volver a observar) |
| Datos públicos (INE, geografía) | Supabase (`stats`, `geo`) | Sí: se reimportan con el trabajador |
| Catálogo y perfiles experimentales | Repositorio (`supabase/seed`) | Sí |
| Fotos, capturas, ficheros del buzón | PC (`INMO_DATA_DIR`) | No |
| Código y migraciones | GitHub (privado) + carpeta local | Sí |
| `.env` del trabajador y de la web local | PC (gestor de contraseñas para las claves) | Se regeneran rotando contraseñas |

## 1. Base de datos (Supabase)

El plan gratuito **no** incluye copias automáticas descargables ni recuperación a un instante. Copia lógica semanal desde el PC (requiere la herramienta `pg_dump` 16+; en Windows, instalador de PostgreSQL marcando solo *Command Line Tools*):

```powershell
$env:PGPASSWORD = "<contraseña de postgres>"   # en la sesión, no en scripts guardados
$f = "C:\Backups\Inmo360\inmo360_$(Get-Date -Format yyyyMMdd).dump"
pg_dump "postgresql://postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432/postgres" `
  --format=custom --no-owner --no-privileges `
  --schema=catalog --schema=geo --schema=stats --schema=ingest --schema=market --schema=invest --schema=scoring --schema=app `
  --file $f
```

- Copia **solo de datos de usuario** (rápida y pequeña, recomendable a diario): añada `--data-only --schema=invest --schema=app --schema=scoring --table=market.attribute_corrections`.
- Los usuarios de `auth` se recrean invitándolos de nuevo; la tabla `app.user_profiles` guarda su rol.
- Guarde las copias fuera del PC (disco externo o nube personal cifrada). Son datos privados.

## 2. Carpeta de datos del PC

Incluya `INMO_DATA_DIR` en el Historial de archivos de Windows o en su herramienta de copias. El almacén de medios es direccionado por contenido: las copias incrementales son eficientes.

## 3. Restauración (ensayo recomendado una vez)

1. Proyecto Supabase nuevo → migraciones + seeds ([SUPABASE.md](SUPABASE.md)).
2. `pg_restore --data-only --disable-triggers --no-owner -d "<cadena>" inmo360_AAAAMMDD.dump` (si restaura el volcado completo sobre un proyecto vacío sin migraciones, omita `--data-only`).
3. Refresque el agregado: `select stats.refresh_latest();`.
4. Fije de nuevo las contraseñas de `inmo_web` e `inmo_worker` y actualice Vercel y el `.env` del PC.
5. Compruebe en la web: escenarios guardados abren con el mismo resultado (la huella del motor se guarda con cada resultado), notas y oportunidades presentes.

## 4. Antes de cambios de esquema

Antes de aplicar migraciones nuevas en Supabase: copia completa (punto 1). Las migraciones de Inmo360 no borran datos de usuario; cualquier excepción se indicará en la propia migración y en `DECISIONES.md`.
