# Fotos y capturas: almacenamiento local y plan de migración a Supabase Storage

## Situación actual (decisión del propietario)

- Las fotos y capturas se guardan **solo en el disco del PC** (`INMO_DATA_DIR\media-store`). La descarga de fotos está **desactivada por defecto** (`INMO_DOWNLOAD_MEDIA=false`).
- La web **no muestra fotos**, no genera miniaturas en la nube, no las pide a los portales y no hay túneles ni servidores de fotos. Con el PC apagado, la web funciona igual.
- En Supabase solo hay **inventario** (`market.media_assets`): anuncio, tipo, hash SHA-256, tamaño, tipo MIME, dimensiones, proveedor (`local`), clave relativa, estado, fecha de captura. Nunca rutas absolutas del PC (restricción en base de datos) ni las URLs originales (solo su hash).

## Almacén local (`LocalStorage`)

- Direccionado por contenido: `media/ab/abcdef….jpg` según el SHA-256 → la misma imagen no se guarda dos veces.
- Escritura atómica (fichero temporal + renombrado); comprobación del tipo real por cabecera (no por extensión) y tamaño máximo 15 MB.
- El trabajador registra un medio como `available` **solo** cuando el fichero está completo y verificado (restricción `available_has_hash`).

## Migración a Supabase Storage (preparada, no ejecutada)

Implementado y probado: `worker/inmo_worker/storage.py` → `SupabaseStorage` (subida, descarga y verificación por hash) y `migrate()`:

- **Reanudable**: diario JSONL con cada clave verificada; al reanudar se omiten.
- **Verificación**: tras subir, descarga y compara SHA-256; solo entonces la anota.
- **No destructiva**: nunca borra el original local.
- **Ensayo** (`dry_run=True`) que solo cuenta pendientes.
- Prueba: `test_media_migration_is_resumable_and_verifies`.

Pendiente de implementar antes de migrar (no se hizo porque el propietario decidió no subir fotos):

1. Orden de línea de comandos `inmo-worker migrate-media [--dry-run]` que lea los medios `available`/`local` del inventario.
2. Función `ingest.worker_mark_media_migrated(run, token, items)` (el trabajador no escribe tablas directamente) que cambie `storage_provider='supabase'`, `status='migrated'` y guarde `migration = {target, verified_at}` solo para claves del diario.
3. Bucket **privado** `inmo-media` y acceso de lectura con URLs firmadas de corta duración desde el servidor de la web (nunca públicas).
4. Interfaz de fotos en la ficha (hoy inexistente por decisión de producto).

Procedimiento previsto:

1. Crear el bucket privado (*Storage → New bucket*, no público). Comprobar el espacio: el plan gratuito incluye 1 GB de almacenamiento de ficheros.
2. Configurar en el `.env` del PC `SUPABASE_URL` y una clave con permiso de escritura **solo en el PC** (nunca en la web ni en Git).
3. `migrate-media --dry-run` → revisar el recuento y el tamaño.
4. `migrate-media` → revisar el diario y el informe (subidos, verificados, fallidos). Repetir hasta 0 pendientes.
5. Mantener los originales locales al menos un ciclo de copias de seguridad completo antes de plantearse borrarlos (nunca automático).

Reversión: el inventario conserva la clave relativa y el hash; volver a `local` es cambiar el proveedor de los registros, porque los originales siguen en el PC.
