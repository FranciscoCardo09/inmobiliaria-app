'use strict';

/**
 * Bug real (2026-07-14, caso "C21_credit_to_debt" probado por el usuario en local):
 * cuando el saldo a favor aplicado a una deuda (`appliedCredit`) es MAYOR que el
 * alquiler+servicios impagos (`remainingBase`), el sobrante se perdía en el cálculo
 * EN VIVO / de vista previa — se clampeaba en 0 en vez de seguir descontando de los
 * punitorios. El modal de pago mostraba "TOTAL A PAGAR" de más (el sobrante de
 * crédito, ignorado).
 *
 * Caso reportado: alquiler impago $300.000, appliedCredit $345.000 (sobran $45.000),
 * punitorios en vivo $244.800 → el modal mostraba TOTAL A PAGAR $244.800 (ignorando
 * el sobrante) cuando el total real es $199.800 ($244.800 - $45.000).
 *
 * payDebt() (el pago REAL) ya aplicaba el sobrante correctamente a los punitorios
 * (creditOnPunitory = credit - totalBase) — el bug estaba SOLO en la vista previa/
 * en-vivo (calculateDebtPunitory → remainingDebt → liveCurrentTotal/totalToPay,
 * consumido por Control Mensual, el modal de pago, y "Deudas Acumuladas" del reporte
 * de Liquidación). Este archivo verifica que ambos caminos ahora coinciden (paridad).
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const GROUP = 'g1';
const CONTRACT = 'c1';

// Punitorio fijo y predecible (244800, 136 días) — el fix no toca la fórmula de
// punitorios en sí, solo cómo se neta el crédito sobrante contra el total.
function buildDebtService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      calculatePunitoryV2: () => ({ amount: 244800, days: 136, fromDate: '2026-03-01', toDate: '2026-07-14' }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
      recalculateMultipleRecords: async () => 0,
    },
  });
}

async function seedContract(prisma) {
  await prisma.contract.create({
    data: {
      id: CONTRACT, groupId: GROUP, renewedFromContractId: null,
      startDate: new Date(2025, 0, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
}

async function seedDebt(prisma, overrides = {}) {
  return prisma.debt.create({
    data: {
      id: 'd1', groupId: GROUP, contractId: CONTRACT, monthlyRecordId: null,
      periodMonth: 3, periodYear: 2026, periodLabel: 'Marzo 2026',
      unpaidRentAmount: 300000, unpaidServicesAmount: 0, appliedCredit: 345000,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 300000, status: 'OPEN',
      punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 2, 1),
      ...overrides,
    },
  });
}

async function lastTransactionConcepts(prisma) {
  const txs = await prisma.paymentTransaction.findMany({ where: {} });
  const mine = txs.filter((t) => t.groupId === GROUP);
  const last = mine[mine.length - 1];
  return last.concepts.create;
}

describe('BUG: appliedCredit > remainingBase (alquiler+servicios) — el sobrante se perdía', () => {
  test('calculateDebtPunitory: remainingDebt queda NEGATIVO (no clampeado en 0) para netear el sobrante contra los punitorios', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContract(prisma);
    const debt = await seedDebt(prisma);

    const r = await svc.calculateDebtPunitory(debt, new Date(2026, 6, 14));

    // remainingBase = 300000 (alquiler) - 0 (amountPaid) = 300000
    // sobrante de crédito = 345000 - 300000 = 45000 → remainingDebt = 300000-345000 = -45000
    assert.strictEqual(r.remainingDebt, -45000, 'el sobrante de crédito debe reflejarse como negativo, no clampeado en 0');

    // El total en vivo que arma cualquier caller (liveCurrentTotal/totalToPay) suma
    // remainingDebt + unpaidAccumulatedPunitory + amount:
    const liveTotal = r.remainingDebt + (r.unpaidAccumulatedPunitory || 0) + r.amount;
    assert.strictEqual(liveTotal, 199800, 'total real = 244800 (punitorios) - 45000 (sobrante de crédito) = 199800, no 244800');
  });

  test('PARIDAD: pagar exactamente el total corregido (199800) salda la deuda sin generar SOBREPAGO', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContract(prisma);
    await seedDebt(prisma);

    await svc.payDebt('d1', 199800, '2026-07-14', 'EFECTIVO', null);

    const concepts = await lastTransactionConcepts(prisma);
    const sobrepago = concepts.find((c) => c.type === 'SOBREPAGO');
    assert.strictEqual(sobrepago, undefined, 'pagando el total ya corregido no debe sobrar nada (SOBREPAGO)');

    const punitorios = concepts.find((c) => c.type === 'PUNITORIOS');
    assert.ok(punitorios, 'debe haber un concepto de punitorios');
    assert.strictEqual(punitorios.amount, 199800, 'los punitorios cobrados en efectivo = 244800 - 45000 (crédito) = 199800');

    const debtAfter = await prisma.debt.findUnique({ where: { id: 'd1' } });
    assert.strictEqual(debtAfter.status, 'PAID', 'con el total corregido la deuda debe quedar saldada');
  });

  test('CONTRASTE: pagar el total VIEJO (buggy, 244800) genera un SOBREPAGO de 45000 (plata de más que no hacía falta poner)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContract(prisma);
    await seedDebt(prisma);

    await svc.payDebt('d1', 244800, '2026-07-14', 'EFECTIVO', null);

    const concepts = await lastTransactionConcepts(prisma);
    const sobrepago = concepts.find((c) => c.type === 'SOBREPAGO');
    assert.ok(sobrepago, 'el total viejo (sin descontar el sobrante de crédito) sobrepaga la deuda');
    assert.strictEqual(sobrepago.amount, 45000);
  });
});
