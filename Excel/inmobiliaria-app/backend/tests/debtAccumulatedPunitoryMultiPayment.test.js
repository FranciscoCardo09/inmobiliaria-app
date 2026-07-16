'use strict';

/**
 * Bug real (2026-07-16, caso "C06_none" probado por el usuario en local): una deuda
 * pagada en DOS pagos parciales separados (el primero cubre alquiler+servicios+parte
 * de los punitorios, el segundo termina de cubrir el resto de los punitorios) quedaba
 * con `debt.accumulatedPunitory` igual al punitorio que quedaba IMPAGO en el ÚLTIMO
 * pago puntual, no al total BRUTO histórico acumulado.
 *
 * Caso real: alquiler $290.000 + servicios $30.000 + punitorios (107 días) $186.180 =
 * $506.180 en total. Pago 1 ($406.000) cubre alquiler+servicios+$86.000 de punitorios
 * (limitado por el efectivo disponible, quedan $100.180 de punitorios sin cubrir).
 * Pago 2 ($100.180) cubre el resto exacto, sin sobrepago.
 *
 * Antes del fix: el pago 2 pisaba accumulatedPunitory con 100.180 (perdiendo los
 * 86.000 ya cubiertos por el pago 1) → la columna "Total" de Control Mensual (que
 * lee accumulatedPunitory de una deuda ya PAID) mostraba $420.180 en vez de los
 * $506.180 reales — aunque el dinero cobrado (amountPaid=506.180) sí era correcto.
 *
 * Fix: usar `grossPunitoryToDate` (calculateDebtPunitory) en vez de `totalPunitoryOwed`
 * para `accumulatedPunitory` — ese campo sí es el bruto acumulado correcto sin
 * importar en cuántos pagos se saldó la deuda.
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const GROUP = 'g1';
const CONTRACT = 'c1';

// Punitorio fijo y predecible: 186.180 en el cálculo "desde cero" (primer pago, sin
// lastPaymentDate todavía), 0 en el cálculo "desde el último pago" (segundo pago, el
// mismo día que el primero — cero días nuevos de mora).
function buildDebtService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      calculatePunitoryV2: (paymentDate, pm, py, base, sd, gd, pct, holidays, lastPaymentDate) => {
        if (!lastPaymentDate) return { amount: 186180, days: 107 };
        return { amount: 0, days: 0 };
      },
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
      startDate: new Date(2026, 3, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
}

async function seedDebt(prisma) {
  return prisma.debt.create({
    data: {
      id: 'd1', groupId: GROUP, contractId: CONTRACT, monthlyRecordId: null,
      periodMonth: 4, periodYear: 2026, periodLabel: 'Abril 2026',
      unpaidRentAmount: 290000, unpaidServicesAmount: 30000, appliedCredit: 0,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 320000, status: 'OPEN',
      punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 3, 1),
    },
  });
}

describe('BUG: accumulatedPunitory se pisaba en pagos parciales sucesivos sobre la misma deuda', () => {
  test('2 pagos parciales que saldan la deuda dejan accumulatedPunitory = bruto histórico (186.180), no el remanente del último pago', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedContract(prisma);
    await seedDebt(prisma);

    // Pago 1: cubre alquiler (290.000) + servicios (30.000) + $86.000 de punitorios
    // (limitado por el efectivo: 406.000 - 320.000 = 86.000 disponibles para punitorios,
    // de los 186.180 que realmente se deben).
    await svc.payDebt('d1', 406000, '2026-07-16', 'EFECTIVO', null);

    const debtAfter1 = await prisma.debt.findUnique({ where: { id: 'd1' } });
    assert.strictEqual(debtAfter1.status, 'PARTIAL', 'todavía quedan $100.180 de punitorios sin cubrir');
    assert.strictEqual(debtAfter1.accumulatedPunitory, 186180, 'el bruto histórico ya debe ser 186.180 desde el primer pago');

    // Pago 2: termina de cubrir el resto exacto de los punitorios ($100.180), sin sobrepago.
    await svc.payDebt('d1', 100180, '2026-07-16', 'EFECTIVO', null);

    const debtAfter2 = await prisma.debt.findUnique({ where: { id: 'd1' } });
    assert.strictEqual(debtAfter2.status, 'PAID');
    assert.strictEqual(debtAfter2.amountPaid, 506180, 'el efectivo cobrado sí se acumula bien: 406.000 + 100.180');
    assert.strictEqual(
      debtAfter2.accumulatedPunitory, 186180,
      'BUG: el 2do pago pisaba esto con 100.180 (lo que quedaba impago en ESE pago), no el bruto histórico completo'
    );

    // Consecuencia visible: "Total" (rentAmount + servicesTotal + accumulatedPunitory,
    // para una deuda ya PAID) debe cerrar contra lo realmente cobrado.
    const total = 290000 + 30000 + debtAfter2.accumulatedPunitory;
    assert.strictEqual(total, 506180, 'Total debe coincidir con amountPaid (506.180), no con 420.180');
  });
});
