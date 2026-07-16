const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// Bug reportado por el usuario (2026-07-12): el modal de pago mostraba una
// deuda a pagar de $160.000 cuando debía ser $110.000 — la diferencia ($50.000)
// coincide exactamente con el saldo a favor (`appliedCredit`) que el endpoint
// `GET /debts/:id` (controlador `getDebtById`) ignoraba por completo:
// calculaba `remainingDebt = unpaidRentAmount - amountPaid` a mano, sin restar
// `appliedCredit` ni sumar `unpaidServicesAmount`.
//
// `getOpenDebts`/`getDebts` (debtService.js) ya calculaban esto bien vía
// `calculateDebtPunitory`, que SÍ resta `appliedCredit` (debtService.js:491:
// `remainingDebt: round2(Math.max(remainingBase - (debt.appliedCredit || 0), 0))`).
// Fix: `getDebtById` reutiliza esa misma función en vez de duplicar el cálculo.
// ============================================================================

function buildEnv() {
  const prisma = makeFakePrisma();
  const debtService = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
      calculatePunitoryV2: () => ({ amount: 0, days: 0, fromDate: null, toDate: null }),
    },
  });
  const controllerStubs = {
    '../lib/prisma': prisma,
    '../services/debtService': debtService,
    '../services/monthlyCloseService': { previewCloseMonth: async () => ({}), closeMonth: async () => ({}) },
    '../utils/apiResponse': {
      success: (res, body) => res.send({ ok: true, data: body }),
      notFound: (res, msg) => res.send({ ok: false, error: msg, status: 404 }),
    },
  };
  const controller = proxyquire('../src/controllers/debtsController', controllerStubs);
  return { prisma, controller };
}

function fakeRes() {
  return { send(payload) { this.payload = payload; return this; } };
}

test('getDebtById: descuenta el saldo a favor (appliedCredit) del monto a pagar, igual que getOpenDebts', async () => {
  const { prisma, controller } = buildEnv();

  await prisma.contract.create({
    data: { id: 'c1', groupId: 'g1', punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006 },
  });

  // Escenario real reportado: deuda de $160.000 de alquiler, con $50.000 de
  // saldo a favor aplicado en el cierre. Debería mostrar $110.000 a pagar, no $160.000.
  await prisma.debt.create({
    data: {
      id: 'd1', groupId: 'g1', contractId: 'c1', monthlyRecordId: null,
      periodMonth: 6, periodYear: 2026, periodLabel: 'Junio 2026',
      unpaidRentAmount: 160000, unpaidServicesAmount: 0, appliedCredit: 50000,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 110000, status: 'OPEN',
      punitoryStartDate: new Date(2026, 5, 10), punitoryPercent: 0.006,
    },
  });

  const res = fakeRes();
  await controller.getDebtById({ params: { groupId: 'g1', id: 'd1' } }, res, () => {});

  assert.equal(res.payload.ok, true);
  const debt = res.payload.data;
  assert.equal(debt.remainingDebt, 110000, 'remainingDebt debe descontar los $50.000 de saldo a favor');
  assert.equal(debt.liveCurrentTotal, 110000, 'liveCurrentTotal (lo que se muestra a pagar) debe ser $110.000, no $160.000');
});

test('getDebtById: sin saldo a favor, el monto a pagar es el total impago completo', async () => {
  const { prisma, controller } = buildEnv();

  await prisma.contract.create({
    data: { id: 'c1', groupId: 'g1', punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006 },
  });

  await prisma.debt.create({
    data: {
      id: 'd1', groupId: 'g1', contractId: 'c1', monthlyRecordId: null,
      periodMonth: 6, periodYear: 2026, periodLabel: 'Junio 2026',
      unpaidRentAmount: 160000, unpaidServicesAmount: 0, appliedCredit: 0,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 160000, status: 'OPEN',
      punitoryStartDate: new Date(2026, 5, 10), punitoryPercent: 0.006,
    },
  });

  const res = fakeRes();
  await controller.getDebtById({ params: { groupId: 'g1', id: 'd1' } }, res, () => {});

  const debt = res.payload.data;
  assert.equal(debt.remainingDebt, 160000);
  assert.equal(debt.liveCurrentTotal, 160000);
});
