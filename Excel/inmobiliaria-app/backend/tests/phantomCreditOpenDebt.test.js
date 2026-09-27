'use strict';

/**
 * Un mes con Deuda ABIERTA no puede regalarle al mes siguiente un saldo a favor
 * que la Deuda ya se consumió.
 *
 * Caso real (Ponce Emilia Roxana, Los Pinos 4171, julio 2026): el 16/8 pagó
 * $1.200.000 contra la deuda de MAYO; sólo $114.356,17 eran punitorios vivos, así
 * que $1.085.643,83 quedaron como SOBREPAGO y bajaron en cascada a JUNIO.
 *
 * Junio tenía Deuda abierta y `syncDebtAppliedCreditFromRecord` le aplicó el
 * crédito ENTERO (`appliedCredit = 1.085.643,83`): la deuda se lo comió todo.
 * Pero el `balance` PERSISTIDO del registro de junio era un snapshot viejo
 * (+$151.356,91), escrito antes del arreglo del punitorio BRUTO. Nada vuelve a
 * recalcular un mes con deuda abierta —el refresh del GET sólo reacciona a
 * cambios de alquiler o de `previousBalance`—, así que ese número quedó
 * congelado y los caminos que derivan el `previousBalance` del mes siguiente lo
 * leen tal cual: JULIO mostró "$151.357 a favor" mientras JUNIO seguía debiendo
 * $415.832,45 en vivo. Peor: ese crédito fantasma entró como `appliedCredit` de
 * la deuda de julio y le descontó plata real.
 *
 * Invariante: lo que un mes puede arrastrar es, como mucho, la parte del crédito
 * que su propia Deuda NO absorbió (`previousBalance - appliedCredit`).
 * `syncDebtAppliedCreditFromRecord` ya clampea `appliedCredit` al total EN VIVO
 * de la deuda, así que el excedente legítimo sigue pasando entero — y el
 * fantasma, que nace de un `balance` rancio, no.
 *
 * Run: cd inmobiliaria-app/backend && node --test tests/phantomCreditOpenDebt.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const realPunitory = require('../src/utils/punitory');

function makeService(prisma) {
  return proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      calculateDebtPunitory: async () => ({}),
      preloadDebtDependencies: async () => ({
        contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map(),
      }),
      syncDebtAppliedCreditFromRecord: async () => null,
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
    './contractSweepService': { sweepSupersededContracts: async () => {} },
  });
}

async function makeContract(prisma) {
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2026, 5, 1), startMonth: 1, durationMonths: 12,
      rescindedAt: null, baseRent: 787763, pagaIva: false,
      punitoryStartDay: 6, punitoryGraceDay: 6, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
    },
  });
}

/**
 * Junio: recibió $1.085.643,83 de crédito, tiene Deuda abierta que se lo aplicó
 * ENTERO, y arrastra un `balance` positivo rancio de $151.356,91.
 */
async function makeJune(prisma, { appliedCredit, balance }) {
  return prisma.monthlyRecord.create({
    data: {
      id: 'mr-jun', groupId: 'g1', contractId: 'c1',
      periodMonth: 6, periodYear: 2026, monthNumber: 1,
      status: 'PENDING', rentAmount: 787763, servicesTotal: 0, includeIva: false,
      ivaAmount: 0, previousBalance: 1085643.83, amountPaid: 0,
      totalDue: 0, balance, punitoryAmount: 0, punitoryDays: 0,
      punitoryForgiven: false, balanceForgiven: 0, isPostExpiry: false,
      needsRecalculation: false, services: [], transactions: [],
      debt: { id: 'd-jun', status: 'OPEN', appliedCredit },
    },
  });
}

test('el mes siguiente NO hereda el saldo a favor que la deuda abierta ya se consumió', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);
  // La deuda de junio absorbió el crédito COMPLETO; el +151.356,91 es un snapshot rancio.
  await makeJune(prisma, { appliedCredit: 1085643.83, balance: 151356.91 });

  await svc.getOrCreateMonthlyRecords('g1', 7, 2026);

  const julio = await prisma.monthlyRecord.findFirst({
    where: { contractId: 'c1', periodMonth: 7, periodYear: 2026 },
  });
  assert.ok(julio, 'julio se genera');
  assert.strictEqual(
    julio.previousBalance, 0,
    'la deuda de junio se comió todo el crédito: julio no puede arrancar con saldo a favor',
  );
});

test('el excedente REAL del crédito (lo que la deuda no absorbió) sí se arrastra', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);
  // La deuda sólo pudo aplicar $900.000 de los $1.085.643,83: sobran $185.643,83.
  await makeJune(prisma, { appliedCredit: 900000, balance: 185643.83 });

  await svc.getOrCreateMonthlyRecords('g1', 7, 2026);

  const julio = await prisma.monthlyRecord.findFirst({
    where: { contractId: 'c1', periodMonth: 7, periodYear: 2026 },
  });
  assert.strictEqual(
    julio.previousBalance, 185643.83,
    'el excedente que la deuda no llegó a cubrir es plata real y tiene que bajar',
  );
});

test('un mes SIN deuda arrastra su saldo a favor sin tocar', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jun', groupId: 'g1', contractId: 'c1',
      periodMonth: 6, periodYear: 2026, monthNumber: 1,
      status: 'COMPLETE', rentAmount: 787763, servicesTotal: 0, includeIva: false,
      ivaAmount: 0, previousBalance: 0, amountPaid: 900000,
      totalDue: 787763, balance: 112237, punitoryAmount: 0, punitoryDays: 0,
      punitoryForgiven: false, balanceForgiven: 0, isPostExpiry: false,
      needsRecalculation: false, services: [], transactions: [],
    },
  });

  await svc.getOrCreateMonthlyRecords('g1', 7, 2026);

  const julio = await prisma.monthlyRecord.findFirst({
    where: { contractId: 'c1', periodMonth: 7, periodYear: 2026 },
  });
  assert.strictEqual(julio.previousBalance, 112237, 'un sobrepago real se arrastra entero');
});

test('el refresh del GET también limpia el saldo a favor fantasma ya persistido', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);
  await makeJune(prisma, { appliedCredit: 1085643.83, balance: 151356.91 });
  // Julio ya existe y YA quedó contaminado con el crédito fantasma.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 2,
      status: 'PENDING', rentAmount: 787763, servicesTotal: 0, includeIva: false,
      ivaAmount: 0, previousBalance: 151356.91, amountPaid: 0,
      totalDue: 636406.09, balance: -636406.09, punitoryAmount: 0, punitoryDays: 0,
      punitoryForgiven: false, balanceForgiven: 0, isPostExpiry: false,
      needsRecalculation: false, services: [], transactions: [],
    },
  });

  await svc.getOrCreateMonthlyRecords('g1', 7, 2026);

  const julio = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  assert.strictEqual(
    julio.previousBalance, 0,
    'refrescar julio tiene que borrar el "A Favor Ant." que nunca existió',
  );
});
