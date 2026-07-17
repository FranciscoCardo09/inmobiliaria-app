# Indicador de estado adentro de la caja (borde + texto de color) — Liquidación General

## Contexto

En el PDF "Liquidación General" (`generateLiquidacionAllPDF`,
`backend/src/services/pdfTemplates.js`), cada propiedad muestra un indicador
de estado (SIN ABONAR, PAGO PARCIAL, SALDO A FAVOR, o nada si está pagado) y
el monto, dibujados como texto plano **arriba a la derecha del encabezado**,
afuera de cualquier caja. El mismo patrón se repite dentro de "Deudas
Acumuladas" y "Deudas Pagadas": cada mes trae su propio encabezado
(período + SIN ABONAR/SALDADA + monto) dibujado afuera de la caja de ese mes
(este patrón "afuera de la caja" fue una decisión deliberada de una sesión
anterior — ver `2026-07-17-liquidacion-boxes-redesign-design.md` — y no se
revierte acá).

El usuario pidió que el indicador de estado deje de flotar afuera y pase a
vivir **adentro** de la caja correspondiente, como la línea de cierre, y que
el **borde** de esa caja (no el relleno) tome el color del estado.

## Objetivo

1. Encabezado de propiedad: sacar el badge+monto que hoy está afuera
   (arriba a la derecha). El nombre de propiedad y datos del inquilino se
   mantienen afuera de la caja, sin cambios. Debajo, un texto simple
   "Liquidación actual" (ya no "LIQUIDACIÓN ACTUAL" en mayúsculas ni adentro
   de la caja). La caja de "Liquidación Actual" pasa a tener borde coloreado
   según estado, y su línea de cierre muestra el estado + monto con ese color.
2. Cajas de mes en "Deudas Acumuladas"/"Deudas Pagadas": mismo tratamiento.
   El `drawMonthHeader` actual (período a la izquierda, estado+monto a la
   derecha, afuera de la caja) se recorta a **solo el período** (sin estado
   ni monto — ambos se van adentro). La caja correspondiente pasa a tener
   borde coloreado y una línea de cierre con estado+monto.

## Colores (confirmados con el usuario, sin relleno — solo borde y texto)

| Estado         | Color     | Hex       | Nota |
|----------------|-----------|-----------|------|
| SALDADA / PAGADO | Negro   | `#000000` | Ya es el color usado hoy en el header de mes cuando `!debe` |
| SIN ABONAR     | Rojo      | `#CC0000` | Ya usado en todo el archivo para deuda/pendiente |
| SALDO A FAVOR  | Celeste   | `#0EA5E9` | Nuevo — antes era `#0066CC` (azul más oscuro) |
| PAGO PARCIAL   | Naranja   | `#E67E22` | Nuevo — antes usaba `C.amber` (`#8B6914`, dorado oscuro) |

El fondo de la caja se mantiene `C.snow` (`#FAFAFA`) sin cambios — solo
cambia el color de `strokeR` (borde) y el color del texto de la línea de
cierre.

## Diseño: encabezado de propiedad + caja "Liquidación Actual"

### Antes (líneas ~1403-1428, 1516-1543 actuales)

```
[addr bold]                                    [badge estado]
[inquilino - dni]                                  [total]
──────────────────────────────────────────────────────────
┌────────────────────────────────────────────────────────┐
│ LIQUIDACIÓN ACTUAL                                       │
│ [concepto]                                    [monto]    │
│ ──────────────────────────────────────────────────────  │
│ Falta pagar (a día de hoy) / Saldo a favor    [monto]    │ (solo si aplica; nada si PAGADO)
└────────────────────────────────────────────────────────┘
```

### Después

```
[addr bold]
[inquilino - dni]
Liquidación actual
┌────────────────────────────────────────────────────────┐  ← borde color estado
│ [concepto]                                    [monto]    │
│ ──────────────────────────────────────────────────────  │
│ SIN ABONAR / PAGO PARCIAL / SALDO A FAVOR / PAGADO [monto]│ ← color estado, SIEMPRE presente
└────────────────────────────────────────────────────────┘
```

Cambios concretos:

- Se elimina el bloque que dibuja `sl.label` y `totalDisplay` arriba a la
  derecha del encabezado (líneas ~1416-1424 actuales). El encabezado de
  propiedad queda con altura reducida (ya no necesita las dos líneas de la
  derecha — se ajusta `HEADER_H`).
- Se agrega, debajo del inquilino y antes de la caja, el texto simple
  `Liquidación actual` (`F.r`/`F.b`? — usar el mismo estilo que ya usan las
  etiquetas de sección "DEUDAS ACUMULADAS"/"DEUDAS PAGADAS": `F.b`, tamaño 8,
  `C.medium`, sin mayúsculas forzadas ya que el usuario lo pidió en minúscula
  tipo oración: "Liquidación actual").
- `LIQUIDACIÓN ACTUAL` (título interno de la caja, línea 1521) se elimina —
  ya no hace falta, el texto de arriba cumple ese rol. Los conceptos suben
  para ocupar ese espacio.
- La caja usa `strokeR(doc, ..., color, 0.5, 0)` con `color` = color de
  estado (tabla arriba) en vez de `C.line` fijo.
- La línea de cierre (hoy "Falta pagar (a día de hoy)" / "Saldo a favor",
  condicional) pasa a estar **siempre presente** y usa:
  - `data.paymentStatus === 'NO COBRADO'` → label `SIN ABONAR`, monto
    `data.pendingAmount`, color rojo.
  - `data.paymentStatus === 'PAGO PARCIAL'` → label `PAGO PARCIAL`, monto
    `data.pendingAmount`, color naranja.
  - `data.paymentStatus === 'SALDO A FAVOR'` → label `SALDO A FAVOR`, monto
    `data.saldoAFavor`, color celeste.
  - `data.paymentStatus === 'PAGADO'` (o cualquier otro caso, fallback) →
    label `PAGADO`, monto `data.total`, color negro. **Este caso hoy no
    dibuja ninguna línea de cierre — se agrega.**
- Se recalcula `liqBoxH` (línea ~1384-1386) sumando la altura de esta línea
  de cierre siempre presente (hoy es condicional a `12` extra solo si
  `pendingAmount > 0` o `saldoAFavor > 0`; pasa a ser incondicional).

## Diseño: cajas de mes en "Deudas Acumuladas" / "Deudas Pagadas"

### `drawMonthHeader` (líneas 1440-1454 actuales)

Se recorta a devolver solo la línea del período (elimina las líneas
`estado`/`totalDisplay`, ~1442-1451). `MONTH_HEADER_H` baja de 21 a ~9 (una
sola línea en vez de dos).

```js
const drawMonthHeader = (d, startY) => {
  doc.font(F.b).fontSize(7.5).fillColor(C.dark).text(d.periodLabel, PAGE.margin, startY, { width: W * 0.5 });
  return startY + 9;
};
```

### `drawMonthBox` (líneas 1462-1514 actuales)

Al final de la función (después del bloque de conceptos, donde hoy está el
`if (debe) {...} else if (d.sobrepago > 0) {...}`, líneas 1504-1512), se
agrega el caso `else` para saldado sin sobrepago:

```js
if (debe) {
  // SIN ABONAR — igual que hoy, pero label "SIN ABONAR" en vez de "Falta pagar"
} else if (d.sobrepago > 0) {
  // SALDO A FAVOR — igual que hoy, pero label "SALDO A FAVOR" en vez de "Saldo a favor", color celeste #0EA5E9
} else {
  // NUEVO: SALDADA, monto d.totalAPagar, color negro
}
```

No existe caso "PAGO PARCIAL" a nivel mes individual (ese concepto solo
aplica al agregado por propiedad) — un mes de deuda está SIN ABONAR, SALDADA,
o (raro) con sobrepago puntual.

### Color de borde por mes

`fillR`/`strokeR` (líneas 1556-1557 y 1578-1580) pasan de `C.line` fijo a un
color derivado del mismo estado que determina la línea de cierre (rojo si
`debe`, celeste si `sobrepago > 0`, negro si saldado limpio).

### Alturas

`monthBoxH(d)` (línea 1378) ya suma `+12` condicional para la línea de
cierre (`d.pendiente > 0.009 || d.sobrepago > 0`). Pasa a sumar `+12`
siempre (la línea de cierre ahora es incondicional, igual que en
Liquidación Actual). `MONTH_HEADER_H` baja de 21 a 9 en todos los cálculos
que la usan (líneas 1549, 1554, 1571, 1576).

## Fuera de alcance

- No se toca `generateLiquidacionPDF` (reporte de un solo contrato, usa
  tablas planas).
- No se cambia el fondo de ninguna caja (se mantiene `C.snow`).
- No se cambia el bloque de totales generales al final del PDF (TOTAL
  ALQUILERES COBRADOS, TOTAL COBRADO, TOTAL PENDIENTE, TOTAL SALDO A FAVOR)
  — esos ya son barras/cajas independientes con su propio estilo y no fueron
  parte del pedido.
- No se cambia el bloque de Honorarios.

## Verificación

1. Generar el PDF con datos que cubran los 4 estados (SIN ABONAR, PAGO
   PARCIAL, SALDO A FAVOR, PAGADO) a nivel propiedad, y con Deudas
   Acumuladas/Pagadas que incluyan al menos un mes SIN ABONAR y uno SALDADA,
   confirmando visualmente (`pdftoppm` → PNG) que:
   - No queda ningún badge/monto flotando afuera de una caja.
   - El borde de cada caja tiene el color correcto para su estado.
   - La línea de cierre adentro de cada caja tiene el label y color
     correctos, y el monto no se sale del recuadro (revisar altura).
2. Confirmar que "Liquidación actual" aparece como texto simple (no en
   mayúsculas, no adentro de una caja) entre los datos del inquilino y la
   caja.
3. Regresión: correr el caso ya usado en la sesión anterior (mes con Ajuste
   de X%) y confirmar que el texto de ajuste sigue apareciendo sin cambios
   (esta sesión no toca esa lógica).
