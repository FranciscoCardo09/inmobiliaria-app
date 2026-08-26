'use strict';

/**
 * Regresión (2026-08-26): cerrar el mes le generaba un SALDO A FAVOR FANTASMA al mes
 * siguiente y, al mismo tiempo, una Deuda por el resto.
 *
 * Causa: `totalDue` y `amountPaid` estaban en escalas distintas. `amountPaid` es toda la
 * plata que entró (incluida la imputada al concepto PUNITORIOS), pero el término de
 * punitorios de `totalDue` contaba sólo los punitorios ADEUDADOS — y una vez creada la
 * Deuda pasaba a ser `debt.accumulatedPunitory`, que al crearse es el impago. Los
 * punitorios ya cobrados contaban entonces dos veces a favor del inquilino:
 *
 *     balance = 2 × punitoriosCobrados − punitoriosTotales + créditoAnterior
 *
 * El parche de las dos pasadas de `_recalculateCore` (2ª pasada con `sumPunitoryConcepts`)
 * tapaba el caso sin deuda, pero estaba explícitamente APAGADO cuando había deuda abierta —
 * justo el momento del cierre.
 *
 * Caso reproducido con el código real: alquiler $100.000, paga el 20/07 $103.350 (alquiler
 * + $3.350 de los $6.600 de punitorios devengados). Antes del fix el balance persistido
 * saltaba de −153,50 a **+100** por el solo hecho de cerrar el mes, mientras la Deuda
 * reclamaba $3.250.
 *
 * Invariante que se fija acá: el `balance` de un mes con Deuda abierta es exactamente
 * `−(total en vivo de la Deuda)`. Nunca positivo.
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

// Punitorios devengados al 20/07 sobre el alquiler completo (11 días, del 10 al 20 incl.)
const PUNITORIO_AL_PAGO = 6600;
const PUNITORIO_COBRADO = 3350;
const PUNITORIO_IMPAGO = PUNITORIO_AL_PAGO - PUNITORIO_COBRADO; // 3250
const PAGO = 100000 + PUNITORIO_COBRADO;

// Punitorio vivo de la Deuda al momento de recalcular (lo calcula el motor real; acá se
// devuelve fijo para que el test no dependa de la fecha de corrida).
const PUNITORIO_VIVO_DEUDA = 234;

function buildEnv() {
  const prisma = makeFakePrisma();

  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      // Deuda recién creada por el cierre: nunca se le pagó nada, así que todo su punitorio
      // está impago. `amount` es el impago en vivo (congelado + tramo nuevo).
      calculateDebtPunitory: async () => ({
        amount: PUNITORIO_IMPAGO + PUNITORIO_VIVO_DEUDA,
        days: 12,
        newPunitoryAmount: PUNITORIO_VIVO_DEUDA,
        accumulatedPunitory: PUNITORIO_IMPAGO,
        unpaidAccumulatedPunitory: 0,
        grossPunitoryToDate: PUNITORIO_IMPAGO + PUNITORIO_VIVO_DEUDA,
        remainingDebt: 0, remainingServices: 0, remainingRent: 0,
        startDate: null, endDate: null,
      }),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
      syncDebtAppliedCreditFromRecord: async () => null,
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
    './contractSweepService': { sweepSupersededContracts: async () => 0 },
  });

  return { prisma, monthlyRecordService };
}

async function seedJulio(prisma, { withDebt }) {
  await prisma.contract.create({ data: CONTRACT });
  if (withDebt) {
    // La fila real en la tabla `debts`: `_recalculateCore` la busca con
    // `tx.debt.findFirst({ monthlyRecordId, status IN (OPEN, PARTIAL) })`. Anidarla sólo
    // dentro del monthlyRecord (como necesita el camino de display) no alcanza.
    await prisma.debt.create({
      data: {
        id: 'd-jul', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr-jul',
        periodLabel: 'Julio 2026', periodMonth: 7, periodYear: 2026,
        originalAmount: 106600, unpaidRentAmount: 0, unpaidServicesAmount: 0,
        previousRecordPayment: PAGO, appliedCredit: 0,
        accumulatedPunitory: PUNITORIO_IMPAGO, currentTotal: PUNITORIO_IMPAGO,
        amountPaid: 0, punitoryPercent: 0.006,
        punitoryStartDate: new Date(2026, 6, 20), lastPaymentDate: null,
        status: 'OPEN', payments: [],
      },
    });
  }
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 1,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 0, includeIva: false, ivaAmount: 0,
      previousBalance: 0, amountPaid: PAGO, totalDue: 0, balance: 0,
      punitoryAmount: PUNITORIO_AL_PAGO, punitoryDays: 11, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false, isPaid: false, isCancelled: false,
      contract: CONTRACT,
      services: [],
      transactions: [{
        id: 'tx1', paymentDate: new Date(2026, 6, 20, 12, 0, 0), amount: PAGO,
        punitoryForgiven: false, punitoryAmount: PUNITORIO_AL_PAGO,
        concepts: [
          { type: 'ALQUILER', amount: 100000 },
          { type: 'PUNITORIOS', amount: PUNITORIO_COBRADO },
        ],
      }],
      ...(withDebt ? {
        debt: {
          id: 'd-jul', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr-jul',
          periodLabel: 'Julio 2026', periodMonth: 7, periodYear: 2026,
          originalAmount: 106600, unpaidRentAmount: 0, unpaidServicesAmount: 0,
          previousRecordPayment: PAGO, appliedCredit: 0,
          accumulatedPunitory: PUNITORIO_IMPAGO, currentTotal: PUNITORIO_IMPAGO,
          amountPaid: 0, punitoryPercent: 0.006,
          punitoryStartDate: new Date(2026, 6, 20), lastPaymentDate: null,
          status: 'OPEN', payments: [],
        },
      } : {}),
    },
  });
}

test('el mes con Deuda abierta nunca queda con saldo a favor: balance = −(total en vivo de la Deuda)', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seedJulio(prisma, { withDebt: true });

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, /* inline */ true);

  const rec = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });

  // Punitorio BRUTO del período = cobrado (3.350) + impago en vivo (3.250 + 234) = 6.834
  const brutoEsperado = PUNITORIO_COBRADO + PUNITORIO_IMPAGO + PUNITORIO_VIVO_DEUDA;
  assert.strictEqual(rec.totalDue, 100000 + brutoEsperado,
    'totalDue debe contar los punitorios COBRADOS además de los adeudados');

  const totalEnVivoDeLaDeuda = PUNITORIO_IMPAGO + PUNITORIO_VIVO_DEUDA;
  assert.strictEqual(rec.balance, -totalEnVivoDeLaDeuda,
    'balance debe ser exactamente el negativo del total en vivo de la Deuda');
  assert.ok(rec.balance < 0, `un mes que debe no puede tener saldo a favor (fue ${rec.balance})`);
  assert.strictEqual(rec.status, 'PARTIAL');
  assert.strictEqual(rec.isCancelled, false);
});

test('el saldo a favor que se arrastra al mes siguiente es 0, no el fantasma', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seedJulio(prisma, { withDebt: true });
  // Agosto ya existe, para verificar el arrastre de la cascada.
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
  assert.strictEqual(ago.previousBalance, 0,
    `agosto no debe heredar saldo a favor de un julio que quedó debiendo (fue ${ago.previousBalance})`);
});

test('sin deuda, el balance tampoco regala los punitorios ya cobrados', async () => {
  const { prisma, monthlyRecordService } = buildEnv();
  await seedJulio(prisma, { withDebt: false });

  await monthlyRecordService.recalculateMultipleRecords(['mr-jul'], null, true);

  const rec = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  // Punitorio bruto = 3.350 cobrados + (3.250 congelado impago + tramo vivo). El tramo vivo
  // depende del día de corrida, así que se verifica la desigualdad, que es la que importa:
  // el mes debe seguir debiendo al menos los 3.250 impagos.
  assert.ok(rec.balance <= -PUNITORIO_IMPAGO + 0.01,
    `el mes debe seguir debiendo al menos los punitorios impagos (balance fue ${rec.balance})`);
  assert.notStrictEqual(rec.status, 'COMPLETE',
    'un mes con punitorios impagos no puede quedar CANCELADO');
});
