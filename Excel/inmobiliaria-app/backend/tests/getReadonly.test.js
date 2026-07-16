const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-06 / A-07 / A-26 (AUDITORIA_FUNCIONAL_2026-07-10.md): `getOrCreateMonthlyRecords`
// corre desde un simple GET (pantalla mensual, dashboard, reportes — incluso
// para el rol VIEWER) y ANTES escribía en DB de dos formas destructivas:
//
//   (A-06) recalculaba y persistía rentAmount/IVA/status de meses YA COMPLETE
//   en el bloque de refresh (solo el previousBalance estaba protegido).
//
//   (A-07/A-26) un fix inline borraba/renumeraba registros con monthNumber
//   obsoleto usando el criterio laxo `amountPaid > 0` (a diferencia de
//   `repairContractRecordMonthNumbers`, que también chequea `debt` y
//   `transactions`) — podía borrar un registro con deuda o transacciones y
//   `amountPaid === 0`, o tirar 500 por violar el `@@unique([contractId,
//   monthNumber])`.
//
// Fix (decisión del usuario 2026-07-12, enfoque "quirúrgico"): el GET sigue
// creando meses faltantes, pero (1) un mes ya COMPLETE queda completamente
// congelado, y (2) el GET ya NO borra ni renumera ningún registro — ese
// repair vive solo en `repairContractRecordMonthNumbers`
// (contractsController.js, tras editar el contrato).
// ============================================================================

function makeService(prisma, extraOverrides = {}) {
  return proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
    },
    './debtService': {
      calculateDebtPunitory: async () => ({}),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
    ...extraOverrides,
  });
}

async function makeContract(prisma, overrides = {}) {
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
      rescindedAt: null, baseRent: 100000, pagaIva: false,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
      ...overrides,
    },
  });
}

test('A-06: un mes ya COMPLETE queda BYTE-A-BYTE igual tras un GET sobre un período estable (snapshot antes/después)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeContract(prisma);
  // Julio 2026: mes COMPLETE, pagado hace tiempo. El alquiler "vigente" del
  // contrato (baseRent=100000) coincide con record.rentAmount a propósito, pero
  // aunque NO coincidiera, un mes COMPLETE ya no debe tocarse (ver test siguiente).
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 100000, totalDue: 100000, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      isPaid: true, isCancelled: true,
      services: [], transactions: [],
    },
  });

  const before = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });

  // GET del período de julio (el mismo mes ya existente) — el escenario más
  // directo de "refrescar la pantalla de un mes ya cerrado".
  await svc.getOrCreateMonthlyRecords('g1', 7, 2026);

  const after = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  assert.deepStrictEqual(after, before, 'ningún campo del mes COMPLETE debe cambiar tras el GET');
});

test('A-06: un mes COMPLETE con rentAmount desactualizado (el contrato cambió después) NO se recalcula', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  // El contrato hoy tiene baseRent=150000, pero el mes de julio quedó COMPLETE
  // con el alquiler viejo ($100.000). Antes del fix, el refresh del GET
  // pisaba rentAmount/totalDue/balance de este mes ya cerrado con el valor nuevo.
  await makeContract(prisma, { baseRent: 150000 });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 100000, totalDue: 100000, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      isPaid: true, isCancelled: true,
      services: [], transactions: [],
    },
  });

  await svc.getOrCreateMonthlyRecords('g1', 7, 2026);

  const after = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-jul' } });
  assert.strictEqual(after.rentAmount, 100000, 'rentAmount de un mes COMPLETE no se actualiza al alquiler nuevo del contrato');
  assert.strictEqual(after.totalDue, 100000);
  assert.strictEqual(after.balance, 0);
  assert.strictEqual(after.status, 'COMPLETE');
});

test('A-26: el GET ya NO borra un registro con Debt asociada y amountPaid=0, aunque su monthNumber esté obsoleto', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeContract(prisma);

  // Registro "fantasma": quedó con monthNumber=8 pero corresponde en realidad a
  // otro período (periodMonth=6). Tiene una Debt asociada y amountPaid=0 — el
  // fix inline viejo lo hubiera BORRADO (solo miraba amountPaid>0); el
  // criterio correcto (repairContractRecordMonthNumbers) lo hubiera preservado
  // por tener `debt`. El GET ya no corre ningún repair, así que debe
  // sobrevivir intacto pase lo que pase.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-stale', groupId: 'g1', contractId: 'c1',
      periodMonth: 6, periodYear: 2026, monthNumber: 8,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 0, totalDue: 100000, balance: -100000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [], transactions: [],
      debt: { id: 'debt-stale', status: 'OPEN' },
    },
  });

  // GET de agosto 2026: quiere crear un MonthlyRecord con monthNumber=8 para
  // periodMonth=8/periodYear=2026 — choca con el registro fantasma de arriba.
  await svc.getOrCreateMonthlyRecords('g1', 8, 2026);

  const stale = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-stale' } });
  assert.notEqual(stale, null, 'el registro con deuda asociada NO debe borrarse');
  assert.strictEqual(stale.monthNumber, 8, 'tampoco debe renumerarse desde el GET');
  assert.strictEqual(stale.amountPaid, 0);
});

test('A-06: el GET sigue creando un mes faltante (no se volvió read-only al punto de romper la UX)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);

  await makeContract(prisma);
  // Julio existe, agosto no.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 100000, totalDue: 100000, balance: 0,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [], transactions: [],
    },
  });

  await svc.getOrCreateMonthlyRecords('g1', 8, 2026);

  const created = await prisma.monthlyRecord.findFirst({ where: { contractId: 'c1', periodMonth: 8, periodYear: 2026 } });
  assert.notEqual(created, null, 'el mes faltante debe seguir creándose');
  assert.strictEqual(created.monthNumber, 8);
});
