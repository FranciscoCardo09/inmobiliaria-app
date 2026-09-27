'use strict';

/**
 * `MonthlyRecord.isPostExpiry` no puede quedar RANCIO cuando cambia el
 * cronograma del contrato (fecha de inicio / duración).
 *
 * Caso real (Gutierrez Juan Rodrigo, Miguel Cervantes 581, agosto 2026):
 * la renovación del 7/8/2026 creó el contrato nuevo (inicio 1/6/2026) y ese
 * mismo día se generó el registro de AGOSTO cuando la duración todavía no
 * cubría ese mes: `monthNumber 3 === endMonth + 1` → nació con
 * `isPostExpiry = true` (alquiler $0, mes extra de servicios).
 *
 * Después la duración pasó a 3 meses y agosto volvió a ser un mes REAL del
 * contrato (rango 1..3). El refresh de `getOrCreateMonthlyRecords` le devolvió
 * el alquiler ($900.000) y `repairContractRecordMonthNumbers` le arregló el
 * `monthNumber`, pero NADIE volvió a evaluar `isPostExpiry`: quedó en `true`
 * para siempre.
 *
 * Consecuencias del flag rancio (las dos silenciosas, sin ningún error):
 *   1. `computeLiveRecordPunitory` (utils/punitory.js) corta en seco y devuelve
 *      $0 → el mes NO devenga punitorios. Fue el síntoma reportado.
 *   2. `isCloseCandidate` (monthlyCloseService.js) y el `where` de
 *      `previewCloseMonth` lo excluyen → el mes NUNCA genera Deuda. El alquiler
 *      impago desaparece del circuito de cobranza.
 *
 * Regla: `isPostExpiry` es DERIVADO de (startMonth, durationMonths). Un mes que
 * cae dentro del rango del contrato no puede estar marcado como post-vencimiento.
 * La corrección va en una sola dirección (true → false): devolver un mes real al
 * circuito nunca destruye datos. El camino inverso (un mes que se sale del rango)
 * ya lo maneja `repairContractRecordMonthNumbers` con su propia regla de meses
 * fantasma / huérfanos con plata.
 *
 * Run: cd inmobiliaria-app/backend && node --test tests/postExpiryStaleFlag.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const realPunitory = require('../src/utils/punitory');

function makeService(prisma, extraOverrides = {}) {
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
    ...extraOverrides,
  });
}

/** Contrato renovado de Gutierrez: inicio 1/6/2026, 3 meses (junio, julio, agosto). */
async function makeRenewedContract(prisma, overrides = {}) {
  return prisma.contract.create({
    data: {
      id: 'c-nuevo', groupId: 'g1', active: true, renewedAt: null,
      renewedFromContractId: null,
      startDate: new Date(2026, 5, 1), startMonth: 1, durationMonths: 3,
      rescindedAt: null, baseRent: 900000, pagaIva: false,
      punitoryStartDay: 1, punitoryGraceDay: 1, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
      ...overrides,
    },
  });
}

/** Agosto 2026 = mes 3 de 3 (dentro del rango) pero marcado post-vencimiento. */
async function makeStaleAugust(prisma, overrides = {}) {
  return prisma.monthlyRecord.create({
    data: {
      id: 'mr-ago', groupId: 'g1', contractId: 'c-nuevo',
      periodMonth: 8, periodYear: 2026, monthNumber: 3,
      status: 'PENDING', rentAmount: 900000, servicesTotal: 0, includeIva: false,
      ivaAmount: 0, previousBalance: 0, amountPaid: 0, totalDue: 900000,
      balance: -900000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: true, needsRecalculation: false,
      services: [], transactions: [],
      ...overrides,
    },
  });
}

test('repair: un mes DENTRO del rango del contrato pierde el isPostExpiry rancio', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  const contract = await makeRenewedContract(prisma);
  await makeStaleAugust(prisma);

  await svc.repairContractRecordMonthNumbers(contract, { deletePhantoms: true, client: prisma });

  const after = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  assert.strictEqual(
    after.isPostExpiry, false,
    'agosto es el mes 3 de un contrato 1..3: no puede seguir marcado post-vencimiento',
  );
});

test('repair: el mes extra post-vencimiento REAL (endMonth+1) conserva su flag', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  const contract = await makeRenewedContract(prisma);
  // Septiembre 2026 = mes 4 = endMonth + 1 → post-vencimiento legítimo.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-sep', groupId: 'g1', contractId: 'c-nuevo',
      periodMonth: 9, periodYear: 2026, monthNumber: 4,
      status: 'PENDING', rentAmount: 0, servicesTotal: 0, includeIva: false,
      ivaAmount: 0, previousBalance: 0, amountPaid: 0, totalDue: 0, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: true, needsRecalculation: false,
      services: [], transactions: [],
    },
  });

  await svc.repairContractRecordMonthNumbers(contract, { deletePhantoms: true, client: prisma });

  const after = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-sep' } });
  assert.strictEqual(after.isPostExpiry, true, 'el mes extra real sigue siendo post-vencimiento');
  assert.ok(after, 'y no se borra como mes fantasma');
});

test('GET: el refresh corrige el isPostExpiry rancio de un mes dentro del rango', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRenewedContract(prisma);
  await makeStaleAugust(prisma);

  await svc.getOrCreateMonthlyRecords('g1', 8, 2026);

  const after = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  assert.strictEqual(
    after.isPostExpiry, false,
    'refrescar la pantalla de agosto tiene que devolver el mes al circuito normal',
  );
});

test('un mes con isPostExpiry rancio vuelve a devengar punitorios', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRenewedContract(prisma);
  await makeStaleAugust(prisma);

  await svc.getOrCreateMonthlyRecords('g1', 8, 2026);

  const after = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });
  const contract = await prisma.contract.findUnique({ where: { id: 'c-nuevo' } });
  const live = realPunitory.computeLiveRecordPunitory(after, contract, [], {
    isFullyPaid: false,
    calculationDate: '2026-09-27',
  });

  assert.ok(
    live.amount > 0,
    `agosto impago ($900.000, punitorios desde el día 1) tiene que devengar mora; devengó ${live.amount}`,
  );
});
