const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// These tests pin the chronological-order rule for payments:
// only the OLDEST unpaid period of a contract's renewal chain may be paid,
// looking at BOTH open Debts (closed months) and unpaid MonthlyRecords
// (pending/partial months not yet closed). A newer period must stay blocked
// until everything older is settled.

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      // We don't care about punitory math here, only ordering / blocking.
      calculatePunitoryV2: () => ({ amount: 0, days: 0, fromDate: null, toDate: null }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
    // payDebt lazily requires monthlyRecordService at the end of the success path.
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
    },
  });
}

// --- shared fixtures -------------------------------------------------------

const GROUP = 'g1';
const CONTRACT = 'c1';

async function seedContract(prisma) {
  await prisma.contract.create({
    data: {
      id: CONTRACT, groupId: GROUP, renewedFromContractId: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
}

async function makeRecord(prisma, { id, periodMonth, periodYear, status = 'PENDING', isCancelled = false }) {
  return prisma.monthlyRecord.create({
    data: {
      id, groupId: GROUP, contractId: CONTRACT, periodMonth, periodYear,
      status, isCancelled, rentAmount: 1000, servicesTotal: 0, amountPaid: 0,
      previousBalance: 0, ivaAmount: 0,
    },
  });
}

async function makeDebt(prisma, { id, monthlyRecordId, periodMonth, periodYear, status = 'OPEN', amountPaid = 0 }) {
  return prisma.debt.create({
    data: {
      id, groupId: GROUP, contractId: CONTRACT, monthlyRecordId,
      periodMonth, periodYear, periodLabel: `M${periodMonth} ${periodYear}`,
      originalAmount: 1000, unpaidRentAmount: 1000, unpaidServicesAmount: 0,
      accumulatedPunitory: 0, currentTotal: 1000, amountPaid, status,
      punitoryPercent: 0.006, punitoryStartDate: new Date(periodYear, periodMonth - 1, 1),
    },
  });
}

// --- getUnpaidPeriods / canPayCurrentMonth ---------------------------------

test('escenario del bug: abril (record parcial) + mayo (deuda) + junio (record) → orden cronológico', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);

  // Abril: MonthlyRecord PARTIAL, sin deuda asociada
  await makeRecord(prisma, { id: 'mr-abr', periodMonth: 4, periodYear: 2026, status: 'PARTIAL' });
  // Mayo: mes cerrado → Debt OPEN (su record existe pero está representado por la deuda)
  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL' });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026 });
  // Junio: mes actual PENDING
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PENDING' });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.deepStrictEqual(
    periods.map((p) => `${p.type}:${p.periodMonth}`),
    ['RECORD:4', 'DEBT:5', 'RECORD:6'],
    'orden ascendente y mayo representado por la deuda (no por el record)'
  );

  // Abril (más viejo) → permitido
  const abr = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 4, periodYear: 2026 });
  assert.strictEqual(abr.canPay, true);

  // Mayo → bloqueado, apuntando a abril
  const may = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 5, periodYear: 2026 });
  assert.strictEqual(may.canPay, false);
  assert.strictEqual(may.blockingPeriod.periodMonth, 4);
  assert.strictEqual(may.blockingPeriod.periodYear, 2026);

  // Junio → bloqueado
  const jun = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 6, periodYear: 2026 });
  assert.strictEqual(jun.canPay, false);
  assert.strictEqual(jun.blockingPeriod.periodMonth, 4);
});

test('sin períodos impagos → canPay true', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeRecord(prisma, { id: 'mr-1', periodMonth: 6, periodYear: 2026, status: 'COMPLETE' });

  const res = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 6, periodYear: 2026 });
  assert.strictEqual(res.canPay, true);
  assert.strictEqual(res.blockingPeriod, null);
});

test('una sola deuda (es la más vieja) → se puede pagar', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeDebt(prisma, { id: 'd-1', monthlyRecordId: 'mr-x', periodMonth: 3, periodYear: 2026 });

  const res = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 3, periodYear: 2026 });
  assert.strictEqual(res.canPay, true);
});

test('record con deuda asociada NO se cuenta doble (solo aparece la deuda)', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeRecord(prisma, { id: 'mr-z', periodMonth: 2, periodYear: 2026, status: 'PARTIAL' });
  await makeDebt(prisma, { id: 'd-z', monthlyRecordId: 'mr-z', periodMonth: 2, periodYear: 2026 });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.strictEqual(periods.length, 1);
  assert.strictEqual(periods[0].type, 'DEBT');
});

test('records COMPLETE / isCancelled se excluyen', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeRecord(prisma, { id: 'mr-c', periodMonth: 1, periodYear: 2026, status: 'COMPLETE' });
  await makeRecord(prisma, { id: 'mr-can', periodMonth: 2, periodYear: 2026, status: 'PARTIAL', isCancelled: true });
  await makeRecord(prisma, { id: 'mr-ok', periodMonth: 3, periodYear: 2026, status: 'PENDING' });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.deepStrictEqual(periods.map((p) => p.periodMonth), [3]);
});

test('sin targetPeriod (legacy) → bloquea si hay alguna deuda abierta', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeDebt(prisma, { id: 'd-leg', monthlyRecordId: 'mr-leg', periodMonth: 4, periodYear: 2026 });

  const res = await svc.canPayCurrentMonth(GROUP, CONTRACT);
  assert.strictEqual(res.canPay, false);
});

// --- payDebt (orden) -------------------------------------------------------

test('payDebt: pagar la deuda más vieja procede y crea el DebtPayment', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeDebt(prisma, { id: 'd-old', monthlyRecordId: 'mr-old', periodMonth: 4, periodYear: 2026 });

  await svc.payDebt('d-old', 500, '2026-06-01', 'EFECTIVO', null);

  const pays = await prisma.debtPayment.findMany({ where: { debtId: 'd-old' } });
  assert.strictEqual(pays.length, 1);
  assert.strictEqual(pays[0].amount, 500);
});

test('payDebt: pagar una deuda más nueva existiendo un record anterior impago → ORDER_BLOCK y no crea pago', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  // Abril impago como MonthlyRecord (sin cerrar)
  await makeRecord(prisma, { id: 'mr-abr', periodMonth: 4, periodYear: 2026, status: 'PARTIAL' });
  // Mayo como deuda (más nueva)
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026 });

  await assert.rejects(
    () => svc.payDebt('d-may', 500, '2026-06-01', 'EFECTIVO', null),
    (err) => {
      assert.strictEqual(err.code, 'ORDER_BLOCK');
      assert.strictEqual(err.blockingPeriod.periodMonth, 4);
      return true;
    }
  );

  const pays = await prisma.debtPayment.findMany({ where: { debtId: 'd-may' } });
  assert.strictEqual(pays.length, 0, 'no debe crear DebtPayment cuando se bloquea por orden');
});

test('payDebt: bloqueado por otra deuda más vieja', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeDebt(prisma, { id: 'd-mar', monthlyRecordId: 'mr-mar', periodMonth: 3, periodYear: 2026 });
  await makeDebt(prisma, { id: 'd-apr', monthlyRecordId: 'mr-apr', periodMonth: 4, periodYear: 2026 });

  await assert.rejects(
    () => svc.payDebt('d-apr', 500, '2026-06-01', 'EFECTIVO', null),
    (err) => err.code === 'ORDER_BLOCK' && err.blockingPeriod.periodMonth === 3
  );
});
