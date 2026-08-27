const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const realDateUtils = require('../src/utils/dateUtils');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// BUG (2026-08-26, caso Brunello Ana Carolina — Julio 2026, Av Colon Ph73-74-75)
//
// Mismo INVARIANTE que `debtPunitoryDoubleCountOnClose.test.js`:
// `debt.accumulatedPunitory` es el punitorio devengado HASTA EL ANCLA
// (`lastPaymentDate ?? punitoryStartDate`); `calculateDebtPunitory` suma el tramo
// vivo DESDE el ancla. Guardar ahí algo devengado DESPUÉS del ancla lo cobra dos
// veces, y encima compuesto (el acumulado impago entra al `compoundBase`).
//
// `deac61a` arregló el patrón en `createDebtFromMonthlyRecord` y
// `recalculateDebtFromMonthlyRecord`, pero NO en `cancelDebtPayment` — la tercera
// función hermana con el mismo código (introducido en `cc55b3e` para reemplazar el
// viejo `newAccumulatedPunitory = 0`, que borraba plata real adeudada).
//
// Al anular el ÚNICO pago de una deuda nacida de un mes con pago parcial, escribía
// en `accumulatedPunitory` el tramo ancla→HOY y dejaba el ancla donde estaba.
//
// Datos reales de producción (deuda 1269c683, leída el 2026-08-26):
//   alquiler $181.024, servicios $425.080, IVA $38.015,04, pago parcial $198.669 el
//   23/07 imputado 100% a EXPENSAS, punitorio congelado $19.550,59 (= 181.024 × 0,6%
//   × 18d, del 6 al 23 de julio). Se registró y anuló un pago de deuda el 20/08:
//
//   ANTES: accumulatedPunitory = 445.450,04 × 0,6% × 29d (23/07→20/08) = 77.508,31
//          → al 26/08: compoundBase 522.958,35, Total punitorios $187.329,56,
//            deuda $632.779,60  (los 29 días 23/07→20/08 cobrados DOS veces)
//   DESPUÉS: accumulatedPunitory = 19.550,59 (punitorio impago del mes hasta el ancla)
//          → al 26/08: compoundBase 465.000,63, Total punitorios $117.200,72,
//            deuda $562.650,76
// ============================================================================

const HOY_DE_LA_ANULACION = '2026-08-20';

const CONTRACT = {
  id: 'c-brunello', groupId: 'g1',
  punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006,
};

const buildRecord = () => ({
  id: 'mr-brunello-jul', periodMonth: 7, periodYear: 2026,
  status: 'PARTIAL', punitoryForgiven: false, includeIva: true,
  rentAmount: 181024, servicesTotal: 425080, ivaAmount: 38015.04,
  amountPaid: 198669, previousBalance: 0,
  punitoryAmount: 19550.59, punitoryDays: 18,
  transactions: [{
    paymentDate: new Date(2026, 6, 23, 12, 0, 0), amount: 198669,
    punitoryForgiven: false, concepts: [{ type: 'EXPENSAS', amount: 198669 }],
  }],
});

/**
 * Siembra el MonthlyRecord y, además, sus PaymentTransaction como FILAS de la tabla
 * (el fake no resuelve relaciones: el service lee `record.transactions` embebido, pero
 * `cancelDebtPayment` consulta la tabla `paymentTransaction` para saber qué pagos
 * quedan tras la anulación — en producción son la misma cosa).
 */
async function seedRecord(prisma, record) {
  await prisma.monthlyRecord.create({ data: { ...record } });
  for (const [i, t] of (record.transactions || []).entries()) {
    await prisma.paymentTransaction.create({
      data: { id: `ptx-mes-${i}`, monthlyRecordId: record.id, amount: t.amount, paymentDate: t.paymentDate },
    });
  }
}

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    // "Hoy" fijo: el día en que se anuló el pago en producción.
    '../utils/dateUtils': { ...realDateUtils, getTodayLocalString: () => HOY_DE_LA_ANULACION },
    // El recálculo del MonthlyRecord es otro subsistema; acá sólo interesa la Deuda.
    './monthlyRecordService': { recalculateMonthlyRecord: async () => {}, recalculateMultipleRecords: async () => {} },
  });
}

/**
 * Deja la Deuda en el estado exacto en el que la dejaría `payDebt`: `accumulatedPunitory`
 * = `grossPunitoryToDate` a la fecha del pago y el ancla movida a esa fecha.
 */
async function simulatePayDebt(debtService, prisma, debt, { paymentDate, amount }) {
  const live = await debtService.calculateDebtPunitory(debt, paymentDate, null, true);
  const grossPunitoryToDate = live.grossPunitoryToDate;
  await prisma.debtPayment.create({
    data: { id: 'dp-1', debtId: debt.id, amount, paymentDate: new Date(`${paymentDate}T12:00:00`), punitoryAtPayment: grossPunitoryToDate },
  });
  await prisma.paymentTransaction.create({
    data: { id: 'ptx-deuda', monthlyRecordId: debt.monthlyRecordId, amount, paymentDate: new Date(`${paymentDate}T12:00:00`) },
  });
  const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
  return prisma.debt.update({
    where: { id: debt.id },
    data: {
      amountPaid: amount,
      accumulatedPunitory: grossPunitoryToDate,
      lastPaymentDate: new Date(`${paymentDate}T12:00:00`),
      status: 'PARTIAL',
      payments, // el fake no resuelve `include`: la relación va embebida en la fila
    },
  });
}

test('anular el único pago de una deuda con ancla = pago parcial NO duplica el tramo (caso Brunello julio 2026)', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);

  const record = buildRecord();
  await seedRecord(prisma, record);
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  assert.strictEqual(debt.accumulatedPunitory, 19550.59, 'precondición: el cierre ya respeta el invariante');
  assert.strictEqual(debt.punitoryStartDate.getTime(), new Date(2026, 6, 23, 12, 0, 0).getTime());

  await simulatePayDebt(debtService, prisma, debt, { paymentDate: HOY_DE_LA_ANULACION, amount: 50000 });

  const { debt: cancelled } = await debtService.cancelDebtPayment(debt.id, 'dp-1');

  assert.strictEqual(cancelled.amountPaid, 0, 'el pago se revierte por completo');
  assert.strictEqual(cancelled.lastPaymentDate, null, 'el ancla vuelve a ser punitoryStartDate (23/07)');
  assert.strictEqual(
    cancelled.punitoryStartDate.getTime(), new Date(2026, 6, 23, 12, 0, 0).getTime(),
    'anular un pago no mueve el ancla'
  );
  assert.strictEqual(
    cancelled.accumulatedPunitory, 19550.59,
    'punitorio devengado HASTA el ancla; antes del fix quedaba en 77.508,31 (tramo 23/07→20/08, o sea DESPUÉS del ancla)'
  );
  assert.strictEqual(cancelled.currentTotal, 465000.63, 'vuelve al total con el que nació la deuda');

  // Tramo vivo: 23/07 → 26/08, ambas fechas inclusive = 35 días.
  const live = await debtService.calculateDebtPunitory(cancelled, '2026-08-26', null, true);
  assert.strictEqual(live.days, 35);
  assert.strictEqual(live.unpaidAccumulatedPunitory, 19550.59, 'los "Acumulados" de Control Mensual; antes 77.508,31');
  assert.strictEqual(live.amount, 97650.13, 'los "Actuales (35d)" sobre compoundBase 465.000,63; antes 109.821,25');
  assert.strictEqual(live.grossPunitoryToDate, 117200.72, 'el "Total"; antes 187.329,56');
  assert.strictEqual(
    round2(live.remainingDebt + live.unpaidAccumulatedPunitory + live.amount), 562650.76,
    'deuda total en vivo; antes 632.779,60 ($70.128,84 de más)'
  );
});

test('anular el único pago de una deuda SIN pago parcial pre-cierre conserva el catch-up (no regresiona el caso Airaldi)', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);

  const record = {
    ...buildRecord(),
    id: 'mr-sin-pagos', status: 'PENDING',
    amountPaid: 0, punitoryAmount: 0, punitoryDays: 0, transactions: [],
  };
  await seedRecord(prisma, record);
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  assert.strictEqual(
    debt.punitoryStartDate.getTime(), new Date(2026, 6, 1).getTime(),
    'sin pagos el ancla es el día 1 del período'
  );

  await simulatePayDebt(debtService, prisma, debt, { paymentDate: HOY_DE_LA_ANULACION, amount: 50000 });
  const { debt: cancelled } = await debtService.cancelDebtPayment(debt.id, 'dp-1');

  // Con ancla = día 1, `hasPayment` es false y `calculateDebtPunitory` recalcula todo
  // desde el día 1 ignorando `accumulatedPunitory`: no hay duplicación posible, y el
  // campo persistido NO puede quedar en 0 porque `_recalculateCore` lo lee tal cual
  // para el "Total" de Control Mensual (bug 2026-07-16).
  assert.ok(cancelled.accumulatedPunitory > 0, 'el catch-up desde el día 1 se conserva');
  assert.strictEqual(cancelled.accumulatedPunitory, round2(181024 * 0.006 * 51), '1/07 → 20/08 = 51 días sobre el alquiler');
});

test('ancla guardada como medianoche UTC del día 1 sigue conservando el catch-up (no se zeroa)', async () => {
  // Deudas viejas de producción guardan `punitoryStartDate` como 2026-07-01T00:00:00Z, que
  // en ART es el 30/06 21:00 y NO matchea `new Date(2026, 6, 1)`. Con el guard basado en esa
  // comparación de timestamps, un mes SIN pagos caía en la rama de "ancla = pago" y se le
  // escribía $0 — el bug de 2026-07-16 (plata real adeudada que desaparecía del Total).
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);

  const record = {
    ...buildRecord(),
    id: 'mr-ancla-utc', status: 'PENDING',
    amountPaid: 0, punitoryAmount: 0, punitoryDays: 0, transactions: [],
  };
  await seedRecord(prisma, record);
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  // Simula el dato legacy: ancla en medianoche UTC del día 1.
  await prisma.debt.update({
    where: { id: debt.id },
    data: { punitoryStartDate: new Date('2026-07-01T00:00:00.000Z') },
  });
  const debtUtc = await prisma.debt.findUnique({ where: { id: debt.id } });

  await simulatePayDebt(debtService, prisma, debtUtc, { paymentDate: HOY_DE_LA_ANULACION, amount: 50000 });
  const { debt: cancelled } = await debtService.cancelDebtPayment(debt.id, 'dp-1');

  assert.ok(
    cancelled.accumulatedPunitory > 0,
    'el mes no tuvo pagos propios: el catch-up desde el día 1 se conserva, no se escribe 0'
  );
});

test('anular el 3er pago restaura el punitorio BRUTO, no el adeudado (no se pierde lo ya cobrado)', async () => {
  // `DebtPayment.punitoryAtPayment` guarda el punitorio ADEUDADO al momento del pago
  // (`totalPunitoryOwed`), mientras que `debt.accumulatedPunitory` guarda el BRUTO
  // (`grossPunitoryToDate`). Coinciden hasta que un pago empieza a imputar plata a
  // punitorios; desde ahí difieren en lo ya cobrado. Restaurar el adeudado dejaba la deuda
  // por DEBAJO de lo real (mismo patrón que el caso Ponce).
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  const record = buildRecord();
  await seedRecord(prisma, record);
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  // El 1er pago ($470.000) supera la base ($445.450,04): a partir de ahí hay plata
  // imputada a punitorios y bruto ≠ adeudado.
  await debtService.payDebt(debt.id, 470000, '2026-08-05', 'EFECTIVO');
  await debtService.payDebt(debt.id, 10000, '2026-08-10', 'EFECTIVO');
  const trasPago2 = await prisma.debt.findUnique({ where: { id: debt.id } });
  const brutoTrasPago2 = trasPago2.accumulatedPunitory;

  await debtService.payDebt(debt.id, 10000, '2026-08-15', 'EFECTIVO');
  const pays = await prisma.debtPayment.findMany({ where: { debtId: debt.id }, orderBy: { createdAt: 'asc' } });
  assert.strictEqual(pays.length, 3);
  assert.notStrictEqual(
    round2(pays[1].punitoryAtPayment), round2(brutoTrasPago2),
    'precondición: en este escenario el adeudado y el bruto YA difieren'
  );
  await prisma.debt.update({ where: { id: debt.id }, data: { payments: pays } });

  const { debt: cancelled } = await debtService.cancelDebtPayment(debt.id, pays[2].id);

  assert.strictEqual(
    round2(cancelled.accumulatedPunitory), round2(brutoTrasPago2),
    'vuelve exactamente al bruto que tenía tras el 2do pago; antes del fix restauraba el adeudado y perdía lo ya cobrado'
  );
  assert.strictEqual(
    new Date(cancelled.lastPaymentDate).getTime(), new Date(pays[1].paymentDate).getTime(),
    'el ancla vuelve a la fecha del 2do pago'
  );
});

const { round2 } = realPunitory;
