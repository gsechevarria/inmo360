# Registro de decisiones (ADR)

Formato: fecha · decisión · motivo · consecuencias. Las decisiones de la especificación (§2) no se repiten aquí: se aplican tal cual.

## 2026-11-02 · Entorno de construcción

- **Construcción en el espacio de trabajo en la nube de Claude, entrega como repositorio Git en `Documentos\Claude\inmo360`** del PC del propietario. La sesión no tiene credenciales de GitHub; el push lo hace el propietario.
- **La red de la sesión solo alcanza npm, PyPI, GitHub y repositorios Ubuntu.** INE, IGN, Catastro, Supabase, portales y teselas devuelven 403 del proxy de salida. Consecuencias:
  - Base de datos de desarrollo/pruebas **aislada** (PostgreSQL 16 + PostGIS 3.4 locales). No es una segunda base operativa: se usa solo para pruebas y capturas.
  - Las fuentes públicas se validan con **respuestas reales capturadas desde el navegador del propietario** (Claude Browser), guardadas como fixtures marcadas `synthetic: false` con URL y fecha de captura.
  - La importación completa la ejecuta el **trabajador en el PC del propietario** contra Supabase Cloud.
- No hay Docker operativo: no se usa `supabase start`. Las migraciones son SQL puro compatible con Supabase (esquema `auth` y roles `authenticated`/`anon`/`service_role` emulados en local por `scripts/local/auth_shim.sql`, que **no** se aplica en Supabase).

## 2026-11-02 · Versiones fijadas

Se fijan versiones estables con al menos dos semanas de publicación y API conocida:

| Componente | Versión | Motivo |
|---|---|---|
| Next.js | 16.4.2 | Estable; 16.4.4 se publicó el mismo día. |
| React | 19.2.x | Compatible con Next 16. |
| TypeScript | 5.9.3 | TS 7 (compilador nativo) aún sin API programática estable para el tipado de Next. |
| maplibre-gl | 5.24.0 | Rama 5 madura; la 6 no aporta nada imprescindible. |
| postgres (porsager) | 3.4.9 | La 4.0 se publicó hace 4 días. |
| zod | 4.6.5 | Contratos compartidos. |
| vitest | 3.2.7 | Rama mantenida (V3). |
| Playwright | 1.63.0 | Coincide con el navegador preinstalado. |
| Python | ≥ 3.12 | Trabajador. psycopg 3, httpx, pydantic 2. |

## 2026-11-02 · Arquitectura

- **Monorepo npm workspaces** (`apps/web`, `packages/*`) + `worker/` (Python) + `supabase/migrations`. Sin microservicios.
- **La web accede a Postgres desde el servidor** (Server Components / Route Handlers) con `postgres.js` a través del pooler de Supabase, ejecutando cada consulta de usuario dentro de una transacción con `SET LOCAL ROLE authenticated` y `request.jwt.claims` del usuario verificado. Así RLS se aplica igual que vía PostgREST y se pueden usar consultas PostGIS complejas, teselas MVT y agregaciones. Supabase Auth sigue siendo el proveedor de identidad (`@supabase/ssr`).
- **Modo de autenticación local `AUTH_MODE=local`** solo para desarrollo/pruebas aisladas: se niega a arrancar si `NODE_ENV=production` o si `VERCEL` está definido.
- **Trabajador con credencial propia y revocable**: rol Postgres `inmo_worker` (LOGIN) sin acceso directo a tablas; solo puede ejecutar funciones `ingest.worker_*` (SECURITY DEFINER) que validan reserva, token de ejecución y entradas. Revocación: `ALTER ROLE inmo_worker NOLOGIN` o rotar contraseña; además `ingest.workers.revoked_at`.
- **Cola en Postgres**: reserva atómica con `FOR UPDATE SKIP LOCKED`, `lease_token` por ejecución (fencing), renovación de reserva, cancelación cooperativa, reintentos con espera exponencial, puntos de control. Un trabajador con reserva caducada no puede escribir.
- **Mapa sin dependencia de teselas externas**: teselas vectoriales MVT generadas por PostGIS (`ST_AsMVT`) para límites e indicadores; mapa base externo opcional por variable de entorno. Agrupación de viviendas en servidor por cuadrícula según zoom.
- **Geometría inicial**: `es-atlas@0.6.0` (npm, MIT) — TopoJSON derivado de *Líneas límite municipales* IGN/CNIG (CC BY 4.0), simplificado. Se registra como recurso derivado; el conector oficial IGN/CNIG queda implementado para ejecutar desde el PC. Diferencias detectadas con el padrón 2025: 48916 Usansolo (creado en 2022) sin geometría; 81 condominios (código 53xxx) y Gibraltar (54) no son municipios y se cargan como `non_municipal_area` / excluidos.
- **Importes**: `number` (doble precisión) sin redondeos intermedios; se redondea solo al presentar. Excepción documentada: las cuotas de préstamo se redondean a céntimos como hace la banca, con ajuste en la última cuota.

## 2026-11-02 · Producto

- Nombre de trabajo: **Inmo360** (la referencia se presenta como Urmétrica; no se copia su marca).
- Las cinco modalidades se representan con dos ejes internos: `unit` (`whole` | `rooms`) × `term` (`long` | `temporary` | `tourist`), más `resale`. Así existe, por ejemplo, alquiler temporal por habitaciones.
- **Sin teselas de fotos ni galería** en la web. Inventario de medios en Supabase; bytes en disco local del trabajador.
- **Scoring**: no hay pesos aprobados. Se entregan perfiles **experimentales** que el propietario debe seleccionar explícitamente. Sin perfil activo: “puntuación pendiente de configuración”.
- **Fiscalidad**: no se precargan tipos autonómicos como confirmados. La tabla `invest.tax_rules` admite reglas fechadas con fuente; las sugerencias que se añadan quedan en estado *publicado, pendiente de confirmar* y nunca se aplican sin confirmación.

## 2026-11-02 · Datos y almacenamiento

- **Presupuesto de 500 MB (Supabase gratuito)**. Con todos los datos reales importados la base ocupaba 1,33 GB: 910.000 filas de derivados (todos los periodos, incluidos los no calculables), un índice único duplicado en observaciones y una nota de captura de ~160 bytes repetida por fila. Decisión: derivados como **foto del último periodo** con poda (son recalculables desde las observaciones, que sí guardan la serie completa), eliminar el índice redundante (la unicidad de la fila vigente la garantiza `observations_current_uq`) y notas por fila cortas. Resultado: **322 MB** con la misma cobertura vigente. Migración `0012_storage_budget`.
- **Derivados de anuncios sintéticos heredan la marca «sintético»** (antes solo constaba en avisos). Migración `0011`.
- **Vistas con `security_invoker`**: las vistas ordinarias respetan la RLS de quien consulta. Excepción deliberada: `stats.latest_values` e `indicator_coverage` leen la vista materializada y filtran por `app.is_member()`.
- **Booleanos desde CSV** con `to_bool` («false» ya no se interpreta como verdadero).

## 2026-11-02 · Web

- **Calculadora en el navegador, verdad en el servidor**: el motor corre en el cliente para respuesta inmediata; al guardar, el servidor recalcula y guarda resultado y movimientos (`invest.calculation_results`, `cashflow_entries`). El precio máximo también se recalcula en servidor al guardarlo.
- **Cambiar de modalidad** conserva compra, adquisición, reforma, financiación, reserva, reposiciones y gastos de tenencia comunes; regenera la explotación con la plantilla de la nueva modalidad.
- **Un préstamo sin tipo de interés queda pendiente** (antes producía NaN silencioso). Prueba añadida.
- **Precio máximo**: si no se fija límite superior y el borde sigue siendo factible, el intervalo se amplía automáticamente (×4, hasta 3 veces).
- **Reglas fiscales sin precarga**: la calculadora ofrece las reglas registradas para el territorio del inmueble y solo las aplica a petición, con fuente y estado. No se incluyen tipos autonómicos porque cambian por normativa y no se han podido verificar contra el BOE/boletines en esta sesión.
- **Comparador de viviendas con supuestos comunes** introducidos en el propio comparador (vacío = desconocido) y renta estimada por comparables solo si la calidad no es insuficiente.
- **Borrados en dos pasos** en la interfaz (sin diálogos modales del navegador).
- **Contratos**: `packages/contracts` (zod) genera JSON Schema que validan las pruebas del trabajador (TS ↔ Python).
