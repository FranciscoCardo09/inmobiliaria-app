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
      startDate: new Date(2025, 0, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
}

async function makeRecord(prisma, { id, periodMonth, periodYear, status = 'PENDING', isCancelled = false, amountPaid = 0, monthNumber = null }) {
  return prisma.monthlyRecord.create({
    data: {
      id, groupId: GROUP, contractId: CONTRACT, periodMonth, periodYear, monthNumber,
      status, isCancelled, rentAmount: 1000, servicesTotal: 0, amountPaid,
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

test('escenario del bug: abril (parcial iniciado) + mayo (deuda) + junio (mes actual) → orden cronológico', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);

  // Abril: MonthlyRecord PARTIAL con pago iniciado (obligación real en curso), sin deuda
  await makeRecord(prisma, { id: 'mr-abr', periodMonth: 4, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, monthNumber: 16 });
  // Mayo: mes cerrado → Debt OPEN (su record existe pero está representado por la deuda)
  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', amountPaid: 0, monthNumber: 17 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026 });
  // Junio: mes actual PENDING sin tocar (es el target a pagar, NO una obligación previa)
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PENDING', monthNumber: 18 });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.deepStrictEqual(
    periods.map((p) => `${p.type}:${p.periodMonth}`),
    ['RECORD:4', 'DEBT:5'],
    'solo abril (parcial iniciado) y mayo (deuda); junio PENDING sin tocar NO cuenta'
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

test('REGRESIÓN: meses PENDING sin tocar (viejos o futuros) NO bloquean el mes actual', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);

  // Enero y febrero PENDING, amountPaid=0, sin deuda (placeholders de grilla / mes fantasma)
  await makeRecord(prisma, { id: 'mr-ene', periodMonth: 1, periodYear: 2026, status: 'PENDING', amountPaid: 0, monthNumber: 13 });
  await makeRecord(prisma, { id: 'mr-feb', periodMonth: 2, periodYear: 2026, status: 'PENDING', amountPaid: 0, monthNumber: 14 });
  // Junio (mes actual) y un futuro PENDING también sin tocar
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PENDING', amountPaid: 0, monthNumber: 18 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', amountPaid: 0, monthNumber: 19 });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.strictEqual(periods.length, 0, 'ningún PENDING sin pago cuenta como período impago');

  const jun = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 6, periodYear: 2026 });
  assert.strictEqual(jun.canPay, true, 'el mes actual se puede pagar pese a los PENDING fantasma');
});

test('parcial con pago pero FUERA de rango (monthNumber inválido) → excluido', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma); // startMonth 1, durationMonths 24 → rango [1..24]
  await makeRecord(prisma, { id: 'mr-corrupt', periodMonth: 3, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, monthNumber: 99 });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.strictEqual(periods.length, 0, 'record con monthNumber fuera de rango no bloquea');
});

test('parcial con pago pero CON deuda asociada → excluido (lo representa la deuda)', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  // Marzo: PARTIAL con pago, pero ya tiene deuda PAGA → no debe bloquear
  await makeRecord(prisma, { id: 'mr-mar', periodMonth: 3, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, monthNumber: 15 });
  await prisma.debt.create({ data: { id: 'd-mar-paid', groupId: GROUP, contractId: CONTRACT, monthlyRecordId: 'mr-mar', periodMonth: 3, periodYear: 2026, periodLabel: 'M3 2026', status: 'PAID', unpaidRentAmount: 0, unpaidServicesAmount: 0, accumulatedPunitory: 0, currentTotal: 0, amountPaid: 1000, originalAmount: 1000, punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 2, 1) } });

  const periods = await svc.getUnpaidPeriods(GROUP, CONTRACT);
  assert.strictEqual(periods.length, 0, 'record con deuda asociada no se cuenta (la deuda PAID está saldada)');
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

test('records COMPLETE / isCancelled se excluyen; solo cuenta el parcial con pago', async () => {
  const prisma = makeFakePrisma();
  const svc = buildService(prisma);
  await seedContract(prisma);
  await makeRecord(prisma, { id: 'mr-c', periodMonth: 1, periodYear: 2026, status: 'COMPLETE', amountPaid: 1000, monthNumber: 13 });
  await makeRecord(prisma, { id: 'mr-can', periodMonth: 2, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, isCancelled: true, monthNumber: 14 });
  await makeRecord(prisma, { id: 'mr-ok', periodMonth: 3, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, monthNumber: 15 });

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
  // Abril como MonthlyRecord parcial con pago iniciado (obligación real previa, sin cerrar)
  await makeRecord(prisma, { id: 'mr-abr', periodMonth: 4, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, monthNumber: 16 });
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
