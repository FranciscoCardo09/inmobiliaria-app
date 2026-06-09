const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// syncDebtServicesFromRecord propaga a la deuda los servicios cargados en su mes.
// Antes, agregar un servicio a un mes que ya tenía deuda NO sumaba el servicio a la
// deuda ni le calculaba punitorios. Estos tests fijan el comportamiento nuevo.

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      calculatePunitoryV2: () => ({ amount: 0, days: 0, fromDate: null, toDate: null }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
  });
}

test('syncDebtServicesFromRecord - suma a la deuda un servicio agregado al mes después de crearla', async () => {
  const prisma = makeFakePrisma();
  await prisma.monthlyRecord.create({ data: {
    id: 'mr1', rentAmount: 645830, includeIva: false, amountPaid: 0, punitoryAmount: 0, previousBalance: 0,
    services: [{ amount: 98657, conceptType: { category: 'OTROS' } }],
  }});
  await prisma.debt.create({ data: {
    id: 'd1', monthlyRecordId: 'mr1', status: 'OPEN',
    unpaidRentAmount: 645830, unpaidServicesAmount: 0, accumulatedPunitory: 0,
    amountPaid: 0, originalAmount: 645830, currentTotal: 645830,
  }});

  const debtService = buildService(prisma);
  await debtService.syncDebtServicesFromRecord('mr1');

  const after = await prisma.debt.findUnique({ where: { id: 'd1' } });
  assert.strictEqual(after.unpaidServicesAmount, 98657, 'el servicio del mes se suma a la deuda');
  assert.strictEqual(after.currentTotal, 744487, 'currentTotal incluye alquiler + servicios');
  assert.strictEqual(after.originalAmount, 744487, 'originalAmount se ajusta por el delta');
});

test('syncDebtServicesFromRecord - un descuento NO suma a la base (servicios netos)', async () => {
  const prisma = makeFakePrisma();
  await prisma.monthlyRecord.create({ data: {
    id: 'mr2', rentAmount: 100000, includeIva: false, amountPaid: 0, punitoryAmount: 0, previousBalance: 0,
    services: [
      { amount: 20000, conceptType: { category: 'OTROS' } },
      { amount: 5000, conceptType: { category: 'DESCUENTO' } },
    ],
  }});
  await prisma.debt.create({ data: {
    id: 'd2', monthlyRecordId: 'mr2', status: 'OPEN',
    unpaidRentAmount: 100000, unpaidServicesAmount: 0, accumulatedPunitory: 0,
    amountPaid: 0, originalAmount: 100000, currentTotal: 100000,
  }});

  const debtService = buildService(prisma);
  await debtService.syncDebtServicesFromRecord('mr2');

  const after = await prisma.debt.findUnique({ where: { id: 'd2' } });
  // servicios netos = 20000 - 5000 = 15000 (el descuento resta, no genera punitorios)
  assert.strictEqual(after.unpaidServicesAmount, 15000, 'descuento resta del neto');
});

test('syncDebtServicesFromRecord - NO infla servicios con previousBalance negativo corrupto (caso Yocsina)', async () => {
  const prisma = makeFakePrisma();
  // Mes con servicios YA pagados (amountPaid los cubre) pero previousBalance corrupto
  // muy negativo. Sin el clamp, la imputación creería que nada está cubierto e
  // inflaría unpaidServicesAmount de la deuda.
  await prisma.monthlyRecord.create({ data: {
    id: 'mr4', rentAmount: 901388, includeIva: false, amountPaid: 999000, punitoryAmount: 0,
    previousBalance: -1818142,
    services: [{ amount: 21690, conceptType: { category: 'OTROS' } }],
  }});
  await prisma.debt.create({ data: {
    id: 'd4', monthlyRecordId: 'mr4', status: 'OPEN',
    unpaidRentAmount: 0, unpaidServicesAmount: 0, accumulatedPunitory: 76.92,
    amountPaid: 0, originalAmount: 1004202.92, currentTotal: 76.92,
  }});

  const debtService = buildService(prisma);
  await debtService.syncDebtServicesFromRecord('mr4');

  const after = await prisma.debt.findUnique({ where: { id: 'd4' } });
  assert.strictEqual(after.unpaidServicesAmount, 0, 'servicios cubiertos por el pago: no se inflan');
  assert.strictEqual(after.currentTotal, 76.92, 'currentTotal no cambia');
});

test('syncDebtServicesFromRecord - NO toca una deuda PAID', async () => {
  const prisma = makeFakePrisma();
  await prisma.monthlyRecord.create({ data: {
    id: 'mr3', rentAmount: 100000, includeIva: false, amountPaid: 0, punitoryAmount: 0, previousBalance: 0,
    services: [{ amount: 50000, conceptType: { category: 'OTROS' } }],
  }});
  await prisma.debt.create({ data: {
    id: 'd3', monthlyRecordId: 'mr3', status: 'PAID',
    unpaidRentAmount: 0, unpaidServicesAmount: 0, accumulatedPunitory: 0,
    amountPaid: 100000, originalAmount: 100000, currentTotal: 0,
  }});

  const debtService = buildService(prisma);
  const res = await debtService.syncDebtServicesFromRecord('mr3');
  assert.strictEqual(res, null, 'deuda PAID no se modifica');
  const after = await prisma.debt.findUnique({ where: { id: 'd3' } });
  assert.strictEqual(after.unpaidServicesAmount, 0);
});
