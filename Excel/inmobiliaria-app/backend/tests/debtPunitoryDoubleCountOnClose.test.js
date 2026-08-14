const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// BUG (2026-08-14, caso Brunello Ana Carolina — Julio 2026, Av Colon Ph73-74-75)
//
// INVARIANTE del motor de deudas: `debt.accumulatedPunitory` es el punitorio bruto
// devengado HASTA EL ANCLA (`lastPaymentDate ?? punitoryStartDate`), y
// `calculateDebtPunitory` suma el tramo vivo DESDE el ancla hasta la fecha de pago.
// `payDebt` lo respeta (guarda `grossPunitoryToDate` y mueve `lastPaymentDate`).
//
// `createDebtFromMonthlyRecord` lo rompía: ponía el ancla en la fecha del pago parcial
// pre-cierre (23/07) pero metía en `accumulatedPunitory` el congelado MÁS un catch-up
// desde esa misma fecha hasta el día del cierre (31/07). El tramo 23→31 de julio se
// cobraba dos veces — y encima compuesto, porque el `accumulatedPunitory` impago entra
// al `compoundBase` del tramo vivo.
//
// Datos reales de producción (alquiler $181.024, servicios $425.080, IVA $38.015,04,
// pago parcial de $198.669 el 23/07 imputado 100% a EXPENSAS, punitorio congelado
// $19.550,59 = 181.024 × 0,6% × 18d del 6 al 23 de julio):
//
//   ANTES (lo que reportó el usuario, al 14/08):
//     accumulatedPunitory = 19.550,59 + 24.054,30 (445.450,04 × 0,6% × 9d, 23→31 jul)
//                         = 43.604,89
//     compoundBase        = 445.450,04 + 43.604,89 = 489.054,93
//     Actuales (23d)      = 67.489,58   →  Total 111.094,47
//
//   DESPUÉS (regla del usuario: "después de ese pago, desde el 23 hasta el próximo
//   pago, ambas fechas inclusive"):
//     accumulatedPunitory = 19.550,59
//     compoundBase        = 445.450,04 + 19.550,59 = 465.000,63  (= balance del mes)
//     Actuales (23d)      = 64.170,09   →  Total 83.720,68
// ============================================================================

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

function buildService(prisma, capturedCalls) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
      calculatePunitoryV2: (...args) => {
        // args: (paymentDate, periodMonth, periodYear, base, startDay, graceDay, pct,
        //        holidays, lastPaymentDate)
        capturedCalls.push({ base: args[3], lastPaymentDate: args[8] });
        return realPunitory.calculatePunitoryV2(...args);
      },
    },
  });
}

test('cerrar un mes con pago parcial NO duplica el tramo pago→cierre (caso Brunello julio 2026)', async () => {
  const prisma = makeFakePrisma();
  const calls = [];
  const debtService = buildService(prisma, calls);

  const record = buildRecord();
  await prisma.monthlyRecord.create({ data: { ...record } });
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);

  assert.deepStrictEqual(calls, [], 'el cierre no debe devengar catch-up cuando el ancla es la fecha del pago');
  assert.strictEqual(debt.accumulatedPunitory, 19550.59, 'antes del fix quedaba en 43.604,89 (congelado + tramo 23→31 jul duplicado)');
  assert.strictEqual(debt.punitoryStartDate.getTime(), new Date(2026, 6, 23, 12, 0, 0).getTime());
  assert.strictEqual(debt.unpaidRentAmount, 181024);
  assert.strictEqual(debt.unpaidServicesAmount, 264426.04);
  assert.strictEqual(debt.currentTotal, 465000.63, 'coincide exactamente con el balance del MonthlyRecord');
  assert.strictEqual(debt.originalAmount, 663669.63, 'coincide con el totalDue del mes');

  // Tramo vivo: 23/07 → 14/08, ambas fechas inclusive = 23 días.
  const live = await debtService.calculateDebtPunitory(debt, '2026-08-14', null, true);

  assert.deepStrictEqual(
    calls.map((c) => c.base), [465000.63],
    'un único cálculo, base = saldo impago (445.450,04) + punitorio congelado impago (19.550,59); antes era 489.054,93'
  );
  assert.strictEqual(live.days, 23);
  assert.strictEqual(live.unpaidAccumulatedPunitory, 19550.59, 'los "Acumulados" que muestra Control Mensual');
  assert.strictEqual(live.amount, 64170.09, 'los "Actuales (23d)"; antes 67.489,58');
  assert.strictEqual(live.grossPunitoryToDate, 83720.68, 'el "Total"; antes 111.094,47');
});

test('el mes SIN ningún pago sigue devengando el catch-up al cerrar (no regresiona el caso Airaldi)', async () => {
  const prisma = makeFakePrisma();
  const calls = [];
  const debtService = buildService(prisma, calls);

  const record = {
    ...buildRecord(),
    id: 'mr-sin-pagos', status: 'PENDING',
    amountPaid: 0, punitoryAmount: 0, punitoryDays: 0, transactions: [],
  };
  await prisma.monthlyRecord.create({ data: { ...record } });
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);

  assert.strictEqual(calls.length, 1, 'sin pagos, el catch-up desde el día 1 sí debe correr');
  assert.strictEqual(calls[0].base, 181024, 'sin ningún pago la base es SOLO el alquiler (LOGICA §4.3)');
  assert.strictEqual(calls[0].lastPaymentDate, null, 'se cuenta desde el día 1 del período');
  assert.strictEqual(
    debt.punitoryStartDate.getTime(), new Date(2026, 6, 1).getTime(),
    'el ancla es el día 1, así que calculateDebtPunitory ignora accumulatedPunitory (hasPayment=false) y no hay duplicación'
  );
  assert.ok(debt.accumulatedPunitory > 0, 'el catch-up devengado se conserva');
});

test('recalcular la deuda por un cambio de servicio no vuelve a inflar el punitorio', async () => {
  const prisma = makeFakePrisma();
  const calls = [];
  const debtService = buildService(prisma, calls);

  const record = buildRecord();
  await prisma.monthlyRecord.create({ data: { ...record } });
  await prisma.contract.create({ data: { ...CONTRACT } });

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  calls.length = 0;

  // Antes del fix esta función repetía el catch-up con el "hoy" del momento de la
  // edición, así que cada toque a un servicio del mes cerrado agrandaba el solapamiento.
  const recalculated = await debtService.recalculateDebtFromMonthlyRecord(debt.id, record.id);

  assert.deepStrictEqual(calls, [], 'el recálculo no debe devengar catch-up con ancla = fecha de pago');
  assert.strictEqual(recalculated.accumulatedPunitory, 19550.59);
  assert.strictEqual(recalculated.punitoryStartDate.getTime(), new Date(2026, 6, 23, 12, 0, 0).getTime());
  assert.strictEqual(recalculated.currentTotal, 465000.63);
});
