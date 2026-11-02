# Guía de conectores

Un conector es un manejador del trabajador (`worker/inmo_worker/connectors/`) registrado en `registry.py` para un `job_type`. Recibe un `JobContext` y devuelve un `Outcome(status, stats, scope_covered, coverage_complete)`.

## Reglas (no negociables)

1. **Solo canales legítimos**: APIs públicas o concedidas, ficheros que aporta el propietario, feeds autorizados y páginas públicas con datos estructurados. No se inventan endpoints: un recurso pasa a `resource_identified` solo con URL comprobada, y a `download_tested`/`import_tested`/`operational` solo con evidencia (`status_evidence` en el catálogo).
2. **No se eluden** autenticaciones, captchas, bloqueos, límites ni condiciones de uso. Un 401/403/captcha → `SourceBlocked`: el trabajo falla **sin reintentos** y queda documentado. Idealista y Fotocasa están bloqueados salvo autorización expresa (Idealista: API con credenciales concedidas; Fotocasa: sin canal autorizado → no hay conector).
3. **Cortesía**: `PoliteClient` respeta `robots.txt` (salvo descargas de paquetes públicos), aplica un intervalo mínimo por host (`INMO_HTTP_MIN_INTERVAL`), reintenta 429/5xx con espera exponencial y se identifica con un User-Agent con contacto. Protección SSRF: no se siguen redirecciones a redes privadas.
4. **Datos personales**: no se recogen datos de anunciantes particulares (teléfonos, nombres, correos). De agencias, solo nombre comercial, web y referencia del anuncio.
5. **Secretos**: solo en el `.env` del PC. Nunca en parámetros de trabajos (la web rechaza parámetros con apariencia de credencial), logs, capturas ni Git.
6. **Fotos**: desactivadas por defecto. Si se activan, el conector guarda bytes en `LocalStorage` (por hash, con verificación de tipo y tamaño) y registra solo metadatos con `ingest.worker_register_media`. La web nunca las muestra ni las pide a los portales.

## Contrato de anuncio

`normalize.listing(source_code, external_id, operation=…, price_amount=…, price_unit=…, location={…}, **campos)` valida y construye el elemento que acepta `ingest.worker_submit_listings`:

- `price_unit` explícita: `sale_total`, `rent_month`, `rent_room_month`, `rent_night` u `other` con nota. Nunca se convierte una unidad ambigua en total multiplicando.
- `municipality_code` como texto de 5 cifras. Coordenadas con punto decimal; `to_coord` no interpreta separadores de miles en coordenadas.
- Números españoles: `to_num` interpreta `120.000` como 120 000 y `1.234,56` como 1234,56; `to_int`/`to_bool` aceptan las variantes habituales; vacío = desconocido (nunca 0).
- Campos no mapeados → `extra.unmapped` (recortados), para no perder información ni ampliar el esquema a ciegas.

## Cobertura y retiradas

- `coverage_complete = True` solo si el conector recorrió **todo** el ámbito declarado en `scope_covered` (municipios/operaciones de la fuente, o el feed completo de una agencia). Solo entonces `worker_finish` marca como `not_observed` los anuncios de ese ámbito que no aparecieron.
- Una ejecución parcial, cancelada o fallida **nunca** retira anuncios. «No observado» no significa vendido; `withdrawn_confirmed` solo con evidencia de la fuente.

## Cola: lo que el conector debe hacer

- Enviar en lotes (`ctx.submit(kind, items)`, ≤ 5.000 elementos) y guardar puntos de control (`ctx.checkpoint(clave, valor)`) para poder reanudar.
- Llamar a `ctx.check()` en los bucles: detiene el trabajo si se perdió la reserva o si el propietario pidió cancelar (la renovación de la reserva y el latido los hace un hilo aparte con su propia conexión).
- Ser idempotente: reenviar el mismo lote no duplica observaciones, anuncios ni eventos.

## Añadir un conector nuevo

1. Dé de alta la fuente y el recurso en `catalog/sources.py` (estado técnico y de reutilización por separado; URL real o `None`), y la correspondencia recurso → indicador en `catalog/mappings.py`. Regenere con `python catalog/build.py` y aplique `supabase/seed/010_catalog.sql`.
2. Implemente el manejador en `connectors/` y regístrelo en `registry.py`. Añada el tipo a `apps/web/lib/jobs.ts` para poder encolarlo desde la web.
3. Pruebas en `worker/tests/` con **respuestas reales capturadas** como fixture (no inventadas) y, si escribe en la base, contra la base aislada.
4. Actualice el estado del recurso en el catálogo solo con la evidencia obtenida (fecha, qué se probó).

## Conectores existentes

| Tipo | Estado | Notas |
|---|---|---|
| `geo.es_atlas` | Importación probada | TopoJSON es-atlas 0.6.0 (npm, derivado de IGN/CNIG, CC BY 4.0). |
| `geo.cnig` | Pendiente (bloqueado) | La descarga de *Líneas límite* exige aceptar la licencia en el centro de descargas del CNIG. El manejador responde «fuente bloqueada» sin reintentos; falta implementar la lectura del ZIP desde el buzón. Mientras tanto, `geo.es_atlas`. |
| `stats.ine_tempus` | Parser probado con respuesta real | Ejecución directa desde el PC pendiente (en la sesión de construcción INE no era accesible desde la nube). |
| `stats.browser_capture` | Importación probada | Vía alternativa usada para cargar padrón, ADRH y VTE reales. |
| `stats.derive` | Operativo | Funciones SQL con pruebas. |
| `listings.file_import` | Importación probada | CSV/JSON del propietario. |
| `listings.feed_kyero` | Parser probado con XML de prueba | Solo con feed autorizado por la agencia. |
| `listings.agency_jsonld` | Parser probado con HTML de prueba | Webs de agencias con schema.org; respeta robots y dominio. |
| `listings.idealista_api` | Bloqueado | Implementado según la documentación pública; sin credenciales no se activa y el mapeo de campos se validará en la primera ejecución real. |
