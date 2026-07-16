const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-15 (AUDITORIA_FUNCIONAL_2026-07-10.md): números de recibo por `count()`
// se repetían tras cualquier borrado (y podían colisionar por concurrencia).
// Fix: contador dedicado `ReceiptSequence` (monotónico, nunca decrece) +
// `@@unique([groupId, receiptNumber])` en el schema como backstop. Ver
// `nextReceiptNumber` en paymentTransactionService.js.
//
// Decisión del usuario (2026-07-12): NO se deduplican recibos históricos ya
// emitidos; el contador arranca "desde cero" en estos tests de unidad (no hay
// datos preexistentes que migrar en el fake in-memory).
// ============================================================================

function makeService(prisma) {
  return proxyquire('../src/services/paymentTransactionService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
    },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'PARTIAL' }),
      recalculateMultipleRecords: async () => 0,
    },
    './debtService': {
      canPayCurrentMonth: async () => ({ canPay: true }),
    },
  });
}

async function makeRecord(prisma, id, overrides = {}) {
  await prisma.monthlyRecord.create({
    data: {
      id, groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'PENDING', rentAmount: 100000, servicesTotal: 0,
      includeIva: false, amountPaid: 0,
      previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      contract: { id: 'c1', punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006, rescindedAt: null },
      ...overrides,
    },
  });
}

test('A-15: dos pagos EFECTIVO secuenciales del mismo grupo obtienen números de recibo distintos y crecientes', async (t) => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeRecord(prisma, 'mr-1');
  await makeRecord(prisma, 'mr-2', { periodMonth: 8, monthNumber: 8 });

  const r1 = await svc.registerPayment('g1', 'mr-1', {
    paymentDate: '2026-07-05', amount: 100000, paymentMethod: 'EFECTIVO',
  });
  const r2 = await svc.registerPayment('g1', 'mr-2', {
    paymentDate: '2026-08-05', amount: 100000, paymentMethod: 'EFECTIVO',
  });

  assert.equal(r1.transaction.receiptNumber, 'REC-000001');
  assert.equal(r2.transaction.receiptNumber, 'REC-000002');
});

test('A-15: borrar una transacción con recibo NO libera su número para reutilización', async (t) => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeRecord(prisma, 'mr-1');
  await makeRecord(prisma, 'mr-2', { periodMonth: 8, monthNumber: 8 });
  await makeRecord(prisma, 'mr-3', { periodMonth: 9, monthNumber: 9 });

  const r1 = await svc.registerPayment('g1', 'mr-1', {
    paymentDate: '2026-07-05', amount: 100000, paymentMethod: 'EFECTIVO',
  });
  assert.equal(r1.transaction.receiptNumber, 'REC-000001');

  // Simula el borrado de la transacción #1 (lo que antes bajaba el count() y
  // reutilizaba REC-000001 en el próximo pago).
  await prisma.paymentTransaction.deleteMany({ where: { monthlyRecordId: 'mr-1' } });
  assert.equal(await prisma.paymentTransaction.count({ where: { groupId: 'g1' } }), 0);

  const r2 = await svc.registerPayment('g1', 'mr-2', {
    paymentDate: '2026-08-05', amount: 100000, paymentMethod: 'EFECTIVO',
  });
  const r3 = await svc.registerPayment('g1', 'mr-3', {
    paymentDate: '2026-09-05', amount: 100000, paymentMethod: 'EFECTIVO',
  });

  // El contador de ReceiptSequence sigue donde estaba (2, 3), no reutiliza 1.
  assert.equal(r2.transaction.receiptNumber, 'REC-000002');
  assert.equal(r3.transaction.receiptNumber, 'REC-000003');
});

test('A-15: pagos concurrentes (Promise.all) del mismo grupo, distinto contrato, no colisionan de número', async (t) => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeRecord(prisma, 'mr-1', { contractId: 'c1' });
  await makeRecord(prisma, 'mr-2', { contractId: 'c2', periodMonth: 8, monthNumber: 8 });

  const [r1, r2] = await Promise.all([
    svc.registerPayment('g1', 'mr-1', { paymentDate: '2026-07-05', amount: 100000, paymentMethod: 'EFECTIVO' }),
    svc.registerPayment('g1', 'mr-2', { paymentDate: '2026-08-05', amount: 100000, paymentMethod: 'EFECTIVO' }),
  ]);

  assert.notEqual(r1.transaction.receiptNumber, r2.transaction.receiptNumber);
  assert.deepEqual(
    [r1.transaction.receiptNumber, r2.transaction.receiptNumber].sort(),
    ['REC-000001', 'REC-000002']
  );
});

test('A-15: TRANSFERENCIA sin generateReceipt no consume número de la secuencia', async (t) => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeRecord(prisma, 'mr-1');
  await makeRecord(prisma, 'mr-2', { periodMonth: 8, monthNumber: 8 });

  const r1 = await svc.registerPayment('g1', 'mr-1', {
    paymentDate: '2026-07-05', amount: 100000, paymentMethod: 'TRANSFERENCIA',
  });
  assert.equal(r1.transaction.receiptNumber, null);

  const r2 = await svc.registerPayment('g1', 'mr-2', {
    paymentDate: '2026-08-05', amount: 100000, paymentMethod: 'EFECTIVO',
  });
  // Al no haberse consumido ningún número por la transferencia, el primer recibo
  // real sigue siendo el 1.
  assert.equal(r2.transaction.receiptNumber, 'REC-000001');
});
