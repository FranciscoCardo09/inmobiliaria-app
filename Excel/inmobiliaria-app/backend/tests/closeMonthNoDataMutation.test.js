'use strict';

/**
 * Invariante del cierre mensual: `previewCloseMonth` y `closeMonth` SOLO leen
 * los MonthlyRecord y crean filas de `debts`. No pueden escribir ni un campo de
 * monthly_records (montos, previousBalance, amountPaid, balance, status…), ni
 * transacciones, ni servicios.
 *
 * Por qué se testea (2026-08-10): un saldo a favor fantasma que apareció en
 * agosto se le atribuyó al cierre de julio. No era el cierre — venía de un
 * servicio de julio sobrescrito DESPUÉS del pago (ver
 * scripts/repair-servicio-sobrescrito-post-pago.js), y el cierre solo lo hizo
 * visible. Este test fija el invariante para que la sospecha se pueda descartar
 * sin volver a auditar producción.
 *
 * Además: el cierre es idempotente — correrlo dos veces no duplica deudas.
 *
 * Run: cd inmobiliaria-app/backend && npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');
const { isContractInRangeForMonth } = require('../src/services/monthlyRecordService');

const RECORD_FIELDS = [
  'rentAmount', 'servicesTotal', 'previousBalance', 'punitoryAmount', 'punitoryDays',
  'punitoryForgiven', 'balanceForgiven', 'includeIva', 'ivaAmount', 'totalDue',
  'amountPaid', 'balance', 'status', 'isPaid', 'isCancelled', 'isPostExpiry',
];

function buildEnv() {
  const prisma = makeFakePrisma();

  // Registra cualquier escritura sobre tablas que el cierre NO debería tocar.
  const writes = [];
  for (const model of ['monthlyRecord', 'paymentTransaction', 'monthlyService', 'transactionConcept']) {
    for (const op of ['update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'create', 'createMany']) {
      const original = prisma[model][op].bind(prisma[model]);
      prisma[model][op] = async (...args) => {
        writes.push({ model, op });
        return original(...args);
      };
    }
  }

  const created = [];
  const debtServiceStub = {
    createDebtFromMonthlyRecord: async (record) => {
      const debt = { id: `debt-${record.id}`, monthlyRecordId: record.id };
      created.push(debt);
      return debt;
    },
    calculateImputation: () => ({
      unpaidRent: 250000, unpaidPunitory: 0, totalOriginal: 250000, totalUnpaid: 250000,
      servicesCovered: 0, rentCovered: 0, punitoryCovered: 0,
    }),
  };

  const svc = proxyquire('../src/services/monthlyCloseService', {
    '../lib/prisma': prisma,
    './debtService': debtServiceStub,
    './monthlyRecordService': { isContractInRangeForMonth },
  });

  return { prisma, svc, writes, created };
}

function makeContract(overrides = {}) {
  return {
    id: 'c1', groupId: 'g1', propertyId: 'p1', contractType: 'INQUILINO',
    startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
    baseRent: 250000, active: true, rescindedAt: null,
    tenant: { id: 't1', name: 'Inquilino Test' }, contractTenants: [],
    property: { id: 'p1', address: 'Calle Falsa 123', owner: { id: 'o1', name: 'Dueño' } },
    ...overrides,
  };
}

// El mes que cerró exacto: COMPLETE, balance 0. El cierre ni lo mira (filtra por
// status PENDING/PARTIAL) y bajo ningún concepto puede dejarle un saldo a favor.
async function seed(prisma) {
  const contract = makeContract();
  await prisma.contract.create({ data: contract });

  const paid = {
    id: 'mr-paid', groupId: 'g1', contractId: 'c1', monthNumber: 7,
    periodMonth: 7, periodYear: 2026, status: 'COMPLETE', isPostExpiry: false,
    rentAmount: 250000, servicesTotal: 20000, previousBalance: 0, punitoryAmount: 0,
    punitoryDays: 0, punitoryForgiven: false, balanceForgiven: 0, includeIva: false,
    ivaAmount: 0, totalDue: 270000, amountPaid: 270000, balance: 0,
    isPaid: true, isCancelled: true, services: [], transactions: [], debt: null, contract,
  };
  const unpaid = {
    id: 'mr-unpaid', groupId: 'g1', contractId: 'c1', monthNumber: 8,
    periodMonth: 7, periodYear: 2026, status: 'PENDING', isPostExpiry: false,
    rentAmount: 250000, servicesTotal: 0, previousBalance: 0, punitoryAmount: 0,
    punitoryDays: 0, punitoryForgiven: false, balanceForgiven: 0, includeIva: false,
    ivaAmount: 0, totalDue: 250000, amountPaid: 0, balance: -250000,
    isPaid: false, isCancelled: false, services: [], transactions: [], debt: null, contract,
  };
  await prisma.monthlyRecord.create({ data: paid });
  await prisma.monthlyRecord.create({ data: unpaid });
}

const snapshot = async (prisma) => {
  const rows = await prisma.monthlyRecord.findMany({ where: { groupId: 'g1' } });
  return rows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => RECORD_FIELDS.map((f) => `${f}=${r[f]}`).join('|'));
};

test('previewCloseMonth no escribe nada', async () => {
  const { prisma, svc, writes } = buildEnv();
  await seed(prisma);
  writes.length = 0; // descartar las escrituras del propio seed
  const before = await snapshot(prisma);

  const preview = await svc.previewCloseMonth('g1', 7, 2026);

  assert.equal(preview.summary.willGenerateDebts, 1, 'debe previsualizar 1 deuda');
  assert.deepEqual(writes, [], `preview escribió: ${JSON.stringify(writes)}`);
  assert.deepEqual(await snapshot(prisma), before);
});

test('closeMonth solo crea deudas: no toca montos, pagos ni balances de ningún MonthlyRecord', async () => {
  const { prisma, svc, writes, created } = buildEnv();
  await seed(prisma);
  writes.length = 0; // descartar las escrituras del propio seed
  const before = await snapshot(prisma);

  const res = await svc.closeMonth('g1', 7, 2026);

  assert.equal(res.debtsCreated, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].monthlyRecordId, 'mr-unpaid', 'la deuda es del mes impago');
  assert.deepEqual(writes, [], `closeMonth escribió sobre tablas que no debe: ${JSON.stringify(writes)}`);
  assert.deepEqual(await snapshot(prisma), before, 'el cierre alteró algún MonthlyRecord');

  // El mes que pagó justo sigue en cero: el cierre no puede inventar saldo a favor.
  const paid = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-paid' } });
  assert.equal(paid.balance, 0);
  assert.equal(paid.previousBalance, 0);
});

test('closeMonth es idempotente: correrlo de nuevo no duplica deudas ni cambia datos', async () => {
  const { prisma, svc, created } = buildEnv();
  await seed(prisma);

  await svc.closeMonth('g1', 7, 2026);
  // Reflejar en el fake lo que en producción hace la FK: el record ya tiene deuda.
  await prisma.monthlyRecord.update({ where: { id: 'mr-unpaid' }, data: { debt: created[0] } });

  const after = await snapshot(prisma);
  const res2 = await svc.closeMonth('g1', 7, 2026);

  assert.equal(res2.debtsCreated, 0, 'el segundo cierre no debe crear deudas');
  assert.equal(created.length, 1);
  assert.deepEqual(await snapshot(prisma), after);
});
