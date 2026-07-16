const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// Bug reportado por el usuario (2026-07-12): en Control Mensual, la columna
// "Debe Sig." (basada en `record.previousBalance`, refrescado en vivo en cada
// recálculo) y el monto a pagar de la Deuda asociada (basado en
// `debt.appliedCredit`, congelado UNA SOLA VEZ al cerrar el mes) mostraban
// valores distintos para el mismo saldo a favor.
//
// Decisión del usuario (2026-07-12): gana el valor EN VIVO. Fix:
// `syncDebtAppliedCreditFromRecord` (debtService.js) se llama desde
// `_recalculateCore` cada vez que se recalcula el previousBalance final de un
// mes que ya tiene una Debt asociada no pagada.
// ============================================================================

function makeService(prisma) {
  return proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': proxyquire('../src/services/debtService', { '../lib/prisma': prisma }),
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });
}

async function makeContract(prisma, overrides = {}) {
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
      rescindedAt: null, baseRent: 100000, pagaIva: false,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
      ...overrides,
    },
  });
}

test('el appliedCredit de la deuda se actualiza cuando el previousBalance en vivo del mes cambia (anular un sobrepago anterior)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);

  // Mes 5: pagado de más ($150.000 de $100.000) → crédito $50.000.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-5', groupId: 'g1', contractId: 'c1',
      periodMonth: 5, periodYear: 2026, monthNumber: 5,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 150000, totalDue: 100000, balance: 50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      transactions: [
        { paymentDate: new Date(2026, 4, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] },
        { paymentDate: new Date(2026, 4, 6, 12, 0, 0), amount: 50000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'SOBREPAGO', amount: 50000 }] },
      ],
    },
  });

  // Mes 6: refleja el crédito de $50.000 de mayo, sin pagos, ya CERRADO con una Debt
  // cuyo appliedCredit se congeló en $50.000 en el momento del cierre.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-6', groupId: 'g1', contractId: 'c1',
      periodMonth: 6, periodYear: 2026, monthNumber: 6,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 50000, amountPaid: 0, totalDue: 50000, balance: -50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [], transactions: [],
    },
  });
  await prisma.debt.create({
    data: {
      id: 'd-6', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr-6',
      periodMonth: 6, periodYear: 2026, periodLabel: 'Junio 2026',
      unpaidRentAmount: 100000, unpaidServicesAmount: 0, appliedCredit: 50000,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 50000, status: 'OPEN',
      punitoryStartDate: new Date(2026, 5, 10), punitoryPercent: 0.006,
    },
  });

  // Anular el pago "de más" de mayo (el sobrepago desaparece).
  await prisma.monthlyRecord.update({
    where: { id: 'mr-5' },
    data: {
      transactions: [
        { paymentDate: new Date(2026, 4, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] },
      ],
    },
  });

  await svc.recalculateMultipleRecords(['mr-5'], null, true);

  const mr6 = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-6' } });
  const debt = await prisma.debt.findUnique({ where: { id: 'd-6' } });

  assert.equal(mr6.previousBalance, 0, 'Control Mensual: el crédito fantasma de junio desaparece');
  assert.equal(debt.appliedCredit, 0, 'Deuda: el appliedCredit se sincroniza al mismo valor en vivo (0), ya no queda en $50.000');
  assert.equal(debt.currentTotal, 100000, 'Deuda: el monto a pagar sube a $100.000, coincidiendo con Control Mensual');
});

test('una deuda ya PAID no se toca (no revive una deuda saldada)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-5', groupId: 'g1', contractId: 'c1',
      periodMonth: 5, periodYear: 2026, monthNumber: 5,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 150000, totalDue: 100000, balance: 50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      transactions: [
        { paymentDate: new Date(2026, 4, 5, 12, 0, 0), amount: 150000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 150000 }] },
      ],
    },
  });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-6', groupId: 'g1', contractId: 'c1',
      periodMonth: 6, periodYear: 2026, monthNumber: 6,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 50000, amountPaid: 50000, totalDue: 50000, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [], transactions: [],
    },
  });
  await prisma.debt.create({
    data: {
      id: 'd-6', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr-6',
      periodMonth: 6, periodYear: 2026, periodLabel: 'Junio 2026',
      unpaidRentAmount: 100000, unpaidServicesAmount: 0, appliedCredit: 50000,
      accumulatedPunitory: 0, amountPaid: 50000, previousRecordPayment: 0,
      currentTotal: 0, status: 'PAID',
      punitoryStartDate: new Date(2026, 5, 10), punitoryPercent: 0.006,
    },
  });

  // Fuerza un recálculo de mayo (no debería tocar la deuda PAID de junio).
  await svc.recalculateMultipleRecords(['mr-5'], null, true);

  const debt = await prisma.debt.findUnique({ where: { id: 'd-6' } });
  assert.equal(debt.status, 'PAID');
  assert.equal(debt.appliedCredit, 50000, 'una deuda PAID no se recalcula');
});
