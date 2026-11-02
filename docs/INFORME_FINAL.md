# Informe final · Inmo360 MVP

Fecha: 2026-11-02. Todo lo que aquí se afirma está respaldado por pruebas ejecutadas o por datos medidos en la base aislada; lo no verificado se indica como tal.

## 1. Qué funciona

Aplicación web completa con los **13 módulos** exigidos, sobre datos reales del INE para toda España y anuncios sintéticos claramente marcados:

| Módulo | Ruta | Estado |
|---|---|---|
| Explorador de zonas (mapa MVT propio + tabla, filtros, selección) | `/zonas` | ✅ |
| Ficha territorial (CCAA, provincia, municipio; series, fuentes, cobertura, puntuación) | `/zonas/[nivel]/[código]` | ✅ |
| Explorador de viviendas (lista + mapa sincronizados, agrupación en servidor, filtros, búsquedas guardadas) | `/viviendas` | ✅ |
| Ficha de vivienda (valores canónicos con discrepancias, correcciones con autor/fecha/motivo, publicaciones, historial, comparables con exclusiones, escenarios, puntuaciones, notas) | `/viviendas/[id]` | ✅ |
| Calculadora de inversión (5 modalidades, libro de movimientos, flujo mensual, amortización, por habitación) | `/calculadora` | ✅ |
| Calculadora inversa de precio máximo | `/calculadora` → pestaña | ✅ |
| Comparador de zonas | `/comparar?modo=zonas` | ✅ |
| Comparador de viviendas/operaciones con los mismos supuestos y de escenarios guardados | `/comparar` | ✅ |
| Mis oportunidades | `/oportunidades` | ✅ |
| Búsquedas guardadas (con novedades desde la última visita) y selecciones de zonas | `/busquedas` | ✅ |
| Panel de importaciones (trabajadores, cola, ejecuciones, incidencias, cobertura, medios) y revisión de duplicados | `/importaciones` | ✅ |
| Catálogo de fuentes e indicadores (recursos, indicadores, matriz, exclusiones) | `/catalogo` | ✅ |
| Supuestos y scoring (conjuntos de supuestos, perfiles, combinación global, reglas fiscales) | `/configuracion` | ✅ |

Además: trabajador local con cola robusta (reserva atómica, latido, renovación, puntos de control, reintentos, cancelación, recuperación tras reinicio, protección de reservas caducadas), 9 conectores, deduplicación reversible, almacenamiento local de medios con migración preparada, seguridad por RLS con roles propios para web y trabajador.

## 2. Qué se probó y resultados

**123 pruebas automáticas, todas correctas** (detalle en [PRUEBAS.md](PRUEBAS.md)): motor financiero 36, puntuación 13, contratos 3, utilidades web 9, trabajador y base de datos 44, E2E escritorio 10, E2E móvil 8. `tsc` sin errores en todos los paquetes y `next build` correcto.

## 3. Fuentes realmente importadas y cobertura

En la **base aislada** (no en Supabase), por el trabajador real:

| Fuente | Periodo | Cobertura municipal |
|---|---|---|
| Geografía es-atlas 0.6.0 (derivada de IGN/CNIG) | — | 8.131 municipios con geometría + 52 provincias + 19 CCAA |
| INE padrón 29005 (total y por sexo) | 2015–2025 | 8.134 territorios con dato en 2025 |
| INE ADRH renta neta media por persona y hogar | 2015–2024 | 8.126 (8 municipios pequeños sin dato; tabla 30824 no importada) |
| INE viviendas turísticas 39363 (viviendas y plazas) | 2020-08 → 2026-05 | 8.135 |
| Derivados (crecimientos 1/5/10 años, CAGR, densidad, índice de masculinidad, plazas por vivienda) | último periodo | 6.254–8.134 según indicador |

Total: 641.815 observaciones vigentes. Catálogo: 37 fuentes, 78 recursos (3 operativos, 5 con importación probada, 20 identificados, 47 catalogados, 2 bloqueados, 1 no disponible), 140 indicadores, 755 etiquetas originales (especificación + `texto.txt`) en una matriz de 920 filas. Detalle: [ESTADO_FUENTES.md](ESTADO_FUENTES.md).

**Anuncios: ningún anuncio real.** Los 507 anuncios disponibles son sintéticos (6 municipios) y se señalan en toda la interfaz, incluidos los derivados calculados con ellos.

## 4. Pendiente y por qué

Resumen (lista completa en [CONTINUIDAD.md](CONTINUIDAD.md)):

- **Despliegue en Supabase y Vercel**: requiere su cuenta y autorización expresa; la red de la sesión no alcanzaba Supabase. Hay un punto a verificar en la primera instalación (`grant authenticated to inmo_web`).
- **Ejecución en directo contra el INE desde su PC** (`stats.ine_tempus`): validado con respuestas reales capturadas, no en vivo.
- **Resto del catálogo §9** (empleo, IRPF, censo de viviendas, precios MIVAU, Catastro, educación, servicios, construcción…): catalogado con su estado real; cada recurso necesita conector y validación.
- **Anuncios reales**: sin canal autorizado (Idealista requiere credenciales; Fotocasa no tiene canal).
- **Límites oficiales CNIG**, CLI de migración de fotos, avisos de búsquedas fuera de la app, invitación de usuarios desde la interfaz.

## 5. Cómo ejecutar

- **Web**: Vercel con `apps/web` como raíz y las variables de [DESPLIEGUE_VERCEL.md](DESPLIEGUE_VERCEL.md). En local: `npm install` y `npm run dev` con `apps/web/.env.local`.
- **Trabajador (Windows)**: `cd worker`, entorno virtual, `pip install -e .`, `.env` con el rol `inmo_worker`, `inmo-worker check` y `inmo-worker run` ([GUIA_WINDOWS.md](GUIA_WINDOWS.md)).
- **Primera carga de datos**: [IMPORTACIONES.md](IMPORTACIONES.md).

## 6. Pasos de despliegue

1. Supabase: proyecto en región UE → migraciones → seeds → contraseñas de `inmo_web` e `inmo_worker` → Auth sin registro público → alta del propietario ([SUPABASE.md](SUPABASE.md)).
2. Trabajador en el PC → `geo.es_atlas`, `stats.ine_tempus` (padrón, VTE, ADRH), `stats.derive`.
3. Vercel → variables → despliegue → URL en Supabase Auth.
4. Copias de seguridad semanales ([COPIAS_SEGURIDAD.md](COPIAS_SEGURIDAD.md)).

Coste: 0 €. Todo cabe en los planes gratuitos; la base con los datos actuales ocupa 322 MB de 500 MB.

## 7. Decisiones experimentales que necesitan su validación

1. **Pesos y umbrales de los 7 perfiles de puntuación** (zona ×5, vivienda, operación de alquiler). Ninguno está activo por defecto.
2. **Supuestos por defecto de las plantillas**: notaría/registro/gestoría 1,5 %, vacancia 4 %, mantenimiento 5 % (completo) y 7 % (habitaciones), ocupación de habitaciones 92 %, honorarios de venta 3 %. Marcados como «estimado» con su origen; editables.
3. **Comparables**: radio municipio → provincia si < 5, superficie ±30 %, habitaciones ±1, Tukey 1,5 × RIC, umbral de calidad por dispersión 35 %.
4. **Deduplicación**: puntuación ≥ 55, ≥ 3 señales positivas, señales fuertes (±2 % superficie, ≤ 30 m, referencia, imagen).
5. **Universo de percentiles**: municipios con ≥ 1.000 habitantes.
6. **Derivados solo del último periodo** para respetar el límite de 500 MB (la serie se puede recalcular).
7. **Sin mapa base externo por defecto** (privacidad y coste); se puede activar uno.
