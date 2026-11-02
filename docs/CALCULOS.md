# Cálculos financieros (`packages/finance`)

Motor determinista, sin dependencias, versionado (`ENGINE_VERSION = finance-1.0.0`) y con huella de entradas (`inputsHash`). El mismo código se ejecuta en el navegador (respuesta inmediata) y en el servidor (al guardar se **recalcula** y se guardan resultado y movimientos; no se confía en el resultado enviado por el navegador).

## Principios

1. **Desconocido ≠ 0.** Cada importe tiene estado: `confirmed`, `published_unconfirmed`, `estimated`, `user_input`, `unknown`, `not_applicable`, `confirmed_zero`. Una partida `unknown` aparece en el libro de movimientos sin importe, se lista en «Datos pendientes» y vuelve **no calculables** solo las métricas que dependen de su componente (mapa de dependencias `DEPS`). El resto se calcula: resultado **parcial**.
2. **Calendario real.** Libro de movimientos fechado (día exacto) y agregados mensuales. Prorrateo por días del mes en la primera renta y en estancias temporales. Las cuotas se fechan en su vencimiento.
3. **Capas separadas**: `asset` (compra, adquisición, reforma, equipamiento, ingresos, gastos, reposiciones, venta), `financing` (disposiciones, intereses, principal, comisiones, cancelación), `reserve` (reserva de liquidez) y `tax` (fiscalidad del inversor, solo si se configura).
4. **La reserva no es gasto**: es dinero inmovilizado. Cuenta en la necesidad de aportaciones y en la TIR del capital propio; no en la rentabilidad del activo. Sus usos pagan partidas que ya están en su sitio (no se cuentan dos veces).
5. **Sin redondeos intermedios**; solo al presentar. Excepción documentada: cuotas de préstamo a céntimos con ajuste en la última, como la banca.
6. **Validación previa**: partidas duplicadas (mismo `group`), importe y porcentaje a la vez, venta anterior a la compra, vacancia por porcentaje y calendario a la vez, estancias solapadas, noches ocupadas > disponibles, disposiciones que no suman 100 %, principal y LTV a la vez. Con errores no se calcula nada.

## Modalidades

| Modalidad | Ingresos | Convención de ingresos brutos |
|---|---|---|
| Reventa | Precio de venta en la fecha de salida; comercialización y costes de venta | — |
| Alquiler completo | Renta mensual desde el inicio del contrato, actualización anual opcional; vacancia por % o por periodos | 12 × renta estabilizada (sin vacancia) |
| Habitaciones | Suma por habitación con ocupación media y gastos específicos; resultado por habitación | Σ rentas × 12 (sin ocupación) |
| Temporal | Calendario de estancias (tarifa mensual prorrateada por días o importe total), comisión por estancia, coste por cambio de ocupante | Según calendario, no 12 × mensualidad |
| Turístico | Año tipo de 12 meses: noches disponibles/ocupadas, ADR, estancia media; comisión de plataforma (bruto o neto), gestión, limpieza y lavandería por estancia | Según el año tipo |

Habitaciones y duración son ejes independientes: el alquiler temporal por habitaciones se modela con estancias asignadas a habitaciones (`roomId`).

## Ventanas

- **Primer año**: 12 meses desde la compra (incluye reforma y meses sin ingresos).
- **12 meses estabilizados**: desde el primer mes completo de explotación. Si el horizonte no alcanza 12 meses estabilizados, las métricas estabilizadas no se calculan y se avisa.

## Métricas (todas con unidad, periodo, convención y denominador)

| Clave | Definición |
|---|---|
| `assetInitialInvestment` | Compra + adquisición + reforma inicial + equipamiento inicial |
| `equityInitial` | Inversión inicial − financiación dispuesta + comisiones hasta el fin de la fase inicial (sin reserva) |
| `peakEquity` | Necesidad máxima de aportaciones: mínimo del flujo acumulado del inversor (incluye reserva) según el calendario |
| `grossYieldOnPrice` / `…OnInvestment` | Ingresos brutos estabilizados / precio o / inversión inicial |
| `noiFirstYear`, `noiStabilized` | Ingresos efectivos − gastos de explotación (sin financiación ni impuestos del inversor) |
| `netOperatingYield` | Resultado operativo estabilizado / inversión inicial del activo |
| `cashflowAnnual`, `cashflowMonthly` | Resultado operativo − reposiciones − servicio de la deuda de la ventana estabilizada. Rotulado «antes de impuestos del inversor» si no hay fiscalidad configurada |
| `cashOnCash` | Flujo anual estabilizado / capital propio inicial |
| `profitBeforeFinancing`, `profitAfterFinancing`, `profitAfterTax` | Con salida: suma de flujos del activo; + financiación; + impuestos configurados |
| `marginOnSale`, `returnOnCost`, `totalReturnOnEquity` | Retornos **totales** (no anuales) sobre venta, coste y capital aportado |
| `irrAsset`, `irrEquity` | TIR por fechas (ACT/365) sin y con financiación |
| `npvEquity` | VAN con tasa explícita del usuario |

## Préstamos

Sistema francés con periodicidad mensual o trimestral; tipo fijo o **escenario de tipos** por tramos (no es una previsión); carencia de solo intereses o capitalizada; disposiciones escalonadas; amortizaciones anticipadas (reducir plazo o cuota) con comisión; cancelación en la venta con comisión. Importe por principal o por LTV sobre precio o tasación (mínimo de ambos). Un tipo de interés no indicado deja el préstamo **pendiente**: nunca se calcula al 0 %.

## TIR robusta

Malla de tipos en (−99 %, 1000 %] para localizar **todos** los cambios de signo del VAN y bisección en cada uno. Estados: `ok`, `multiple_solutions` (se muestran todas las raíces y no se elige una), `no_solution`, `not_converged`, `insufficient`. En operaciones de menos de 12 meses se advierte que una TIR alta no implica repetibilidad.

## Precio máximo de compra (`maxPurchasePrice`)

Mayor precio que cumple **todos** los objetivos activos (capital propio máximo, rentabilidad neta mínima, flujo mensual mínimo, beneficio mínimo, retorno sobre coste, TIR mínima, plazo máximo). Para cada precio candidato se recalcula el escenario completo (impuestos por tramos, LTV sobre precio, comisiones porcentuales…). No supone monotonía: malla de 120 puntos → intervalos factibles → bisección del borde superior del intervalo factible más alto, redondeando hacia abajo a la precisión pedida (100 € por defecto). Sin límite superior explícito, si el borde sigue siendo factible amplía el intervalo (×4, hasta 3 veces). Devuelve estado (`calculated`, `infeasible`, `insufficient_data`, `search_limit`), restricción limitante, holgura de cada objetivo e intervalos factibles. Es una oferta compatible con los supuestos, **no una tasación**.

## Comparables y renta estimada (web)

Comparables por modalidad: mismo municipio, tipo compatible, superficie ±30 %, habitaciones ±1; si hay menos de 5, se amplía a la provincia y se indica. Un comparable = un inmueble (deduplicado). Estadístico: mediana de €/m² con cuartiles; atípicos por la regla de Tukey (1,5 × RIC, con ≥ 8 casos) listados y excluidos; el usuario puede excluir comparables y restaurar la selección. Calidad: insuficiente (< 5), media (< 10, ampliada o dispersión RIC/mediana > 35 %), baja (varias). Con calidad insuficiente no se presenta renta estimada.

## Pruebas

`packages/finance/test/engine.test.ts` (36 casos): contado y financiado, costes desconocidos, duplicados, préstamos con carencia/escenarios/amortización anticipada, reventa, habitaciones, temporal, turístico, reserva, TIR con varias raíces y sin solución, precio máximo con impuesto por tramos, inviable, límite y ampliación de búsqueda.
