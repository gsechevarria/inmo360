# Pruebas

Resultados de la última ejecución completa: **2026-11-02**, sesión de construcción (Linux, Node 22.23, Python 3.13, PostgreSQL 16.15 + PostGIS 3.4 aislado).

| Conjunto | Ubicación | Casos | Resultado |
|---|---|---|---|
| Motor financiero | `packages/finance/test` | 36 | ✅ 36/36 |
| Motor de puntuación | `packages/scoring/test` | 13 | ✅ 13/13 |
| Contratos (zod) | `packages/contracts/test` | 3 | ✅ 3/3 |
| Utilidades web (comparables, valores canónicos, supuestos, formato) | `apps/web/test` | 9 | ✅ 9/9 |
| Trabajador: unidades, conectores, contratos, cola y datos contra la base aislada | `worker/tests` | 44 | ✅ 44/44 |
| E2E escritorio (Playwright, Chromium 1440×900) | `apps/web/e2e/flujos.spec.ts` | 10 | ✅ 10/10 |
| E2E móvil (Pixel 7) | `apps/web/e2e/movil.spec.ts` | 8 | ✅ 8/8 |
| Tipos (`tsc --noEmit`, todos los workspaces) y `next build` | — | — | ✅ sin errores |

## Qué cubren

**Cálculo**: desconocido ≠ 0 (bloquea solo las métricas dependientes), duplicados, préstamos (carencia, escenarios de tipos, amortización anticipada, LTV, tipo desconocido → pendiente), cinco modalidades, reserva (no gasto), TIR con varias raíces / sin solución, precio máximo (tramos no lineales, inviable, límite y ampliación automática).

**Puntuación**: atributos protegidos y factores de riesgo rechazados, señales correlacionadas, faltantes (bloquear / parcial con cobertura mínima), universo estable, requisitos imprescindibles, combinación global solo explícita.

**Cola (base aislada)**: el rol del trabajador no accede a tablas; reserva atómica (solo un trabajador gana); reserva caducada → reasignación y la ejecución vieja no puede escribir; cancelación cooperativa; reintentos con espera exponencial y fallo final; fuente bloqueada sin reintentos; reanudación desde punto de control tras reinicio; trabajador revocado; solo el propietario encola y ve la cola.

**Datos (base aislada)**: revisiones de observaciones, censurados con literal y sin número, territorio inexistente y correspondencia no declarada rechazados con incidencia, códigos con ceros iniciales; anuncios idempotentes, cambio de precio, recorrido parcial que **no** retira anuncios, recorrido completo → «no observado», reaparición; candidatos de duplicado y unión reversible; reglas de registro de medios; aislamiento RLS entre usuarios; miembros leen referencia pero no escriben; derivados como foto del último periodo con explicación y poda; derivados con anuncios sintéticos marcados como sintéticos.

**Conectores**: parser INE con respuesta real capturada, TopoJSON y jerarquía, almacenamiento local atómico y deduplicado, migración de medios reanudable y verificada, protección SSRF, robots y fuentes bloqueadas, reintento ante 429, unidades de precio explícitas, coordenadas nunca como miles, ceros iniciales en CSV, booleanos de CSV («false» no es verdadero), JSON-LD de venta y alquiler, feed Kyero, contrato compartido con JSON Schema.

**E2E**: provincia → municipios → viviendas; lista y mapa sincronizados; ficha → calculadora con datos pendientes → completar → guardar (recalculado en servidor); precio máximo y guardado; comparación de escenarios y de viviendas con los mismos supuestos; corrección de un dato sin sobrescribir el original; seguimiento en Mis oportunidades; importación con el trabajador apagado (pendiente) y cancelación; escenario incompleto sin ceros; **ninguna petición a terceros ni imágenes**; sin sesión no hay acceso; móvil sin desbordamiento horizontal y alternancia lista/mapa.

## Cómo ejecutarlas

```bash
npm install
npm test                                     # finance, scoring, contracts, web
cd worker && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
python -m pytest -q                          # las pruebas «db» se omiten si no hay base aislada
```

Base aislada y E2E (Linux/WSL con PostgreSQL 16 + PostGIS):

```bash
scripts/local/db-reset.sh inmo360_dev
psql postgresql://postgres:postgres@127.0.0.1:5432/inmo360_dev -f supabase/seed/010_catalog.sql -f supabase/seed/020_scoring_profiles.sql -f scripts/local/dev-owner.sql
# cargar datos con el trabajador (ver IMPORTACIONES.md) y anuncios sintéticos de prueba
cd apps/web && cp .env.example .env.local   # DATABASE_URL=inmo_web@127.0.0.1, AUTH_MODE=local, LOCAL_AUTH_SECRET (≥ 32 caracteres)
npx playwright test
```

## No probado (y por qué)

- **Contra Supabase real y Vercel**: la red de la sesión no alcanzaba Supabase y el despliegue público requiere autorización del propietario. Las migraciones usan solo SQL compatible y los roles de Supabase emulados; ver ⚠ en [SUPABASE.md](SUPABASE.md).
- **Login por enlace mágico** (Supabase Auth): implementado con `@supabase/ssr`; las pruebas usan el modo local de la base aislada.
- **`stats.ine_tempus` contra la API del INE en directo** desde el PC: probado con respuesta real capturada, no en vivo.
- **Idealista API**: sin credenciales concedidas.
- Rendimiento con decenas de miles de anuncios reales: probado con 507 sintéticos (consultas paginadas y agrupación en servidor; ver DECISIONES.md).
