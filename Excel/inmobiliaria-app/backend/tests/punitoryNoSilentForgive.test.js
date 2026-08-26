'use strict';

/**
 * Regresión (2026-08-26), el reverso del saldo a favor fantasma: un mes con punitorios
 * IMPAGOS se marcaba CANCELADO y la mora desaparecía en silencio.
 *
 * `_recalculateCore` hacía dos pasadas. La primera usaba el punitorio ADEUDADO
 * (`unpaidFrozen + nuevo`), que es MENOR que los punitorios ya cobrados cuando el pago
 * alcanzó a cubrir parte de la mora — y esos cobrados viajan dentro de `amountPaid`. Con un
 * `totalDue` así de bajo, la primera pasada daba `balance >= -1` → COMPLETE, la segunda
 * pasada congelaba el punitorio en lo efectivamente cobrado y el balance terminaba en 0.
 * Resultado: el mes quedaba "CANCELÓ SÍ" debiendo mora, y `closeMonth` (que filtraba por
 * status PENDING/PARTIAL) ni lo miraba, así que nunca se generaba la deuda.
 *
 * Caso reproducido con el código real — alquiler 100.000 + servicios 20.000, punitorios
 * devengados 15.000, paga 130.000 (el motor imputa servicios 20.000 + alquiler 100.000 +
 * punitorios 10.000, quedan 5.000 de mora impaga):
 *
 *     pasada 1: punitorio  5.390 → totalDue 125.390 → balance +4.610 → COMPLETE
 *     pasada 2: punitorio 10.000 → totalDue 130.000 → balance      0 → COMPLETE
 *     >>> los 5.000 de punitorios impagos desaparecían
 *
 * Con el punitorio BRUTO (10.000 cobrados + 5.390 adeudados = 15.390) el mes queda PARTIAL
 * debiendo 5.390, y el cierre genera la deuda.
 *
 * Run: cd inmobiliaria-app/backend && npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

const CONTRACT = {
  id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
  startDate: new Date(2026, 6, 1), startMonth: 1, durationMonths: 24,
  rescindedAt: null, baseRent: 100000, pagaIva: false, contractType: 'INQUILINO',
  punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
  adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
  comprobantes: [], tenant: { id: 't1', name: 'Inquilino Test' }, contractTenants: [],
  property: { id: 'p1', address: 'Calle Falsa 123', owner: { id: 'o1', name: 'Dueño' } },
};

const PUNITORIO_DEVENGADO = 15000;
const PUNITORIO_COBRADO = 10000;
const PUNITORIO_IMPAGO = PUNITORIO_DEVENGADO - PUNITORIO_COBRADO; // 5000
const PAGO = 130000; // servicios 20.000 + alquiler 100.000 + punitorios 10.000

function buildEnv() {
  const prisma = makeFakePrisma();
  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
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
  return { prisma, monthlyRecordService };
}

async function seed(prisma) {
  await prisma.contract.create({ data: CONTRACT });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 1,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 20000, includeIva: false, ivaAmount: 0,
      previousBalance: 0, amountPaid: PAGO, totalDue: 0, balance: 0,
      punitoryAmount: PUNITORIO_DEVENGADO, punitoryDays: 25, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false, isPaid: false, isCancelled: false,
      contract: CONTRACT,
      services: [{ amount: 20000, conceptType: { category: 'SERVICIO' } }],
      transactions: [{
        id: 'tx1', paymentDate: new Date(2026, 6, 20, 12, 0, 0), amount: PAGO,
        punitoryForgiven: false, punitoryAmount: PUNITORIO_DEVENGADO,
        concepts: [
          { type: 'EXPENSAS', amount: 20000 },
          { type: 'ALQUILER', amount: 100000 },
          { type: 'PUNITORIOS', amount: PUNITORIO_COBRADO },
        ],
      }],
    },
  });
}

test('un mes con punitorios impagos NO queda CANCELADO', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seed(prisma);

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, /* inline */ true);

  const rec = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  assert.notStrictEqual(rec.status, 'COMPLETE',
    `quedan ${PUNITORIO_IMPAGO} de mora impaga: el mes no puede estar CANCELADO`);
  assert.strictEqual(rec.isCancelled, false, 'la columna CANCELÓ debe decir NO');
  assert.strictEqual(rec.isPaid, false);
});

test('el balance refleja la mora impaga, no cero', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seed(prisma);

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, true);

  const rec = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  // El punitorio bruto es 10.000 cobrados + (5.000 congelados impagos + tramo vivo desde el
  // 20/07). El tramo vivo depende del día de corrida, así que se verifica la cota: el mes
  // debe deber AL MENOS los 5.000 impagos.
  assert.ok(rec.balance <= -PUNITORIO_IMPAGO + 0.01,
    `debe al menos los ${PUNITORIO_IMPAGO} de mora impaga (balance fue ${rec.balance})`);
  assert.ok(rec.totalDue >= 120000 + PUNITORIO_DEVENGADO - 0.01,
    `totalDue debe incluir los ${PUNITORIO_DEVENGADO} de mora devengada (fue ${rec.totalDue})`);
});

test('no arrastra saldo a favor al mes siguiente', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seed(prisma);
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ago', groupId: 'g1', contractId: 'c1',
      periodMonth: 8, periodYear: 2026, monthNumber: 2,
      status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false, ivaAmount: 0,
      previousBalance: 0, amountPaid: 0, totalDue: 100000, balance: -100000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false, isPaid: false, isCancelled: false,
      contract: CONTRACT, services: [], transactions: [],
    },
  });

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, true);

  const ago = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  assert.strictEqual(ago.previousBalance, 0);
});

test('si la mora se pagó COMPLETA, el mes sí queda CANCELADO en cero', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await prisma.contract.create({ data: CONTRACT });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ok', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 1,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 20000, includeIva: false, ivaAmount: 0,
      previousBalance: 0, amountPaid: 120000 + PUNITORIO_DEVENGADO, totalDue: 0, balance: 0,
      punitoryAmount: PUNITORIO_DEVENGADO, punitoryDays: 25, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false, isPaid: false, isCancelled: false,
      contract: CONTRACT,
      services: [{ amount: 20000, conceptType: { category: 'SERVICIO' } }],
      transactions: [{
        id: 'tx1', paymentDate: new Date(2026, 6, 20, 12, 0, 0), amount: 120000 + PUNITORIO_DEVENGADO,
        punitoryForgiven: false, punitoryAmount: PUNITORIO_DEVENGADO,
        concepts: [
          { type: 'EXPENSAS', amount: 20000 },
          { type: 'ALQUILER', amount: 100000 },
          { type: 'PUNITORIOS', amount: PUNITORIO_DEVENGADO },
        ],
      }],
    },
  });

  await monthlyRecordService.recalculateMultipleRecords(['mr-ok'], null, true);

  const rec = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ok' } });
  assert.strictEqual(rec.status, 'COMPLETE', 'pagó todo, incluida la mora');
  assert.strictEqual(rec.balance, 0, 'y no le queda saldo a favor inventado');
  assert.strictEqual(rec.totalDue, 120000 + PUNITORIO_DEVENGADO);
});
