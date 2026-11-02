# Documento de continuidad

Para retomar Inmo360 en otra sesión (humana o de IA) sin contexto previo. Última actualización: **2026-11-02**.

## Dónde está cada cosa

- Repositorio Git (rama `feat/mvp`): carpeta del propietario `Documentos\Claude\inmo360`. El propietario hace el *push* a GitHub (privado).
- Especificación funcional: la conversación original con el propietario (secciones 1–31). Las decisiones que la concretan están en [DECISIONES.md](DECISIONES.md); el catálogo §9 en `catalog/` y en la app (*Fuentes e indicadores*).
- Estado verificado: [INFORME_FINAL.md](INFORME_FINAL.md), [PRUEBAS.md](PRUEBAS.md), [ESTADO_FUENTES.md](ESTADO_FUENTES.md).

## Estado en una tabla

| Área | Estado |
|---|---|
| 13 módulos web | Implementados y probados E2E contra la base aislada |
| Motores financiero y de puntuación | Implementados con pruebas (36 + 13) |
| Cola y trabajador | Implementados con pruebas contra la base aislada (44) |
| Datos públicos | Padrón, renta ADRH y viviendas turísticas importados **en la base aislada**; nada todavía en Supabase |
| Anuncios reales | **Ninguno**: no hay fuente autorizada. Solo 507 sintéticos de prueba (no cargar en producción) |
| Supabase | **Instalado** (proyecto `npilepdhviyzlenmycvv`, Frankfurt): esquema, catálogo, perfiles, roles, Auth sin registro público, propietario. Sin datos todavía |
| Vercel | **No desplegado** |

## Próximos pasos (orden recomendado)

1. ~~Instalar en Supabase~~ (hecho el 2026-11-02). Revocar el token personal usado. Configuración con secretos en `Documentos\Claude\inmo360\instalacion_supabase\SECRETO_*.env`.
2. **Arrancar el trabajador** en el PC ([GUIA_WINDOWS.md](GUIA_WINDOWS.md)) y encolar: `geo.es_atlas` → `stats.ine_tempus` (padrón, VTE, ADRH) → `stats.derive`. Verificar que `stats.ine_tempus` funciona en directo; si no, usar `stats.browser_capture` con las capturas entregadas aparte (`capturas_ine_2026-11-02.zip`). Al lograrlo, subir el estado de esos recursos a `operational` con evidencia en `catalog/sources.py`.
3. **Desplegar en Vercel** ([DESPLIEGUE_VERCEL.md](DESPLIEGUE_VERCEL.md)).
4. **Registrar reglas fiscales** (ITP de su comunidad, etc.) con su fuente oficial en *Supuestos y scoring*.
5. **Revisar y activar perfiles de puntuación** (experimentales) o crear variantes.
6. **Fuente de anuncios autorizada**: feed de agencias (Kyero XML), webs de agencias con schema.org (respetando condiciones), exportaciones propias por CSV o API de Idealista si conceden acceso.
7. Ampliar el catálogo importado (ver «Pendiente» abajo).

## Pendiente conocido (con motivo)

| Pendiente | Motivo / bloqueo |
|---|---|
| Despliegue en Supabase y Vercel | Requiere cuentas y autorización expresa del propietario |
| `stats.ine_tempus` en directo | La red de la sesión de construcción no alcanzaba el INE; validado con respuestas reales capturadas |
| ADRH tabla 30824 | Respuesta truncada en la captura; reintentar desde el PC |
| 47 recursos «catalogados» y 20 «identificados» sin importar (empleo, IRPF/AEAT, censo de viviendas, MIVAU, Catastro, educación, servicios, construcción…) | Alcance: cada recurso necesita conector y validación con respuesta real; no se marcan como hechos sin evidencia |
| Límites oficiales CNIG | Descarga con aceptación de licencia; conector bloqueado a propósito; se usa es-atlas (simplificado) |
| Anuncios reales | Sin canal autorizado. Idealista: credenciales; Fotocasa: sin canal → no hay conector |
| Migración de fotos a Supabase Storage | Preparada y probada la parte de copia/verificación; falta orden CLI y función de marcado (ver [MIGRACION_MEDIOS.md](MIGRACION_MEDIOS.md)) |
| Perfiles de operación para modalidades distintas del alquiler completo | Decisión de producto pendiente |
| Avisos de búsquedas guardadas fuera de la app (correo/push) | Fuera del MVP; hoy se cuentan novedades al visitar |
| Invitación de usuarios desde la interfaz | Preparado en datos (RLS por usuario); alta manual en Supabase |
| Mapa base | Sin mapa base por defecto (solo límites propios); opcional por variable de entorno |

## Cómo trabajar en el código

- Monorepo npm (`apps/web`, `packages/*`) + `worker` (Python) + `supabase/migrations` (SQL puro, compatible con Supabase).
- Base aislada para pruebas: `scripts/local/db-reset.sh` + seeds + `scripts/local/dev-owner.sql`; web con `AUTH_MODE=local` (se niega fuera de localhost/Vercel). Nunca apuntar estos scripts a Supabase.
- Cambios de esquema: **migración nueva** numerada (no editar las existentes una vez aplicadas en Supabase).
- Catálogo: editar `catalog/*.py` → `python catalog/build.py` → aplicar `supabase/seed/010_catalog.sql` (idempotente).
- Reglas de producto que no se deben romper: desconocido ≠ 0; sin fotos en la web; sin módulo ni factores de riesgo; atributos protegidos nunca puntúan ni filtran; importación parcial nunca retira anuncios; estado técnico solo con evidencia; secretos solo en servidor/`.env` del PC.
