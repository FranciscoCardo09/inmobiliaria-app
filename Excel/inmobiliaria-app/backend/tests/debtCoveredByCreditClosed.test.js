'use strict';

/**
 * Bug real (2026-10-20, caso Yocsina 1615 — Asociación Civil Compartir, Julio 2026):
 * una deuda que el saldo a favor cubre ENTERA quedaba OPEN para siempre y bloqueaba el
 * cobro de los meses siguientes.
 *
 * Cómo se llegó: Julio se pagó el 18/07 con el sobrante de Junio ($1.017.110,08) más
 * $10.457 en efectivo (sobraron $0,08). El cierre del 31/07 —con el doble conteo del tramo
 * pago→cierre que se arregló el 14/08— le inventó mora y creó una deuda de Julio. El script
 * de reparación de ese doble conteo bajó la mora y dejó `currentTotal` en $0, pero NO tocó
 * `status`: la deuda quedó OPEN con neto −$0,08.
 *
 * Desde ahí `calculateDebtPunitory` (rama `hasPayment`, por los $10.457 previos al cierre)
 * devengaba mora desde el ancla sobre $919.910 sin mirar que el crédito ya cubría todo
 * ($524.348,70 al 20/10), y el auto-cierre por crédito de `syncDebtAppliedCreditFromRecord`
 * nunca la cerraba: comparaba contra un techo que incluía esa misma mora en vivo. Como es el
 * período más viejo, `canPayCurrentMonth` exigía "pagar primero Julio" y no dejaba cargar
 * Agosto.
 *
 * Invariante (`isDebtSettledAtAnchor`): una deuda con algún pago cuyo neto al ancla (impago +
 * mora congelada − crédito − pagos) es ≤ $1 está SALDADA — no devenga mora, no bloquea el
 * orden cronológico, y los escritores de `currentTotal` la cierran como PAID.
 *
 * Run with: cd inmobiliaria-app/backend && node --test tests/debtCoveredByCreditClosed.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');
const realPunitory = require('../src/utils/punitory');

function buildDebtService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    // Fórmula REAL de punitorios: el bug es justamente el monto que devenga.
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
      recalculateMultipleRecords: async () => 0,
    },
  });
}

const GROUP = 'g1';
const CONTRACT = 'c1';
const TODAY = '2026-10-20';

async function seedYocsina(prisma, debtOverrides = {}) {
  await prisma.contract.create({
    data: {
      id: CONTRACT, groupId: GROUP, renewedFromContractId: null,
      startDate: new Date(2026, 4, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  // Julio: alquiler 900.000 + servicios 30.367 + mora 97.200, crédito 1.017.110,08, pagó 10.457.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: GROUP, contractId: CONTRACT, monthNumber: 3, periodMonth: 7, periodYear: 2026,
      rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0, punitoryAmount: 97200,
      previousBalance: 1017110.08, amountPaid: 10457, status: 'PARTIAL', isCancelled: false,
    },
  });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ago', groupId: GROUP, contractId: CONTRACT, monthNumber: 4, periodMonth: 8, periodYear: 2026,
      rentAmount: 900000, servicesTotal: 28416, ivaAmount: 0, punitoryAmount: 0,
      previousBalance: 0, amountPaid: 0, status: 'PENDING', isCancelled: false,
    },
  });
  // Estado EXACTO de la deuda en producción tras la reparación del 14/08.
  await prisma.debt.create({
    data: {
      id: 'd-jul', groupId: GROUP, contractId: CONTRACT, monthlyRecordId: 'mr-jul',
      periodLabel: 'Julio 2026', periodMonth: 7, periodYear: 2026,
      originalAmount: 1027567, unpaidRentAmount: 900000, unpaidServicesAmount: 19910,
      previousRecordPayment: 10457, appliedCredit: 1017110.08, accumulatedPunitory: 97200,
      currentTotal: 0, amountPaid: 0, punitoryPercent: 0.006,
      punitoryStartDate: new Date('2026-07-18T12:00:00.000Z'), lastPaymentDate: null,
      status: 'OPEN', closedAt: null,
      ...debtOverrides,
    },
  });
  await prisma.debt.create({
    data: {
      id: 'd-ago', groupId: GROUP, contractId: CONTRACT, monthlyRecordId: 'mr-ago',
      periodLabel: 'Agosto 2026', periodMonth: 8, periodYear: 2026,
      originalAmount: 1101215.98, unpaidRentAmount: 900000, unpaidServicesAmount: 28416,
      previousRecordPayment: 0, appliedCredit: 0.08, accumulatedPunitory: 172799.98,
      currentTotal: 1101215.9, amountPaid: 0, punitoryPercent: 0.006,
      punitoryStartDate: new Date(2026, 7, 1), lastPaymentDate: null,
      status: 'OPEN', closedAt: null,
    },
  });
}

describe('Deuda cubierta entera por saldo a favor (caso Yocsina, Julio 2026)', () => {
  test('debtNetAtAnchor: impago + mora congelada − crédito − pagos', () => {
    const svc = buildDebtService(makeFakePrisma());
    assert.equal(svc.debtNetAtAnchor({
      unpaidRentAmount: 900000, unpaidServicesAmount: 19910, accumulatedPunitory: 97200,
      appliedCredit: 1017110.08, amountPaid: 0,
    }), -0.08);
  });

  test('no devenga mora en vivo: el crédito ya cubre todo lo adeudado al ancla', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedYocsina(prisma);
    const debt = await prisma.debt.findUnique({ where: { id: 'd-jul' } });

    const r = await svc.calculateDebtPunitory(debt, TODAY, null, true);
    // Antes: 95 días × 0,6% × $919.910 = $524.348,70 de mora fantasma.
    assert.equal(r.amount, 0);
    assert.equal(r.unpaidAccumulatedPunitory, 0);
    assert.ok(r.remainingDebt <= 0, `remainingDebt=${r.remainingDebt}`);
  });

  test('syncDebtAppliedCreditFromRecord cierra como PAID la deuda que el crédito cubre', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedYocsina(prisma);

    await svc.syncDebtAppliedCreditFromRecord('d-jul', 1017110.08);

    const after = await prisma.debt.findUnique({ where: { id: 'd-jul' } });
    assert.equal(after.status, 'PAID');
    assert.equal(after.currentTotal, 0);
    assert.ok(after.closedAt, 'closedAt debe quedar seteado');
    assert.equal(after.accumulatedPunitory, 97200, 'la mora congelada (ya cubierta) no cambia');
  });

  test('no bloquea el orden cronológico: Agosto queda como período más viejo y se puede pagar', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedYocsina(prisma);

    const res = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 8, periodYear: 2026 });
    assert.equal(res.canPay, true, res.message);
    assert.equal(res.oldestUnpaid.periodMonth, 8);
    assert.ok(!res.debts.some((d) => d.id === 'd-jul'), 'Julio no debe figurar como deuda');
  });

  test('control: con crédito PARCIAL la deuda sigue devengando mora como siempre', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    await seedYocsina(prisma, { appliedCredit: 500000, currentTotal: 517110 });
    const debt = await prisma.debt.findUnique({ where: { id: 'd-jul' } });

    const r = await svc.calculateDebtPunitory(debt, TODAY, null, true);
    assert.ok(r.amount > 0, 'una deuda con saldo real pendiente sigue devengando');

    const res = await svc.canPayCurrentMonth(GROUP, CONTRACT, { periodMonth: 8, periodYear: 2026 });
    assert.equal(res.canPay, false, 'Julio con saldo real sigue bloqueando Agosto');
    assert.equal(res.blockingPeriod.periodMonth, 7);
  });

  test('control: SIN pago previo al cierre el invariante no aplica (la mora congelada está contenida en la viva)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildDebtService(prisma);
    // Mismos números pero sin los $10.457: ancla día 1, regla vigente (caso Ponce) = sigue devengando.
    await seedYocsina(prisma, {
      previousRecordPayment: 0, punitoryStartDate: new Date(2026, 6, 1),
    });
    const debt = await prisma.debt.findUnique({ where: { id: 'd-jul' } });

    assert.equal(svc.isDebtSettledAtAnchor(debt), false);
    const r = await svc.calculateDebtPunitory(debt, TODAY, null, true);
    assert.ok(r.amount > 0);
  });
});

describe('repair-punitorio-doble-conteo-cierre: si la corrección deja la deuda en ≤ $1, la cierra', () => {
  const { repairOne } = require('../scripts/repair-punitorio-doble-conteo-cierre');

  test('neto ≤ $1 tras bajar la mora → PAID (es el agujero que dejó a Yocsina en OPEN con $0)', async () => {
    const prisma = makeFakePrisma();
    await seedYocsina(prisma, { accumulatedPunitory: 174472.41, currentTotal: 77362.33 });

    await repairOne(prisma, {
      debtId: 'd-jul', correctAccum: 97200, newCurrentTotal: 0, newOriginalAmount: 1027567,
    });

    const after = await prisma.debt.findUnique({ where: { id: 'd-jul' } });
    assert.equal(after.accumulatedPunitory, 97200);
    assert.equal(after.status, 'PAID');
    assert.ok(after.closedAt);
  });

  test('neto > $1 tras bajar la mora → sigue OPEN', async () => {
    const prisma = makeFakePrisma();
    await seedYocsina(prisma, { appliedCredit: 500000, accumulatedPunitory: 174472.41 });

    await repairOne(prisma, {
      debtId: 'd-jul', correctAccum: 97200, newCurrentTotal: 517110, newOriginalAmount: 1027567,
    });

    const after = await prisma.debt.findUnique({ where: { id: 'd-jul' } });
    assert.equal(after.status, 'OPEN');
    assert.equal(after.closedAt, null);
  });
});

describe('Mes abierto: la mora que pagó el saldo a favor no vuelve como impaga (Julio de Yocsina sin deuda)', () => {
  const CONTRACT_PUN = { punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const julyRecord = (txs) => ({
    periodMonth: 7, periodYear: 2026, rentAmount: 900000, servicesTotal: 30367, includeIva: false,
    previousBalance: 1017110.08, amountPaid: txs.reduce((s, t) => s + t.amount, 0),
    punitoryAmount: 97200, punitoryDays: 18, punitoryForgiven: false, isPostExpiry: false,
    transactions: txs,
  });
  const TX_18_07 = {
    paymentDate: new Date('2026-07-18T12:00:00.000Z'), amount: 10457, punitoryForgiven: false,
    concepts: [{ type: 'A_FAVOR', amount: -1017110.08 }, { type: 'PUNITORIOS', amount: 10457 }],
  };

  test('creditPaidFrozenPunitory: el crédito pagó $86.743 de los $97.200 de mora', () => {
    assert.equal(realPunitory.creditPaidFrozenPunitory({
      txCount: 1, frozenPunitory: 97200, lastTxPunitoryPaid: 10457, appliedCredit: 1017110.08,
      amountPaid: 10457, rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0,
    }), 86743);
  });

  test('bruto del mes = $97.200 (no $146.643) → total $10.456,92 y saldo +$0,08', () => {
    const r = julyRecord([TX_18_07]);
    const gross = realPunitory.computeGrossRecordPunitory(r, CONTRACT_PUN, [], { calculationDate: TODAY });
    assert.equal(gross.amount, 97200);
    assert.equal(gross.unpaid, 0, 'nada de mora impaga ni mora compuesta sobre ella');
    const totalDue = realPunitory.round2(900000 + 30367 + gross.amount - 1017110.08);
    assert.equal(totalDue, 10456.92);
    assert.equal(realPunitory.round2(10457 - totalDue), 0.08);
  });

  test('con un segundo pago el crédito ya actuó: el congelado nuevo no se descuenta de nuevo', () => {
    assert.equal(realPunitory.creditPaidFrozenPunitory({
      txCount: 2, frozenPunitory: 5000, lastTxPunitoryPaid: 1000, appliedCredit: 1017110.08,
      amountPaid: 11457, rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0,
    }), 0);
  });

  test('sin crédito no cambia nada (el sobrepago en efectivo no se toma como mora pagada)', () => {
    assert.equal(realPunitory.creditPaidFrozenPunitory({
      txCount: 1, frozenPunitory: 97200, lastTxPunitoryPaid: 0, appliedCredit: 0,
      amountPaid: 2000000, rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0,
    }), 0);
  });

  test('crédito que no alcanza a cubrir los cargos: no paga mora', () => {
    assert.equal(realPunitory.creditPaidFrozenPunitory({
      txCount: 1, frozenPunitory: 97200, lastTxPunitoryPaid: 0, appliedCredit: 500000,
      amountPaid: 100000, rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0,
    }), 0);
  });
});
