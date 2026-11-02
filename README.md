# Inmo360

Aplicación privada para analizar inversión inmobiliaria residencial en toda España: explorar zonas y viviendas, estudiar comparables, calcular operaciones en cinco modalidades (reventa, alquiler de vivienda completa, por habitaciones, temporal y turístico), calcular el precio máximo de compra y hacer seguimiento de oportunidades.

- **Web** (Next.js, desplegable en Vercel) contra **Supabase Cloud** (Postgres + PostGIS + Auth, con RLS). Funciona con el PC apagado.
- **Trabajador local** (Python) en el PC del propietario: cola de importación, conectores, almacenamiento de fotos en disco local.
- La web **no muestra fotos** ni las solicita a los portales. Un dato desconocido **nunca** se trata como cero.

> Estado real y resultados de las pruebas: [`docs/INFORME_FINAL.md`](docs/INFORME_FINAL.md). Para retomar el trabajo: [`docs/CONTINUIDAD.md`](docs/CONTINUIDAD.md).

## Estructura

| Ruta | Contenido |
|---|---|
| `apps/web` | Aplicación web (Next.js 16, React 19, Tailwind 4, MapLibre). Acceso a datos solo en servidor. |
| `packages/finance` | Motor financiero determinista (calendario mensual, TIR por fechas, préstamos, precio máximo). |
| `packages/scoring` | Motor de puntuación explicable (perfiles versionados, sin atributos protegidos). |
| `packages/contracts` | Contratos compartidos (zod). |
| `worker` | Trabajador local: cola con reservas, conectores INE/geo/anuncios, almacenamiento de medios. |
| `supabase/migrations` | Esquema, RLS, funciones de la cola y agregados (SQL compatible con Supabase). |
| `supabase/seed` | Catálogo (fuentes, recursos, 140 indicadores, 755 etiquetas, matriz) y perfiles experimentales. |
| `catalog` | Fuente del catálogo en Python y generador del seed y de los CSV de la matriz. |
| `scripts` | Base local aislada, encolado, captura de navegador, datos sintéticos de prueba. |
| `docs` | Guías de instalación, despliegue, importación, cálculos, scoring, copias, decisiones. |

## Puesta en marcha (resumen)

1. **Supabase**: crear proyecto, aplicar migraciones y seeds, configurar Auth y roles → [`docs/SUPABASE.md`](docs/SUPABASE.md).
2. **Web en Vercel** → [`docs/DESPLIEGUE_VERCEL.md`](docs/DESPLIEGUE_VERCEL.md). En local: `npm install`, `apps/web/.env.local` (ver `.env.example`), `npm run dev`.
3. **Trabajador en Windows** → [`docs/GUIA_WINDOWS.md`](docs/GUIA_WINDOWS.md).
4. **Importar datos** → [`docs/IMPORTACIONES.md`](docs/IMPORTACIONES.md).

## Pruebas

```bash
npm test                                   # motores finance/scoring + utilidades web (vitest)
cd worker && python -m pytest -q           # trabajador + base aislada (cola, RLS, datos)
cd apps/web && npx playwright test         # E2E escritorio y móvil (base aislada + modo local)
```

Detalle y resultados: [`docs/PRUEBAS.md`](docs/PRUEBAS.md).

## Documentación

[Cálculos](docs/CALCULOS.md) · [Scoring](docs/SCORING.md) · [Conectores](docs/CONECTORES.md) · [Estado de las fuentes](docs/ESTADO_FUENTES.md) · [Migración de medios](docs/MIGRACION_MEDIOS.md) · [Copias de seguridad](docs/COPIAS_SEGURIDAD.md) · [Decisiones](docs/DECISIONES.md) · [Sistema visual](docs/SISTEMA_VISUAL.md) · [Catálogo](docs/CATALOGO_RESUMEN.md)

## Seguridad en una línea

Credenciales privilegiadas solo en servidor o en el `.env` del PC; la web usa el rol `inmo_web` (solo puede actuar como `authenticated`, con RLS); el trabajador usa `inmo_worker` (sin acceso a tablas, solo funciones con reserva y token). Sin registro público. Nada de secretos, fotos ni volcados en Git.
