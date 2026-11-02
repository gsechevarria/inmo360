# Puntuación (`packages/scoring`)

La puntuación es una **ayuda explicable**, no una verdad. Por eso:

- **Sin perfil activo no hay puntuación** («pendiente de configuración»). Las métricas se muestran igualmente.
- Los perfiles incluidos son **experimentales**: pesos y umbrales propuestos, **no validados empíricamente**. El propietario los activa explícitamente en *Supuestos y scoring* y puede crear variantes propias (la plantilla nunca se modifica; cada cambio es una versión nueva).
- Tres bloques **separados**: zona (por modalidad), vivienda (características observables del estado actual) y operación (por modalidad, desde las métricas del escenario). Una puntuación **global** solo existe si el usuario define una combinación explícita de pesos; si algún bloque no está completo, no hay global.

## Garantías (comprobadas en `validateProfile` y en pruebas)

| Regla | Cómo se garantiza |
|---|---|
| Sin atributos protegidos (sexo, nacionalidad, lugar de nacimiento, estado civil, discapacidad…) | Dimensiones protegidas rechazadas; indicadores marcados `excluded_protected` o protegidos en el catálogo no pueden ser factor. Pueden mostrarse como contexto estadístico, nunca puntuar, penalizar ni filtrar. |
| Sin factores de riesgo | No existe módulo de riesgo; claves `risk.*` e indicadores `excluded_risk` rechazados. |
| Sin doble conteo de señales correlacionadas | Factores con el mismo `signalGroup` (p. ej. crecimiento de población 5 y 10 años) no pueden coexistir en un perfil. |
| Faltantes explícitos | `missingPolicy = block` (no puntúa si falta alguno) o `partial_explicit` con cobertura mínima de peso; los factores sin dato se listan y **no se rellenan con cero**. Factores `required` bloquean. |
| Universo estable | Los percentiles se calculan sobre un universo definido por el perfil (municipios con población mínima), **nunca** sobre los filtros de pantalla. |
| Requisitos imprescindibles | Se evalúan aparte (p. ej. flujo mensual ≥ 0) y una nota alta no los compensa. |
| Trazabilidad | Cada resultado lleva versión del perfil, contribución de cada factor (dato, nota 0–100, peso, puntos), periodo y fuente del dato, y huella de entradas. |

## Transformaciones

- **Percentil** (rango medio) en el universo; `lower_better` invierte.
- **Tramos**: interpolación lineal por puntos `(valor, nota)`.
- **Banda objetivo**: 100 dentro de `[low, high]`, cae linealmente a 0 a `falloff` de distancia (útil cuando «más» no es mejor, p. ej. peso turístico).
- **Booleano**.

Puntuación = media ponderada de las notas de los factores con dato. Con datos parciales, se indica la cobertura de peso.

## Perfiles experimentales incluidos (`supabase/seed/020_scoring_profiles.sql`)

| Perfil | Factores (peso) | Faltantes |
|---|---|---|
| Zona · alquiler completo | Crecimiento anual compuesto de la población a 5 años (30) · renta neta por hogar (25) · tamaño del mercado (15) · esfuerzo de alquiler, banda objetivo (30) | Parcial explícita, cobertura ≥ 60 %; universo: municipios ≥ 1.000 hab. |
| Zona · habitaciones | Crecimiento 5 años (30) · tamaño (35) · estudiantes residentes (20) · renta por persona (15) | Ídem |
| Zona · turístico | % viviendas turísticas, banda objetivo (40) · tamaño (20) · crecimiento 5 años (20) · renta por hogar (20) | Ídem |
| Zona · reventa | Crecimiento 10 años (35) · renta por hogar (35) · tamaño (30) | Ídem |
| Zona · temporal | Tamaño (40) · crecimiento 5 años (30) · renta por persona (30) | Ídem |
| Vivienda · cualquiera | m² por habitación, banda (25) · baños por habitación (20) · ascensor (15) · estado actual (25) · terraza (15) | Parcial, cobertura ≥ 50 % |
| Operación · alquiler completo | Rentabilidad neta operativa, sin financiación (50) · cash-on-cash, financiado (50) · requisito: flujo mensual ≥ 0 | No puntúa si falta alguno |

El detalle exacto (claves, tramos, universos) está en `packages/scoring/src/profiles.ts` y se muestra en la aplicación al pulsar *Ver / editar pesos*. Algunos factores dependen de indicadores aún no importados (p. ej. esfuerzo de alquiler y % de viviendas turísticas, que necesitan renta de oferta suficiente o el censo de viviendas; estudiantes residentes): mientras falten, la cobertura del perfil baja y se ve explícitamente.

## Decisiones pendientes de validar

- Pesos y umbrales de todos los perfiles (experimentales).
- Población mínima del universo de percentiles.
- Si la puntuación de operación debe existir para modalidades distintas del alquiler completo (hoy solo hay perfil de operación para alquiler completo).
