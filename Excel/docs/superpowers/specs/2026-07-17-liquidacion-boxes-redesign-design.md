# Rediseño de recuadros de deuda en "Liquidación General" + Ajuste de % en meses anteriores

## Contexto

El reporte PDF "Liquidación General" (`generateLiquidacionAllPDF` en
`backend/src/services/pdfTemplates.js`) dibuja, por propiedad, hasta tres tipos
de recuadro: **LIQUIDACIÓN ACTUAL**, **DEUDAS ACUMULADAS** (meses pendientes) y
**DEUDAS PAGADAS** (meses saldados, uno por caja).

Se corrigió antes un bug donde el monto de cierre de "LIQUIDACIÓN ACTUAL" se
salía del recuadro (altura de caja subestimada). Al revisar el resultado, el
usuario mostró como referencia el estilo de "LIQUIDACIÓN ACTUAL" para un caso
simple: el nombre de propiedad y los datos del inquilino quedan **afuera** de
cualquier caja gris, y adentro de la caja solo aparecen las líneas de concepto
(label + monto), sin un título de sección repetido.

El usuario pidió extender ese mismo estilo a los otros dos recuadros
(Deudas Acumuladas, Deudas Pagadas), donde hoy cada mes trae su propio
mini-encabezado (período + estado + total) dibujado **adentro** de la caja,
junto con las líneas de concepto. Además, pidió que cuando un mes tuvo un
ajuste de alquiler, la línea de Alquiler correspondiente diga explícitamente
"Ajuste de X%" — esto ya funciona para el mes actual (Liquidación Actual) pero
no existe para meses de deudas acumuladas/pagadas, donde falta el dato de
ajuste en el pipeline.

**Objetivo:** unificar el estilo visual de las 3 secciones (encabezado de mes
afuera de la caja, caja con solo conceptos+cierre) y hacer que el texto
"Ajuste de X%" aparezca consistentemente en los 3 casos cuando corresponda.

## Alcance

- `backend/src/services/reportDataService.js`: plumbing de datos (rentHistory
  disponible + detección de ajuste) para Deudas Acumuladas y Deudas Pagadas;
  unificación de formato de texto ("Ajuste de X%") en las 3 rutas.
- `backend/src/services/pdfTemplates.js`: reestructuración de dibujo de cajas
  en `generateLiquidacionAllPDF` (Deudas Acumuladas y Deudas Pagadas).
- No se toca "LIQUIDACIÓN ACTUAL" salvo el cambio de texto ("Ajuste X%" →
  "Ajuste de X%").
- No se cambian colores: los conceptos siguen en gris oscuro (`C.dark`/`C.medium`),
  igual que hoy en Liquidación Actual. Rojo para "Falta pagar", azul para
  "Saldo a favor" se mantienen sin cambios.
- No se toca `generateLiquidacionPDF` (el reporte de un solo contrato, que usa
  tablas planas, no cajas).

## Diseño: `reportDataService.js` — plumbing de "Ajuste de X%"

### Helper compartido

Extraer la detección de ajuste (hoy inline en `buildLiquidacionFromRecord`,
líneas ~466-469) a una función reutilizable:

```js
// contract-relative monthNumber, no calendar month/year
const findAjusteForMonth = (rentHistory, monthNumber) =>
  (rentHistory || []).find(
    (h) => h.effectiveFromMonth === monthNumber && h.reason !== 'INICIAL' && h.adjustmentPercent != null
  );
```

Usada en los 3 puntos de detección (mes actual, deuda pagada, deuda pendiente).

### Formato de texto unificado

En los 3 lugares, cuando hay ajuste, el label de Alquiler agrega el sufijo
`" Ajuste de {pct}%"` (con "de"), usando el mismo formato de número que ya
existe (`adjustmentPercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })`).

- Mes actual (línea ~491-494): cambia de `` `Ajuste ${pctStr}%` `` a
  `` `Ajuste de ${pctStr}%` ``.
- Deuda pagada: label pasa de `Pago deuda Alquiler {Mes} {Año} (Mes {N})` a
  `Pago deuda Alquiler {Mes} {Año} (Mes {N}) Ajuste de {pct}%` cuando aplica.
- Deuda pendiente ("Alquiler pendiente"): pasa a
  `Alquiler pendiente Ajuste de {pct}%` cuando aplica.

### Deudas Pagadas (saldadasUni → `buildConceptosDeudaPagada`)

`entry.contract` ya está en scope en `getLiquidacionesAllContracts` donde se
llama `buildConceptosDeudaPagada(d.rec, d)` (línea ~1176), pero el `select` del
contrato (líneas ~1046-1053) no trae `rentHistory`. Agregar:

```js
contract: {
  select: {
    contractType: true,
    tenant: { select: { name: true } },
    contractTenants: { select: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
    property: { select: { address: true, floor: true, apartment: true, owner: { select: { name: true } } } },
    rentHistory: { select: { effectiveFromMonth: true, reason: true, adjustmentPercent: true } }, // NUEVO
  },
},
```

`buildConceptosDeudaPagada(rec, det, rentHistory)` recibe un tercer argumento
(`entry.contract.rentHistory`) y, al armar el label de alquiler (línea ~190),
usa `findAjusteForMonth(rentHistory, rec.monthNumber)` para decidir si agrega
el sufijo. `rec.monthNumber` ya se selecciona (línea 1036), no requiere cambios
ahí.

### Deudas Acumuladas (pendientesUni ← `deudasVivas`)

`contract.rentHistory` ya se trae en los 3 call sites relevantes
(`getLiquidacionData` líneas ~355/383, `getLiquidacionesAllContracts` línea
~906), pero cada `Debt` no tiene `monthNumber` (solo `periodMonth`/`periodYear`,
que son calendario, no el índice de contrato que usa `rentHistory.effectiveFromMonth`).
Agregar a los 3 `include` de `debts`:

```js
debts: {
  where: { status: { not: 'PAID' } }, // (mantener el where/orderBy existente)
  include: { monthlyRecord: { select: { monthNumber: true } } }, // NUEVO
},
```

En `deudasVivas` (líneas ~696-716, dentro de `buildLiquidacionFromRecord`,
donde `contract` ya es una variable cerrada por closure), usar
`findAjusteForMonth(contract.rentHistory, d.monthlyRecord?.monthNumber)` para
calcular un nuevo campo `ajustePercent` (o `null`) por cada deuda viva, y
pasarlo a través de `buildDeudasUnificadas` hasta el objeto final que consume
`pdfTemplates.js` (el label "Alquiler pendiente" se arma en pdfTemplates.js
dentro de la nueva función de dibujo de caja — ver abajo — usando este campo).

## Diseño: `pdfTemplates.js` — reestructuración de cajas

### Split de `drawMonthBlock`

Reemplazar la función única `drawMonthBlock(d, startY)` (líneas 1444-1502) por
dos funciones:

- **`drawMonthHeader(d, startY)`** — dibuja, FUERA de cualquier caja: línea 1
  (período a la izquierda + estado SIN ABONAR/SALDADA a la derecha), línea 2
  (total o pagado/total). Devuelve la nueva Y. Es exactamente el contenido que
  hoy son las líneas 1449-1455 de `drawMonthBlock`, sin el `+12` de indentación
  (`PAGE.margin + 12` → `PAGE.margin`, mismo patrón que usa hoy la etiqueta de
  sección "DEUDAS PAGADAS" en la línea 1555, que ya está afuera).
- **`drawMonthBox(d, startY)`** — dibuja, DENTRO de la caja: las líneas de
  concepto (con el ajuste ya embebido en el label, sin lógica nueva acá) y la
  línea de cierre "Falta pagar"/"Saldo a favor". Es el contenido de las líneas
  1457-1499 actuales. Devuelve la nueva Y (para calcular la altura de caja).

### "DEUDAS ACUMULADAS" → una caja por mes

Reemplazar el bloque de líneas 1530-1543 (una sola caja compartida con todos
los meses adentro) por un loop análogo al de "DEUDAS PAGADAS": por cada `d` en
`pendientesUni`, `drawMonthHeader(d, iy)` (afuera), luego `fillR`/`strokeR` +
`drawMonthBox(d, iy + 10)` (adentro), avanzando `iy` por cada mes. El label de
sección "DEUDAS ACUMULADAS" se mantiene una sola vez arriba de todos los meses
(mismo patrón que ya usa "DEUDAS PAGADAS" en la línea 1555). El footer "Total
Deuda" se mantiene, dibujado una sola vez después del loop, afuera de las
cajas.

### "DEUDAS PAGADAS" → mismo split, header afuera

El loop ya existente (líneas 1549-1561, una caja por mes) se actualiza para
llamar `drawMonthHeader(d, iy)` antes del `fillR`/`strokeR`, y `drawMonthBox`
adentro, en vez de la llamada única a `drawMonthBlock`.

### Recalcular alturas

`monthBlockH`/`pendienteRowsOf` (líneas 1359-1371) y `pagadaBoxHeights`
(línea 1388) se separan en dos medidas: altura del header (fuera, para avanzar
`iy` antes de dibujar la caja) y altura de la caja (solo conceptos + cierre +
`BOX_TOP`/`BOX_BOTTOM`, sin el header). `deudasBoxH` (línea 1381-1383) se
elimina como caja única y se reemplaza por el cálculo por-mes que ya usa
`pagadaBoxHeights`.

## Fuera de alcance / no ambiguo

- Si un mes no tuvo ajuste, no se agrega ningún sufijo (comportamiento actual,
  sin cambios).
- El helper `findAjusteForMonth` no cambia ningún cálculo de montos — es
  puramente de presentación/label, igual que el `isAjuste` boolean existente.
- No se agrega el sufijo de ajuste a servicios/IVA/punitorios, solo a la línea
  de Alquiler (igual que hoy).

## Verificación

1. Extender el script de prueba ya creado (`test_liq.js`, generado durante el
   fix anterior) con un caso que incluya: un mes de Deudas Acumuladas con
   ajuste, un mes de Deudas Pagadas con ajuste, y confirmar visualmente
   (`pdftoppm` → PNG) que:
   - El encabezado (período/estado/total) de cada mes queda afuera de la caja.
   - Los conceptos y el monto de cierre quedan claramente adentro de la caja,
     con el mismo padding que "Liquidación Actual".
   - Las 3 secciones muestran "Ajuste de X%" cuando corresponde.
2. Levantar backend+frontend locales (ya configurado con DB Docker local) y
   generar el reporte real desde la UI para un contrato con ajuste real en el
   historial, confirmando que no rompe con datos reales (paginación, saltos de
   página con `checkBox`/`checkNewPage`).
3. Revisar un caso sin ajuste para confirmar que no aparece texto de más.
