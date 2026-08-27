const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// BUG (2026-08-26): un pago de deuda con fecha ANTERIOR al ancla inflaba el punitorio.
//
// `payDebtHandler` no valida `paymentDate` (acepta cualquier fecha del body) y `payDebt`
// escribe `lastPaymentDate = paymentDate`. Si esa fecha es anterior al ancla vigente, el
// ancla se mueve HACIA ATRÁS mientras `accumulatedPunitory` sigue cubriendo hasta la fecha
// vieja: el tramo entre ambas se cobra dos veces (y compuesto).
//
// Fix: `calculateDebtPunitory` clampea el ancla efectiva a `punitoryStartDate` — el tramo
// vivo siempre arranca donde TERMINA `accumulatedPunitory`.
//
// En producción ya existe una deuda con esta forma: Etica S.A, Mayo 2026 (pago 09/05 con
// ancla 14/05). No hizo daño sólo porque terminó saldada.
// ============================================================================

const CONTRACT = {
  id: 'c-brunello', groupId: 'g1',
  punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006,
};

const buildRecord = () => ({
  id: 'mr-jul', periodMonth: 7, periodYear: 2026,
  status: 'PARTIAL', punitoryForgiven: false, includeIva: true,
  rentAmount: 181024, servicesTotal: 425080, ivaAmount: 38015.04,
  amountPaid: 198669, previousBalance: 0,
  punitoryAmount: 19550.59, punitoryDays: 18,
  transactions: [{
    paymentDate: new Date(2026, 6, 23, 12, 0, 0), amount: 198669,
    punitoryForgiven: false, concepts: [{ type: 'EXPENSAS', amount: 198669 }],
  }],
});

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './monthlyRecordService': { recalculateMonthlyRecord: async () => {}, recalculateMultipleRecords: async () => {} },
  });
}

async function seed(prisma, record) {
  await prisma.monthlyRecord.create({ data: { ...record } });
  for (const [i, t] of (record.transactions || []).entries()) {
    await prisma.paymentTransaction.create({
      data: { id: `ptx-${i}`, monthlyRecordId: record.id, amount: t.amount, paymentDate: t.paymentDate },
    });
  }
  await prisma.contract.create({ data: { ...CONTRACT } });
}

test('un pago de deuda fechado ANTES del ancla no re-devenga el tramo ya acumulado', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  const record = buildRecord();
  await seed(prisma, record);

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  assert.strictEqual(debt.punitoryStartDate.getTime(), new Date(2026, 6, 23, 12, 0, 0).getTime());

  const antes = await debtService.calculateDebtPunitory(debt, '2026-08-26', null, true);
  assert.strictEqual(antes.grossPunitoryToDate, 117200.72);
  assert.strictEqual(antes.days, 35, '23/07 → 26/08, ambas inclusive');

  // Pago simbólico de $1 fechado el 10/07: ANTES del ancla (23/07).
  await debtService.payDebt(debt.id, 1, '2026-07-10', 'EFECTIVO', 'retroactivo');
  const conPago = await prisma.debt.findUnique({ where: { id: debt.id } });
  assert.strictEqual(conPago.accumulatedPunitory, 19550.59, 'el acumulado no cambia: el pago no devengó nada nuevo');

  const despues = await debtService.calculateDebtPunitory({ ...conPago, payments: [] }, '2026-08-26', null, true);

  assert.strictEqual(despues.days, 35, 'sigue contando desde el ancla (23/07); antes del fix contaba 48 días desde el 10/07');
  assert.strictEqual(
    despues.grossPunitoryToDate, 117200.51,
    'el pago de $1 sólo baja la base en $1 (−$0,21 en 35 días); antes del fix saltaba a 153.470,48'
  );
  assert.ok(
    despues.grossPunitoryToDate < antes.grossPunitoryToDate,
    'pagar nunca puede AUMENTAR el punitorio devengado'
  );
});

test('un pago con fecha posterior al ancla sigue moviendo el ancla normalmente', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  const record = buildRecord();
  await seed(prisma, record);

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  await debtService.payDebt(debt.id, 100000, '2026-08-05', 'EFECTIVO');
  const conPago = await prisma.debt.findUnique({ where: { id: debt.id } });

  assert.strictEqual(
    new Date(conPago.lastPaymentDate).getTime(), new Date(2026, 7, 5).getTime(),
    'el clamp no debe frenar el caso normal: el ancla avanza al 05/08'
  );
  const live = await debtService.calculateDebtPunitory({ ...conPago, payments: [] }, '2026-08-26', null, true);
  assert.strictEqual(live.days, 22, '05/08 → 26/08, ambas inclusive');
});
