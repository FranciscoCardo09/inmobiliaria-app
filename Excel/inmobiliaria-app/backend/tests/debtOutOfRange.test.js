'use strict';

// Deudas de meses posteriores a la rescisión (decisión 2026-10-20): no se muestran ni bloquean.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

test('una deuda de un mes posterior a la rescisión no figura como período impago', async () => {
  const prisma = makeFakePrisma();
  const svc = proxyquire('../src/services/debtService', { '../lib/prisma': prisma });
  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', renewedFromContractId: null, startMonth: 1, durationMonths: 24,
      startDate: new Date(2026, 0, 1), rescindedAt: new Date(2026, 3, 15),
    },
  });
  for (const [id, m] of [['mr-abr', 4], ['mr-jun', 6]]) {
    await prisma.monthlyRecord.create({ data: { id, groupId: 'g1', contractId: 'c1', monthNumber: m, periodMonth: m, periodYear: 2026, status: 'PENDING', amountPaid: 0 } });
    await prisma.debt.create({
      data: {
        id: `d-${id}`, groupId: 'g1', contractId: 'c1', monthlyRecordId: id, periodMonth: m, periodYear: 2026,
        periodLabel: `M${m}`, status: 'OPEN', unpaidRentAmount: 1000, unpaidServicesAmount: 0,
        accumulatedPunitory: 0, appliedCredit: 0, amountPaid: 0, previousRecordPayment: 0,
      },
    });
  }
  const periods = await svc.getUnpaidPeriods('g1', 'c1');
  assert.deepEqual(periods.map((p) => p.periodMonth), [4], 'abril (vigente) sí; junio (post-rescisión) no');
});
