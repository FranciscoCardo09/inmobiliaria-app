'use strict';

/**
 * Bug real (2026-07-14, reportado por el usuario probando la Liquidación): el desglose
 * de "deuda saldada" mostraba Junio como saldado mientras Control Mensual mostraba
 * "Parcial" para el mismo período — 6 casos confirmados en producción con la misma
 * firma: `Debt.status = 'PAID'` pero `MonthlyRecord.status` congelado en 'PARTIAL'.
 *
 * Causa raíz: `recalculateDebtFromMonthlyRecord` (llamada desde paymentTransactionService
 * cuando se cancela un pago y no se puede emparejar con el DebtPayment exacto) decidía
 * PAID/PARTIAL comparando `amountPaid >= totalBase` — SIN punitorios ni appliedCredit —
 * y nunca sincronizaba el MonthlyRecord (a diferencia de `payDebt()`, que sí lo hace).
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
  });
}

const BASE_DEBT = {
  id: 'd1', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr1',
  periodMonth: 6, periodYear: 2026, periodLabel: 'Junio 2026',
  punitoryPercent: 0.02, punitoryStartDate: new Date(2026, 5, 4), lastPaymentDate: null,
  appliedCredit: 0,
};

const BASE_RECORD = {
  id: 'mr1', groupId: 'g1', contractId: 'c1',
  periodMonth: 6, periodYear: 2026,
  rentAmount: 100000, servicesTotal: 0, ivaAmount: 0, punitoryAmount: 0,
  transactions: [],
};

describe('recalculateDebtFromMonthlyRecord — sincronía con MonthlyRecord.status', () => {
  test('BUG: rent+servicios cubiertos pero punitorios SIN cubrir → sigue PARTIAL, no PAID (antes ignoraba punitorios)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildService(prisma);

    await prisma.debt.create({ data: {
      ...BASE_DEBT,
      originalAmount: 105000,
      unpaidRentAmount: 100000, unpaidServicesAmount: 0,
      accumulatedPunitory: 5000, // punitorios pendientes: NO deben ignorarse
      currentTotal: 5000, amountPaid: 100000, status: 'PARTIAL',
    }});
    // MonthlyRecord.amountPaid queda CONGELADO en lo pagado antes de cerrar (acá: nada —
    // los 100000 se pagaron DESPUÉS, vía pagos de deuda, que se trackean en Debt.amountPaid,
    // no en el record).
    await prisma.monthlyRecord.create({ data: { ...BASE_RECORD, amountPaid: 0, status: 'PARTIAL' } });

    const updated = await svc.recalculateDebtFromMonthlyRecord('d1', 'mr1');

    assert.strictEqual(updated.status, 'PARTIAL', 'con punitorios pendientes NO debe marcarse PAID');
    assert.ok(updated.currentTotal > 0, `currentTotal debe reflejar los punitorios impagos, quedó ${updated.currentTotal}`);

    const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr1' } });
    assert.strictEqual(record.status, 'PARTIAL', 'el mes no debe tocarse: la deuda sigue abierta');
  });

  test('FIX: deuda realmente saldada (incluye punitorios) → status PAID Y el MonthlyRecord pasa a COMPLETE', async () => {
    const prisma = makeFakePrisma();
    const svc = buildService(prisma);

    await prisma.debt.create({ data: {
      ...BASE_DEBT,
      originalAmount: 105000,
      unpaidRentAmount: 100000, unpaidServicesAmount: 0,
      accumulatedPunitory: 5000,
      currentTotal: 0, amountPaid: 105000, status: 'PARTIAL', // amountPaid YA cubre todo, pero status quedó viejo
      lastPaymentDate: new Date(2026, 5, 20),
    }});
    // MonthlyRecord desincronizado: la deuda está de hecho saldada (vía Debt.amountPaid,
    // pagos posteriores al cierre), pero el mes quedó en PARTIAL (reproduce el bug real
    // reportado: Control Mensual mostraba "Parcial").
    await prisma.monthlyRecord.create({ data: { ...BASE_RECORD, amountPaid: 0, status: 'PARTIAL' } });

    const updated = await svc.recalculateDebtFromMonthlyRecord('d1', 'mr1');

    assert.strictEqual(updated.status, 'PAID');
    assert.ok(updated.currentTotal <= 1, `currentTotal debe quedar ~0, quedó ${updated.currentTotal}`);

    const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr1' } });
    assert.strictEqual(record.status, 'COMPLETE', 'FIX: el mes debe sincronizarse a COMPLETE cuando la deuda queda PAID');
    assert.strictEqual(record.isPaid, true);
    assert.strictEqual(record.isCancelled, true);
  });

  test('deuda con saldo a favor aplicado (appliedCredit) que cubre lo que falta → también sincroniza el mes', async () => {
    const prisma = makeFakePrisma();
    const svc = buildService(prisma);

    await prisma.debt.create({ data: {
      ...BASE_DEBT,
      originalAmount: 105000,
      unpaidRentAmount: 100000, unpaidServicesAmount: 0,
      accumulatedPunitory: 5000,
      currentTotal: 5000, amountPaid: 100000, status: 'PARTIAL',
      appliedCredit: 5000, // crédito previo que cubre los 5000 de punitorios restantes
      lastPaymentDate: new Date(2026, 5, 15),
    }});
    // MonthlyRecord.amountPaid queda CONGELADO en lo pagado antes de cerrar (acá: nada —
    // los 100000 se pagaron DESPUÉS, vía pagos de deuda, que se trackean en Debt.amountPaid,
    // no en el record).
    await prisma.monthlyRecord.create({ data: { ...BASE_RECORD, amountPaid: 0, status: 'PARTIAL' } });

    const updated = await svc.recalculateDebtFromMonthlyRecord('d1', 'mr1');

    assert.strictEqual(updated.status, 'PAID', 'appliedCredit debe contar para saldar la deuda');
    const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr1' } });
    assert.strictEqual(record.status, 'COMPLETE');
  });
});
