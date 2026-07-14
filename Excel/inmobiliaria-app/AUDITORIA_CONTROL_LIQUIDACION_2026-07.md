# Auditoría: Control Mensual ↔ Reportes de Liquidación (2026-07-14)

Auditoría de la lógica de cálculo entre **Control Mensual** (lo que cada contrato debe por
período) y **Reportes de Liquidación** (lo que efectivamente se cobró). Cubre backend y
frontend, identifica duplicación de lógica, discrepancias, y deja una batería de tests que
congela el comportamiento actual y documenta cada hallazgo.

**Regla de negocio confirmada con el usuario (2026-07-14):** el Reporte de Liquidación de un
mes debe representar **lo efectivamente cobrado ese mes calendario** (criterio de caja),
independientemente del período al que pertenecía la deuda. Ejemplo: si en marzo el inquilino
paga y cancela enero y febrero, esos importes deben aparecer en el reporte de **marzo**, con
desglose por mes de origen y por concepto (alquiler/IVA/servicios/punitorios). Los punitorios
mostrados son los **efectivamente pagados** (congelados para meses saldados; para el mes
parcial, lo pagado a la fecha del pago, no el valor a la fecha en que se genera el reporte).

---

## Hallazgo #0 — CRÍTICO, ya corregido (commit `f04a6e2`)

**`getLiquidacionesAllContracts` devolvía filas vacías** (bug activo, sin commitear, distinto
de todo lo demás en este documento).

- **Causa:** `buildLiquidacionFromRecord` se convirtió a `async` (para poder calcular deudas en
  vivo vía `computeLiveDebtTotal`), pero `getLiquidacionesAllContracts` seguía armando su
  array de resultados con un simple `.map()`, sin `await Promise.all(...)`.
  `reportDataService.js:626-637`.
- **Efecto:** el reporte de "Liquidación — todos los contratos" devolvía un array de Promises
  sin resolver. Verificado contra la base real: antes del fix, cada fila tenía solo 1 campo
  (`cobradoOtrosPeriodos`, la única propiedad asignada después de la creación); el resto
  (`conceptos`, `total`, `amountPaid`, `paymentStatus`, etc.) estaba ausente.
  La liquidación de un solo contrato (`getLiquidacionData`) no estaba afectada.
- **Fix aplicado:** envolver el `.map()` en `await Promise.all(...)`. Un cambio de una línea.
- **Verificado:** contra la DB real, cada fila pasó de 1 campo a los 39 campos esperados con
  valores reales (`total: 847000, amountPaid: 1415260, paymentStatus: 'SALDO A FAVOR'`, etc.).
- **Estado:** commiteado (`f04a6e2`, rama `deploy`, **sin pushear**).

---

## Hallazgo #1 — Filas de Liquidación por período de deuda, no por fecha de pago

**Severidad: Alta (bug respecto a la regla de negocio confirmada).**

`getLiquidacionesAllContracts` selecciona las filas principales por
`MonthlyRecord.periodMonth/periodYear` + `isCancelled` (`reportDataService.js:554-608`), NO por
la fecha real del pago (`PaymentTransaction.paymentDate`). Con el escenario "Juan" (enero y
febrero impagos, marzo paga $250.000 cancelando ambos + parte de marzo):

- El reporte de **marzo** solo muestra los **$42.000 propios de marzo**, no los $250.000
  efectivamente cobrados ese mes.
- Enero y febrero "viven" en sus propios reportes (mes de origen), no en el de marzo.

Solo el bloque secundario `cobradoOtrosPeriodos` (`reportDataService.js:676-742`) usa
`paymentDate` — y únicamente para períodos **estrictamente anteriores** al seleccionado
(`periodMonth < month`). No cubre pagos del propio mes ni adelantados, y coexiste como un
bloque aparte en vez de fusionarse con la fila principal.

**Test que lo documenta:** `tests/liquidacionCaja.test.js` → suite "comportamiento ACTUAL"
(`Hallazgo #1: la fila principal de marzo NO incluye lo cobrado de enero/febrero`).

**Fix propuesto:** rediseñar `getLiquidacionesAllContracts` para seleccionar por
`PaymentTransaction.paymentDate ∈ mes` (join contra `MonthlyRecord` solo para saber el período
de origen y los datos del contrato), agrupando por período + concepto. El bloque
`cobradoOtrosPeriodos` deja de ser necesario como estructura aparte — pasa a ser el desglose
"por mes de origen" de la fila principal.

---

## Hallazgo #2 — Punitorios/`paid*` re-derivados, no leídos de los conceptos reales

**Severidad: Alta (bug respecto a la regla de negocio confirmada, ligado al #1).**

`buildLiquidacionFromRecord` (`reportDataService.js:346-375`) re-deriva `paidServicios`,
`paidAlquiler`, `paidPunitorios` con una imputación secuencial propia
(`remaining = amountPaid + previousBalance + bonificaciones`, luego servicios→alquiler→
punitorios), en vez de leer los conceptos **realmente pagados** (`TransactionConcept`, tipo
`PUNITORIOS`/`ALQUILER`/etc.) de cada `PaymentTransaction`.

Consecuencia concreta (regla P2 del usuario): para un mes **parcial** que sigue en mora, el
reporte debería mostrar "lo pagado en punitorios a la fecha del pago", no una cifra re-derivada
de `amountPaid` contra el punitorio *congelado del record* (que puede no corresponder a lo que
ese pago concreto imputó a punitorios).

**Test que lo documenta:** `tests/liquidacionCaja.test.js` → suite "modelo DESEADO", que
calcula punitorios cobrados sumando `TransactionConcept` de tipo `PUNITORIOS`
(`sumPunitoryConcepts`-style), y `tests/consistenciaControlLiquidacion.test.js` (caso "mes
COMPLETE": ahí SÍ coincide, porque en un mes saldado el congelado == lo pagado).

**Fix propuesto:** que `buildLiquidacionFromRecord` (o su reemplazo por período) tome
`paidServicios/paidAlquiler/paidPunitorios` sumando los `TransactionConcept` reales de las
transacciones dentro del mes de caja, en vez de re-derivarlos desde `amountPaid`.

---

## Hallazgo #3 — `computeGrandTotals` duplicado (frontend/backend)

**Severidad: Media (riesgo de *drift* silencioso, sin bug activo hoy).**

Existen dos implementaciones idénticas de `computeGrandTotals`:
- Backend: `reportDataService.js:497-522` (usada al generar PDF/Excel/DOCX/HTML).
- Frontend: `frontend/src/utils/reportTotals.js:6-30` (usada para la pantalla), literal
  "Mirrors the backend computeGrandTotals" en su propio comentario.

Si una cambia sin la otra, el total mostrado en pantalla puede divergir del total del
documento exportado, sin que nada lo detecte.

**Test que lo protege:** `tests/grandTotalsParity.test.js` — corre ambas implementaciones
(la del backend vía `require`, la del frontend vía `import()` dinámico del archivo real) sobre
4 fixtures y exige igualdad campo por campo. Si una de las dos cambia, este test se pone rojo.

**Fix propuesto:** eliminar la copia del frontend; que `ReportsPage.jsx` consuma un total ya
calculado por el backend (agregarlo a la respuesta del endpoint), o extraer
`computeGrandTotals` a un paquete/módulo compartido entre frontend y backend.

---

## Hallazgo #4 — `grandTotal` no incluye lo cobrado de deudas de meses anteriores

**Severidad: Media (subestima el total de caja real del mes).**

`grandTotal = Σ amountPaid` de las filas del período (`reportDataService.js:508`). No suma
`cobradoOtrosPeriodos.total`. En el escenario "Juan" (marzo): el header del reporte muestra
$42.000 cuando la caja real de marzo fue $250.000.

**Test que lo documenta:** `tests/grandTotalsParity.test.js` → suite "Hallazgo #4" (assert
explícito de que `grandTotal` hoy ignora `cobradoOtrosPeriodos`), y
`tests/liquidacionCaja.test.js` → "computeGrandTotals del reporte de marzo NO suma
cobradoOtrosPeriodos".

**Fix propuesto:** una vez resuelto el Hallazgo #1 (rediseño a caja), este hallazgo se resuelve
solo — `grandTotal` sumaría directamente los pagos reales del mes, sin distinguir "propio" vs
"de otros períodos".

---

## Hallazgo #5 — Orden de imputación de display ≠ orden real de imputación

**Severidad: Baja.**

El desglose de display en `buildLiquidacionFromRecord` imputa **servicios → alquiler →
punitorios** (`reportDataService.js:363-372`). La imputación real de un pago (la que efectivamente
genera los `TransactionConcept`) es **servicios → alquiler → IVA → punitorios**
(`paymentTransactionService.js:222-226`). Con IVA de por medio, el desglose de display puede no
coincidir exactamente con lo que el recibo real muestra.

**Fix propuesto:** una vez resuelto el Hallazgo #2 (leer conceptos reales en vez de re-derivar),
este hallazgo desaparece — el desglose sería directamente el de los conceptos ya imputados.

---

## Hallazgo #6 — Campo `exemptFromPunitory` huérfano

**Severidad: Baja.**

`punitory.js:300` lee `contract?.exemptFromPunitory`, pero ese campo no existe en
`schema.prisma` (modelo `Contract`). Siempre es `undefined` → nunca exime punitorios por esta
vía.

**Fix propuesto:** agregar el campo al schema (migración) si la funcionalidad se quiere
soportar, o eliminar la lectura muerta si no está en uso.

---

## Divergencia intencional (documentada, NO es un bug)

**Control Mensual vs. Liquidación — punitorio vivo vs. congelado.**

Para un mes abierto en mora, Control Mensual muestra el punitorio **en vivo, recalculado a
hoy** (`livePunitoryAmount`, `monthlyRecordService.js:911-925`); Liquidación muestra el
punitorio **congelado** del último pago o cierre (`monthlyRecord.punitoryAmount`,
`reportDataService.js:317`). Confirmado con el usuario: es el comportamiento deseado —
Control Mensual es una foto en vivo; Liquidación es un papel de caja (snapshot).

Para un mes **saldado** (COMPLETE), ambos valores SÍ deben coincidir (el punitorio vivo
"fully-paid" = suma de conceptos PUNITORIOS pagados = el mismo congelado). Esto está protegido
como regresión en `tests/consistenciaControlLiquidacion.test.js`.

---

## Batería de tests agregada

| Archivo | Qué cubre |
|---|---|
| `tests/consistenciaControlLiquidacion.test.js` | Control Mensual vs. Liquidación para el mismo `MonthlyRecord`: igualdad en mes COMPLETE (regresión), divergencia esperada en mes abierto en mora, redondeo sin diferencias de centavos. |
| `tests/grandTotalsParity.test.js` | Paridad exacta entre `computeGrandTotals` del frontend y del backend sobre 4 fixtures (Hallazgo #3); caracteriza el Hallazgo #4. |
| `tests/liquidacionCaja.test.js` | Escenario "Juan" (ene/feb impagos, marzo cancela todo + parcial): PARTE 1 documenta el comportamiento actual (período-based, Hallazgos #1/#2/#4 con datos concretos); PARTE 2 especifica el modelo de caja deseado mediante un agregador de referencia ejecutable (total cobrado, punitorios pagados, desglose por mes de origen, agrupado por fecha de pago, liquidación total, saldo pendiente). |

Correr con:
- Unit tests: `cd inmobiliaria-app/backend && npm run test:unit` (223/223 verde)
- Integration tests (requieren Docker): `npm run test:integration` (10/10 verde)

## Roturas preexistentes encontradas y corregidas (fuera del alcance original, ahora resueltas)

Al verificar la suite completa tras el fix del Hallazgo #0 aparecieron otras roturas
preexistentes, causadas por la misma causa raíz (conversión de `buildLiquidacionFromRecord`/
`liveDebtFigures` a `async`/vivo sin actualizar a todos sus consumidores) más una fragilidad de
test no relacionada. Todas quedaron corregidas:

- **`tests/reportTotals.test.js`** (14 tests) — llamaba a `buildLiquidacionFromRecord` sin
  `await`. Arreglo mecánico: se agregó `async`/`await` en los 10 tests afectados.
- **`tests/impuestos.test.js`** (`getImpuestosData logic`) — el mock manual de Prisma no
  cubría la nueva llamada a `debtService.computeLiveDebtTotal` (hace un `contract.findUnique`
  real cuando no hay datos precargados). Se agregó un stub de `./debtService` que devuelve los
  totales ya conocidos de la deuda (mismo comportamiento que el código pre-WIP), ya que el test
  solo valida el mapeo INQUILINO/PROPIETARIO, no la matemática de punitorios en vivo.
- **`tests/punitoryBase.test.js`** (`A-04`, 2 tests) — **no era un bug de cálculo real**: el
  test stubeaba `calculatePunitoryV2` vía proxyquire, pero `computeLiveRecordPunitory` (en
  `utils/punitory.js`) la llama como referencia directa del mismo archivo, no a través de
  `module.exports` — el stub nunca se aplicaba, y el test dependía silenciosamente de que la
  fecha real de "hoy" coincidiera por casualidad con el valor stubeado. Se corrigió calculando
  el valor esperado invocando la misma función real de producción con el mismo record/contrato,
  en vez de un stub fijo — el test queda determinístico para cualquier fecha en que se corra.

Nota aparte: durante la primera pasada se reportaron 8 fallas más (`C-01/C-02/C-03/C-04/C-08`,
`REGRESIÓN`, `docker-test-db.js`, `harness: seed + snapshot...`) que resultaron ser una falsa
alarma — son tests de integración (`test/integration/`) que requieren Docker + Postgres
descartable, y se habían corrido con `npm test` (que los barre igual) en vez de
`npm run test:integration`. Corridos correctamente: 10/10 verde, sin cambios necesarios.
