# AUDITORÍA FUNCIONAL EXHAUSTIVA — Sistema de Gestión Inmobiliaria

**Fecha:** 2026-07-10 · **Alcance:** backend completo (`inmobiliaria-app/backend/src`), frontend (`inmobiliaria-app/frontend/src`), `schema.prisma`, contrastado con `LOGICA.md`.
**Método:** 7 auditorías paralelas independientes (pagos · deudas/punitorios/cierre · contratos/ajustes/RentHistory · generación mensual/servicios · comprobantes/reportes · frontend · transversal concurrencia/decimales/fechas), luego consolidadas y deduplicadas. Los hallazgos que 2+ auditores encontraron por caminos independientes se marcan **[×N]**.
**No se modificó ningún archivo de código.** Rutas relativas a `inmobiliaria-app/`.

---

## ESTADO DE IMPLEMENTACIÓN (actualizado 2026-07-12)

### ⚠️ PENDIENTE — ACCIÓN MANUAL REQUERIDA
**Correr `npx prisma db:push` en `inmobiliaria-app/backend`.** El fix de A-15 (Bloque 3) agregó un modelo nuevo (`ReceiptSequence`) y una restricción nueva (`@@unique([groupId, receiptNumber])` en `PaymentTransaction`) al `schema.prisma`. El código y los tests ya están corregidos y en verde, pero la base de datos real todavía NO tiene ese cambio aplicado — no se corrió automáticamente por apuntar a una base de datos real (Supabase/dev), y ese tipo de acción requiere confirmación explícita.

### ⚠️ 26 fallas preexistentes en `npm test` — NO relacionadas con A-19/A-32 ni con ningún fix de hoy (detectadas y aisladas 2026-07-13)
Al correr la suite completa antes de implementar A-19/A-32 ya había 26 tests en rojo, causados por trabajo previo de Bloque 3 sin commitear que quedó a medio terminar (no por A-19/A-32: se verificó revirtiendo puntualmente los cambios de hoy en `debtService.js`/`reportDataService.js` y confirmando que las mismas 26 fallas persisten igual, con o sin ellos). Concretamente:
- `tests/reportTotals.test.js` (`buildLiquidacionFromRecord — isRentPaid and cobrado fields`, 10 subtests): `buildLiquidacionFromRecord` (`reportDataService.js`) se volvió `async` (para poder llamar a `liveDebtFigures`/`computeLiveDebtTotal`, parte del trabajo de A-21/Bloque 3), pero el test la sigue llamando sin `await` → recibe una Promise en vez del objeto real.
- `tests/impuestos.test.js` (`getImpuestosData logic`): por la misma razón, `getImpuestosData` ahora llama a `liveDebtFigures` → `calculateDebtPunitory` → `prisma.contract.findUnique`, pero el `prismaMock` del test no tiene ese método mockeado.
- `tests/punitoryBase.test.js` (2 subtests, "A-04: el refresh persistido del GET..." y "A-04 (refresh del GET, integración)..."): esperan un monto distinto al que devuelve hoy el refresh de `monthlyRecordService.js` — no tiene relación con comprobantes/recibos.
- El resto son tests de integración que necesitan Docker/Postgres real (no disponible en este entorno) y algunos de concurrencia (C-01 a C-05, C-08) que también dependen de esa infraestructura.

**No se tocó nada de esto** — está fuera del alcance de Bloque 4 (comprobantes). Es deuda pendiente de cerrar el checkpoint de A-21 (Módulo 3, ver más abajo) y de actualizar esos tests/mocks a la firma `async` de `buildLiquidacionFromRecord`/`getImpuestosData`.

**Bloque 1 (los 7 Críticos, C-01 a C-07): ✅ COMPLETO.**
**Bloque 2 (A-01, A-02, A-03, A-04, A-05, A-25): ✅ COMPLETO** (2026-07-11). A-25 se resolvió con un fix mínimo sin migración de datos (ver detalle en el hallazgo y en PARTE 7).
**M-26 (Bloque 4): ✅ CORREGIDO** (2026-07-11), adelantado fuera de orden — encontrado al investigar una falla real de tests (`tests/liquidacion.test.js`) durante el cierre de A-25/Bloque 2; era una reproducción concreta y verificable del hallazgo, no solo teórica, y se resolvió con confirmación explícita del usuario. Ver detalle en el hallazgo.
**Bloque 3 (A-06, A-07, A-09, A-10, A-12, A-13, A-14, A-15, A-16, A-26): ✅ COMPLETO** (2026-07-12), con confirmación explícita del usuario en cada decisión de negocio ambigua (alcance de A-06, política de A-12, A-13, A-09, A-15, y orden de A-16). Ver detalle de cada fix en su hallazgo. Pendiente: correr `npx prisma db:push` (schema cambiado por A-15: modelo `ReceiptSequence` + `@@unique([groupId, receiptNumber])` en `PaymentTransaction`) — no se ejecutó automáticamente por apuntar a una base de datos real.
**A-30/A-31 (nuevos, reportados por el usuario, fuera de la numeración original): ✅ CORREGIDOS** (2026-07-12). El usuario detectó en producción dos casos concretos de "Control Mensual muestra una cosa, Deudas muestra otra" para el mismo saldo a favor. Ver detalle en A-30 y A-31 (agregados al final de PARTE 2, después de A-29).
**Bloque 4 (A-28) y Fixes adicionales (B-18): ✅ CORREGIDOS** (2026-07-13). Se completó la limpieza del frontend eliminando matemática duplicada en los modales de pago (A-28), y se arregló el off-by-one de meses al editar contratos en curso (B-18).
**A-19 y A-32 (nuevo, reportado por el usuario en producción, Bloque 4 — comprobantes): ✅ CORREGIDOS** (2026-07-13). El usuario detectó que el recibo de pago en efectivo de una deuda no mostraba los punitorios pagados ni que la deuda tenía un saldo a favor aplicado. Se agregó A-32 (nuevo, ver detalle al final de PARTE 2) para esa causa raíz puntual (`payDebt` nunca creaba el concepto `A_FAVOR`) y de paso se corrigió A-19 (recibo global: faltaban los renglones de IVA y "Saldo a favor" en el detalle, aunque el TOTAL ya los incluía). **No se tocó ninguna fórmula de punitorios.** Tests: `tests/debtReceipt.test.js`, `tests/globalReceipt.test.js`. Quedan pendientes del resto de Bloque 4 — comprobantes: A-17, A-18, A-20, A-21, A-22, A-23, A-27, A-29 (ver checkpoints de decisión de negocio antes de tocar A-20/A-21).

Cada hallazgo corregido tiene su propio "**Estado:** ✅ CORREGIDO" con el detalle del fix y los tests que lo cubren. El resto de los hallazgos (Altos restantes de Bloque 4, Medios, Bajos — Bloques 4 y 5 de PARTE 7) sigue sin tocar.

---

## RESUMEN CUANTITATIVO

| Severidad | Cantidad |
|---|---|
| **Crítica** | **7** |
| **Alta** | **29** |
| **Media** | **35** |
| **Baja** | **21** |
| **Total consolidado** | **92** |

**Confianza:** salvo indicación explícita de PLAUSIBLE, todos los hallazgos están CONFIRMADOS por traza de código con archivo:línea.

---

# PARTE 1 — HALLAZGOS CRÍTICOS

---

## C-01 · El saldo a favor que supera el total del mes SE DESTRUYE

- **Severidad:** Crítica · **Módulo:** Recálculo mensual / saldos a favor · **Confianza:** CONFIRMADO
- **Descripción:** si `previousBalance > (alquiler + servicios + punitorios + IVA)`, el excedente de crédito desaparece del sistema sin dejar rastro.
- **Por qué ocurre:** `backend/src/services/monthlyRecordService.js:1249-1250` y `:1260`:
  ```js
  const totalDue = rent + services + punitory + iva - activePreviousBalance;  // puede dar negativo
  const balance = round2(amountPaid - Math.max(totalDue, 0));                 // se clampa a 0: el excedente no pasa a balance
  runningPreviousBalance = Math.max(effectiveBalance, 0);
  ```
  El mismo clamp existe en la creación (`:496,511,513`) y el refresh (`:763-768`). En el cierre, `debtService.js:168` también topea el crédito a `totalUnpaid`.
- **Flujo afectado:** mes N sobrepago grande → mes N+1 barato/bonificado → mes N+2 arranca sin el crédito restante.
- **Reproducción:** sobrepago de $300.000 en mes N; mes N+1 con alquiler $200.000: `totalDue = max(200.000−300.000, 0) = 0`; el inquilino no paga nada → `balance = 0` → mes N+2 con crédito $0. **Se esfumaron $100.000.**
- **Qué debería ocurrir:** el excedente debe arrastrarse (`balance = amountPaid + previousBalance − cargos brutos`).
- **Riesgo económico:** pérdida directa y silenciosa del dinero del inquilino. Casos reales con crédito grande (p.ej. Gutierrez, $208.441 a favor) están a un mes bonificado de perder plata.
- **Archivos/Funciones:** `monthlyRecordService.js` → `_recalculateCore`, `getOrCreateMonthlyRecords`; `debtService.js` → `createDebtFromMonthlyRecord`.
- **Tests:** crédito > total del mes → el excedente sobrevive intacto al mes siguiente; ídem cruzando el cierre.
- **Estado:** ✅ **CORREGIDO** (2026-07-11). `_recalculateCore` ya no clampea `td` antes de restarlo del balance (el excedente sobrevive como `balance` positivo). La creación de un mes nuevo (`monthlyRecordService.js`, antes `balance: -Math.max(totalDue,0)`) tenía el MISMO bug sin corregir — se detectó al auditar el fix y se corrigió también (`balance: -totalDue`, sin clampear). Tests: `tests/punitoryBase.test.js` ("A-04 ... _recalculateCore" y "C-01 (creación) ...").

---

## C-02 · Punitorios impagos se auto-condonan: pagar solo el alquiler marca el mes COMPLETO

- **Severidad:** Crítica · **Módulo:** Pagos / recálculo / cierre · **Confianza:** CONFIRMADO
- **Descripción:** `totalDue` suma únicamente los punitorios **pagados** (conceptos PUNITORIOS de las transacciones). Si el pago no alcanza a los punitorios, éstos no forman parte de `totalDue` → `balance = 0` → COMPLETE → el cierre (que solo toma PENDING/PARTIAL) **nunca crea la deuda** por esos punitorios.
- **Por qué ocurre:** `monthlyRecordService.js:1221-1227` (`totalPunitory` = solo conceptos), `:1249`, `:1273` (`effectiveBalance >= -1 && amountPaid > 0` → COMPLETE). El concepto PUNITORIOS solo se crea por lo que el pago cubre (`paymentTransactionService.js:157`). El fix "sumar conceptos de todas las tx" (anti saldo-a-favor-falso) tuvo este efecto colateral.
- **Reproducción:** alquiler $100.000, mora de 11 días (0,6%/día ⇒ sistema cotiza $106.600). El operador registra el pago "redondo" de $100.000 → conceptos: ALQUILER 100.000, PUNITORIOS 0 → `totalDue = 100.000`, `balance = 0` → COMPLETE. El cierre no genera deuda. Los $6.600 desaparecen con `punitoryForgiven = false`.
- **Qué debería ocurrir:** el mes queda PARTIAL debiendo los punitorios, o se exige `forgivePunitorios` explícito.
- **Riesgo económico:** condonación sistemática y silenciosa de punitorios en el escenario más común de mora (pago tardío por el monto del alquiler).
- **Archivos/Funciones:** `monthlyRecordService.js` → `_recalculateCore`; `paymentTransactionService.js` → `registerPayment`; `monthlyCloseService.js` → `closeMonth`.
- **Tests:** pago que cubre solo alquiler en mora → mes NO COMPLETE; cierre posterior crea deuda por los punitorios.
- **Estado:** ✅ **CORREGIDO** (previo a esta sesión, working tree). `totalDue` ahora usa el punitorio VIVO (`computeLivePunitoryAmount`), no solo la suma de conceptos ya pagados — una mora nunca cobrada mantiene el mes PARTIAL en vez de auto-condonarse.

---

## C-03 · `registerPayment` no es atómico ni idempotente: doble click = pago duplicado + crédito aplicado dos veces + punitorios duplicados **[×2]**

- **Severidad:** Crítica · **Módulo:** Pagos · **Confianza:** CONFIRMADO
- **Descripción:** lectura y cálculo fuera de toda transacción/lock (`paymentTransactionService.js:23-44,97-105,107-158`); el `$transaction` (`:255`) solo envuelve el create + un update. No hay clave de idempotencia ni unique en `PaymentTransaction`.
- **Reproducción:** 2 POST idénticos con <100 ms de diferencia (doble click/retry de red). Ambos leen `amountPaidSoFar = 0` y `prevBalance` completo →
  - dos transacciones con ALQUILER completo y PUNITORIOS completo → `totalDue` inflado con punitorios fantasma (por C-02 invertido: la suma de conceptos los duplica);
  - dos conceptos `A_FAVOR` por el mismo crédito → crédito aplicado dos veces en dos recibos;
  - dos recibos, posiblemente con el MISMO número (ver A-15);
  - `amountPaid` duplicado → saldo a favor falso que cascadea al mes siguiente (un alquiler regalado si nadie lo detecta).
- **Qué debería ocurrir:** serializar con el advisory lock por contrato que YA existe para el recálculo (`monthlyRecordService.js:1164-1170`) + idempotency key.
- **Riesgo económico:** cobro doble al inquilino o mes siguiente gratis; recibos legales duplicados.
- **Archivos/Funciones:** `paymentTransactionService.js` → `registerPayment`.
- **Tests:** 2 POST en paralelo → exactamente 1 efecto (o 2 con estado final coherente); un solo A_FAVOR; receiptNumbers únicos.
- **Estado:** ✅ **CORREGIDO** (previo a esta sesión, working tree). Todo el ciclo leer→calcular→escribir de `registerPayment` corre dentro de `prisma.$transaction` serializado por `pg_advisory_xact_lock(hashtext(contractId))` — el mismo lock que usa el recálculo mensual. El recálculo ahora corre inline en esa misma transacción (ya no `setImmediate` fire-and-forget). Efecto colateral: la numeración de recibos también queda protegida por este lock dentro de la transacción (no resuelve A-15 en todo el sistema, solo esta carrera puntual).

---

## C-04 · `payDebt` hace 3-4 escrituras sin transacción: lost updates y estados a medio camino **[×3]**

- **Severidad:** Crítica · **Módulo:** Deudas / pagos · **Confianza:** CONFIRMADO
- **Descripción:** `debtService.js:519` (create `DebtPayment`) → `:561` (create `PaymentTransaction`) → `:602` (update `Debt` con `newAmountPaid = debt.amountPaid + parsedAmount` calculado de una lectura vieja, `:583`) → recálculo. Sin `$transaction`, sin lock. El check `status === 'PAID'` (`:490`) es check-then-act.
- **Reproducción (carrera):** dos pagos de $100.000 simultáneos sobre deuda de $200.000 → ambos leen `amountPaid=0` → quedan 2 DebtPayment + 2 transacciones ($200.000 reales) pero `debt.amountPaid = 100.000`, status PARTIAL → al inquilino que pagó todo se le siguen devengando **punitorios compuestos** sobre $100.000 fantasma ($600/día).
- **Reproducción (crash):** proceso muere entre `:528` y `:561` (deploy de Render, OOM): DebtPayment sin transacción espejo; la deuda reclama plata ya pagada y el bloqueo cronológico impide pagar los meses siguientes.
- **Riesgo económico:** cobro doble o deuda inmortal ya pagada; divergencia permanente Debt ↔ MonthlyRecord.
- **Archivos/Funciones:** `debtService.js` → `payDebt`, `payDebtsBulk` (hereda el problema, ver M-11).
- **Tests:** 2 `payDebt` paralelos → `amountPaid` = suma real; crash inyectado entre pasos → estado recuperable/atómico.
- **Estado:** ✅ **CORREGIDO** (previo a esta sesión, working tree). `payDebt` relee la deuda YA bajo el mismo advisory lock por contrato (`pg_advisory_xact_lock`) dentro de `prisma.$transaction`, eliminando el lost-update: dos `payDebt` concurrentes sobre la misma deuda ya no pueden calcular `newAmountPaid` a partir de la misma lectura vieja.

---

## C-05 · Borrar una transacción de pago de deuda traga el error LIFO: deuda "cobrada" con plata inexistente **[×3]**

- **Severidad:** Crítica · **Módulo:** Anulación de pagos · **Confianza:** CONFIRMADO
- **Descripción:** `paymentTransactionService.js:553-559`:
  ```js
  try { await cancelDebtPayment(debt.id, matchingDebtPayment.id, true); }
  catch (error) { /* Continue with transaction deletion even if... */ }
  ...
  await prisma.paymentTransaction.delete({ where: { id } });
  ```
  `cancelDebtPayment` **lanza** si el pago no es el último (regla LIFO, `debtService.js:1113-1116`). El catch vacío lo silencia y la transacción se borra igual: el `DebtPayment` sigue vivo, `debt.amountPaid` conserva plata que ya no existe (deuda PAID/PARTIAL sin respaldo), el `MonthlyRecord` recalcula sin esa transacción.
- **Agravante:** el matching DebtPayment↔Transaction es heurístico por **fecha + monto** (`:545-551`, `debtService.js:1120-1127`): dos pagos iguales el mismo día → se anula/borra el equivocado.
- **Reproducción:** deuda con 2 pagos ($50.000 el 5/7, $80.000 el 8/7); borrar del historial la transacción del 5/7 → error tragado → tx borrada, DebtPayment vivo. La deuda dice cobrados $130.000; las transacciones suman $80.000.
- **Qué debería ocurrir:** abortar el borrado completo si la cancelación falla; vincular DebtPayment↔PaymentTransaction por FK explícita (hoy no existe relación en el schema).
- **Riesgo económico:** deudas marcadas cobradas sin dinero real; el faltante no se reclama nunca más.
- **Archivos/Funciones:** `paymentTransactionService.js` → `deleteTransaction`; `debtService.js` → `cancelDebtPayment`.
- **Tests:** borrar transacción no-última de deuda → operación falla completa; dos pagos iguales el mismo día → se anula el correcto.
- **Estado:** ✅ **CORREGIDO** (previo a esta sesión, working tree). Si `cancelDebtPayment` lanza (regla LIFO), el error ya NO se traga: propaga y `prisma.$transaction` revierte todo — el `PaymentTransaction` no se borra. El matching heurístico DebtPayment↔Transaction por fecha+monto (el "agravante") se mantiene igual, fuera de alcance de este fix puntual.

---

## C-06 · La renovación de contrato PIERDE el saldo a favor del inquilino

- **Severidad:** Crítica · **Módulo:** Contratos / renovación · **Confianza:** CONFIRMADO
- **Descripción:** `renewContract` (`contractsController.js:892-952`) crea el contrato nuevo sin transferir el balance final del viejo. El arrastre de `previousBalance` es estrictamente por `contractId` (`monthlyRecordService.js:487-493`: el mes 1 nunca busca saldo; `:412-419` filtra por contractId; la cascada `:1234-1260` también corta por contrato).
- **Asimetría grave:** las **deudas** del contrato viejo sí sobreviven y se encadenan (`expandToChain`, `debtService.js:11-25`), pero los **créditos** mueren con el contrato.
- **Reproducción:** inquilino con balance +$50.000 en el último mes → renovar → mes 1 del contrato nuevo: `previousBalance = 0`.
- **Qué debería ocurrir:** el saldo a favor final debe acreditarse al mes 1 del contrato nuevo (o al menos alertarse en la renovación).
- **Riesgo económico:** cobro en exceso silencioso, exactamente del monto del crédito, en cada renovación con sobrepago previo.
- **Archivos/Funciones:** `contractsController.js` → `renewContract`; `monthlyRecordService.js` → `getOrCreateMonthlyRecords`, `_recalculateCore`.
- **Tests:** contrato viejo termina con balance +X → mes 1 del nuevo arranca con crédito X.
- **Estado:** ✅ **CORREGIDO** (previo a esta sesión, working tree). El mes 1 de un contrato renovado ahora busca el balance final del contrato viejo (`oldContractFinalBalance`, vía `renewedFromContractId`) y lo hereda como `previousBalance` — simétrico con el encadenamiento de deudas que ya existía.

---

## C-07 · Endpoint legacy `POST /payments` vivo: persiste montos y conceptos arbitrarios del cliente **[×2]**

- **Severidad:** Crítica · **Módulo:** Pagos (legacy) / seguridad de datos financieros · **Confianza:** CONFIRMADO
- **Descripción:** montado en `routes/index.js:82`. `paymentsController.js:162-271`: `totalDue = concepts.reduce(...)` sobre lo que manda el cliente, sin validación (no existe validador de pagos en `validators/`), sin recálculo contra RentHistory ni motor de punitorios; update (`:274-383`) y delete (`:386-404`) tampoco recalculan nada. Crea un **segundo libro contable** (`Payment`) que nada reconcilia: no baja deudas, no genera saldo real, no aparece en el control mensual.
- **Frontend:** el form que lo usaba (`PaymentForm.jsx`) ya no está ruteado (código muerto), pero el hook (`usePayments.js:37-67`) y el endpoint siguen vivos para cualquier usuario autenticado.
- **Reproducción:** `POST /api/groups/:gid/payments` con `concepts: [{type:'ALQUILER', amount: 1}]` → pago "completo" con totalDue=$1 persistido.
- **Qué debería ocurrir:** deshabilitar el endpoint o recalcular server-side todo lo recibido.
- **Riesgo económico:** registros de dinero manipulables a voluntad, desincronizados del estado real.
- **Archivos/Funciones:** `paymentsController.js` (create/update/delete), `paymentService.js` (flujo V1 con punitorios sin gracia/feriados y orden por `monthNumber` — bug conocido de meses fantasma).
- **Tests:** contrato de API: POST con conceptos arbitrarios → rechazado o recalculado.
- **Estado:** ✅ **CORREGIDO** (previo a esta sesión, working tree). `createPayment`/`updatePayment`/`deletePayment` devuelven 410 Gone (no escriben nada); confirmado que ningún flujo vivo del frontend los llama. Las rutas GET (lectura) y concept-types NO se tocaron. El modelo `Payment` y su historial no se borraron.

---

# PARTE 2 — HALLAZGOS ALTOS

---

## A-01 · Los punitorios congelados impagos del mes desaparecen de la deuda cuando hubo pagos parciales antes del cierre
**Deudas** · `debtService.js:433-441`: `unpaidAccumulatedPunitory = amountPaid > 0 ? ... : 0`. El descarte a 0 es correcto solo para meses nunca pagados (donde el cálculo vivo cubre desde el día 1). Con pagos parciales, `punitoryStartDate` = fecha del último pago (`:181-184`) y el vivo solo cuenta desde ahí: los punitorios devengados ANTES del último pago que ese pago no cubrió (congelados en `accumulatedPunitory` al crear la deuda) **se pierden del total y nunca se cobran**. `compoundBase` (`:447-449`) tampoco los incluye. **Repro:** mes $100.000; pago parcial $50.000 el día 20 (con $10.200 de punitorios devengados impagos); cerrar; pagar la deuda → los $10.200 no se exigen; deuda PAID. **Riesgo:** pérdida sistemática en cada deuda nacida de un mes PARTIAL. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-11, con confirmación del usuario tras evidencia con números concretos). El gate de `unpaidAccumulatedPunitory` usaba `debt.amountPaid > 0` (más angosto); ahora usa `hasPayment` (la misma condición que ya usaba correctamente `compoundBase`, que también incluye `previousRecordPayment`). Test de regresión: `tests/punitory.test.js` → "A-01: deuda nacida de un mes con pago parcial NO pierde los punitorios congelados impagos".

## A-02 · Contradicción `appliedCredit`: la imputación lo aplica primero, el cálculo de punitorios lo ignora → re-cobro de punitorios ya pagados
**Deudas** · `payDebt` imputa crédito antes que efectivo (`debtService.js:536-558`, regla Brunello), pero `calculateDebtPunitory` computa `remainingBase = totalBase − amountPaid` y `paidToPunitory = max(amountPaid − totalBase, 0)` sobre la base **bruta sin crédito** (`:333-344, :384, :438`). Efectivo que según los conceptos pagó punitorios no se reconoce. **Repro:** deuda alquiler $100.000 + crédito $20.000 + punitorios $10.000; pago parcial $85.000 (cubre $80.000 alquiler + $5.000 punitorios) → siguiente preview: base viva $15.000 (ya cubiertos) y punitorios impagos $10.000 (los $5.000 pagados "resucitan"). Es la imagen especular del caso Etica: el fix por conceptos reales se aplicó al camino MonthlyRecord, no al camino Debt. **Riesgo:** sobre-cobro de intereses en toda deuda con crédito pagada en cuotas. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-11, con confirmación del usuario tras evidencia con números concretos). `paidToPunitory`/`amountPaidToPunitory` ahora consideran efectivo + `appliedCredit`, no solo efectivo, al decidir cuánto ya se pagó de punitorios (se corrigió en ambas ramas de `calculateDebtPunitory`: base pendiente y base ya saldada). Test de regresión: `tests/punitory.test.js` → "A-02: efectivo que pagó punitorios NO resucita como impago cuando hay appliedCredit".

## A-03 · Tres bases de punitorios distintas para el mismo mes: lo mostrado ≠ lo cobrado ≠ lo congelado al cierre **[×2]**
**Punitorios** · Con pagos parciales: display del Control Mensual usa `rent + services + iva − amountPaid` (`monthlyRecordService.js:877-884`); el cobro real usa solo alquiler impago sin IVA (`paymentTransactionService.js:87-94`); el cierre usa una tercera variante que descuenta IVA en otro orden (`debtService.js:122-141`). **Ejemplo:** alquiler $100.000, servicios $50.000, pagado $30.000 → display base $120.000, cobro base $100.000. LOGICA.md §4.3 coincide con el display; el cobro implementa otra regla. **Riesgo:** se intima/muestra un punitorio y se cobra otro. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-11). Nueva función única `computePunitoryBase` (`src/utils/punitory.js`) implementa la regla de LOGICA §4.3 (sin pago → solo alquiler; con pago parcial → saldo restante = alquiler+servicios+IVA−pagado). El cobro (`paymentTransactionService.js`, cobro y preview) y el catch-up de cierre (`debtService.js` → `createDebtFromMonthlyRecord`) ahora la llaman en vez de su fórmula rent-only propia; el display/`_recalculateCore` (que ya la implementaban bien, duplicada) también se refactorizaron para usar la misma función. Único cambio observable: el cobro y el cierre ahora incluyen servicios/IVA impagos en la base con pagos parciales. Tests: `tests/punitoryBase.test.js` (tests 1-2) + `tests/punitory.test.js` (`computePunitoryBase`).

## A-04 · Tres fórmulas de `totalDue` según el camino que corra: el refresh del GET usa el punitorio congelado del último pago **[×2]**
**Recálculo** · Refresh en GET: `totalDue = rent + services + record.punitoryAmount (congelado del ÚLTIMO pago) + iva − prev` (`monthlyRecordService.js:763`); `_recalculateCore`: suma de conceptos PUNITORIOS de TODAS las tx (`:1227,1249`); display: punitorio vivo (`:952`). El fix documentado en LOGICA.md se aplicó solo a `_recalculateCore`. **Repro:** mes pagado en 2 tandas con punitorios en ambas; cambiar `previousBalance` (borrar un pago previo) y abrir el período → `totalDue` cae, aparece **saldo a favor falso** que se arrastra como `previousBalance`; el próximo `_recalculateCore` lo vuelve a subir: los números **oscilan** según qué endpoint corrió último. **Riesgo:** la clase exacta de bug ya sufrida (Brunello/Etica), aún viva en el segundo camino. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-11). El refresh persistido del GET (bloque `rentChanged||prevBalanceChanged||ivaChanged`) ahora usa el punitorio VIVO (`computeLivePunitoryAmount`, con el mismo patrón de dos pasadas que `_recalculateCore` para no reintroducir saldo a favor falso), no el congelado. Ambos caminos convergen en la misma función. Tests: `tests/punitoryBase.test.js` (test 3, `_recalculateCore`; test 5, integración real del refresh del GET vía `getOrCreateMonthlyRecords`).

## A-05 · La tasa de punitorios por Group NO se usa; default de schema al 2%/día
**Configuración/Punitorios** · `Group.punitoryRate` (`schema.prisma:50`) no se referencia en ningún cálculo (solo el CRUD de groups): editarla no tiene efecto — todo usa `contract.punitoryPercent`, cuyo default de schema es **0.02 = 2%/día** (`schema.prisma:374`), 3,3× el 0,6% documentado. El controller lo pisa con 0.006, pero cualquier creación por otro camino (seed, scripts de reparación, futura API) hereda 2%. `notificationTemplates.js:58,85,114` usa fallback `|| 0.02`. Menor: `punitoryStartDay` default 4 en schema vs 10 en LOGICA.md. **Riesgo:** punitorios al triple de lo pactado en contratos creados fuera del controller. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-11), fix mínimo sin alterar cálculos existentes. Defaults de schema alineados (`punitoryPercent` 0.02→0.006, `punitoryStartDay` 4→10); fallbacks de `notificationTemplates.js` corregidos (`|| 0.02`→`|| 0.006`, `|| 4`→`|| 10`); `Group.punitoryRate` documentado como no usado por ningún cálculo (se deja sin borrar). Contratos existentes no cambian: siguen usando su `punitoryPercent` guardado. Tests: `tests/notificationTemplates.test.js`.

## A-06 · Endpoints GET mutan estado financiero (`getOrCreateMonthlyRecords` no es read-only), incluso para rol VIEWER **[×2]**
**Generación mensual** · `getOrCreateMonthlyRecords` crea, actualiza (`rentAmount` incluso de meses COMPLETOS — `monthlyRecordService.js:714`), borra registros y recalcula status. Se invoca desde `GET /monthly-records` (VIEWER permitido, `monthlyRecords.routes.js:11-15`), `GET /dashboard/summary` y los reportes de liquidación (`reportDataService.js:167,526`). Refrescar una pantalla o imprimir una liquidación cambia montos en DB sin usuario/acción trazable; pedir un reporte de un período futuro **crea** los meses. **Riesgo:** mutaciones financieras invisibles disparadas por consultas. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12), enfoque quirúrgico confirmado por el usuario: el GET sigue creando meses faltantes (necesario para la UX), pero un mes que ya está `COMPLETE` al entrar al refresh queda completamente congelado (ni rentAmount, ni IVA, ni totalDue/balance, ni status se tocan) — antes solo `previousBalance` estaba protegido. Ver también A-07/A-26 (el borrado inline se eliminó del todo). Tests: `tests/getReadonly.test.js`.

## A-07 · El fix inline de monthNumbers dentro del GET puede borrar condonaciones o tirar 500
**Generación mensual** · `monthlyRecordService.js:544-570` decide borrar registros conflictivos mirando solo `amountPaid > 0` (la función oficial `repairContractRecordMonthNumbers:84-131` chequea también `debt` y `transactions`). Registro con `Debt` y `amountPaid=0` → delete viola FK → **500 en todo el Control Mensual**. Registro con `balanceForgiven>0` → **condonación borrada silenciosamente** (cascade). Renumeración inline sin two-phase → P2002 → 500. **Riesgo:** pérdida de condonaciones / indisponibilidad. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). Decisión del usuario: el GET deja de reparar por completo (se eliminó el bloque entero de borrado/renumeración inline). El repair de monthNumbers queda SOLO en `repairContractRecordMonthNumbers` (ya usaba el criterio correcto de tres señales, con transacción de dos fases), invocado tras editar un contrato. Si `createMany` choca con un monthNumber obsoleto sin reparar, `skipDuplicates: true` simplemente omite ese registro (no borra nada, no crashea). Tests: `tests/getReadonly.test.js`.

## A-08 · Status COMPLETE sin ningún pago: el mes escapa al cierre y nunca genera deuda
**Recálculo/Cierre** · Refresh del GET: `newBalance >= -0.01 → COMPLETE` sin exigir `amountPaid > 0` (`monthlyRecordService.js:780-786`); `_recalculateCore` exige pago o condonación con tolerancia $1 (`:1269-1277`). Un mes cubierto por `previousBalance` (o con residuo de tolerancia) oscila PENDING↔COMPLETE según el camino, y un COMPLETE laxo **no entra al cierre** (`monthlyCloseService.js:25,108`) → deuda nunca creada. **Riesgo:** meses impagos "pagados" que escapan del cierre. CONFIRMADO.

## A-09 · Ajuste retroactivo (o del mes en curso) reabre meses YA pagados con punitorios corriendo
**Ajustes** · `applyAdjustmentToCalendar`/`undo*` no validan que el mes objetivo no esté pagado/cerrado (`adjustmentService.js:598-624, 503-576, 677-762`); el refresh del GET actualiza `rentAmount` incluso de COMPLETE (`monthlyRecordService.js:714,737-809`) y si el nuevo `totalDue` supera lo pagado el mes pasa a PARTIAL (`:787-792`) **con punitorios en vivo sobre la diferencia** (`:867-931`). El recibo emitido ya no coincide; la Debt (si existía) queda con montos viejos. Mismo mecanismo para "ajuste el mismo día de un pago". **Riesgo:** deudas ficticias con punitorios reales sobre inquilinos que pagaron. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). Decisión del usuario: bloquear (saltar ese contrato, sin abortar el resto del lote) si el mes objetivo está COMPLETE, tiene `amountPaid>0`, tiene transacciones, o tiene una Debt asociada. Fuente única: `isMonthLocked` en `adjustmentService.js`, reutilizada por `applyAdjustmentToCalendar`, `undoAdjustmentForMonth` y `undoAdjustmentForCalendar`. Tests: `tests/adjustmentGuards.test.js`.

## A-10 · El cierre mensual genera deudas por meses posteriores a una rescisión
**Rescisión/Cierre** · `rescindContract` no borra los MonthlyRecord futuros ya generados; `isContractInRangeForMonth` los oculta de la vista y `getUnpaidPeriods` los filtra, pero `closeMonth`/`preview` seleccionan todo PENDING/PARTIAL del período **sin filtro de rango ni rescisión** (`monthlyCloseService.js:20-28,104-117`). **Repro:** navegar a septiembre (crea el registro) → rescindir en julio → cerrar septiembre → Debt real de un mes en que el contrato no existía, invisible en el Control Mensual pero exigible en Deudas. Lo mismo aplica a registros fantasma fuera de rango tras editar un contrato. **Riesgo:** deuda fantasma + punitorios reclamable a un ex-inquilino. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). `previewCloseMonth` y `closeMonth` ahora reutilizan `isContractInRangeForMonth` (ya existía y ya contemplaba la rescisión) como filtro adicional antes de convertir un registro PENDING/PARTIAL en deuda. Tests: `tests/closeMonthRange.test.js`.

## A-11 · Renovación sin validación de solapamiento ni hueco de fechas
**Renovación** · `renewContract` toma `startDate` del request sin compararlo con el fin del viejo (`contractsController.js:841-887`). startDate anterior al fin del viejo → **doble facturación del mismo período** (registros congelados del viejo + registros nuevos; el cierre generaría dos deudas). startDate con hueco → meses sin facturar, sin aviso. CONFIRMADO (falta de validación); ocurrencia PLAUSIBLE.

## A-12 · Eliminar contrato destruye en cascada todo el historial pagado
**Contratos** · `deleteContract` solo bloquea con deudas OPEN/PARTIAL (`contractsController.js:567-573`); el delete arrastra por `onDelete: Cascade`: MonthlyRecord → PaymentTransaction → TransactionConcept, Payment, Debts pagadas → DebtPayment, RentHistory. Borrar un contrato intermedio de una cadena de renovaciones corta `renewedFromContractId` (SetNull) → `expandToChain` deja de ver deudas ancestrales. **Riesgo:** pérdida irreversible de comprobantes de pagos reales con un click. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). Decisión del usuario: bloquear el borrado si existe CUALQUIER historial financiero (deuda en cualquier estado, mes con `amountPaid>0`) o si el contrato es eslabón de una cadena de renovación (`renewedFrom`/`renewedTo`). Solo se puede borrar un contrato financieramente vacío. Tests: `tests/deleteContract.test.js`.

## A-13 · Contrato rescindido queda `active=true` para siempre; desactivarlo a mano oculta TODO su historial
**Contratos** · Nada desactiva un rescindido (solo la renovación pone `active=false`). Consecuencias: (1) la propiedad queda bloqueada para contratos nuevos indefinidamente (`contractsController.js:211-219`); (2) si el operador lo desactiva a mano, el contrato queda `active=false` sin `renewedAt` → `getOrCreateMonthlyRecords` lo excluye por completo (`monthlyRecordService.js:277-281`) → **todos sus meses históricos y el mes de multa desaparecen del Control Mensual** (datos vivos en DB pero invisibles). CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). Decisión del usuario: el contrato rescindido sigue `active=true` (su historial se sigue viendo, `rescindContract` no se tocó), pero los 3 chequeos de "propiedad ocupada" (createContract, assignTenantToProperty, renewContract) ahora exigen además `rescindedAt: null`. Tests: `tests/rescissionProperty.test.js`.

## A-14 · El recálculo es asíncrono pero todos los callers lo tratan como síncrono; `payDebt`/`forgiveDebt` fuerzan COMPLETE en una carrera **[×3]**
**Recálculo** · `recalculateMonthlyRecord` marca dirty + `setImmediate(processDirtyRecords)` (`monthlyRecordService.js:1404-1423`); el fetch de retorno compite con el worker. Efectos: (1) `registerPayment` responde con el record SIN el pago reflejado; (2) `payDebt` (`debtService.js:624-648`) y `forgiveDebt` (`:1255-1270`) leen el estado viejo, fuerzan COMPLETE, y el worker después recalcula desde cero y **puede revertirlo** (para condonaciones sin pagos, `_recalculateCore` da PENDING porque `forgiveDebt` no usa `balanceForgiven`); (3) no hay barrido al boot: un crash deja `needsRecalculation=true` huérfano con totales stale indefinidamente. Compatible con la anomalía real de Amaya Nelida (mes PARTIAL $4.801 con deuda saldada). CONFIRMADO (estructura y carrera por diseño).
**Estado:** ✅ **CORREGIDO** (2026-07-12). `forgiveDebt` ahora corre TODO (update de la deuda + recálculo + forzado de COMPLETE) dentro de una transacción con el mismo advisory lock por contrato que `payDebt`/`registerPayment`/`cancelDebtPayment`, con el recálculo INLINE (no fire-and-forget) — elimina la ventana de carrera por diseño. Además, `app.js` corre un barrido único de `processDirtyRecords()` al arrancar el server, para levantar `needsRecalculation` huérfanos de un crash previo. Tests: `tests/recalcConsistency.test.js`.

## A-15 · Números de recibo por `count()`: duplicados garantizados tras cualquier borrado y por concurrencia **[×2]**
**Comprobantes** · `paymentTransactionService.js:249-252`: `REC-${count+1}`. Borrar una transacción baja el count → el próximo recibo **repite un número ya emitido**; dos pagos concurrentes → mismo número. `receiptNumber` no es `@unique`. **Riesgo:** documentos con valor fiscal duplicados. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). Decisión del usuario: contador monotónico por grupo (nuevo modelo `ReceiptSequence`, incrementado atómicamente vía `upsert`+`{increment}`, nunca decrece con borrados) + `@@unique([groupId, receiptNumber])` como backstop en el schema. Los recibos históricos ya emitidos NO se deduplican (decisión explícita del usuario). Pendiente correr `prisma db:push`. Tests: `tests/receiptSequence.test.js`.

## A-16 · La cascada de recálculo corta en el 31/12: correcciones de diciembre no propagan al año siguiente **[×4]**
**Recálculo/Saldos** · `_recalculateCore` y `_markRecordsDirty` acotan a `periodYear` (`monthlyRecordService.js:1156-1160, 1386-1390`). El refresh al abrir enero compensa **solo si enero no está COMPLETE** (`:753`). **Repro:** sobrepago dic-2025 → enero COMPLETE con ese crédito → se anula el pago de diciembre → enero conserva $50.000 de crédito fantasma para siempre (y 2027 arrastra el error). **Riesgo:** créditos fantasma o faltantes permanentes cruzando el año. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12), tras una batería de tests de blindaje que confirmó que ningún test de punitorios existente se rompía. `_recalculateCore` y `_markRecordsDirty` ahora usan únicamente `monthNumber` (contador continuo del contrato, nunca se reinicia por año calendario) como criterio de rango de la cascada, sin fijar `periodYear` — `monthNumber: { gte }` ya cruza el límite de año por sí solo. No se tocaron fórmulas, redondeos ni el orden de cálculo de punitorios. Tests: `tests/yearBoundaryCarry.test.js` (incluye la batería de blindaje dentro del mismo año + los casos nuevos de cruce de año).

## A-17 · La Liquidación usa el punitorio CONGELADO del último pago y recalcula con imputación propia → totales, estado y honorarios incorrectos en PDF/XLSX/DOCX/HTML
**Reportes** · `reportDataService.js:220,315-317,369,448` usa `record.punitoryAmount` (congelado del último pago) en vez de `sumPunitoryConcepts` (la "fuente única" declarada en `helpers.js:127-142`); el sobrante tras cubrir el punitorio subestimado se etiqueta **falso "SALDO A FAVOR"** (`:361-387`) y propaga a `pendingAmount`, `totalSinAbonar`, `grandSaldoAFavor` y honorarios en los 4 formatos. **Riesgo:** liquidaciones al propietario con totales/estados errados; deudores mostrados con saldo a favor. CONFIRMADO.

## A-18 · El desglose de imputación de la Liquidación usa OTRO orden (servicios+IVA → alquiler) → honorarios liquidados sobre base equivocada
**Reportes** · `reportDataService.js:344-373` imputa (servicios+IVA) antes que alquiler, contra el orden real servicios → alquiler → IVA → punitorios de los conceptos persistidos (`paymentTransactionService.js:153-158`). Con pagos parciales + IVA, `paidAlquiler` difiere de los recibos → `subtotalAlquileresCobrado` y los **honorarios de administración** (`:406-415`) se calculan sobre una imputación que no coincide con la contabilidad. CONFIRMADO.

## A-19 · Recibo global: el TOTAL incluye IVA y resta saldo a favor, pero esos renglones NO están en el detalle **[×2]**
**Comprobantes** · `reportDataService.js:1210-1214` calcula el total con IVA (recalculado `rent*0.21`, no el almacenado) y `−previousBalance`, pero los conceptos listados (`:1217-1257`) no incluyen renglón IVA ni "Saldo a favor" → **la suma visible de renglones ≠ TOTAL** en el documento entregado al inquilino. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-13). Se agregaron los renglones "IVA 21%" y "Saldo a favor" al detalle de la rama global de `getPagoEfectivoFromRecord` (`reportDataService.js`), reusando los mismos valores YA calculados para `total` (no se recalculó nada nuevo, no se tocó ninguna fórmula de punitorios). Ahora Σ renglones === TOTAL impreso. Test: `tests/globalReceipt.test.js`.

## A-20 · Regenerar un comprobante con deuda viva da un monto DISTINTO al original (no idempotente)
**Comprobantes** · `reportDataService.js:1190-1194`: punitorio calculado a `new Date()` (fecha de generación). El mismo recibo (mismo `REC-YYYYMM-N`, sin versión) impreso hoy y en 10 días muestra totales distintos; el "Saldo a Pagar" crece día a día. La sección "Deudas Acumuladas" de la Liquidación consulta deudas por estado ACTUAL sin filtrar por período (`:150,574`) → regenerar la liquidación de marzo en julio muestra las deudas de hoy. **Riesgo:** dos versiones del mismo comprobante en circulación. CONFIRMADO.

## A-21 · Dos fórmulas para el punitorio vivo de una deuda: el recibo/pantalla subcuenta vs los reportes
**Reportes/Deudas** · Fórmula A (recibo global y Control Mensual): `unpaidAccumulatedPunitory + newPunitoryAmount` (`reportDataService.js:1192`, `monthlyRecordService.js:973-974`). Fórmula B (reporte Control Mensual, Estado de Cuentas, Carta Documento, Resumen Ejecutivo): `unpaidAccumulatedPunitory + amount` (`reportDataService.js:43`). Divergen cuando la base está saldada y solo quedan punitorios (`debtService.js:376-417`): A = solo tramo nuevo (subcuenta), B = total impago. **Riesgo:** se intima por Carta Documento un monto mayor que el que el recibo muestra al inquilino. CONFIRMADO.

## A-22 · El reporte "Control Mensual" ≠ la pantalla de Control Mensual
**Reportes** · La pantalla usa el servicio con refresh + punitorios vivos (`monthlyRecordsController.js:32`); el reporte (JSON y Excel) lee `findMany` crudo (`reportDataService.js:1361-1416`): mes abierto en mora sin pagos → pantalla muestra punitorios corriendo, el Excel muestra $0; datos sin refrescar tras correcciones; días de mora con criterio distinto; fórmula A vs B (A-21). **Riesgo:** cobranza decidida sobre un Excel que subestima la mora. CONFIRMADO.

## A-23 · Excel de Liquidaciones: columna "Alquiler" siempre $0, "Servicios" contiene el total
**Reportes** · `excelTemplates.js:134-144` matchea `c.concepto === 'Alquiler'`, pero el label real es `Alquiler JULIO 2026 (Mes 7)` → nunca matchea: Alquiler = 0, Servicios = todo. La columna Total cuadra, así que pasa desapercibido. **Riesgo:** cualquier análisis por columnas del contador es inválido. CONFIRMADO.

## A-24 · Todo el dinero es `Float` + siete tolerancias distintas: el mismo mes puede ser COMPLETO y PARCIAL según el camino
**Transversal** · Ningún monto usa `Decimal` (`schema.prisma:364-823`). `totalDue` se almacena sin redondear (`monthlyRecordService.js:1249`) mientras `balance` sí; comparaciones estrictas entre floats (`:744,756,1036`; `debtService.js:307-315`). Conviven tolerancias `-0.01` / `-1` / `≤1` / `0.01` / `0.5` / `>1` / round-a-peso en 8 lugares distintos. **Repro:** balance −$0,60 → `_recalculateCore` lo marca COMPLETE (≥−1), el refresh del GET lo baja a PARTIAL (≥−0.01), el reporte dice $0 (±0.5): tres pantallas, tres estados. **Riesgo:** estados oscilantes y residuos acumulables en cadenas largas. CONFIRMADO.

## A-25 · El "hoy" del servidor es UTC: entre las 21:00 y las 24:00 (ART) todos los cálculos en vivo cuentan un día de más
**Transversal/Fechas** · Servidor Render en UTC, sin `TZ`. `debtService.js:134` (fecha del CIERRE), `:268` (default de `calculateDebtPunitory`), `monthlyRecordService.js:905`, `reportDataService.js:39,1191,1409` usan `new Date()`. **Repro 1:** cerrar junio el 30/06 a las 21:30 ART → el server ya está en 01/07 → punitorios congelados con un día extra ($3.000 de más por deuda de $500.000) y el período pasa a `isPastPeriod` (regla "desde el día 1"). **Repro 2:** consultar el día de gracia a las 21:30 → la pantalla muestra ~$24.000 de punitorios que no corresponden; si el operador cobra "lo que dice la pantalla", el excedente queda como sobrepago. **Riesgo:** sobre-cobros sistemáticos en horario vespertino. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-11), fix mínimo SIN migración de datos ni TZ global del proceso (análisis de migración previo concluyó que no hacía falta: la fecha que elige el usuario ya viaja como string TZ-safe; el bug estaba solo en los `new Date()` del backend usados como "hoy"). Nuevo helper único `getTodayLocalString()`/`getTodayLocalDate()` (`utils/dateUtils.js`, vía `Intl.DateTimeFormat` con TZ nombrada `America/Argentina/Buenos_Aires`, inmune a la TZ del proceso) que reemplaza `new Date()` en todos los cálculos financieros en vivo: cierre de mes (`debtService.js`), `computeLivePunitoryAmount` persistido por `_recalculateCore` (`monthlyRecordService.js`), `calculateDebtPunitory` y sus callers (deudas vivas, previews, Control Mensual, reportes/recibos), y el default de fecha de pago de deuda cuando el operador no la especifica (`debtsController.js`). No se tocaron las convenciones de escritura de fechas, la TZ del proceso, las fórmulas de punitorios ni el schema. Tests: `tests/timezoneToday.test.js` (incluye el caso exacto del bug —23:30 ART reclasificando un mes como pasado— verificado determinísticamente forzando `TZ=UTC`, sin depender de la TZ de la máquina que corre la suite).

## A-26 · `getOrCreate` puede borrar un registro cuyo pago aún no se reflejó → la transacción de pago se borra en cascada
**Transversal** · El fix inline (A-07) chequea solo `amountPaid > 0`; con el recálculo asíncrono (A-14) pendiente o perdido tras un crash, un registro CON transacción real pero `amountPaid=0` stale es "borrable" — y `PaymentTransaction.monthlyRecord` es `onDelete: Cascade` (`schema.prisma:617`): **el pago desaparece con él**. Familia directa del bug histórico de $4.48M. PLAUSIBLE (requiere la ventana stale), estructura CONFIRMADA.
**Estado:** ✅ **CORREGIDO** (2026-07-12), como consecuencia directa del fix de A-07: al eliminarse por completo el bloque de borrado/renumeración inline del GET, ya no existe ningún camino por el que un simple GET borre un `MonthlyRecord` (con o sin transacción real). Tests: `tests/getReadonly.test.js` (caso específico de un registro con `debt` y `amountPaid=0`).

## A-27 · Honorarios en pantalla ignoran el "Descuento alquiler" que el PDF sí aplica
**Frontend** · `ReportsPage.jsx:139-171`: `computeHonorariosLocal` recibe `descuentosAlquilerState` y **nunca lo usa**; el POST de descarga sí lo envía y el backend lo aplica (`reportDataService.js:221-222`). El usuario valida en pantalla un número y le manda al propietario otro (diferencia = % × descuento por contrato). CONFIRMADO.

## A-28 · Modales de pago recalculan `totalDue`/imputación en el cliente y el prefill pisa lo que tipea el usuario
**Frontend** · `PaymentRegistrationModal.jsx:95-110` duplica la fórmula de `totalDue` con `punitoryPreview?.amount || 0` (sin punitorios mientras carga) y un `useEffect` sobre `remaining` **sobrescribe el monto tipeado** cuando el preview llega tarde (mismo patrón en `DebtPaymentModal.jsx:76-80` y `BulkDebtPaymentModal.jsx:71-75`). `DebtPaymentModal.jsx:67-73` además re-implementa la imputación como fallback **ignorando `appliedCredit` e IVA** (regla Brunello). **Riesgo:** cobrar en caja un monto distinto al prometido/tipeado. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-13). Los modales fueron refactorizados para consumir directamente los valores `record.liveTotalDue`, `record.amountPaid` y `record.livePunitoryAmount` expuestos por la API tras la centralización de punitorios, eliminando la replicación de lógica en React. También se resolvieron errores transitorios de renderizado al eliminar variables huérfanas (`alquiler`, `servicios`, `iva`).

## A-29 · No existe edición de pago; "borrar + recrear" no restaura el estado exacto
**Pagos** · No hay PUT para `PaymentTransaction` (solo create/get/delete). Editar = borrar (con los problemas C-05) + recrear: los punitorios se recalculan desde el `lastTransaction` restante (puede no reproducir el tramo original) y los conceptos de transacciones POSTERIORES (líneas A_FAVOR/SOBREPAGO congeladas) nunca se reescriben → recibos ya emitidos describen una realidad que ya no existe. CONFIRMADO.

## A-30 · `GET /debts/:id` ignora el saldo a favor (`appliedCredit`) al calcular el monto a pagar **[reportado por el usuario en producción, 2026-07-12]**
**Deudas** · `getDebtById` (`debtsController.js:83-92`) calculaba `remainingDebt = Math.max(0, debt.unpaidRentAmount - debt.amountPaid)` a mano: no restaba `appliedCredit` (saldo a favor del mes anterior aplicado al total) ni sumaba `unpaidServicesAmount`/`unpaidAccumulatedPunitory`. `getOpenDebts`/`getDebts` (`debtService.js:878-891, 924-938`) ya calculaban esto correctamente vía `calculateDebtPunitory`, que sí resta `appliedCredit` (`debtService.js:491`). **Repro real:** deuda de alquiler $160.000 con $50.000 de saldo a favor aplicado → el modal de pago mostraba $160.000 a cobrar en vez de $110.000. **Riesgo:** cobrar en caja $50.000 de más al inquilino. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). `getDebtById` reutiliza `calculateDebtPunitory` (la misma función que ya usaban correctamente `getOpenDebts`/`getDebts`) en vez de duplicar el cálculo. No se tocó `calculateDebtPunitory` ni ninguna fórmula de punitorios. Tests: `tests/debtByIdAppliedCredit.test.js`.

## A-31 · `Debt.appliedCredit` queda congelado desde el cierre del mes; `record.previousBalance` se refresca en vivo → Control Mensual y Deudas divergen **[reportado por el usuario en producción, 2026-07-12]**
**Deudas/Recálculo** · `appliedCredit` se calcula UNA SOLA VEZ al crear la deuda (`createDebtFromMonthlyRecord:177`, `appliedCredit = min(max(previousBalance,0), totalUnpaid)`) y nunca se vuelve a tocar — no hay ningún caller que lo actualice después. En cambio, la columna "Debe Sig." de Control Mensual usa `record.previousBalance`, que SÍ se refresca en cada recálculo real del mes (`monthlyRecordService.js`, refresh del GET para meses no-COMPLETE y `_recalculateCore` para la cascada). **Repro:** se cierra un mes con $50.000 de crédito → se genera la deuda con `appliedCredit=50.000` → después se anula un pago de un mes anterior que reducía ese crédito a $0 → Control Mensual muestra "Debe Sig." recalculado sin crédito, pero la Deuda sigue descontando los $50.000 fantasma. **Riesgo:** dos pantallas con montos distintos para el mismo saldo a favor; cobrar de menos si se guía por la Deuda vieja. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-12). Decisión del usuario: gana el valor EN VIVO. Nueva función `syncDebtAppliedCreditFromRecord` (`debtService.js`, misma fórmula de clamp que `createDebtFromMonthlyRecord:177`, alcance acotado a solo `appliedCredit`/`currentTotal`, no toca `status` ni el resto de los campos de la deuda), invocada desde `_recalculateCore` (`monthlyRecordService.js`) reutilizando el `openDebt` que esa función ya consultaba, cada vez que se recalcula el `previousBalance` final de un mes con una Debt asociada no pagada. No se tocó ninguna fórmula de `calculateDebtPunitory` ni de punitorios. Tests: `tests/debtAppliedCreditSync.test.js` (incluye el caso de que una deuda `PAID` nunca se toca).

## A-32 · Recibo de pago en efectivo de una DEUDA no mostraba los punitorios pagados ni el saldo a favor aplicado **[nuevo, reportado por el usuario en producción, 2026-07-13]**
**Comprobantes/Deudas** · `payDebt` (`debtService.js`, bloque `concepts.create`) nunca creaba un concepto `A_FAVOR` — a diferencia de `registerPayment` (`paymentTransactionService.js:235-249`), que sí lo hace para el pago normal de un mes. Por eso el recibo de un pago de deuda jamás podía mostrar el saldo a favor aplicado. Además, el armador del recibo `getPagoEfectivoFromRecord` (`reportDataService.js:1165`) filtraba `c.amount > 0`, lo que igual habría descartado esa línea (amount 0/negativo) aunque existiera. Los punitorios pagados EN EFECTIVO sí se guardaban y mostraban cuando el efectivo los cubría; el síntoma aparecía cuando el saldo a favor cubría total o parcialmente los punitorios, dejando la porción en efectivo en $0 sin ninguna línea que explicara por qué. CONFIRMADO.
**Estado:** ✅ **CORREGIDO** (2026-07-13). Decisión del usuario: el recibo de deuda muestra los renglones de lo pagado EN EFECTIVO (modelo ya existente) + una nota informativa de saldo a favor (`A_FAVOR`, `amount: 0`, el monto va en la descripción) **solo en el 1er pago de la deuda** (`isFirstPaymentToDebt = amountPaid===0 && payments.length===0`); en pagos posteriores de la MISMA deuda se omite (el crédito ya se mostró una vez). El filtro de `getPagoEfectivoFromRecord` ahora deja pasar puntualmente esa línea (`c.type === 'A_FAVOR' && c.amount === 0`), sin cambiar el descarte pre-existente de cualquier otro `A_FAVOR` negativo (fuera de alcance de este fix). **No se tocó ninguna fórmula ni el orden de cálculo de punitorios.** Tests: `tests/debtReceipt.test.js`.

---

# PARTE 3 — HALLAZGOS MEDIOS

| # | Hallazgo | Evidencia | Confianza |
|---|---|---|---|
| M-01 | **Deuda "zombi" OPEN en $0** bloquea el pago de todos los meses siguientes: pagar el mes vía `registerPayment` con Debt abierta del mismo período nunca toca `debt.amountPaid/status`; el auto-recompute corrige montos pero jamás el status. Salida típica: "condonar" (registro contable falso) **[×2]** | `debtService.js:321-330, 940-951`; `paymentTransactionService.js:52-64`; `monthlyRecordService.js:1271-1272` | CONFIRMADO |
| M-02 | `recalculateDebtFromMonthlyRecord` marca la deuda **PAID ignorando punitorios** (status decidido contra alquiler+servicios solamente); condonación silenciosa al borrar transacciones pre-cierre | `debtService.js:1303-1310` | CONFIRMADO |
| M-03 | `closeMonth` sin guardas de período: se puede cerrar el **mes en curso o uno futuro** (deudas por alquileres no exigibles + bloqueo cronológico masivo), sin confirmación específica **[×2]** | `monthlyCloseService.js:98-156` | CONFIRMADO |
| M-04 | `previewCloseMonth` **no coincide** con lo que `closeMonth` hace: preview sin punitorios vivos al cierre y sin descontar `appliedCredit`/tolerancia `netUnpaid ≤ 1` | `monthlyCloseService.js:55-92` vs `debtService.js:104-174` | CONFIRMADO |
| M-05 | "Último pago" definido de **tres maneras** (`createdAt asc` en el cierre; `paymentDate desc` en pagos; `paymentDate asc` en recálculo): un pago **retro-fechado** cargado tarde ancla `punitoryStartDate` mal → días de punitorios de más o de menos **[×3]** | `monthlyCloseService.js:47,119`; `debtService.js:128-131,181-184`; `paymentTransactionService.js:97-99` | CONFIRMADO |
| M-06 | Múltiples fuentes de verdad para "cuánto debe": `Debt.currentTotal` escrito en 5 lugares con fórmulas distintas y congelado al último evento; `debt.appliedCredit` congelado vs `record.previousBalance` refrescable; el valor persistido depende de **qué pantalla se abrió antes** (skipUpdate vs no) | `debtService.js:216,323,586,1207,1320,1395; :294-331` | CONFIRMADO |
| M-07 | Orden de imputación del IVA distinto entre el pago del mes (servicios→alquiler→IVA) y el cierre/deuda (servicios→IVA→alquiler): el split alquiler/IVA impago difiere según cuándo se calcule → cambia la base "solo alquiler" de punitorios. LOGICA.md se contradice (§5 vs §6) | `paymentTransactionService.js:153-158` vs `debtService.js:51-70` | CONFIRMADO |
| M-08 | En mes abierto, la base de punitorios **ignora el IVA impago** (contra LOGICA §4.3): pagado alquiler pero no IVA → 0 punitorios nuevos | `paymentTransactionService.js:88-94` | CONFIRMADO |
| M-09 | Pago parcial **dentro de la gracia** hace contar los punitorios del siguiente tramo desde esa fecha (antes del inicio de mora): quien paga parte temprano paga MÁS punitorios que quien no pagó nada | `punitory.js:145-157` | CONFIRMADO |
| M-10 | Invariante "1 pago = N pagos" rota en fechas distintas: cada tramo cuenta "ambas fechas inclusive" (+1 día por pago intermedio) + interés compuesto tras el primer pago. Es regla confirmada por el usuario (LOGICA §4.4/§11) — se consigna el costo: N pagos ⇒ hasta N−1 días extra. El mismo día la invariante SÍ se cumple **[×3]** | `punitory.js:147-157`; `debtService.js:443-449` | CONFIRMADO (por diseño) |
| M-11 | `payDebtsBulk` no atómico: totales precalculados + `payDebt` secuenciales; un fallo a mitad deja el pago múltiple aplicado a medias; un total interno menor al precalculado desvía el excedente a SOBREPAGO de una deuda intermedia en vez de fluir a la siguiente **[×2]** | `debtService.js:759-801` | CONFIRMADO |
| M-12 | `punitoryAmount` de la transacción cambia de semántica según el canal (mes: adeudado total; deuda: porción pagada) → el "congelado" del mes tras un pago de deuda parcial hace invisible el punitorio pendiente para el canal mes | `paymentTransactionService.js:267` vs `debtService.js:568`; `monthlyRecordService.js:1224` | CONFIRMADO |
| M-13 | El camino de **cuotas** sigue creando meses pasados con `baseRent` actual (bug #9 de LOGICA.md corregido solo en `bulkAssign`) y sin IVA ni `previousBalance` → patrón Rezzonico hasta que alguien abra el mes; cierres/pagos en el intervalo usan el número equivocado | `monthlyServiceService.js:113-127` | CONFIRMADO |
| M-14 | Servicios sobre mes con deuda PAGADA: el cargo nuevo reabre el mes como PARTIAL pero **no tiene camino de cobro** (sync retorna si PAID; `closeMonth` saltea records con debt; `Debt.monthlyRecordId @unique` impide segunda deuda). Simétrico: **eliminar un servicio ya pagado regala el importe como sobrepago** que cascadea como crédito | `debtService.js:1356`; `monthlyCloseService.js:129`; `schema.prisma:660` | CONFIRMADO |
| M-15 | `PATCH /:recordId/iva` (excepción de IVA por mes) es **revertido silenciosamente por cualquier GET** (el refresh sincroniza `includeIva` desde `contract.pagaIva`) | `monthlyRecordsController.js:307-329`; `monthlyRecordService.js:747-777` | CONFIRMADO |
| M-16 | Mes post-vencimiento: `previousBalance` inconsistente (creado en 0 y excluido del refresh, pero la cascada SÍ lo alcanza → el total depende del historial de recálculos) y los servicios NO se re-sincronizan si se corrige el último mes después de creado (la factura que llega tarde es justamente su caso de uso) | `monthlyRecordService.js:437-459, 653-679, 1241-1260` | PLAUSIBLE |
| M-17 | Meses salteados: el mismo crédito puede aplicarse DOS veces (la cascada salta el gap y acredita a mayo; al abrir abril después, también lo recibe; si mayo está COMPLETE la corrección no llega) | `monthlyRecordService.js:1235-1243, 488-493, 753` | PLAUSIBLE |
| M-18 | Deshacer un ajuste intermedio **no recalcula los posteriores** (el mes 7 conserva el monto compuesto sobre el valor deshecho) y deja `baseRent` desincronizado de la fila vigente | `adjustmentService.js:534-563, 720-749` | CONFIRMADO |
| M-19 | Apply→Undo de ajuste no deja el estado EXACTAMENTE igual: fila INICIAL creada no se borra; `index.currentValue/lastUpdated` no se revierten; interacción con meses pagados (A-09) | `adjustmentService.js:36-51`; `adjustmentIndicesController.js:191-197,312-319,411-418` | CONFIRMADO |
| M-20 | `calculateCurrentContractMonth` (dateUtils) contradice a `computeCurrentMonth` (adjustmentService) para contratos con `startMonth > 1` (cap a `durationMonths`): la ficha del contrato y la pantalla de ajustes muestran **meses distintos** → ajustes aplicados/omitidos en el mes equivocado | `dateUtils.js:39-50` vs `adjustmentService.js:10-19` | CONFIRMADO |
| M-21 | `AJUSTE_MANUAL` con `effectiveFromMonth == targetMonth` es **ignorado** al aplicar el índice (`lt` en `getRentBeforeMonth`): el % se aplica sobre el valor anterior al manual y la fila automática pisa a la manual — contra lo que promete LOGICA.md:81-83 | `adjustmentService.js:54-60` | PLAUSIBLE |
| M-22 | `createContract`/`updateContract`: escrituras multi-paso **sin `$transaction`** (contrato y fila INICIAL separados; renumeración de historial antes del update final): un fallo intermedio deja contrato sin historial (re-abre Rezzonico) o numeración corrupta (familia meses fantasma) | `contractsController.js:253-295, 369-484` | CONFIRMADO (estructura) |
| M-23 | Dos contratos activos sobre la misma propiedad por **carrera** (unicidad solo con `findFirst` en aplicación; sin índice único parcial en DB) → doble facturación permanente | `contractsController.js:211-219,617-622,864-875`; `schema.prisma:405-409` | PLAUSIBLE |
| M-24 | "Pendiente" de deudas **congelado** (`currentTotal`) en Liquidación e Impuestos vs **vivo** (compuesto a hoy) en Carta Documento/Estado de Cuentas/Resumen Ejecutivo: el mismo inquilino, el mismo día, montos distintos entre documentos | `reportDataService.js:394,469-476,1575-1637` vs `:826-1003` | CONFIRMADO |
| M-25 | Resumen Ejecutivo (KPI punitorios = `_sum.punitoryAmount` congelado) y Estado de Cuentas (filas con `punitoryAmount`; cabecera con 3 métricas de fuentes mixtas que no cuadran entre sí ni con las filas; sin IVA en el detalle) | `reportDataService.js:812, 826-853, 892-917` | CONFIRMADO |
| M-26 | La Liquidación general filtra `contract.active: true` → **regenerar un mes histórico después de renovar hace desaparecer ese contrato** del reporte (totales de meses cerrados cambian retroactivamente); Impuestos y Control Mensual no filtran igual → cobertura inconsistente entre reportes. **Estado: ✅ CORREGIDO** (2026-07-11, confirmado con el usuario). `buildBaseWhere()` (`getLiquidacionesAllContracts`) ahora filtra `contract.active:true OR renewedAt IS NOT NULL` — mismo criterio ya usado por Control Mensual (`monthlyRecordService.js`). Un contrato RENOVADO recupera sus meses históricos en la Liquidación general; un contrato RESCINDIDO (`active:false`, `renewedAt:null`) sigue excluido, sin cambios para ese caso. Impuestos/Estado de Cuentas/Carta Documento/Recibos/Liquidación individual no filtraban por `active` y no se tocaron. Test: `tests/liquidacion.test.js` (contra DB real; fixture corregido a los contratos que realmente son dueños del período histórico). | `reportDataService.js:552-565` | CONFIRMADO |
| M-27 | Filas de total que no son la suma de la columna mostrada: XLSX muestra `total` (a pagar) por fila pero el pie es Σ `amountPaid` ("TOTAL COBRADO"); DOCX/HTML rotulan solo "TOTAL" sin avisar el cambio de semántica; HTML consolidado suma "Honorarios alquiler" con los gastos incluidos dos veces (`totalAlquiler` copiado de `totalHon`) | `excelTemplates.js:146,168`; `docxTemplates.js:406,503-508`; `htmlTemplates.js:267-278` | CONFIRMADO |
| M-28 | Se puede emitir un documento titulado **"RECIBO"** para un mes SIN ningún pago (fecha = hoy, método "EFECTIVO" por defecto, total = lo adeudado) — constancia de pago sin pago; y el recibo individual PDF vs HTML tiene secciones distintas | `reportDataService.js:1166-1167`; `htmlTemplates.js:388-404` | CONFIRMADO |
| M-29 | Fechas en el frontend: tres formateadores; Historial de Pagos y modal de transacciones usan getters **locales** (día −1 con fechas UTC-midnight) mientras Control Mensual usa UTC → **el mismo pago muestra fechas distintas según la pantalla** ("pagué el 10, el recibo dice 9") | `PaymentHistoryList.jsx:52-59`; `TransactionHistoryModal.jsx:110` vs `MonthlyRecordRow.jsx:23-30` | CONFIRMADO |
| M-30 | Grand totals de liquidación **duplicados** cliente/backend (`reportTotals.js` espeja a mano `computeGrandTotals`; se computan sobre filas ya mutadas por A-27) y "Alquiler pagado" derivado en el cliente con fórmula distinta al `paidAlquiler` del backend mostrado en la misma pantalla (ignora IVA) | `frontend/src/utils/reportTotals.js:6-30`; `ReportsPage.jsx:218-229,739` | CONFIRMADO |
| M-31 | Preview del ajuste calculado en el cliente sobre `baseRent` cuando el backend aplica sobre el vigente **según historial**: el modal de confirmación muestra un "Nuevo alquiler" que puede no ser el que se aplica (y dice "NO se puede deshacer" cuando sí hay undo) | `ContractsWithAdjustments.jsx:66-77,327-352`; `AdjustmentIndexList.jsx:148-196` | CONFIRMADO |
| M-32 | Invalidaciones de caché faltantes (TanStack Query): registrar/eliminar pago no invalida reportes (staleTime 10 min) ni el tab "Pago Efectivo" (clave `['monthlyRecords','pago',gid]` no matchea el prefijo) ni dashboard; pagar deuda no invalida el detalle del registro; servicios no invalidan deudas/previews de punitorios; cerrar mes no invalida dashboard/reportes → pantallas con números viejos conviviendo con nuevos | `usePaymentTransactions.js:30-43`; `useDebts.js:37-48,197-214`; `useMonthlyServices.js:22-24`; `useReports.js:210-227` | CONFIRMADO |
| M-33 | Control Mensual y Deudas: tarjetas resumen del backend SIN filtrar junto a una tabla filtrada en el cliente ("estos 3 deben $X" cuando $X es del mes completo) | `MonthlyControlPage.jsx:154-174,360-394`; `useMonthlyFiltering.js:6-73` | CONFIRMADO |
| M-34 | IVA redondeado en unos caminos y crudo en otros (`rentAmount*0.21` sin `round2` en creación y `_recalculateCore`; con `round2` en refresh y sync): el `ivaAmount` persistido difiere en centavos según qué camino tocó el registro último | `monthlyRecordService.js:495,762,1245`; `paymentTransactionService.js:87` | CONFIRMADO |
| M-35 | `forgiveBalance` condona `|record.balance|` leído sin lock (read-modify-write): con un pago concurrente o dirty pendiente condona un monto equivocado; `getLiquidacion*` y summary del total del tablero usan `liveTotalDue` mientras las filas muestran `totalHistorico` → **el total del Control Mensual no es la suma de sus filas** con deudores en el período | `monthlyRecordsController.js` (forgive, `:58`); `monthlyRecordService.js:952,983-986` | CONFIRMADO |

---

# PARTE 4 — HALLAZGOS BAJOS

| # | Hallazgo | Evidencia |
|---|---|---|
| B-01 | `getDebtById` calcula `remainingDebt` ignorando servicios, crédito y punitorios impagos (display-only, difiere del resto de endpoints) | `debtsController.js:81-84` |
| B-02 | Feriados comparados vía `toISOString()` (UTC) con fechas construidas en local, y `addHoliday` (UTC-midnight) vs `seedHolidays` (local-midnight): la gracia puede correrse un día según TZ del server / cómo se cargó el feriado. `getHolidaysForYear` solo carga el año del período: gracia que cruza al 01/01 pierde el feriado de Año Nuevo | `punitory.js:19-22`; `holidayService.js:33,51`; `monthlyRecordService.js:426` |
| B-03 | Cron: solo existe `late-payments` (no hay cierre automático — riesgo de proceso); el cron de avisos NO es idempotente (dos corridas el mismo día = avisos duplicados); si corre a las 00:00 UTC ejecuta a las 21:00 ART del día anterior; sin sweep de `needsRecalculation` al boot | `cron.routes.js`; `notificationsController.js:108-121` |
| B-04 | Mes cubierto 100% por saldo a favor queda PENDING para siempre tras el cierre (no genera deuda —correcto— pero tampoco pasa a COMPLETE) | `debtService.js:168-174`; `monthlyRecordService.js:1273` |
| B-05 | Validación de `amount` permeable: `parseFloat("abc") <= 0` es false → pasa y explota en Prisma (500); `"100abc"` → 100 silencioso; sin límite superior; `paymentDate` futura aceptada (punitorios "hasta esa fecha" cobrados hoy). No hay validadores Zod para pagos ni contratos | `paymentTransactionsController.js:32`; `debtsController.js:102` |
| B-06 | Fechas de pago a horas distintas por canal: `registerPayment` 12:00 local; `payDebt` 00:00 local; `dateUtils.parseLocalDate` 12:00 **UTC** — tres convenciones que solo coinciden porque el server está en UTC. Trampa armada: fijar `TZ=America/Argentina/...` globalmente **rompería el matching por igualdad de `paymentDate` sobre datos históricos** si no se migra la convención completa. (A-25 se resolvió el 2026-07-11 SIN fijar TZ global ni tocar estas convenciones — ver A-25 —, así que este riesgo no se disparó; sigue latente si en el futuro se encara la migración completa de Bloque 5.) | `paymentTransactionService.js:260-264`; `debtService.js:28-36`; `dateUtils.js:10-14` |
| B-07 | Flujo legacy `GET /payments/calculate` usa punitorios V1: sin gracia hábil, sin feriados, base = alquiler completo ignorando pagos parciales, saldo por `monthNumber` (bug meses fantasma) | `paymentService.js:10-79`; `punitory.js:198-211` |
| B-08 | `numeroATexto`: `parteDecimal` puede dar 100 → "…CON CIEN PESOS" (letras ≠ números en el recibo); montos ≥ $1.000 millones → "undefined MILLONES". El importe en letras es la parte con valor legal | `helpers.js:66-77` |
| B-09 | Convenciones de TZ mezcladas entre templates (lista de pagos con `timeZone:'UTC'`, resto local); rangos de mes construidos con `new Date(year, month-1, 1)` local del server pueden clasificar un pago del día 1/último día en el mes equivocado | `pdfTemplates.js:63-66,868,1012`; `reportDataService.js:663-665,1419` |
| B-10 | Reporte de vencimientos: el texto dice "2 meses", la lógica usa 3 y sin cota inferior incluye contratos ya vencidos con días negativos | `reportDataService.js:1686-1697`; `pdfTemplates.js:1270` |
| B-11 | Criterios de redondeo distintos entre reportes: Control Mensual redondea por fila y suma redondeados (bien); Liquidación suma floats crudos y redondea al formatear → el total impreso puede diferir en centavos de la suma de renglones impresos | `reportDataService.js:490-515,1386-1389,1431-1434` |
| B-12 | Tolerancia de $1 asimétrica: impago ≤$1 se perdona (deuda PAID / sin deuda) pero sobrepago >$0.01 SÍ genera crédito — siempre a favor del inquilino; sobrepago ≤$0.01 queda en `amountPaid` sin concepto (desglose difiere del total en ≤1 centavo) | `debtService.js:172,595`; `paymentTransactionService.js:239` |
| B-13 | Redondeos de display divergentes: dashboard a peso entero, reportes ±$0.50, control round2 — tres cifras para la misma cartera | `debtService.js:912-914`; `reportDataService.js:1431-1434` |
| B-14 | Sin prorrateo de meses parciales (mes 1 y último se facturan completos — decisión a confirmar) y los punitorios del mes 1 pueden correr desde `punitoryStartDay` **antes del inicio real del contrato** | `monthlyRecordService.js:27-34`; `punitory.js` |
| B-15 | Refresh del mes de penalidad: si `rentAmount ≠ rescissionPenalty` borra TODOS los servicios del mes de penalidad y los re-copia → un GET pisa ediciones manuales | `monthlyRecordService.js:717-736` |
| B-16 | `durationMonths` sin validar: `"0"`/`"-5"` pasan → contrato con `endDate < startDate`, EXPIRED inmediato, rango vacío | `contractsController.js:172,334` |
| B-17 | Overflow de `setMonth` con contratos iniciados el 29–31: etiquetas de período corridas un mes ("Marzo" para febrero) y `endDate` 2-3 días largo (renovación habilitada tarde). Los cálculos de dinero no se afectan (`getCalendarPeriod` usa día 1) **[×2]** | `dateUtils.js:19-25`; `contractService.js:37-39` |
| B-18 | Off-by-one al crear contrato "a mitad de camino": el clamp `Math.max(1, userCurrentMonth - elapsedMonths)` corre toda la numeración +1 sin aviso. **Estado: ✅ CORREGIDO** (2026-07-13). Se refactorizó la lógica de cálculo en `contractsController.js` para usar la diferencia de tiempo real (`elapsedMonths`), evitando el reseteo erróneo a mes 1 que terminaba recortando la duración real del contrato (el "baja a 34 meses"). | `contractsController.js:230-231` |
| B-19 | Re-aplicar un índice con % distinto: silencioso ("aplicado a 0 contratos") pero `index.currentValue` ya quedó actualizado al % nuevo que ningún contrato recibió | `adjustmentIndicesController.js:312-319` |
| B-20 | `startDate` default del backend en UTC (`toISOString().split('T')[0]`): contrato creado a las 21:00 ART sin fecha explícita queda iniciado al día/mes siguiente | `contractsController.js:187` |
| B-21 | Frontend: totales re-sumados de renglones (romperán con paginación); distribución de servicios en lote redondea por fila y envía los `amount` (suma ≠ total tipeado); botón "Condonar deuda" sin guard de loading; sin idempotency-key ante retry manual de red; fallbacks `totalHistorico \|\| liveTotalDue \|\| totalDue` con `\|\|` (un 0 legítimo cae al siguiente campo) | `PaymentHistoryList.jsx:185`; `BatchServiceModal.jsx:185-222`; `MonthlyRecordRow.jsx:233,373-383` |

---

# PARTE 5 — VERIFICACIONES QUE RESULTARON CORRECTAS

Para acotar el riesgo, lo siguiente fue auditado y **está bien**:

1. **Imputación del `appliedCredit` antes que el efectivo** en `payDebt` (fix Brunello): trazado con crédito+efectivo total y parcial — cierra exacto.
2. **Cierre de mes idempotente**: doble ejecución no duplica deudas (triple protección: `record.debt`, check `existing`, `@@unique(monthlyRecordId)`).
3. **Generación mensual idempotente y protegida contra duplicados** (`@@unique([contractId, monthNumber])` + `createMany skipDuplicates` + advisory locks en el recálculo).
4. **Duplicación de servicios** prevenida (`@@unique([monthlyRecordId, conceptTypeId])` + upserts + 409 manejado).
5. **RentHistory como fuente del alquiler** (fixes Rezzonico): lectura con fallback a la fila más antigua, escritura de baseline INICIAL, renumeración al editar contrato, desempate consistente — correcto en los caminos principales (excepción: cuotas, M-13).
6. **Bloqueo cronológico** consistente entre `payDebt`, `payDebtsBulk` y `registerPayment`, incluida la cadena de renovaciones (`expandToChain`).
7. **`cancelDebtPayment` en sí** restaura `accumulatedPunitory` vía `punitoryAtPayment` correctamente (el problema es el caller que traga su error, C-05).
8. **Fechas del formulario**: el frontend envía `YYYY-MM-DD` local correcto (`DateInput.getLocalToday`), y el backend guarda mediodía — la fecha elegida por el usuario no sufre corrimiento.
9. **Doble submit en la UI**: los botones principales de pago/cierre se deshabilitan durante la mutación (la protección que falta es server-side, C-03/C-04).
10. **N cuotas el mismo día = 1 pago**: la invariante SÍ se cumple intra-día (tramo 0 días).
11. **Deshacer ajuste sin historial previo** ahora deriva el valor anterior del % (bug #5 corregido).
12. **Post-vencimiento**: un solo mes extra, alquiler $0, sin punitorios al mostrar ni al pagar, excluido del cierre (residuos en M-16).

---

# PARTE 6 — PLAN DE TESTING CONSOLIDADO

> Objetivo: que cualquier cambio futuro que altere la lógica rompa un test de inmediato. Prioridad: los módulos sin ninguna cobertura hoy (no existe suite automatizada).

## 6.1 Unitarios — motor de punitorios (`punitory.js`, `calculateDebtPunitory`)
1. Pago en el día de gracia hábil exacto → $0; gracia en sábado/domingo/feriado → corre al hábil siguiente (mismo resultado en preview, cobro y cierre).
2. Mes corriente sin pagos → desde `punitoryStartDay` inclusive; mes pasado sin cerrar sin pagos → desde el día 1.
3. Pagos múltiples: tramo desde el último pago ambas fechas inclusive; mismo día → 0; pago con fecha anterior al último → 0.
4. Pago parcial dentro de la gracia + saldo después (M-09): definir la regla y fijarla.
5. Base: sin pagos = solo alquiler (¿con o sin IVA impago? — resolver A-03/M-08 primero y fijar UNA regla); con pagos = saldo según la imputación real (con crédito, A-02).
6. Deuda: interés compuesto solo tras el primer pago; punitorios congelados impagos incluidos en el total (A-01); `paidToPunitory` desde conceptos reales (A-02).
7. Property-based: `calculatePunitoryV2(base, from, to)` monótono en días y lineal en base; nunca negativo.

## 6.2 Unitarios — imputación y redondeo
8. `calculateImputation`: UN solo orden canónico (resolver M-07), fronteras exactas de cada concepto ±$0.01, descuentos negativos.
9. Tolerancia monetaria ÚNICA: mes con residuo −$0.60 → mismo estado por todos los caminos (A-24).
10. `numeroATexto` vs `fmt` property-based (B-08), incluyendo `x.995–x.9999` y ≥ $10⁹.
11. IVA: `round2` en TODOS los caminos; conceptos del pago suman exactamente `amount` (+ crédito aplicado).

## 6.3 Integración — pagos
12. Pago exacto / parcial / mayor al total: estados, conceptos, sobrepago exactamente una vez.
13. **Pago que cubre solo el alquiler en mora → el mes NO queda COMPLETE (C-02).**
14. **Crédito mayor al total del mes → el excedente sobrevive (C-01).**
15. Sobrepago → previousBalance → consumo → no se regenera (patrón Valenzuela).
16. Deuda con `appliedCredit`: total en 1 pago y en cuotas → sin re-cobro de punitorios (A-02); regresión Brunello.
17. Cancelar deuda con 1 vs 2 vs 10 pagos el mismo día → estado final idéntico; en fechas distintas → diferencia exactamente igual a la regla documentada (M-10).
18. Pago sobre mes con Debt abierta → ambos libros consistentes (M-01); pago sobre mes COMPLETE → rechazado o 100% crédito.
19. Inputs inválidos (B-05): NaN, "100abc", negativos, fecha futura → 400 limpios.

## 6.4 Integración — deudas y cierre
20. Cierre idempotente (2 ejecuciones secuenciales y concurrentes); cierre del mes en curso/futuro → rechazado (M-03); registro fantasma/post-rescisión → sin deuda (A-10).
21. Preview del cierre == ejecución (M-04).
22. Cierre de mes parcialmente pagado → la deuda incluye los punitorios congelados impagos y luego NO los pierde (A-01) ni los duplica.
23. Pago retro-fechado + cierre → `punitoryStartDate` = mayor `paymentDate` (M-05).
24. Deuda saldada → record COMPLETE **estable** tras el worker asíncrono (A-14); `forgiveDebt` → COMPLETE estable con `balanceForgiven`.
25. Anulaciones: LIFO estricto visible también vía `deleteTransaction` (C-05); dos pagos iguales el mismo día → se anula el correcto; borrar transacción pre-cierre → deuda no marca PAID con punitorios impagos (M-02).
26. Cambiar `Group.punitoryRate` → afecta los cálculos (A-05); contrato creado por CUALQUIER camino → 0.6%, nunca 2%.

## 6.5 Integración — contratos, ajustes, generación
27. Editar startDate con meses cerrados con deuda / condonación → preservados, sin 500 (A-07); GET puramente read-only sobre período estable (diff completo de tablas antes/después) (A-06).
28. **Renovación: crédito final del viejo → mes 1 del nuevo (C-06)**; solapamiento/hueco de fechas → rechazado/advertido (A-11); deudas del viejo → cadena.
29. Rescisión: registros futuros excluidos del cierre (A-10); la propiedad se libera tras el mes de multa; historial visible aunque se desactive (A-13).
30. Eliminar contrato con pagos históricos → bloqueado o auditado (A-12).
31. Ajustes: aplicar → deshacer = estado exacto (M-19); undo intermedio → bloqueado o recalcula posteriores (M-18); apply/undo sobre mes pagado/cerrado → bloqueado (A-09); AJUSTE_MANUAL mismo mes → el % se aplica sobre el manual (M-21); doble click en Aplicar → una sola fila.
32. Cuotas que crean mes pasado → alquiler histórico + IVA (M-13); `toggleIva` sobrevive al refresh (M-15); servicios sobre deuda pagada → flujo definido (M-14).
33. Cruce de año: corrección de diciembre propaga a enero incluso COMPLETE (A-16); meses salteados → crédito aplicado exactamente una vez (M-17).
34. Contrato iniciado el 31: etiquetas y endDate correctos (B-17); mes 1 sin punitorios anteriores al startDate (B-14).

## 6.6 Concurrencia e idempotencia (requieren DB real)
35. **2 `registerPayment` idénticos en paralelo → un solo efecto, un solo A_FAVOR, receiptNumbers únicos (C-03, A-15).**
36. **2 `payDebt` paralelos → `amountPaid` = suma real (C-04)**; crash inyectado entre pasos → atómico.
37. 2 contratos activos concurrentes misma propiedad → uno solo (M-23); `payDebtsBulk` con fallo a mitad → rollback (M-11).
38. Borrado de transacción y pago simultáneos sobre el mismo mes; reinicio con `needsRecalculation` pendiente → barrido al boot (A-14).

## 6.7 Comprobantes y reportes (consistencia multi-formato)
39. Mes pagado en 2 tandas con punitorios: Liquidación PDF == XLSX == DOCX == HTML == recibo == pantalla == `totalDue` recalculado (A-17, A-04).
40. Recibo global con IVA y crédito: Σ renglones visibles == TOTAL (A-19); ningún "RECIBO" emitible sin pago (M-28).
41. Regeneración idempotente: recibo/liquidación regenerados N días después → mismos montos o leyenda "calculado al DD/MM" (A-20, M-26).
42. Deuda con base saldada y punitorios impagos: recibo == pantalla == reporte == Carta Documento (A-21).
43. Reporte Control Mensual == pantalla (mora viva, días, alquiler refrescado) (A-22).
44. XLSX: columna Alquiler == rentAmount; Σ columna == total al pie con el mismo rótulo (A-23, M-27).
45. Ningún endpoint GET de reportes escribe en DB (snapshot antes/después) (A-06).
46. Honorarios: pantalla == PDF con descuento de alquiler y gastos (A-27); imputación del reporte == conceptos persistidos (A-18).

## 6.8 E2E frontend
47. Total de cada fila del Control Mensual == API; "RESTANTE A PAGAR" del modal con y sin preview de punitorios cargado (interceptar y demorar la request) (A-28).
48. Monto tipeado NO es pisado por el prefill cuando llega el preview (A-28).
49. Tras pagar/cerrar/ajustar: reportes, dashboard, tab Pago Efectivo y detalle actualizados sin recarga (M-32).
50. La misma transacción muestra la MISMA fecha en las 4 pantallas (fixture UTC-midnight, TZ America/Argentina) (M-29).
51. Doble click en todos los botones de pago/cierre → 1 solo POST; retry tras timeout → sin duplicado (requiere idempotencia server).
52. Fechas límite: pago 23:59 del último día del mes (ART) → cae en el mes correcto en pantalla, reportes y punitorios (A-25, B-09).

## 6.9 Invariantes contables globales (property-based / verificación nocturna)
53. `Debt.amountPaid == Σ DebtPayment.amount` con transacciones espejo 1:1.
54. `MonthlyRecord.amountPaid == Σ PaymentTransaction.amount` del record.
55. Σ conceptos de cada transacción == `amount` (+ crédito consumido − crédito generado).
56. Para todo par de pantallas/documentos que muestren "lo que debe X": mismo número a la misma fecha.
57. Ningún `balance`/`previousBalance`/`currentTotal` negativo; ningún mes COMPLETE con `amountPaid == 0 && balanceForgiven == 0`; ninguna deuda OPEN con total $0.

---

# PARTE 7 — RESUMEN FINAL Y PRIORIZACIÓN

## Conteo

- **Críticos: 7** · **Altos: 29** · **Medios: 35** · **Bajos: 21** — Total: **92**

## Orden de corrección recomendado

**Bloque 1 — detiene pérdida de dinero activa (esta semana): ✅ COMPLETO (2026-07-11)**
1. ✅ C-04 + C-03: transaccionar `payDebt` y `registerPayment` reutilizando el advisory lock por contrato que ya existe (mayor riesgo, menor esfuerzo).
2. ✅ C-05: dejar de tragar el error de `cancelDebtPayment` en `deleteTransaction`.
3. ✅ C-02: punitorios impagos deben mantener el mes PARTIAL (o exigir condonación explícita).
4. ✅ C-01: arrastrar el excedente de crédito cuando supera el total del mes. (Corregido en `_recalculateCore`; el mismo bug en la CREACIÓN de un mes nuevo se detectó al auditar el fix y se corrigió también, ver detalle en el hallazgo.)
5. ✅ C-07: deshabilitar o blindar el endpoint legacy `/payments`.
6. ✅ C-06: transferir (o alertar) el saldo a favor en la renovación.

**Bloque 2 — corrige cobros incorrectos sistemáticos: ✅ COMPLETO (2026-07-11)**
7. ✅ A-01, ✅ A-02 (punitorios de deudas con pagos parciales / crédito — corregidos con confirmación explícita del usuario tras evidencia), ✅ A-03 + A-04 (unificados en `computePunitoryBase`, una sola función), ✅ A-05 (tasa del Group + default de schema), ✅ A-25 (hoy financiero del servidor). A-25 se había diferido deliberadamente el 2026-07-11 por el riesgo de B-06 (romper el matching histórico de pagos por fecha+monto si se migraba TZ+datos sin plan). Un análisis de migración posterior concluyó que el sobre-cobro se podía eliminar **sin** fijar TZ global ni migrar datos históricos: el helper `getTodayLocalString()` da el día ART correcto como string, que el motor de punitorios ya parsea de forma TZ-inmune. Se implementó ese fix mínimo (mismo día 2026-07-11); B-06 y la migración completa de convenciones de fecha siguen diferidos a Bloque 5.

**Bloque 3 — integridad de datos e historial: ✅ COMPLETO (2026-07-12)**
8. ✅ A-06/A-07/A-26 (GET quirúrgicamente read-only: deja de borrar/renumerar y de mutar meses COMPLETE; el repair queda solo en el endpoint explícito de edición de contrato), ✅ A-09/A-10 (guardas sobre meses pagados/rescindidos, vía `isMonthLocked` e `isContractInRangeForMonth` respectivamente), ✅ A-12/A-13 (protección del historial de contratos: bloqueo de borrado con cualquier historial financiero, liberación de la propiedad al rescindir sin ocultar el historial), ✅ A-14 (recálculo inline en `forgiveDebt` + sweep al boot), ✅ A-15 (contador monotónico `ReceiptSequence` + `@@unique`), ✅ A-16 (cascada de `_recalculateCore`/`_markRecordsDirty` ahora cruza el año, usando `monthNumber` en vez de `periodYear`). Cada uno con confirmación explícita del usuario en las decisiones de negocio ambiguas y batería de tests dedicada (ver detalle en cada hallazgo).

**Bloque 4 — documentos y frontend:**
9. A-17 a A-23 (reportes consumiendo la fuente única), A-27/A-28/A-29, luego los Medios en orden de tabla. **✅ M-26 ya corregido** (2026-07-11, adelantado fuera de orden — ver ESTADO DE IMPLEMENTACIÓN y el hallazgo). **✅ A-28 corregido** (2026-07-13, modales de pago). **✅ A-19 y A-32 (nuevo) corregidos** (2026-07-13, recibo global y recibo de deuda — ver detalle en cada hallazgo). Quedan sin tocar: A-17, A-18, A-20, A-21, A-22, A-23, A-27, A-29 y los Medios/Bajos restantes.

**Bloque 5 — endurecimiento:**
10. Migración a `Decimal`/centavos con tolerancia única (A-24), validadores Zod de pagos/contratos (B-05, B-16), unificación de convención de fechas (B-06) — cada uno con su plan de migración de datos históricos.

## Módulos más riesgosos (mayor desconfianza sobre la integridad financiera)

1. **Recálculo mensual (`monthlyRecordService`)** — es el corazón del sistema y tiene **tres fórmulas para el mismo número** (`totalDue`), dos reglas de status, mutaciones desde GETs, asincronía tratada como sincronía y un límite de año calendario. Casi todos los críticos pasan por acá o dependen de él. Cualquier fix en otro módulo puede ser deshecho por el camino de recálculo "equivocado".
2. **Pagos y deudas (`paymentTransactionService` + `debtService`)** — los dos endpoints que mueven dinero real no son atómicos ni idempotentes, y la relación entre los dos libros (MonthlyRecord ↔ Debt) es heurística (match por fecha+monto, sin FK). Es donde un incidente de concurrencia o un crash de deploy produce pérdida directa.
3. **Reportes y comprobantes (`reportDataService` + templates)** — reimplementan la lógica con fórmulas propias en vez de consumir la fuente de verdad: liquidaciones, recibos y cartas documento pueden diferir entre sí y contra la base **hoy**, sin necesidad de ningún bug nuevo. Son además los documentos con valor legal frente a inquilinos y propietarios.
4. **Ajustes y edición de contratos** — el historial "sagrado" está protegido hacia atrás pero no contra operaciones sobre el propio mes objetivo (retroactivos, undo compuesto, edición sin transacción). Su interacción con el refresh de GETs es el mecanismo por el que un error chico se propaga a meses cerrados.

**Conclusión del auditor:** el sistema tiene las reglas de negocio correctas escritas en al menos un lugar de cada módulo (las correcciones de la auditoría 2026-07-02 son reales), pero **no tiene una única fuente de verdad para casi ningún número financiero**: totalDue, base de punitorios, punitorio vivo de deuda, "último pago", estado del mes y "cuánto debe" tienen entre 2 y 4 implementaciones cada uno, y cuál gana depende del orden en que se visitan las pantallas. Hasta unificar esas fórmulas y transaccionar los dos endpoints de dinero, cualquier número individual del sistema es correcto *solo por coincidencia de caminos*. No se recomienda producción sin, como mínimo, el Bloque 1 completo y los tests de las secciones 6.3, 6.4 y 6.6.
