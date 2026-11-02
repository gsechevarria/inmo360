# Sistema visual

Objetivo: un entorno de análisis denso y legible, donde el mapa y el territorio dan identidad. Sin bloques de marketing ni tarjetas genéricas.

## Paleta (tokens en `apps/web/app/globals.css`)

| Token | Claro | Uso |
|---|---|---|
| `--ink` | `#0f1e2e` | Texto principal |
| `--ink-2` | `#3d4b5c` | Texto secundario |
| `--ink-3` | `#6b7785` | Etiquetas, metadatos |
| `--surface` | `#ffffff` | Paneles |
| `--canvas` | `#f3f5f7` | Fondo de la aplicación |
| `--line` | `#dde2e8` | Bordes y divisores |
| `--brand` | `#123a5c` | Navegación, acciones primarias |
| `--brand-2` | `#1f5f8b` | Hover / foco |
| `--focus` | `#f0a500` | Anillo de foco (3 px) |
| `--pos` | `#1b7a4b` | Resultado favorable (siempre con signo/icono) |
| `--neg` | `#b3261e` | Resultado desfavorable |
| `--warn` | `#9a6200` | Dato estimado / parcial |
| `--info` | `#2f5d9e` | Dato publicado pendiente de confirmar |
| `--nodata` | `#c9ced6` + trama | Sin dato (mapa) |

Escala secuencial de mapa (6 clases, apta para daltonismo, de claro a oscuro): `#e8f1f8 #c3dbec #8fbcdb #5797c4 #2b6ea3 #123a5c`. Divergente (variaciones): `#b3261e #e58a7f #f3f3f3 #86c3a1 #1b7a4b`. Las zonas sin dato se dibujan con gris y trama diagonal, nunca con el color de la clase más baja.

## Estados de dato (chips)

Texto + icono + color; nunca solo color:

- `Observado` (●), `Provisional` (◐), `Estimado` (≈, ámbar), `Publicado, pendiente de confirmar` (?), `Introducido por el usuario` (✎), `Desconocido` (—, “pendiente”), `No aplicable` (n/a), `Censurado` (‹5 literal), `Cero confirmado` (0 ✓).

## Tipografía

- **Inter Variable** (autoalojada con `@fontsource-variable`) para interfaz; `font-variant-numeric: tabular-nums` en todas las cifras y tablas.
- **JetBrains Mono Variable** para códigos (INE, referencias, claves).
- Escala: 12 (metadatos, mínimo), 13 (tablas), 14 (cuerpo), 16 (subtítulos), 20 (títulos de panel), 28 (cifra principal de ficha).
- Números en formato español (`Intl.NumberFormat('es-ES')`): `1.284,72 €`, `6,2 %`, `12,1 €/m²/mes`. La unidad siempre visible.

## Espaciado y estructura

- Escala de 4 px (4, 8, 12, 16, 24, 32).
- Navegación lateral compacta (56 px, iconos + etiqueta en tooltip y en modo expandido).
- Barra superior: territorio activo · estrategia activa · búsqueda global.
- Exploradores: filtros en panel plegable a la izquierda, mapa y lista sincronizados, vista previa en panel lateral derecho. Una sola zona de scroll por columna.
- Móvil (< 768 px): pestañas Mapa / Lista / Detalle; nunca tres columnas.

## Componentes

- `Metric` — cifra + unidad + periodo + fuente + estado. Jerarquía: resultado (grande) › supuesto (chip `Supuesto`) › fuente (texto pequeño enlazado).
- `DataTable` — columnas configurables, ordenación accesible (`aria-sort`), cabeceras con unidad y periodo, fila seleccionable con teclado.
- `StatusChip`, `CoverageBar` (n con dato / universo), `Legend` (unidad, periodo, cobertura, clase “sin dato”).
- `Panel` (no tarjeta genérica): título, acciones, cuerpo; variantes `result`, `assumption`, `source`.
- Gráficos SVG propios: línea temporal y barras; ejes con unidad, etiquetas directas, tabla alternativa accesible.

## Accesibilidad

- Foco visible (`:focus-visible` con anillo ámbar de 3 px).
- Contraste AA en texto (≥ 4,5:1) y AA en elementos gráficos (≥ 3:1).
- `prefers-reduced-motion`: sin animaciones de mapa (`flyTo` → `jumpTo`) ni transiciones.
- Toda la navegación por teclado; atajos: `/` búsqueda, `g z` zonas, `g v` viviendas.
- Estados de carga, vacío, error y datos incompletos explícitos en cada vista.
