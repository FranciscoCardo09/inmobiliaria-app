'use strict';

/**
 * Tres agujeros del saldo a favor encontrados en la auditoría del 2026-10-20 (caso Yocsina 1615,
 * Julio 2026), los tres reproducidos sobre una copia de producción:
 *
 * 1. `syncDebtAppliedCreditFromRecord`: el tope del crédito usaba la mora congelada YA NETA del
 *    propio crédito (circular). Cuando el crédito pagaba la mora, el tope la excluía, el crédito
 *    bajaba justo esa mora ($97.200) y reaparecía como saldo a favor fantasma en Agosto.
 * 2. `_punitoryOutsideConcepts`: la mora pagada en EFECTIVO antes del cierre (concepto
 *    PUNITORIOS) se contaba otra vez dentro de `accumulatedPunitory`, porque la Deuda imputa ese
 *    pago a servicios/alquiler. El mes quedaba debiendo $10.456,92 ya cobrados.
 * 3. `_recalculateCore`: la condonación (`balanceForgiven`) se arrastraba como crédito cuando el
 *    balance del mes ya era ≥ 0 ($11.142,92 condonados sobre un mes con +$0,08).
 *
 * Run: cd inmobiliaria-app/backend && node --test tests/creditCeilingAndForgivenCarry.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

describe('syncDebtAppliedCreditFromRecord: el tope incluye la mora congelada bruta', () => {
  test('deuda con pago previo cubierta por el crédito: no le baja la mora al crédito', async () => {
    const prisma = makeFakePrisma();
    const svc = proxyquire('../src/services/debtService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    });
    await prisma.contract.create({
      data: { id: 'c1', groupId: 'g1', punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 },
    });
    await prisma.monthlyRecord.create({
      data: {
        id: 'mr-jul', groupId: 'g1', contractId: 'c1', periodMonth: 7, periodYear: 2026,
        rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0, punitoryAmount: 97200,
        previousBalance: 1017110.08, amountPaid: 10457,
      },
    });
    await prisma.debt.create({
      data: {
        id: 'd-jul', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr-jul',
        periodLabel: 'Julio 2026', periodMonth: 7, periodYear: 2026,
        unpaidRentAmount: 900000, unpaidServicesAmount: 19910, accumulatedPunitory: 97200,
        previousRecordPayment: 10457, appliedCredit: 1017110.08, amountPaid: 0, currentTotal: 0,
        punitoryPercent: 0.006, punitoryStartDate: new Date('2026-07-18T12:00:00.000Z'),
        lastPaymentDate: null, status: 'OPEN',
      },
    });

    await svc.syncDebtAppliedCreditFromRecord('d-jul', 1017110.08);

    const d = await prisma.debt.findUnique({ where: { id: 'd-jul' } });
    assert.equal(d.status, 'PAID');
    // Antes: 919.910 (sólo alquiler + servicios) → $97.200 de mora volvían como crédito.
    assert.equal(d.appliedCredit, 1017110);
  });
});

describe('_punitoryOutsideConcepts: la mora cobrada en efectivo antes del cierre no se cuenta dos veces', () => {
  const { _punitoryOutsideConcepts } = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': makeFakePrisma(),
  });
  const debt = {
    createdAt: new Date('2026-07-31T14:11:26Z'), previousRecordPayment: 10457, amountPaid: 0,
    unpaidRentAmount: 900000, unpaidServicesAmount: 19910, accumulatedPunitory: 97200,
    appliedCredit: 1017110, status: 'PAID',
  };
  const record = {
    rentAmount: 900000, servicesTotal: 30367, ivaAmount: 0,
    transactions: [{
      createdAt: new Date('2026-07-21T15:35:13Z'), punitoryForgiven: false,
      concepts: [{ type: 'A_FAVOR', amount: -1017110.08 }, { type: 'PUNITORIOS', amount: 10457 }],
    }],
  };

  test('Yocsina: fuera de los conceptos quedan $86.743 (crédito), no $97.200', () => {
    const outside = _punitoryOutsideConcepts(debt, null, record);
    assert.equal(outside, 86743);
    // Bruto del mes = conceptos (10.457) + fuera (86.743) = 97.200 → total 10.456,92, saldo +0,08.
    assert.equal(realPunitory.round2(10457 + outside), 97200);
  });

  test('pagos cargados DESPUÉS del cierre (espejo de payDebt) no corren el cálculo', () => {
    const later = { ...record, transactions: [{ ...record.transactions[0], createdAt: new Date('2026-08-05T10:00:00Z') }] };
    assert.equal(_punitoryOutsideConcepts(debt, null, later), 97200);
  });

  test('si la imputación ya dio ese efectivo por pagado a mora, no se descuenta (caso pancho)', () => {
    // Alquiler 1.000.000 + servicios 32.000 + IVA 210.000; pagó 1.300.000 → 58.000 fueron a mora.
    const d = { ...debt, previousRecordPayment: 1300000, unpaidRentAmount: 0, unpaidServicesAmount: 0, accumulatedPunitory: 32000, appliedCredit: 0, status: 'OPEN' };
    const r = { rentAmount: 1000000, servicesTotal: 32000, ivaAmount: 210000, transactions: [{ createdAt: new Date('2026-04-24T16:04:55Z'), concepts: [{ type: 'PUNITORIOS', amount: 90000 }] }] };
    // De los 90.000 del recibo, 58.000 la Deuda ya los descontó; los 32.000 restantes sí se duplicaban.
    assert.equal(_punitoryOutsideConcepts(d, { unpaidAccumulatedPunitory: 32000, amount: 34560 }, r), 34560);
  });
});

describe('_recalculateCore: la condonación no se arrastra como saldo a favor', () => {
  const CONTRACT = {
    id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
    startDate: new Date(2026, 6, 1), startMonth: 1, durationMonths: 24,
    rescindedAt: null, baseRent: 100000, pagaIva: false, contractType: 'INQUILINO',
    punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
    adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
    comprobantes: [], tenant: { id: 't1', name: 'Inquilino Test' }, contractTenants: [],
    property: { id: 'p1', address: 'Calle Falsa 123', owner: { id: 'o1', name: 'Dueño' } },
  };
  const rec = (id, m, n, extra) => ({
    id, groupId: 'g1', contractId: 'c1', periodMonth: m, periodYear: 2026, monthNumber: n,
    status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false, ivaAmount: 0,
    previousBalance: 0, amountPaid: 0, totalDue: 100000, balance: -100000,
    punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
    balanceForgiven: 0, isPostExpiry: false, isPaid: false, isCancelled: false,
    contract: CONTRACT, services: [], transactions: [], ...extra,
  });

  async function run(julExtra) {
    const prisma = makeFakePrisma();
    const svc = proxyquire('../src/services/monthlyRecordService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
      './debtService': {
        calculateDebtPunitory: async () => ({}),
        preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
        syncDebtAppliedCreditFromRecord: async () => null,
      },
      './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
      './contractSweepService': { sweepSupersededContracts: async () => 0 },
    });
    await prisma.contract.create({ data: CONTRACT });
    await prisma.monthlyRecord.create({ data: rec('mr-jul', 7, 1, julExtra) });
    await prisma.monthlyRecord.create({ data: rec('mr-ago', 8, 2) });
    await svc.recalculateMultipleRecords(['mr-jul'], null, true);
    return prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  }

  test('condonación sobre un mes que ya cerraba con +20.000: arrastra 20.000, no 25.000', async () => {
    const ago = await run({ previousBalance: 120000, balanceForgiven: 5000 });
    assert.equal(ago.previousBalance, 20000);
  });

  test('condonación que lleva a cero un mes que debía: arrastra 0', async () => {
    const ago = await run({ previousBalance: 40000, balanceForgiven: 60000 });
    assert.equal(ago.previousBalance, 0);
  });
});
