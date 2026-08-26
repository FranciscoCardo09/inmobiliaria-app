'use strict';

/**
 * Regresión (2026-08-26): un mes pagado ÍNTEGRAMENTE con el saldo a favor arrastrado
 * quedaba en PENDING para siempre.
 *
 * `computeTotals` (`_recalculateCore`) exigía `amountPaid > 0 || isForgiven` para dar
 * COMPLETE. Un mes cubierto por el crédito tiene `amountPaid === 0`, así que:
 *   - se mostraba como impago ("CANCELÓ: NO") aunque no debiera nada, y
 *   - `closeMonth` lo levantaba mes a mes como candidato a deuda (era la puerta de entrada
 *     del bug del crédito y la mora — ver closeMonthCreditPunitoryBase.test.js).
 *
 * También se fija que el EXCEDENTE del crédito sobrevive como saldo a favor y se arrastra:
 * `totalDue` se persiste clampeado a 0 (no se puede "deber negativo") pero el `balance` se
 * calcula sin clampear, que es lo que deja pasar el sobrante al mes siguiente (C-01).
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

// Julio: alquiler 100.000, sin pagos nuevos, con `credito` de saldo a favor arrastrado.
async function seed(prisma, credito) {
  await prisma.contract.create({ data: CONTRACT });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 1,
      status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false, ivaAmount: 0,
      previousBalance: credito, amountPaid: 0, totalDue: 100000, balance: -100000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false, isPaid: false, isCancelled: false,
      contract: CONTRACT, services: [], transactions: [],
    },
  });
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
}

test('un mes cubierto entero por el saldo a favor queda CANCELADO, no PENDING', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seed(prisma, 120000); // crédito 120.000 sobre cargos de 100.000

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, /* inline */ true);

  const jul = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  assert.strictEqual(jul.status, 'COMPLETE',
    'el crédito cubrió todos los cargos: el mes está saldado aunque no haya entrado efectivo');
  assert.strictEqual(jul.isCancelled, true, 'la columna CANCELÓ debe decir SÍ');
  assert.strictEqual(jul.totalDue, 0, 'no queda nada por pagar');
});

test('el excedente del crédito se arrastra al mes siguiente', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seed(prisma, 120000);

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, true);

  const jul = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  const ago = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  assert.strictEqual(jul.balance, 20000, 'sobran 20.000 del crédito');
  assert.strictEqual(ago.previousBalance, 20000, 'y se arrastran como "A Favor Ant." de agosto');
});

test('si el crédito NO cubre los cargos, el mes sigue PENDING (sin efectivo no está saldado)', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seed(prisma, 40000); // crédito insuficiente

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, true);

  const jul = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  assert.strictEqual(jul.status, 'PENDING');
  assert.strictEqual(jul.isCancelled, false);
  assert.ok(jul.balance < 0, `debe seguir debiendo (balance fue ${jul.balance})`);

  const ago = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  assert.strictEqual(ago.previousBalance, 0, 'un mes que debe no arrastra saldo a favor');
});
