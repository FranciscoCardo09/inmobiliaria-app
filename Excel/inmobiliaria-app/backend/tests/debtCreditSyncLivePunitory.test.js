'use strict';

/**
 * Bug real (2026-07-14, caso "C21_credit_to_debt" probado por el usuario en local):
 * `syncDebtAppliedCreditFromRecord` topeaba el crédito a sincronizar usando
 * `unpaidRentAmount + unpaidServicesAmount + accumulatedPunitory` — pero
 * `accumulatedPunitory` es el valor CONGELADO al cerrar la deuda, no los
 * punitorios que siguen corriendo EN VIVO desde entonces. Con una deuda vieja
 * (136 días) el congelado puede ser $0 mientras el vivo ya es $244.800: el tope
 * quedaba clampeado muy bajo (a la base sola) y nunca dejaba subir
 * `appliedCredit` hasta el crédito real (`previousBalance` del mes), aunque
 * hubiera de sobra para cubrirlo todo.
 *
 * Caso reportado: alquiler impago $300.000, previousBalance real $504.800,
 * punitorios en vivo $244.800 (accumulatedPunitory congelado = $0). "Debe Sig."
 * (que usa previousBalance directo) mostraba correctamente $40.000; "Deuda"
 * (que dependía de appliedCredit, topeado en $300.000 por este bug) mostraba
 * $244.800 de más.
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

function buildDebtService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      // Punitorio en vivo fijo y predecible (244800, 136 días) — el fix no toca
      // la fórmula de punitorios, solo el tope de crédito a sincronizar.
      calculatePunitoryV2: () => ({ amount: 244800, days: 136, fromDate: '2026-03-01', toDate: '2026-07-14' }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
  });
}

async function seedContractAndDebt(prisma, overrides = {}) {
  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', renewedFromContractId: null,
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  return prisma.debt.create({
    data: {
      id: 'd1', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr1',
      periodMonth: 3, periodYear: 2026, periodLabel: 'Marzo 2026',
      unpaidRentAmount: 300000, unpaidServicesAmount: 0, appliedCredit: 345000,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 300000, status: 'OPEN',
      punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 2, 1),
      ...overrides,
    },
  });
}

describe('syncDebtAppliedCreditFromRecord — tope debe incluir punitorios EN VIVO, no solo el congelado', () => {
  test('BUG: con punitorios en vivo grandes y accumulatedPunitory=0 (congelado), el tope viejo clampeaba en la base sola', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContractAndDebt(prisma);

    // previousBalance real del mes: $504.800 (más que suficiente para cubrir
    // alquiler(300000) + punitorios en vivo(244800) = 544800).
    const updated = await svc.syncDebtAppliedCreditFromRecord('d1', 504800);

    assert.strictEqual(updated.appliedCredit, 504800, 'debe sincronizar hasta el crédito real, no clamparlo en la base sola (300000)');
  });

  test('FIX: tras sincronizar, el total en vivo de la deuda (Deuda / liveCurrentTotal) da $40.000, igual que "Debe Sig."', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContractAndDebt(prisma);

    await svc.syncDebtAppliedCreditFromRecord('d1', 504800);
    const debtAfterSync = await prisma.debt.findUnique({ where: { id: 'd1' } });

    const live = await svc.computeLiveDebtTotal(debtAfterSync, '2026-07-14');
    assert.strictEqual(live.liveCurrentTotal, 40000, 'alquiler(300000) + punitorios(244800) - crédito(504800) = 40000');
  });

  test('el tope sigue respetando el crédito disponible: si previousBalance es MENOR al total, no se aplica de más', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContractAndDebt(prisma);

    // Solo hay $100.000 de crédito disponible (menos que el total 544800) → se aplica tal cual, sin clampear artificialmente.
    const updated = await svc.syncDebtAppliedCreditFromRecord('d1', 100000);
    assert.strictEqual(updated.appliedCredit, 100000);
  });

  test('deuda ya PAID no se toca (guard existente, no debe romperse con el fix)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContractAndDebt(prisma, { status: 'PAID' });

    const result = await svc.syncDebtAppliedCreditFromRecord('d1', 504800);
    assert.strictEqual(result, null);
  });
});
