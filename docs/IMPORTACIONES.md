# Guía de importaciones

Todas las importaciones pasan por la **cola** (`ingest.jobs`): se encolan desde la web (*Importaciones → Encolar trabajo*, solo el propietario) y las ejecuta el trabajador del PC. Con el PC apagado quedan **pendientes**; la web sigue funcionando con los datos ya cargados.

## Orden recomendado en una instalación nueva

| # | Trabajo | Parámetros | Resultado esperado |
|---|---|---|---|
| 1 | `geo.es_atlas` (fuente `es_atlas`) | `{}` | 19 CCAA, 52 provincias, 8.131 municipios con geometría simplificada; 81 condominios como área no municipal; Gibraltar excluido. |
| 2 | `stats.ine_tempus` (fuente `ine`) | `{"preset":"padron_municipal_sexo","tables":["29005"]}` | Padrón municipal por sexo. Añade los municipios del padrón sin geometría (p. ej. 48916). |
| 3 | `stats.ine_tempus` | `{"preset":"vte_municipal","tables":["39363"]}` | Viviendas turísticas y plazas por municipio (serie semestral). |
| 4 | `stats.ine_tempus` | `{"preset":"adrh_renta","tables":["<id tabla provincia 1>", "…"]}` | Renta neta media por persona y por hogar (tablas provinciales del ADRH; ver nota). |
| 5 | `stats.derive` (fuente `derived`) | `{}` | Crecimientos, densidad, ratios, estadísticas de oferta; refresca el agregado de la web. |

Ejecute `stats.derive` después de cada importación estadística o de anuncios. También puede pulsar *Actualizar «último dato disponible»* en la web.

**Nota ADRH**: el INE publica la renta municipal en una tabla por provincia dentro de la operación 353 («Indicadores de renta media y mediana»). Los identificadores se obtienen del listado de tablas de esa operación en la API Tempus (`OPERACIONES_DISPONIBLES` → 353 → `TABLAS_OPERACION`). En la sesión de construcción se descargaron desde el navegador; la tabla 30824 llegó truncada y no se importó (ver [ESTADO_FUENTES.md](ESTADO_FUENTES.md)).

## Vía alternativa: capturas del navegador

Si el PC no puede descargar del INE directamente (red corporativa, proxy), puede guardar las respuestas con el navegador y dejarlas en `INMO_DATA_DIR\captures\<dataset>\chunk_NNN.txt` (formato documentado en `scripts/capture/collect.py`). Luego encole `stats.browser_capture` con `{"dataset":"ine_29005"}`, `ine_adrh` o `ine_vte`. Así se cargó la base de pruebas. Las observaciones quedan marcadas con `capture_method = browser_capture` y la URL y fecha de captura se guardan en la ejecución.

## Anuncios desde fichero (`listings.file_import`)

1. Deje el fichero en `INMO_DATA_DIR\inbox\` (UTF-8; CSV con `;` o `,`, o JSON).
2. Encole `listings.file_import` con fuente = un código propio estable (p. ej. `agencia_garcia`) y `{"file":"agencia_garcia_2026-11.csv"}`.
3. Si el fichero es una **exportación completa** de esa fuente (todos sus anuncios vigentes), añada `"complete_snapshot": true`: solo entonces los anuncios de esa fuente y ámbito que no aparezcan pasan a «no observado». Sin esa marca, una importación nunca retira anuncios.

Columnas (cabecera exacta; las desconocidas se conservan en `extra.unmapped`):

| Columna | Obligatoria | Formato / valores |
|---|---|---|
| `external_id` | Sí | Identificador estable del anuncio en su fuente |
| `operation` | Sí | `sale` · `rent` |
| `price_amount` | No | Número. Admite `120000`, `120.000` (miles españoles) o `120000.50`. Vacío = desconocido |
| `price_unit` | Sí | `sale_total` · `rent_month` · `rent_room_month` · `rent_night` · `other` (+ `price_unit_note`) |
| `municipality_code` | Recomendada | Código INE de 5 cifras **como texto** (`02003`, no `2003`) |
| `lat`, `lon`, `location_precision` | No | Grados decimales con punto (`-3.7038`). Precisión: `exact` · `street` · `zone` · `municipality` · `unknown` |
| `property_type` | No | `piso`, `casa`, `ático`, `dúplex`, `estudio`… o `flat`, `house`… |
| `built_area_m2`, `useful_area_m2`, `rooms`, `bathrooms`, `year_built` | No | Números |
| `has_elevator`, `has_terrace`, `has_parking` | No | `sí`/`no`, `true`/`false`, `1`/`0`; vacío = desconocido |
| `condition` | No | `new` · `good` · `to_renovate` (otro valor → desconocido) |
| `floor_text`, `energy_rating`, `address_text`, `postal_code`, `title`, `description`, `url` | No | Texto |
| `published_at_declared` | No | `AAAA-MM-DD` o `DD/MM/AAAA` (fecha que declara la fuente; no es «días en mercado») |
| `agency_name`, `agency_reference` | No | Agencia y su referencia interna (ayuda a detectar duplicados) |
| `is_synthetic` | No | `true` solo para datos de prueba |

Errores por fila (unidad de precio incoherente, municipio mal formado, coordenadas fuera de rango…) se registran como incidencias y el trabajo termina como **parcial**; las filas válidas sí se importan. Reimportar el mismo fichero es idempotente: no duplica anuncios ni eventos; un cambio de precio genera un evento `price_change`.

## Deduplicación

Tras cada importación se proponen posibles duplicados entre publicaciones (*Importaciones → Duplicados*). Nunca por una sola señal: hacen falta ≥ 3 señales positivas, puntuación ≥ 55 y al menos una señal fuerte (superficie casi idéntica ±2 %, ubicación exacta a ≤ 30 m, misma referencia de agencia o imagen idéntica); dos fuerzas si ambas publicaciones son de la misma fuente. Confirmar une los inmuebles conservando el historial; *Deshacer unión* lo revierte; *Son distintos* no se vuelve a proponer.

## Datos sintéticos de prueba

`scripts/demo/generate_synthetic_listings.py` crea 507 anuncios marcados `is_synthetic = true` (referencias `SINT-…`). La web muestra un aviso global y una etiqueta en cada dato afectado, incluidos los derivados calculados con ellos. **No los cargue en la base operativa**; si lo hace por error: `delete from market.listings where is_synthetic;` y vuelva a ejecutar `stats.derive`.

## Seguimiento

*Importaciones* muestra trabajadores (conectado/desconectado y último latido), trabajos con intentos, progreso y error, ejecuciones de cada trabajo con su cobertura (completa o parcial), incidencias, observaciones vigentes por recurso, anuncios por fuente e inventario de medios. Cancelar un trabajo pendiente es inmediato; uno en curso se detiene en el siguiente punto seguro.
