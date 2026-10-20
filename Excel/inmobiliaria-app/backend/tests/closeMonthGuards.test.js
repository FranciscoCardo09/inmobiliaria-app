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

test('2 pagos antes del cierre: la deuda nace con la mora que realmente falta (caso Marquez Gomez)', async () => {
  const prisma = makeFakePrisma();
  const { computeDebtDraft } = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
  });
  const contract = { id: 'c1', groupId: 'g1', punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  // Alquiler 787.763. 15/10 paga 797.763 (mora 47.265,78; cubre 10.000). 20/10 paga 1.000
  // (mora adeudada antes de ese pago 38.607,35 → punitoryAmount del mes).
  const record = {
    id: 'mr', periodMonth: 10, periodYear: 2026, rentAmount: 787763, servicesTotal: 0, ivaAmount: 0,
    punitoryAmount: 38607.35, amountPaid: 798763, previousBalance: 0, status: 'PARTIAL',
    transactions: [
      { paymentDate: new Date('2026-10-15T12:00:00Z'), createdAt: new Date('2026-10-15T13:00:00Z'), amount: 797763, concepts: [{ type: 'ALQUILER', amount: 787763 }, { type: 'PUNITORIOS', amount: 10000 }] },
      { paymentDate: new Date('2026-10-20T12:00:00Z'), createdAt: new Date('2026-10-20T13:00:00Z'), amount: 1000, concepts: [{ type: 'PUNITORIOS', amount: 1000 }] },
    ],
  };
  const draft = await computeDebtDraft(record, contract);
  assert.equal(draft.unpaidPunitory, 37607.35); // antes 27.607,35: se perdían los $10.000 del primer pago
});
