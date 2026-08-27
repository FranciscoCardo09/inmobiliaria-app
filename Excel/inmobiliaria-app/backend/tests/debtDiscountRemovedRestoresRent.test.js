const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// Caso Ciuro (mayo 2026, reportado 2026-08-27): a un mes YA CERRADO EN DEUDA se le cargó un
// servicio de categoría DESCUENTO, después se vio que iba a otro mes y se lo borró — pero el
// modal de pago seguía mostrando el alquiler descontado, para siempre.
//
// Dos defectos encadenados, uno por capa:
//
//  (1) `calculateImputation` pliega el EXCESO de descuento (servicesTotal < 0) dentro de
//      `unpaidRent`, y `syncDebtServicesFromRecord` —la función enganchada a todas las
//      mutaciones de servicio— sólo escribía `unpaidServicesAmount`. El alquiler descontado
//      no tenía quién lo devolviera. Peor: su early-return la volvía no-op cuando el
//      descuento era el único servicio del mes (unpaidServices 0 → 0).
//
//  (2) el auto-heal de `calculateDebtPunitory` comparaba el total recalculado contra el total
//      ALMACENADO, así que era un ratchet de una sola vía: la bajada se persistía y la subida
//      quedaba rechazada para siempre. Ahora el techo son los cargos BRUTOS vivos del mes,
//      que es un invariante (la imputación nunca puede superarlos) y sigue frenando la
//      inflación fantasma de una fuente corrupta.

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      calculatePunitoryV2: () => ({ amount: 0, days: 0, fromDate: null, toDate: null }),
      getHolidaysForYear: async () => [],
      computePunitoryBase: () => 0,
      round2: (n) => Math.round(n * 100) / 100,
    },
  });
}

const RENT = 650000;
const LUZ = 20000;
const DISC = 100000;

// Estado en el que el bug dejaba la deuda: el exceso de descuento ($80.000) pegado al alquiler.
const RATCHETED_RENT = RENT - (DISC - LUZ); // 570.000

async function seedRecord(prisma, { id, services, servicesTotal, amountPaid = 0 }) {
  await prisma.monthlyRecord.create({ data: {
    id, rentAmount: RENT, includeIva: false, amountPaid, punitoryAmount: 0,
    previousBalance: 0, servicesTotal, ivaAmount: 0, services,
  }});
}

async function seedDebt(prisma, { id, monthlyRecordId, unpaidRentAmount, unpaidServicesAmount, originalAmount, amountPaid = 0 }) {
  await prisma.debt.create({ data: {
    id, groupId: 'g1', contractId: 'c1', monthlyRecordId,
    periodMonth: 5, periodYear: 2026, periodLabel: 'Mayo 2026',
    originalAmount, unpaidRentAmount, unpaidServicesAmount,
    accumulatedPunitory: 0, appliedCredit: 0, previousRecordPayment: 0,
    currentTotal: unpaidRentAmount + unpaidServicesAmount, amountPaid, status: 'OPEN',
    punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 4, 1), lastPaymentDate: null,
  }});
}

// ── Capa 1: el resync de escritura devuelve el alquiler ──────────────────────

test('syncDebtServicesFromRecord - borrar un DESCUENTO que era el UNICO servicio devuelve el alquiler', async () => {
  const prisma = makeFakePrisma();
  // El descuento ya se borró: el mes quedó sin servicios.
  await seedRecord(prisma, { id: 'mr1', services: [], servicesTotal: 0 });
  // La deuda quedó con el descuento entero pegado al alquiler.
  await seedDebt(prisma, { id: 'd1', monthlyRecordId: 'mr1',
    unpaidRentAmount: RENT - DISC, unpaidServicesAmount: 0, originalAmount: RENT - DISC });

  await buildService(prisma).syncDebtServicesFromRecord('mr1');

  const after = await prisma.debt.findUnique({ where: { id: 'd1' } });
  assert.strictEqual(after.unpaidRentAmount, RENT, 'el alquiler vuelve al valor pleno');
  assert.strictEqual(after.unpaidServicesAmount, 0);
  assert.strictEqual(after.currentTotal, RENT);
  assert.strictEqual(after.originalAmount, RENT, 'originalAmount acompaña el delta');
});

test('syncDebtServicesFromRecord - borrar el DESCUENTO con otro servicio presente restaura alquiler Y servicios', async () => {
  const prisma = makeFakePrisma();
  await seedRecord(prisma, { id: 'mr2', servicesTotal: LUZ,
    services: [{ amount: LUZ, conceptType: { category: 'OTROS' } }] });
  await seedDebt(prisma, { id: 'd2', monthlyRecordId: 'mr2',
    unpaidRentAmount: RATCHETED_RENT, unpaidServicesAmount: 0, originalAmount: RATCHETED_RENT });

  await buildService(prisma).syncDebtServicesFromRecord('mr2');

  const after = await prisma.debt.findUnique({ where: { id: 'd2' } });
  assert.strictEqual(after.unpaidRentAmount, RENT, 'alquiler restaurado');
  assert.strictEqual(after.unpaidServicesAmount, LUZ, 'servicio real restaurado');
  assert.strictEqual(after.currentTotal, RENT + LUZ);
  assert.strictEqual(after.originalAmount, RENT + LUZ);
});

test('syncDebtServicesFromRecord - cargar un DESCUENTO mayor a los servicios SIGUE bajando el alquiler', async () => {
  const prisma = makeFakePrisma();
  // Descuento recién cargado: neto de servicios negativo.
  await seedRecord(prisma, { id: 'mr3', servicesTotal: LUZ - DISC, services: [
    { amount: LUZ, conceptType: { category: 'OTROS' } },
    { amount: DISC, conceptType: { category: 'DESCUENTO' } },
  ]});
  await seedDebt(prisma, { id: 'd3', monthlyRecordId: 'mr3',
    unpaidRentAmount: RENT, unpaidServicesAmount: LUZ, originalAmount: RENT + LUZ });

  await buildService(prisma).syncDebtServicesFromRecord('mr3');

  const after = await prisma.debt.findUnique({ where: { id: 'd3' } });
  assert.strictEqual(after.unpaidRentAmount, RATCHETED_RENT, 'el exceso de descuento baja el alquiler');
  assert.strictEqual(after.unpaidServicesAmount, 0, 'el neto de servicios queda absorbido');
  assert.strictEqual(after.currentTotal, RATCHETED_RENT);
  assert.strictEqual(after.originalAmount, RATCHETED_RENT, 'orig = cargos brutos del mes');
});

test('syncDebtServicesFromRecord - con pagos propios en la deuda NO toca el alquiler (lo maneja payDebt)', async () => {
  const prisma = makeFakePrisma();
  await seedRecord(prisma, { id: 'mr4', servicesTotal: LUZ,
    services: [{ amount: LUZ, conceptType: { category: 'OTROS' } }] });
  await seedDebt(prisma, { id: 'd4', monthlyRecordId: 'mr4',
    unpaidRentAmount: RATCHETED_RENT, unpaidServicesAmount: 0,
    originalAmount: RATCHETED_RENT, amountPaid: 100000 });

  await buildService(prisma).syncDebtServicesFromRecord('mr4');

  const after = await prisma.debt.findUnique({ where: { id: 'd4' } });
  assert.strictEqual(after.unpaidRentAmount, RATCHETED_RENT, 'el ancla de alquiler es de payDebt');
  assert.strictEqual(after.unpaidServicesAmount, LUZ, 'los servicios se sincronizan igual');
});

test('syncDebtServicesFromRecord - un servicio agregado a un mes cerrado CON pago pre-cierre ya no queda invisible', async () => {
  const prisma = makeFakePrisma();
  // El mes cerró con un pago parcial de $30.000 y sin servicios: deuda de alquiler 620.000.
  // Después se le agrega LUZ 20.000. La imputación manda el pago primero a servicios
  // (20.000) y el resto al alquiler (10.000) => rent 640.000, serv 0, total 640.000.
  // Antes del fix esto era un NO-OP: `unpaidServices` seguía dando 0, el early-return
  // disparaba, y el servicio nuevo no aparecía nunca en la deuda ni en el modal de pago.
  await prisma.monthlyRecord.create({ data: {
    id: 'mr6', rentAmount: RENT, includeIva: false, amountPaid: 30000, punitoryAmount: 0,
    previousBalance: 0, servicesTotal: LUZ, ivaAmount: 0,
    services: [{ amount: LUZ, conceptType: { category: 'OTROS' } }],
  }});
  await prisma.debt.create({ data: {
    id: 'd6', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr6',
    periodMonth: 5, periodYear: 2026, periodLabel: 'Mayo 2026',
    originalAmount: RENT, unpaidRentAmount: 620000, unpaidServicesAmount: 0,
    accumulatedPunitory: 0, appliedCredit: 0, previousRecordPayment: 30000,
    currentTotal: 620000, amountPaid: 0, status: 'OPEN',
    punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 4, 1), lastPaymentDate: null,
  }});

  await buildService(prisma).syncDebtServicesFromRecord('mr6');

  const after = await prisma.debt.findUnique({ where: { id: 'd6' } });
  assert.strictEqual(after.currentTotal, 640000, 'el servicio nuevo suma a la deuda');
  assert.strictEqual(after.unpaidRentAmount, 640000);
  assert.strictEqual(after.unpaidServicesAmount, 0, 'el pago pre-cierre cubrió los servicios');
});

// ── Capa 2: el auto-heal de lectura ya no es un ratchet ──────────────────────

const preloadedFor = (mr) => ({
  contractMap: new Map([['c1', { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006 }]]),
  holidayMap: new Map([[2026, []]]),
  monthlyRecordMap: new Map([['mr5', mr]]),
});

test('calculateDebtPunitory - una deuda ya dañada por el ratchet se sana al leerla', async () => {
  const prisma = makeFakePrisma();
  await seedDebt(prisma, { id: 'd5', monthlyRecordId: 'mr5',
    unpaidRentAmount: RATCHETED_RENT, unpaidServicesAmount: LUZ,
    originalAmount: RENT + LUZ });

  const mr = { rentAmount: RENT, servicesTotal: LUZ, ivaAmount: 0, amountPaid: 0, punitoryAmount: 0, previousBalance: 0 };
  const res = await buildService(prisma).calculateDebtPunitory(
    await prisma.debt.findUnique({ where: { id: 'd5' } }),
    new Date(2026, 7, 27), preloadedFor(mr), false);

  assert.strictEqual(res.remainingRent, RENT, 'el modal de pago muestra el alquiler pleno');
  const after = await prisma.debt.findUnique({ where: { id: 'd5' } });
  assert.strictEqual(after.unpaidRentAmount, RENT, 'y se persiste la corrección');
  assert.strictEqual(after.currentTotal, RENT + LUZ);
});

test('calculateDebtPunitory - el techo sigue frenando la inflación fantasma de una fuente corrupta', async () => {
  const prisma = makeFakePrisma();
  await seedDebt(prisma, { id: 'd5', monthlyRecordId: 'mr5',
    unpaidRentAmount: 0, unpaidServicesAmount: 0, originalAmount: RENT + LUZ });

  // amountPaid corrupto NEGATIVO: la imputación cree que se debe muchísimo más que los
  // cargos del mes (servicios impagos = 20.000 − (−2.000.000)). Eso está por encima del
  // techo bruto y tiene que rechazarse.
  const corruptMr = { rentAmount: RENT, servicesTotal: LUZ, ivaAmount: 0, amountPaid: -2000000, punitoryAmount: 0, previousBalance: 0 };
  await buildService(prisma).calculateDebtPunitory(
    await prisma.debt.findUnique({ where: { id: 'd5' } }),
    new Date(2026, 7, 27), preloadedFor(corruptMr), false);

  const after = await prisma.debt.findUnique({ where: { id: 'd5' } });
  assert.strictEqual(after.unpaidRentAmount, 0, 'no se infla el alquiler');
  assert.strictEqual(after.unpaidServicesAmount, 0, 'no se inflan los servicios');
});

test('calculateDebtPunitory - una LECTURA no puede subir una deuda CONDONADA (status PAID)', async () => {
  const prisma = makeFakePrisma();
  // `forgiveDebt` sólo marca status PAID + closedAt: deja `amountPaid` en 0 y los montos
  // impagos como estaban. Sin la excepción para PAID, el techo bruto dejaría que un GET le
  // volviera a subir el total y la condonación quedaría a medias.
  await prisma.debt.create({ data: {
    id: 'd7', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr5',
    periodMonth: 5, periodYear: 2026, periodLabel: 'Mayo 2026',
    originalAmount: RENT + LUZ, unpaidRentAmount: RATCHETED_RENT, unpaidServicesAmount: 0,
    accumulatedPunitory: 0, appliedCredit: 0, previousRecordPayment: 0,
    currentTotal: RATCHETED_RENT, amountPaid: 0, status: 'PAID', closedAt: new Date(),
    punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 4, 1), lastPaymentDate: null,
  }});

  const mr = { rentAmount: RENT, servicesTotal: LUZ, ivaAmount: 0, amountPaid: 0, punitoryAmount: 0, previousBalance: 0 };
  await buildService(prisma).calculateDebtPunitory(
    await prisma.debt.findUnique({ where: { id: 'd7' } }),
    new Date(2026, 7, 27),
    {
      contractMap: new Map([['c1', { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006 }]]),
      holidayMap: new Map([[2026, []]]),
      monthlyRecordMap: new Map([['mr5', mr]]),
    },
    false);

  const after = await prisma.debt.findUnique({ where: { id: 'd7' } });
  assert.strictEqual(after.unpaidRentAmount, RATCHETED_RENT, 'la deuda cerrada no se sube desde una lectura');
  assert.strictEqual(after.status, 'PAID', 'sigue condonada');
});
