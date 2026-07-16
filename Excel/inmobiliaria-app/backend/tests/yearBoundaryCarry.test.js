const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-16 (AUDITORIA_FUNCIONAL_2026-07-10.md): `_recalculateCore` y
// `_markRecordsDirty` acotaban la cascada de recálculo a `periodYear` — una
// corrección en diciembre (ej: anular un pago) nunca propagaba a enero del
// año siguiente, dejando créditos o faltantes fantasma congelados para
// siempre al cruzar el año.
//
// Fix: usar `monthNumber` (contador continuo del contrato, NO se reinicia
// cada año calendario) como único criterio del rango de la cascada, sin fijar
// `periodYear`. `monthNumber: { gte }` ya cruza el límite de año por sí solo.
//
// Mandato del usuario: NINGÚN test de punitorios existente puede romperse.
// La primera mitad de este archivo es la batería de BLINDAJE (regresión del
// comportamiento correcto DENTRO de un mismo año, que debe seguir intacto);
// la segunda mitad son los tests NUEVOS de A-16 (cruce de año).
// ============================================================================

function makeService(prisma) {
  return proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      calculateDebtPunitory: async () => ({}),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });
}

async function makeContract(prisma, overrides = {}) {
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2025, 0, 1), startMonth: 1, durationMonths: 24,
      rescindedAt: null, baseRent: 100000, pagaIva: false,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// BLINDAJE: dentro del mismo año calendario, la cascada sigue funcionando
// exactamente igual que antes del fix (esto ya estaba cubierto por
// punitoryBase.test.js/monthlyServices.test.js; se repite acá con
// `recalculateMultipleRecords` en modo inline para fijar el contrato del
// comportamiento previo al tocar `_recalculateCore`/`_markRecordsDirty`).
// ---------------------------------------------------------------------------

test('BLINDAJE: anular un pago de enero propaga correctamente el arrastre a febrero (mismo año)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);

  // Enero 2026 (monthNumber=13): pagado de más ($150.000 de $100.000 debidos) → crédito $50.000.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ene', groupId: 'g1', contractId: 'c1',
      periodMonth: 1, periodYear: 2026, monthNumber: 13,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 150000, totalDue: 100000, balance: 50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      transactions: [
        { paymentDate: new Date(2026, 0, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] },
        { paymentDate: new Date(2026, 0, 6, 12, 0, 0), amount: 50000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'SOBREPAGO', amount: 50000 }] },
      ],
    },
  });

  // Febrero 2026 (monthNumber=14): ya refleja el crédito de $50.000 de enero, pagado con eso + $50.000 más.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-feb', groupId: 'g1', contractId: 'c1',
      periodMonth: 2, periodYear: 2026, monthNumber: 14,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 50000, amountPaid: 50000, totalDue: 50000, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      transactions: [
        { paymentDate: new Date(2026, 1, 5, 12, 0, 0), amount: 50000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 50000 }] },
      ],
    },
  });

  // Anular el pago de $50.000 "de más" de enero: el mismo array de transactions
  // se recrea con solo el pago de 100000, simulando un cancelDebtPayment/deleteTransaction.
  await prisma.monthlyRecord.update({
    where: { id: 'mr-ene' },
    data: {
      transactions: [
        { paymentDate: new Date(2026, 0, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] },
      ],
    },
  });

  await svc.recalculateMultipleRecords(['mr-ene'], null, true);

  const ene = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ene' } });
  const feb = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-feb' } });

  assert.equal(ene.balance, 0, 'enero ya no tiene crédito (el pago de más fue anulado)');
  assert.equal(feb.previousBalance, 0, 'BLINDAJE: febrero pierde el crédito fantasma (esto YA funcionaba antes del fix, mismo año)');
  assert.equal(feb.totalDue, 100000, 'BLINDAJE: sin crédito previo, febrero vuelve a deber el alquiler completo');
});

// ---------------------------------------------------------------------------
// A-16 NUEVO: el mismo escenario, pero cruzando el límite de año calendario
// (diciembre 2025 → enero 2026). Antes del fix, `periodYear` cortaba acá y
// enero quedaba con el crédito fantasma para siempre.
// ---------------------------------------------------------------------------

test('A-16: anular un pago de diciembre 2025 SÍ propaga a enero 2026 (cruce de año)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);

  // Diciembre 2025 (monthNumber=12): pagado de más ($150.000 de $100.000) → crédito $50.000.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-dic', groupId: 'g1', contractId: 'c1',
      periodMonth: 12, periodYear: 2025, monthNumber: 12,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 150000, totalDue: 100000, balance: 50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      transactions: [
        { paymentDate: new Date(2025, 11, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] },
        { paymentDate: new Date(2025, 11, 6, 12, 0, 0), amount: 50000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'SOBREPAGO', amount: 50000 }] },
      ],
    },
  });

  // Enero 2026 (monthNumber=13): ya refleja el crédito de $50.000 de diciembre.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ene', groupId: 'g1', contractId: 'c1',
      periodMonth: 1, periodYear: 2026, monthNumber: 13,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 50000, amountPaid: 50000, totalDue: 50000, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      transactions: [
        { paymentDate: new Date(2026, 0, 5, 12, 0, 0), amount: 50000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 50000 }] },
      ],
    },
  });

  // Anular el pago "de más" de diciembre.
  await prisma.monthlyRecord.update({
    where: { id: 'mr-dic' },
    data: {
      transactions: [
        { paymentDate: new Date(2025, 11, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] },
      ],
    },
  });

  await svc.recalculateMultipleRecords(['mr-dic'], null, true);

  const dic = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-dic' } });
  const ene = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ene' } });

  assert.equal(dic.balance, 0, 'diciembre ya no tiene crédito (el pago de más fue anulado)');
  assert.equal(ene.previousBalance, 0, 'A-16: enero 2026 pierde el crédito fantasma aunque cruce el año calendario');
  assert.equal(ene.totalDue, 100000, 'A-16: enero vuelve a deber el alquiler completo, sin el crédito fantasma');
  assert.notEqual(ene.status, 'COMPLETE', 'A-16: con solo $50.000 pagados de $100.000, enero ya no puede seguir COMPLETE');
});

test('A-16: _markRecordsDirty también cruza el año (no solo _recalculateCore inline)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeContract(prisma);

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-dic', groupId: 'g1', contractId: 'c1',
      periodMonth: 12, periodYear: 2025, monthNumber: 12,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 50000, totalDue: 100000, balance: -50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      needsRecalculation: false, services: [], transactions: [],
    },
  });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ene', groupId: 'g1', contractId: 'c1',
      periodMonth: 1, periodYear: 2026, monthNumber: 13,
      status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 0, totalDue: 100000, balance: -100000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      needsRecalculation: false, services: [], transactions: [],
    },
  });

  // Camino ASYNC (dirty + setImmediate), como usan la mayoría de los callers reales.
  await svc.recalculateMultipleRecords(['mr-dic'], null, false);

  const dic = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-dic' } });
  const ene = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ene' } });
  assert.equal(dic.needsRecalculation, true);
  assert.equal(ene.needsRecalculation, true, 'A-16: el mes de enero (año siguiente) también debe quedar marcado dirty');
});
