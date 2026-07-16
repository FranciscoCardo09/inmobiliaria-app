const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// calculateDebtPunitory recomputes a debt's unpaid amounts from its MonthlyRecord
// when debt.amountPaid === 0. If that MonthlyRecord has a corrupt (stale negative)
// previousBalance, the imputation thinks everything is unpaid and the debt gets
// INFLATED. These tests pin the guard: the auto-recompute may correct a debt
// DOWNWARD but must never inflate it above its stored total.

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      // Stub punitory math: we only care about the recompute/write behavior.
      calculatePunitoryV2: () => ({ amount: 0, days: 0, fromDate: null, toDate: null }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
  });
}

function preloadedFor(mr) {
  return {
    contractMap: new Map([['c1', { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.02 }]]),
    holidayMap: new Map([[2026, []]]),
    monthlyRecordMap: new Map([['mr1', mr]]),
  };
}

test('calculateDebtPunitory - NO infla una deuda saldada cuando el MonthlyRecord tiene previousBalance corrupto (caso Yocsina)', async () => {
  const prisma = makeFakePrisma();
  // Debt was created correctly at month-close: rent+services paid, only $76.92 punitorios.
  const debtRow = await prisma.debt.create({ data: {
    id: 'd1', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr1',
    periodMonth: 4, periodYear: 2026, periodLabel: 'Abril 2026',
    originalAmount: 1004202.92,
    unpaidRentAmount: 0, unpaidServicesAmount: 0, accumulatedPunitory: 76.92,
    currentTotal: 76.92, amountPaid: 0, status: 'OPEN',
    punitoryPercent: 0.02, punitoryStartDate: new Date(2026, 3, 4), lastPaymentDate: null,
  }});

  // The MonthlyRecord carries a corrupt, large-negative previousBalance (inherited
  // from a deleted predecessor month). calculateImputation will read this and think
  // rent + services are fully unpaid.
  const corruptMR = {
    rentAmount: 901388, servicesTotal: 21690, ivaAmount: 0,
    amountPaid: 999000, punitoryAmount: 81048, previousBalance: -1818142,
  };

  const debtService = buildService(prisma);
  await debtService.calculateDebtPunitory(debtRow, new Date(2026, 4, 30), preloadedFor(corruptMR), /* skipUpdate */ false);

  const after = await prisma.debt.findUnique({ where: { id: 'd1' } });
  assert.strictEqual(after.unpaidRentAmount, 0, 'unpaidRent NO debe inflarse');
  assert.strictEqual(after.unpaidServicesAmount, 0, 'unpaidServices NO debe inflarse');
  assert.ok(after.currentTotal <= 100, `currentTotal debe quedar ~76.92, quedó ${after.currentTotal}`);
});

test('calculateDebtPunitory - SÍ corrige hacia abajo una deuda sobre-estimada (MonthlyRecord sano que muestra pago)', async () => {
  const prisma = makeFakePrisma();
  // Stored debt overstates what's owed (legacy/corrupt-high): says rent 100000 unpaid.
  const debtRow = await prisma.debt.create({ data: {
    id: 'd2', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr1',
    periodMonth: 4, periodYear: 2026, periodLabel: 'Abril 2026',
    originalAmount: 100000,
    unpaidRentAmount: 100000, unpaidServicesAmount: 0, accumulatedPunitory: 0,
    currentTotal: 100000, amountPaid: 0, status: 'OPEN',
    punitoryPercent: 0.02, punitoryStartDate: new Date(2026, 3, 4), lastPaymentDate: null,
  }});

  // Healthy MR showing the rent was actually fully paid (amountPaid covers rent).
  const healthyMR = {
    rentAmount: 100000, servicesTotal: 0, ivaAmount: 0,
    amountPaid: 100000, punitoryAmount: 0, previousBalance: 0,
  };

  const debtService = buildService(prisma);
  await debtService.calculateDebtPunitory(debtRow, new Date(2026, 4, 30), preloadedFor(healthyMR), false);

  const after = await prisma.debt.findUnique({ where: { id: 'd2' } });
  assert.strictEqual(after.unpaidRentAmount, 0, 'corrección hacia abajo SÍ permitida: rent pagado → 0');
});

test('calculateDebtPunitory - NO borra el punitorio catch-up de una deuda nunca pagada (bug 2026-07-16)', async () => {
  const prisma = makeFakePrisma();
  // Deuda creada correctamente: al cerrar el mes quedó $500.000 de alquiler impago y,
  // como la deuda se creó 44 días después del cierre, createDebtFromMonthlyRecord
  // congeló ese catch-up devengado en accumulatedPunitory.
  const debtRow = await prisma.debt.create({ data: {
    id: 'd3', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr1',
    periodMonth: 5, periodYear: 2026, periodLabel: 'Mayo 2026',
    originalAmount: 632000,
    unpaidRentAmount: 500000, unpaidServicesAmount: 0, accumulatedPunitory: 132000,
    currentTotal: 632000, amountPaid: 0, status: 'OPEN',
    punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 4, 1), lastPaymentDate: null,
  }});

  // MonthlyRecord sano (sin previousBalance corrupto): nunca se pagó nada, así que
  // su punitoryAmount congelado es 0 — calculateImputation NO puede reproducir el
  // catch-up devengado después del cierre, solo lo que el MonthlyRecord ya sabía.
  const healthyUnpaidMR = {
    rentAmount: 500000, servicesTotal: 0, ivaAmount: 0,
    amountPaid: 0, punitoryAmount: 0, previousBalance: 0,
  };

  const debtService = buildService(prisma);
  // skipUpdate=false: exactamente lo que hacen GET /debts/:id y punitory-preview
  // (los que dispara el modal de pago) al abrir esta deuda.
  await debtService.calculateDebtPunitory(debtRow, new Date(2026, 6, 16), preloadedFor(healthyUnpaidMR), false);

  const after = await prisma.debt.findUnique({ where: { id: 'd3' } });
  assert.strictEqual(after.accumulatedPunitory, 132000, 'el catch-up NO debe borrarse por solo abrir/leer la deuda');
  assert.strictEqual(after.currentTotal, 632000, 'currentTotal NO debe perder el catch-up');
});
