# LÓGICA DEL SISTEMA — Referencia completa

> Este documento describe **cómo funciona hoy** la lógica de negocio (alquileres, ajustes,
> punitorios, pagos, deudas, cierres). Sirve para que puedas revisar cada regla y marcar
> dónde está equivocada. Al final hay una sección de **preguntas abiertas** que necesitan
> tu confirmación.
>
> Última actualización: 2026-07-02 (auditoría completa + correcciones).

---

## 1. El alquiler de cada mes: `RentHistory`

El alquiler de un mes **NO** sale de `contract.baseRent`. Sale del **historial de alquileres**
(`RentHistory`), que tiene filas `(mes desde el que rige, monto, motivo)`:

| Motivo | Quién la crea |
|---|---|
| `INICIAL` | Al crear un contrato (con el alquiler original) |
| `RENOVACION` | Al renovar (alquiler nuevo, rige desde el mes 1 del contrato nuevo) |
| `AJUSTE_AUTOMATICO` | Al aplicar un índice de ajuste |
| `AJUSTE_MANUAL` | Al editar el monto del alquiler en el contrato |

**Regla:** el alquiler del mes N es el de la fila con `effectiveFromMonth <= N` más reciente.
`contract.baseRent` es solo un espejo del valor vigente HOY (muta con cada ajuste).

### Qué estaba mal (caso Rezzonico) — CORREGIDO
- Si un contrato no tenía ninguna fila que cubriera los meses viejos (renovaciones viejas
  sin fila inicial, o ediciones que renumeraron los meses y dejaron el historial huérfano),
  el sistema caía en `baseRent` **actual** para los meses pasados. Al aplicar un ajuste,
  `baseRent` cambia → **los meses pasados se reescribían con el alquiler nuevo**.
- **Fix 1:** si hay historial pero ninguno cubre el mes, se usa la fila **más antigua**
  (el alquiler más viejo conocido), nunca `baseRent`.
- **Fix 2:** al aplicar cualquier ajuste, si el contrato no tiene historial previo se crea
  automáticamente la fila `INICIAL` con el alquiler viejo.
- **Fix 3:** al editar un contrato (fecha/duración/mes actual), el historial se **renumera**
  junto con los meses (antes quedaba huérfano).
- **Fix 4:** si dos filas rigen desde el mismo mes, gana la **más nueva** (antes era azar).

---

## 2. Registros mensuales (`MonthlyRecord`)

- Al abrir un mes en el Control Mensual, el sistema **crea** los registros que falten para
  los contratos vigentes en ese período y **refresca** los existentes:
  - `rentAmount` se refresca desde el historial (para TODOS los registros del período,
    incluso pagados — así una corrección de historial se propaga).
  - `previousBalance` (saldo a favor del mes anterior) se refresca solo si el mes no está
    COMPLETO. **Ojo:** eso vale para el refresh del GET (`getOrCreateMonthlyRecords`). El
    recálculo en cascada (`_recalculateCore`) NO tiene ese guard: reescribe el
    `previousBalance` de todos los meses posteriores del contrato, incluidos los COMPLETOS.
  - Contratos **renovados/inactivos** quedan **congelados**: sus meses históricos no se recalculan.
- `totalDue = alquiler + servicios + punitorios BRUTOS + IVA − saldo a favor anterior`.
  **Punitorios BRUTOS = los ya cobrados + los que siguen adeudados** (helper único
  `computeGrossRecordPunitory`). Tiene que ser el bruto porque `balance = amountPaid − totalDue`
  y `amountPaid` es toda la plata que entró, incluida la imputada al concepto PUNITORIOS.
  Contar sólo los punitorios adeudados (como se hacía hasta el 2026-08-26) los cobraba dos
  veces a favor del inquilino: `balance = 2 × cobrado − total + crédito`. Ver §6.
- Un mes cuyos cargos quedan cubiertos ENTEROS por el saldo a favor arrastrado pasa a
  COMPLETO aunque no haya entrado un peso nuevo (`amountPaid = 0`). Antes quedaba PENDING
  para siempre y el cierre lo levantaba todos los meses.
- El **recálculo en cascada**: cualquier cambio (pago, servicio) recalcula ese mes y todos
  los posteriores **del mismo año calendario**, arrastrando el saldo a favor.
  - **CORREGIDO:** solo se arrastra saldo **a favor** (positivo). Antes, un recálculo podía
    arrastrar saldo negativo (deuda) al mes siguiente y **duplicar** la deuda (una vez como
    `previousBalance` negativo y otra como entidad `Debt`).
- La carga masiva de servicios que crea un mes faltante ahora usa el **alquiler histórico**
  del mes (antes usaba `baseRent` actual → mismo bug de Rezzonico).

---

## 3. Ajustes de alquiler (índices)

### Cuándo ajusta un contrato
- Los ajustes caen en los meses `inicio + frecuencia`, `inicio + 2×frecuencia`, … (nunca en
  el mes 1). Ej.: contrato de 24 meses, trimestral → ajusta en los meses 4, 7, 10, …
- La pantalla de Ajustes muestra, para un mes calendario, los contratos cuyo mes de contrato
  cae en un mes de ajuste según su frecuencia.

### Aplicar un ajuste
- **Solo afecta del mes objetivo en adelante**: crea la fila `AJUSTE_AUTOMATICO`
  con `effectiveFromMonth = mes objetivo` y actualiza `baseRent`. Los meses anteriores
  conservan su alquiler histórico (garantizado por los fixes de la sección 1).
- El nuevo alquiler se calcula sobre el vigente **según historial** (no `baseRent` directo)
  y se redondea a pesos.
- **No duplica**: si ese contrato ya tiene un ajuste automático para ese mes, se saltea
  (ahora en TODOS los endpoints; antes dos de ellos no lo verificaban y aplicaban dos veces).
- **NUEVO — aplicar por propiedad:** en la tabla "Propiedades que se Actualizan" cada fila
  tiene su botón **Aplicar** / **Deshacer** que afecta SOLO a ese contrato. El botón masivo
  del índice ahora aplica **únicamente a las pendientes** (las ya aplicadas no se tocan).
- OJO: un `AJUSTE_MANUAL` (editar el alquiler en el contrato) **no** cuenta como "ajuste
  aplicado" del índice. Si actualizaste a mano y después aplicás el índice, se aplica el %
  **sobre el valor manual**. Usá el botón por propiedad para controlar esto.

### Deshacer un ajuste
- Borra la fila `AJUSTE_AUTOMATICO` de ese mes y restaura el alquiler anterior (el del
  historial previo). **CORREGIDO:** si no había historial previo, antes "restauraba" al
  `baseRent` ya ajustado (no revertía nada); ahora deriva el valor anterior desde el % del
  ajuste que se deshace.

### Meses futuros ya creados
- Si un mes futuro ya existía (creado antes del ajuste), queda con el alquiler viejo hasta
  que lo abras en el Control Mensual: ahí se refresca solo con el valor correcto del historial.

---

## 4. Punitorios — todos los casos

Parámetros por contrato: `punitoryStartDay` (default 10), `punitoryGraceDay`, `punitoryPercent`
(default 0,6% diario). La gracia se corre al siguiente día hábil (fines de semana y feriados).

### Mes abierto (todavía no cerrado como deuda)
1. **Paga hasta el día de gracia (hábil):** $0 punitorios.
2. **Paga después de la gracia, sin pagos previos:** días desde `punitoryStartDay` hasta la
   fecha de pago, ambos inclusive. `punitorio = base × % × días`.
3. **Base del cálculo:**
   - Sin ningún pago real: solo el **alquiler** (los servicios no generan punitorios en mes abierto).
   - Con pagos parciales: el **saldo restante** (alquiler + servicios + IVA − pagos reales).
   - El **saldo a favor del mes anterior** entra como plata cobrada y **sí reduce la base**:
     si el crédito arrastrado cubre el alquiler, no se devengan punitorios (regla confirmada
     por el usuario el 2026-08-26). No activa la base ampliada (los servicios impagos siguen
     sin generar mora si no hubo un pago real). El crédito se descuenta además del total al
     final, pero eso no lo cuenta dos veces: la base y el total son cosas distintas.
   - Las bonificaciones/descuentos no reducen la base mientras el neto no esté cubierto.
4. **Pagos múltiples (REGLA CONFIRMADA):** cada pago congela los punitorios cobrados hasta
   ahí; el siguiente tramo cuenta desde la **fecha del último pago hasta hoy, ambas fechas
   inclusive**, sobre el saldo restante.
5. **Mes pasado sin cerrar, sin pagos previos (REGLA CONFIRMADA):** cuenta desde el
   **día 1** del mes del período hasta la fecha de pago, ambos inclusive, sobre el alquiler.

### Mes cerrado (deuda)
- Al **cerrar el mes**, los impagos generan una `Debt` con: alquiler impago, servicios+IVA
  impagos y punitorios acumulados hasta el cierre (imputación de lo pagado:
  servicios → IVA → alquiler → punitorios).
- **Base de punitorios de la deuda:**
  - Nunca hubo pago (ni del mes ni de la deuda): solo sobre el **alquiler impago**.
  - Hubo algún pago: sobre el **saldo restante total** + punitorios impagos
    (**interés compuesto**, regla que confirmaste).
- Los punitorios de la deuda arrancan desde el último pago del mes (o día 1 si no hubo).
- **Pagar deuda:** imputación servicios → alquiler → punitorios; el saldo a favor aplicado
  (`appliedCredit`) cubre esos conceptos ANTES que el efectivo. El excedente queda como
  SOBREPAGO (a favor del mes siguiente).
- Solo se puede pagar el período impago **más antiguo** primero (bloqueo cronológico).
- Condonar punitorios (`forgivePunitorios`) los deja en 0 para ese pago.

### Qué se muestra en el Control Mensual
- Mes COMPLETO: los punitorios mostrados son la **suma real** de los conceptos PUNITORIOS
  de todas las transacciones (no el congelado del último pago).
- Mes con deuda viva: punitorios impagos viejos + nuevos en vivo (sin duplicar).

---

## 5. Pagos e imputación de conceptos

Orden de imputación de cada pago: **servicios → alquiler → IVA → punitorios → sobrepago**.
Los créditos previos (saldo a favor + pagos anteriores) cubren primero esos conceptos en el
mismo orden; el pago nuevo cubre lo que reste.

- **CORREGIDO:** el IVA no existía como concepto. En contratos con IVA, el 21% del pago
  quedaba etiquetado como `SOBREPAGO — "Pago en exceso (a favor próximo mes)"` en los
  recibos, aunque el número final era correcto. Eso hacía parecer que el inquilino tenía
  saldo a favor todos los meses. Ahora sale la línea `IVA 21% sobre alquiler`.
- `SOBREPAGO` real (pago mayor al total adeudado) SÍ pasa como saldo a favor al mes
  siguiente (`previousBalance`), y aparece como línea `A_FAVOR` negativa en el pago siguiente.

### El caso Valenzuela (saldo a favor "fantasma") — es DATA, no bug de código
En marzo 2026 se cargó a mano un servicio **"Saldo a favor" (bonificación) de $9.667** y
40 segundos después se registró el pago por el alquiler completo ($511.511). Como el mes
debía $501.844 (por la bonificación), quedaron $9.667 a favor. Desde entonces **cada mes se
registra el pago por el alquiler bruto completo**, así que el crédito se aplica pero se
regenera con el sobrepago: la cadena `A_FAVOR −9.667 / SOBREPAGO +9.667` se repite para
siempre. La aritmética es consistente; para eliminar el saldo hay dos opciones:
1. Si la bonificación de marzo fue un error → borrar ese servicio de marzo y recalcular.
2. Si fue real → registrar UN mes con el pago neto ($557.036 en vez de $566.703) y la
   cadena muere ahí.

---

## 6. Cierre mensual y deudas

- `Cerrar mes` **decide por la plata, no por el status**. Antes filtraba por
  `status IN (PENDING, PARTIAL)`, un campo derivado que puede quedar viejo (los recálculos
  por servicios/IVA/condonación corren fire-and-forget). Ahora: primero salda los recálculos
  pendientes (`processDirtyRecords`), después evalúa todos los registros del período y deja
  que el monto decida. Se excluyen sólo por razones estructurales: mes post-vencimiento, mes
  que ya tiene deuda, mes fuera del rango activo del contrato, y saldo condonado a mano
  (`balanceForgiven > 0`).
- Si lo impago neto del crédito es ≤ $1 no crea deuda (tolerancia de redondeo). Un mes
  cancelado da 0 y no genera nada, sin depender del string de status.
- Los punitorios del catch-up del cierre usan la MISMA base que Control Mensual, crédito
  incluido (§4). Antes el cierre los cobraba sobre el alquiler completo aunque el crédito ya
  lo cubriera, y armaba una deuda que la pantalla no mostraba.
- El `balance` del mes y el total de su Deuda son el mismo número con signo opuesto:
  **`record.balance == −(total EN VIVO de la Deuda)`**. Ese es el invariante a chequear si
  alguna vez Control Mensual y Deudas vuelven a discrepar. Ojo con dos cosas al medirlo:
  el `balance` persistido es un *snapshot* (se actualiza recién en el próximo recálculo,
  no todos los días), y `debt.currentTotal` está *congelado* al cierre — hay que comparar
  contra el total en vivo, calculado en el mismo instante.
- La deuda guarda su propio `punitoryStartDate`, `appliedCredit` (saldo a favor aplicado al
  total) y `previousRecordPayment` (lo que se había pagado del mes antes del cierre).
- Cuando la deuda se salda, el `MonthlyRecord` asociado pasa a COMPLETO.
- Borrar una transacción de pago que correspondía a un pago de deuda cancela también ese
  `DebtPayment` (match por fecha+monto) y recalcula.

---

## 7. Editar un contrato

- Cambiar **fecha de inicio / duración / mes actual**:
  - `startMonth` se resetea a 1 y TODOS los `MonthlyRecord` se renumeran al nuevo esquema
    ("meses fantasma" se borran solo si no tienen plata; los que tienen pagos fuera de rango
    se preservan y se avisa).
  - **CORREGIDO:** el historial de alquileres ahora se renumera también (antes quedaba
    huérfano y disparaba el bug de Rezzonico).
  - `nextAdjustmentMonth` se recalcula.
- Cambiar **monto del alquiler**: crea/actualiza una fila `AJUSTE_MANUAL` que rige desde el
  mes actual. **CORREGIDO:** si el contrato no tenía historial que cubriera los meses
  anteriores, se crea la fila `INICIAL` con el alquiler viejo para que el cambio NO afecte
  los meses pasados.
- Cambiar **IVA / punitorios / inquilinos / comprobantes**: afecta de ahí en adelante; el
  refresh del período abierto sincroniza IVA en los registros no congelados.

## 8. Renovación, rescisión y post-vencimiento

- **Renovar**: el contrato viejo queda inactivo (`renewedAt`) y conserva sus meses
  congelados; se crea contrato nuevo desde el mes 1 con su fila `RENOVACION` en el historial.
- **Rescindir**: el mes calendario siguiente a la rescisión es el **mes de penalidad**
  (alquiler = multa, servicios copiados del mes de rescisión, sin IVA).
- **Post-vencimiento**: un contrato vencido (no renovado ni rescindido) muestra UN mes extra
  con alquiler $0 y solo los servicios del último mes (se pagan a mes vencido). Nunca genera
  punitorios ni deuda.

## 9. Carga masiva de servicios

- Asigna el mismo concepto+monto a varios contratos × varios meses (upsert: si ya existía el
  concepto en ese mes, **pisa el monto** y lo avisa como "overwrite").
- Si el mes no existía, lo crea con el **alquiler histórico** correcto (corregido hoy).
- No crea meses fuera del rango del contrato ni después de una rescisión.
- "Propagar hacia adelante" copia el servicio hasta diciembre del mismo año.

---

## 10. Preguntas abiertas (necesito tu confirmación)

> Las reglas de punitorios ya fueron confirmadas (2026-07): sin pagos → sobre el alquiler,
> desde el inicio de punitorios hasta hoy inclusive; con pagos → desde la fecha del último
> pago inclusive sobre el saldo restante; mes con deuda sin pagos → desde el día 1.

> (Diaz Leonardo, Amaya Paola y F y B Manias quedaron descartados: contratos rescindidos,
> el usuario indicó no darles importancia.)

1. **Valenzuela:** ✅ RESUELTO (2026-07-03). El saldo a favor de $9.667 era un error de
   carga: se borró la bonificación de marzo, se corrigieron los recibos y se recalculó.
   Marzo→julio quedaron COMPLETOS en $0, sin arrastre.
2. **Amaya Nelida (Av Colón 375):** marzo 2026 quedó PARTIAL debiendo **$4.801 de
   punitorios**, pero la deuda asociada figura saldada en $0. ¿Esos punitorios se
   perdonaron? Si sí → correr `FIX_AMAYA=1 node scripts/repair-conceptos.js`. Si no →
   avisar, hay que reabrir la deuda.
3. **Etica S.A. (9 de Julio 560), mayo 2026:** el pago del 14/05 etiquetó como PUNITORIOS
   $64.662 que ya estaban pagados con la deuda, y el IVA quedó como "sobrepago". La plata
   está bien; hay que re-etiquetar con `FIX_ETICA=1 node scripts/repair-conceptos.js` para
   que un recálculo futuro no lo haga aparecer debiendo $64.662. (La causa en el código ya
   se corrigió.)
4. **Av. Figueroa Alcorta 482 (Dtos 1, 3, 4 y 5):** los cuatro pagaron exactamente **$560
   de más** en junio 2026. Parece un cargo de $560 que no está cargado como servicio en el
   sistema. ¿Qué es? Si corresponde, cargarlo y los saldos a favor desaparecen.
5. **Gutierrez Juan Rodrigo:** ✅ RESUELTO — el usuario confirmó el pago de $800.000; el
   saldo a favor de $208.441 es correcto. Sin acción.
6. **Biassi (F. Alcorta Dto 5), marzo:** el usuario confirmó que los $35.145 SÍ se
   cobraron pero nunca se cargaron. Fix listo: `FIX_BIASSI=1 node scripts/repair-conceptos.js`
   (registra el pago con fecha 07/05/2026 —día en que se marcó la deuda como pagada— y
   método EFECTIVO; si la fecha/método reales eran otros, avisar antes de correrlo).

## 11. Bugs corregidos en esta auditoría (2026-07-02)

| # | Bug | Efecto | Archivo |
|---|---|---|---|
| 1 | Fallback de alquiler histórico a `baseRent` | Ajuste reescribía meses pasados (Rezzonico) | `monthlyRecordService.js` |
| 2 | Ajuste sin fila INICIAL previa | Igual que #1 | `adjustmentService.js` |
| 3 | Editar contrato no renumeraba el historial | Historial huérfano → #1 | `contractsController.js` |
| 4 | Sin dedup en 2 endpoints de aplicar ajuste | Ajuste doble (compuesto) | `adjustmentService.js` |
| 5 | Deshacer ajuste sin historial previo no revertía | Alquiler quedaba ajustado | `adjustmentService.js` |
| 6 | Aplicación de ajuste era todo-o-nada | No se podía confirmar por propiedad | endpoint + UI nuevos |
| 7 | IVA sin concepto en la imputación de pagos | Recibos mostraban IVA como "a favor próximo mes" | `paymentTransactionService.js` |
| 8 | Recalculo en cascada arrastraba saldo negativo | Podía duplicar deuda en meses siguientes | `monthlyRecordService.js` |
| 9 | Carga masiva creaba meses con `baseRent` actual | Meses con alquiler equivocado | `monthlyServiceService.js` |
| 10 | Empate de historial con mismo mes era azaroso | Alquiler impredecible | varios |

> Nota: el conteo de días de punitorios con pagos múltiples (ambas fechas inclusive) se
> revisó y se dejó EXACTAMENTE como estaba — es la regla confirmada, no era un bug.
