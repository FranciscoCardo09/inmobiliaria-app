const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-12 (AUDITORIA_FUNCIONAL_2026-07-10.md): `deleteContract` solo bloqueaba con
// deudas OPEN/PARTIAL; el cascade del schema borraba irreversiblemente pagos,
// transacciones, comprobantes y deudas ya PAGADAS, y cortaba la cadena de
// renovación (renewedFromContractId es onDelete: SetNull).
//
// Decisión del usuario (2026-07-12): bloquear el borrado si existe CUALQUIER
// historial financiero (deuda de cualquier estado, mes con amountPaid>0) o si
// el contrato es eslabón de una cadena de renovación. Solo se puede borrar un
// contrato financieramente vacío.
//
// Nota sobre fakePrisma: `findUnique({ include })` no resuelve relaciones (el
// fake solo soporta `select` plano); por eso las fixtures de este archivo
// embeben directamente los arrays/objetos de relación (`debts`,
// `monthlyRecords`, `renewedFrom`, `renewedTo`, `contractTenants`) en la fila
// creada, igual que hace contractsRenewal.test.js para renewedFromContractId.
// ============================================================================

function buildEnv() {
  const prisma = makeFakePrisma();
  const controllerStubs = {
    '../lib/prisma': prisma,
    '../services/adjustmentService': {
      calculateNextAdjustmentMonth: () => null,
      isAdjustmentMonth: () => false,
    },
    '../services/contractService': { enrichContract: (c) => c },
    '../services/monthlyRecordService': {
      repairContractRecordMonthNumbers: async () => ({ updated: 0, deleted: 0, paidOrphans: [] }),
    },
    '../utils/dateUtils': { parseLocalDate: (s) => (s ? new Date(s) : new Date()) },
    '../utils/asyncHandler': (fn) => fn,
    '../utils/apiResponse': {
      success: (res, body, msg) => res.send({ ok: true, data: body, msg }),
      badRequest: (res, msg) => res.send({ ok: false, error: msg, status: 400 }),
      notFound: (res, msg) => res.send({ ok: false, error: msg, status: 404 }),
    },
  };
  const contractsController = proxyquire('../src/controllers/contractsController', controllerStubs);
  return { prisma, contractsController };
}

function fakeRes() {
  return { send(payload) { this.payload = payload; return this; } };
}

async function seedContract(prisma, overrides = {}) {
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', propertyId: 'p1',
      contractType: 'INQUILINO', startDate: new Date('2026-01-01'),
      startMonth: 1, durationMonths: 12, baseRent: 100000, active: true,
      debts: [], monthlyRecords: [], renewedFrom: null, renewedTo: null,
      contractTenants: [], tenant: null, property: { address: 'Calle Falsa 123' },
      ...overrides,
    },
  });
}

test('A-12: contrato con deuda (aunque esté PAGADA) no se puede borrar', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { debts: [{ id: 'd1', status: 'PAID' }] });

  const res = fakeRes();
  await contractsController.deleteContract({ params: { groupId: 'g1', id: 'c1' } }, res, () => {});

  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.status, 400);
  assert.match(res.payload.error, /deuda/i);
  assert.notEqual(await prisma.contract.findUnique({ where: { id: 'c1' } }), null);
});

test('A-12: contrato con un mes pagado (amountPaid>0) no se puede borrar', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { monthlyRecords: [{ id: 'mr1', amountPaid: 50000 }] });

  const res = fakeRes();
  await contractsController.deleteContract({ params: { groupId: 'g1', id: 'c1' } }, res, () => {});

  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /pagos registrados/i);
  assert.notEqual(await prisma.contract.findUnique({ where: { id: 'c1' } }), null);
});

test('A-12: contrato eslabón de una cadena de renovación (renewedFrom/renewedTo) no se puede borrar', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { renewedFrom: { id: 'old-contract' } });

  const res = fakeRes();
  await contractsController.deleteContract({ params: { groupId: 'g1', id: 'c1' } }, res, () => {});

  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /cadena de renovaciones/i);
  assert.notEqual(await prisma.contract.findUnique({ where: { id: 'c1' } }), null);
});

test('A-12: contrato eslabón de renovación por el otro extremo (renewedTo) tampoco se puede borrar', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { renewedTo: { id: 'new-contract' } });

  const res = fakeRes();
  await contractsController.deleteContract({ params: { groupId: 'g1', id: 'c1' } }, res, () => {});

  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /cadena de renovaciones/i);
});

test('A-12: contrato financieramente vacío (sin deudas/pagos/renovación) SÍ se puede borrar', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { monthlyRecords: [{ id: 'mr1', amountPaid: 0 }] });

  const res = fakeRes();
  await contractsController.deleteContract({ params: { groupId: 'g1', id: 'c1' } }, res, () => {});

  assert.equal(res.payload.ok, true);
  assert.equal(await prisma.contract.findUnique({ where: { id: 'c1' } }), null);
});

test('A-12: contrato inexistente devuelve 404, no crashea', async () => {
  const { contractsController } = buildEnv();
  const res = fakeRes();
  await contractsController.deleteContract({ params: { groupId: 'g1', id: 'nope' } }, res, () => {});
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.status, 404);
});
