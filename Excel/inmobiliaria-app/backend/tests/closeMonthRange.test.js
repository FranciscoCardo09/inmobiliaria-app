const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');
const { isContractInRangeForMonth } = require('../src/services/monthlyRecordService');

// ============================================================================
// A-10 (AUDITORIA_FUNCIONAL_2026-07-10.md): `closeMonth`/`previewCloseMonth`
// seleccionaban TODO MonthlyRecord PENDING/PARTIAL del período, sin filtrar
// por rango de contrato ni rescisión — un registro fantasma posterior a una
// rescisión (invisible en el Control Mensual, pero vivo en la DB) generaba
// una Debt real y exigible.
//
// Fix: reutilizar `isContractInRangeForMonth` (monthlyRecordService.js, ya
// usada por el refresh del GET) como filtro adicional antes de convertir en
// deuda. Se importa la función REAL (no un stub) para probar la integración
// real, no solo que "se llamó a algo".
// ============================================================================

function buildEnv() {
  const prisma = makeFakePrisma();
  const debtServiceStub = {
    createDebtFromMonthlyRecord: async (record) => ({ id: `debt-${record.id}`, monthlyRecordId: record.id }),
    calculateImputation: () => ({
      unpaidRent: 100000, unpaidPunitory: 0, totalOriginal: 100000, totalUnpaid: 100000,
      servicesCovered: 0, rentCovered: 0, punitoryCovered: 0,
    }),
  };
  const svc = proxyquire('../src/services/monthlyCloseService', {
    '../lib/prisma': prisma,
    './debtService': debtServiceStub,
    './monthlyRecordService': { isContractInRangeForMonth, processDirtyRecords: async () => 0 },
  });
  return { prisma, svc };
}

async function makeContractAndRecord(prisma, { rescindedAt = null, monthNumber = 9 } = {}) {
  // Nota sobre fakePrisma: `findMany({ include: { contract: ... } })` no resuelve
  // relaciones (solo soporta `select` plano), así que el contrato se embebe
  // directamente en la fila del MonthlyRecord, igual que en otros tests de este
  // helper (punitoryBase.test.js, receiptSequence.test.js).
  const contract = {
    id: 'c1', groupId: 'g1', propertyId: 'p1', contractType: 'INQUILINO',
    startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
    baseRent: 100000, active: true, rescindedAt,
    tenant: { id: 't1', name: 'Juan' }, contractTenants: [],
    property: { id: 'p1', address: 'Calle Falsa 123', owner: { id: 'o1', name: 'Owner' } },
  };
  await prisma.contract.create({ data: contract });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr1', groupId: 'g1', contractId: 'c1', monthNumber,
      periodMonth: 9, periodYear: 2026, status: 'PENDING', isPostExpiry: false,
      amountPaid: 0, rentAmount: 100000, services: [], transactions: [], debt: null,
      contract,
    },
  });
}

test('A-10: closeMonth NO genera deuda para un mes posterior a la rescisión del contrato', async () => {
  const { prisma, svc } = buildEnv();
  // Rescindido en julio 2026 (mes de contrato 7); el registro es septiembre (mes 9): fuera de rango.
  await makeContractAndRecord(prisma, { rescindedAt: new Date(2026, 6, 15), monthNumber: 9 });

  const result = await svc.closeMonth('g1', 9, 2026);

  assert.equal(result.debtsCreated, 0);
  const debt = await prisma.debt.findFirst({ where: { monthlyRecordId: 'mr1' } });
  assert.equal(debt, null);
});

test('A-10: closeMonth SÍ genera deuda para un mes dentro del rango vigente del contrato', async () => {
  const { prisma, svc } = buildEnv();
  await makeContractAndRecord(prisma, { rescindedAt: null, monthNumber: 9 });

  const result = await svc.closeMonth('g1', 9, 2026);

  assert.equal(result.debtsCreated, 1);
});

test('A-10: closeMonth SÍ genera deuda para un mes rescindido pero anterior a la rescisión', async () => {
  const { prisma, svc } = buildEnv();
  // Rescindido en octubre (mes de contrato 10); el registro es septiembre (mes 9): sigue vigente.
  await makeContractAndRecord(prisma, { rescindedAt: new Date(2026, 9, 15), monthNumber: 9 });

  const result = await svc.closeMonth('g1', 9, 2026);

  assert.equal(result.debtsCreated, 1);
});

test('A-10: previewCloseMonth excluye del preview el registro fuera de rango y lo reporta en outOfContractRange', async () => {
  const { prisma, svc } = buildEnv();
  await makeContractAndRecord(prisma, { rescindedAt: new Date(2026, 6, 15), monthNumber: 9 });

  const { debtsPreview, summary } = await svc.previewCloseMonth('g1', 9, 2026);

  assert.equal(debtsPreview.length, 0);
  assert.equal(summary.outOfContractRange, 1);
  assert.equal(summary.willGenerateDebts, 0);
});

test('A-10: previewCloseMonth SÍ incluye un registro vigente en el preview', async () => {
  const { prisma, svc } = buildEnv();
  await makeContractAndRecord(prisma, { rescindedAt: null, monthNumber: 9 });

  const { debtsPreview, summary } = await svc.previewCloseMonth('g1', 9, 2026);

  assert.equal(debtsPreview.length, 1);
  assert.equal(summary.outOfContractRange, 0);
  assert.equal(summary.willGenerateDebts, 1);
});
