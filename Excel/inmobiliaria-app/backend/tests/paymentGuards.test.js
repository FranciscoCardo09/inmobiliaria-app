'use strict';

/**
 * Guardas del cobro de un mes (auditoría 2026-10-20, `assertPaymentAllowed` en
 * paymentTransactionService.js):
 *  - mes que ya pasó a Deuda → se cobra desde Deudas (antes se grababa como ALQUILER sin
 *    DebtPayment y el mes y la Deuda quedaban con saldos distintos);
 *  - fecha anterior a un pago ya cargado → se bloquea (regla confirmada 2026-10-20);
 *  - doble envío (mismo monto y fecha en 2 minutos) → se bloquea.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

function makeService(prisma) {
  return proxyquire('../src/services/paymentTransactionService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'PARTIAL' }),
      recalculateMultipleRecords: async () => 0,
    },
    './debtService': { canPayCurrentMonth: async () => ({ canPay: true }) },
  });
}

async function seed(prisma) {
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-1', groupId: 'g1', contractId: 'c1', periodMonth: 10, periodYear: 2026, monthNumber: 4,
      status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false, amountPaid: 0,
      previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false, services: [],
      contract: { id: 'c1', punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006, rescindedAt: null },
    },
  });
}

// Pago ya cargado (directo en el fake: no soporta la relación anidada `concepts`).
const existingTx = (prisma, paymentDate, amount) => prisma.paymentTransaction.create({
  data: { groupId: 'g1', monthlyRecordId: 'mr-1', paymentDate: new Date(`${paymentDate}T12:00:00Z`), amount, concepts: [] },
});
const pay = (svc, paymentDate, amount) => svc.registerPayment('g1', 'mr-1', { paymentDate, amount, paymentMethod: 'TRANSFERENCIA' });

test('mes con Deuda abierta: no se cobra por acá', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await seed(prisma);
  await prisma.debt.create({ data: { id: 'd1', monthlyRecordId: 'mr-1', status: 'OPEN', periodLabel: 'Octubre 2026' } });
  await assert.rejects(pay(svc, '2026-10-15', 50000), { code: 'PAYMENT_BLOCKED', message: /Octubre 2026 ya pasó a deuda/ });
});

test('fecha anterior a un pago ya cargado del mismo mes: bloquea con aviso', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await seed(prisma);
  await existingTx(prisma, '2026-10-20', 30000);
  await assert.rejects(pay(svc, '2026-10-15', 20000), { code: 'PAYMENT_BLOCKED', message: /anterior al último pago de este mes \(20\/10\/2026\)/ });
  // El mismo día o después sí se puede.
  await pay(svc, '2026-10-20', 20000);
});

test('doble envío: mismo monto y fecha en 2 minutos → bloquea; otro monto sí pasa', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await seed(prisma);
  await existingTx(prisma, '2026-10-15', 30000);
  await assert.rejects(pay(svc, '2026-10-15', 30000), { code: 'PAYMENT_BLOCKED', message: /ya se registró hace un momento/ });
  await pay(svc, '2026-10-15', 25000);
});
