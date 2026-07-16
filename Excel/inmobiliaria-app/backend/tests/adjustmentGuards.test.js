const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-09 (AUDITORIA_FUNCIONAL_2026-07-10.md): `applyAdjustmentToCalendar`,
// `undoAdjustmentForMonth` y `undoAdjustmentForCalendar` no validaban si el
// MonthlyRecord del mes objetivo ya estaba pagado/cerrado antes de pisar
// rentAmount/baseRent — reabría meses ya cobrados con punitorios en vivo sobre
// la diferencia.
//
// Decisión del usuario (2026-07-12): bloquear (saltar ese contrato, sin
// abortar el resto del lote) si el mes está COMPLETE, tiene amountPaid>0,
// tiene transacciones, o tiene una Debt asociada. Fuente única: `isMonthLocked`
// dentro de adjustmentService.js, reutilizada por las 3 funciones.
//
// Setup común: contrato con startDate=2026-01-01, startMonth=1, ajuste
// trimestral... en realidad semestral (frequencyMonths=6) → el mes de ajuste
// cae en julio 2026 (contractMonth = 1 + 6 = 7), ver calculateContractMonthFromCalendar.
// ============================================================================

function buildEnv() {
  const prisma = makeFakePrisma();
  const svc = proxyquire('../src/services/adjustmentService', {
    '../lib/prisma': prisma,
  });
  return { prisma, svc };
}

async function seedContract(prisma, overrides = {}) {
  await prisma.adjustmentIndex.create({
    data: { id: 'idx1', groupId: 'g1', name: 'IPC', frequencyMonths: 6, currentValue: 10 },
  });
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', propertyId: 'p1',
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
      baseRent: 100000, active: true, adjustmentIndexId: 'idx1',
      nextAdjustmentMonth: 7,
      tenant: null, contractTenants: [], property: { address: 'Calle Falsa 123' },
      adjustmentIndex: { frequencyMonths: 6 },
      ...overrides,
    },
  });
}

test('A-09: applyAdjustmentToCalendar SALTEA un mes ya COMPLETE (no pisa rentAmount/baseRent)', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma);
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'COMPLETE', amountPaid: 100000 },
  });

  const results = await svc.applyAdjustmentToCalendar('g1', 'idx1', 10, 7, 2026);

  assert.equal(results.length, 1);
  assert.equal(results[0].skipped, true);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 100000, 'baseRent no debe cambiar en un mes bloqueado');
  const histories = await prisma.rentHistory.findMany({ where: { contractId: 'c1' } });
  assert.equal(histories.length, 0, 'no debe crearse ningún RentHistory para un mes bloqueado');
});

test('A-09: applyAdjustmentToCalendar SALTEA un mes con amountPaid>0 aunque no esté COMPLETE', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma);
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'PARTIAL', amountPaid: 30000 },
  });

  const results = await svc.applyAdjustmentToCalendar('g1', 'idx1', 10, 7, 2026);

  assert.equal(results[0].skipped, true);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 100000);
});

test('A-09: applyAdjustmentToCalendar SALTEA un mes con una Debt asociada (cerrado), aunque amountPaid sea 0', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma);
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'PENDING', amountPaid: 0, debt: { id: 'd1' } },
  });

  const results = await svc.applyAdjustmentToCalendar('g1', 'idx1', 10, 7, 2026);

  assert.equal(results[0].skipped, true);
});

test('A-09: applyAdjustmentToCalendar aplica normalmente un mes SIN pagos ni deuda', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma);
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'PENDING', amountPaid: 0 },
  });

  const results = await svc.applyAdjustmentToCalendar('g1', 'idx1', 10, 7, 2026);

  assert.equal(results.length, 1);
  assert.ok(!results[0].skipped);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 110000);
});

test('A-09: undoAdjustmentForMonth SALTEA (no revierte baseRent ni borra el RentHistory) si el mes está pagado', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma, { baseRent: 110000 });
  await prisma.rentHistory.create({
    data: {
      id: 'rh1', contractId: 'c1', effectiveFromMonth: 7, rentAmount: 110000, adjustmentPercent: 10, reason: 'AJUSTE_AUTOMATICO',
      contract: { id: 'c1', groupId: 'g1', adjustmentIndexId: 'idx1', active: true, tenant: null, contractTenants: [], property: { address: 'Calle Falsa 123' }, adjustmentIndex: { frequencyMonths: 6 } },
    },
  });
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'COMPLETE', amountPaid: 110000 },
  });

  const results = await svc.undoAdjustmentForMonth('g1', 'idx1', 7);

  assert.equal(results.length, 1);
  assert.equal(results[0].skipped, true);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 110000, 'no debe revertirse');
  const history = await prisma.rentHistory.findUnique({ where: { id: 'rh1' } });
  assert.notEqual(history, null, 'el RentHistory no debe borrarse');
});

test('A-09: undoAdjustmentForMonth revierte normalmente un mes sin pagos', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma, { baseRent: 110000 });
  await prisma.rentHistory.create({
    data: {
      id: 'rh1', contractId: 'c1', effectiveFromMonth: 7, rentAmount: 110000, adjustmentPercent: 10, reason: 'AJUSTE_AUTOMATICO',
      contract: { id: 'c1', groupId: 'g1', adjustmentIndexId: 'idx1', active: true, tenant: null, contractTenants: [], property: { address: 'Calle Falsa 123' }, adjustmentIndex: { frequencyMonths: 6 } },
    },
  });
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'PENDING', amountPaid: 0 },
  });

  const results = await svc.undoAdjustmentForMonth('g1', 'idx1', 7);

  assert.ok(!results[0].skipped);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 100000);
  assert.equal(await prisma.rentHistory.findUnique({ where: { id: 'rh1' } }), null);
});

test('A-09: undoAdjustmentForCalendar SALTEA un mes con transacciones registradas', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma, { baseRent: 110000 });
  await prisma.rentHistory.create({
    data: { id: 'rh1', contractId: 'c1', effectiveFromMonth: 7, rentAmount: 110000, adjustmentPercent: 10, reason: 'AJUSTE_AUTOMATICO' },
  });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026,
      status: 'PARTIAL', amountPaid: 0, transactions: [{ id: 'tx1' }],
    },
  });

  const results = await svc.undoAdjustmentForCalendar('g1', 'idx1', 7, 2026);

  assert.equal(results[0].skipped, true);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 110000);
});

test('A-09: undoAdjustmentForCalendar revierte normalmente un mes sin pagos/transacciones/deuda', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma, { baseRent: 110000 });
  await prisma.rentHistory.create({
    data: { id: 'rh1', contractId: 'c1', effectiveFromMonth: 7, rentAmount: 110000, adjustmentPercent: 10, reason: 'AJUSTE_AUTOMATICO' },
  });
  await prisma.monthlyRecord.create({
    data: { id: 'mr7', groupId: 'g1', contractId: 'c1', monthNumber: 7, periodMonth: 7, periodYear: 2026, status: 'PENDING', amountPaid: 0 },
  });

  const results = await svc.undoAdjustmentForCalendar('g1', 'idx1', 7, 2026);

  assert.ok(!results[0].skipped);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 100000);
});

test('A-09: si el mes objetivo directamente no tiene MonthlyRecord aún, el ajuste se aplica (nada que proteger)', async () => {
  const { prisma, svc } = buildEnv();
  await seedContract(prisma);

  const results = await svc.applyAdjustmentToCalendar('g1', 'idx1', 10, 7, 2026);

  assert.ok(!results[0].skipped);
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 110000);
});
