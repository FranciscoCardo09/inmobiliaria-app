'use strict';

// Auditoría 2026-10-20: cierre de mes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');
const { assertMonthCanClose } = require('../src/services/monthlyCloseService');

test('no se puede cerrar el mes en curso antes de su último día, ni un mes futuro', () => {
  assert.throws(() => assertMonthCanClose(10, 2026, '2026-10-20'), { code: 'PAYMENT_BLOCKED', message: /a partir del 31\/10\/2026/ });
  assert.throws(() => assertMonthCanClose(12, 2026, '2026-10-20'), { code: 'PAYMENT_BLOCKED' });
  assert.doesNotThrow(() => assertMonthCanClose(10, 2026, '2026-10-31'));
  assert.doesNotThrow(() => assertMonthCanClose(9, 2026, '2026-10-01'));
  assert.doesNotThrow(() => assertMonthCanClose(12, 2025, '2026-01-02'));
  assert.doesNotThrow(() => assertMonthCanClose(2, 2026, '2026-02-28'));
});

test('el ancla de la deuda es el último pago por FECHA, aunque se haya cargado antes (caso Flejsz)', async () => {
  const prisma = makeFakePrisma();
  const { computeDebtDraft } = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
  });
  const contract = { id: 'c1', groupId: 'g1', punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const record = {
    id: 'mr', periodMonth: 10, periodYear: 2026, rentAmount: 1000000, servicesTotal: 0, ivaAmount: 0,
    punitoryAmount: 0, amountPaid: 600000, previousBalance: 0, status: 'PARTIAL',
    // Cargados fuera de orden: primero el del 20/10, después el del 15/10.
    transactions: [
      { paymentDate: new Date('2026-10-20T12:00:00Z'), createdAt: new Date('2026-10-20T13:00:00Z'), amount: 300000 },
      { paymentDate: new Date('2026-10-15T12:00:00Z'), createdAt: new Date('2026-10-21T13:00:00Z'), amount: 300000 },
    ],
  };
  const draft = await computeDebtDraft(record, contract);
  const anchor = draft.monthlyRecord.transactions[draft.monthlyRecord.transactions.length - 1];
  assert.equal(new Date(anchor.paymentDate).toISOString().slice(0, 10), '2026-10-20');
});
