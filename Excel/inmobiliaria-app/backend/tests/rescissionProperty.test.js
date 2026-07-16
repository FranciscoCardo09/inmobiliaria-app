const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-13 (AUDITORIA_FUNCIONAL_2026-07-10.md): `rescindContract` nunca pone
// `active=false` (para no ocultar el historial del contrato del filtro de
// `getOrCreateMonthlyRecords`, que excluye active=false sin renewedAt). Pero
// los 3 chequeos de "propiedad ocupada" (createContract, assignTenantToProperty,
// renewContract) filtraban solo por `active:true`, así que un contrato
// rescindido bloqueaba la propiedad para siempre.
//
// Decisión del usuario (2026-07-12): el contrato rescindido sigue
// `active=true` (su historial se sigue viendo), pero el chequeo de ocupación
// ahora también exige `rescindedAt: null`. Se prueba a nivel de
// `assignTenantToProperty`, el más simple de los tres; los otros dos aplican
// exactamente el mismo patrón (`active: true, rescindedAt: null`).
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
      created: (res, body, msg) => res.send({ ok: true, data: body, msg }),
      badRequest: (res, msg) => res.send({ ok: false, error: msg, status: 400 }),
      notFound: (res, msg) => res.send({ ok: false, error: msg, status: 404 }),
      conflict: (res, msg) => res.send({ ok: false, error: msg, status: 409 }),
    },
  };
  const contractsController = proxyquire('../src/controllers/contractsController', controllerStubs);
  return { prisma, contractsController };
}

function fakeRes() {
  return { send(payload) { this.payload = payload; return this; } };
}

test('A-13: propiedad con contrato ACTIVO (no rescindido) del mismo tipo sigue bloqueada', async () => {
  const { prisma, contractsController } = buildEnv();
  await prisma.property.create({ data: { id: 'p1', groupId: 'g1' } });
  await prisma.tenant.create({ data: { id: 't2', groupId: 'g1' } });
  await prisma.contract.create({
    data: { id: 'c1', groupId: 'g1', propertyId: 'p1', contractType: 'INQUILINO', active: true, rescindedAt: null },
  });

  const res = fakeRes();
  await contractsController.assignTenantToProperty(
    { params: { groupId: 'g1', propertyId: 'p1' }, body: { tenantId: 't2', startDate: '2026-08-01', durationMonths: 12, baseRent: 100000 } },
    res, () => {}
  );

  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.status, 409);
});

test('A-13: propiedad con contrato RESCINDIDO (active=true, rescindedAt seteado) ya NO bloquea', async () => {
  const { prisma, contractsController } = buildEnv();
  await prisma.property.create({ data: { id: 'p1', groupId: 'g1' } });
  await prisma.tenant.create({ data: { id: 't2', groupId: 'g1' } });
  await prisma.contract.create({
    data: { id: 'c1', groupId: 'g1', propertyId: 'p1', contractType: 'INQUILINO', active: true, rescindedAt: new Date('2026-06-15') },
  });

  const res = fakeRes();
  // Se omite startDate/duration/baseRent a propósito: si el chequeo de ocupación
  // NO bloqueara (que es lo que queremos probar), el siguiente error debe ser el
  // de "faltan datos", no el 409 de propiedad ocupada.
  await contractsController.assignTenantToProperty(
    { params: { groupId: 'g1', propertyId: 'p1' }, body: { tenantId: 't2' } },
    res, () => {}
  );

  assert.equal(res.payload.status, 400);
  assert.match(res.payload.error, /Fecha inicio/i);
});

test('A-13: contrato ACTIVO en OTRA propiedad no interfiere', async () => {
  const { prisma, contractsController } = buildEnv();
  await prisma.property.create({ data: { id: 'p1', groupId: 'g1' } });
  await prisma.property.create({ data: { id: 'p2', groupId: 'g1' } });
  await prisma.tenant.create({ data: { id: 't2', groupId: 'g1' } });
  await prisma.contract.create({
    data: { id: 'c1', groupId: 'g1', propertyId: 'p2', contractType: 'INQUILINO', active: true, rescindedAt: null },
  });

  const res = fakeRes();
  await contractsController.assignTenantToProperty(
    { params: { groupId: 'g1', propertyId: 'p1' }, body: { tenantId: 't2' } },
    res, () => {}
  );

  assert.equal(res.payload.status, 400);
  assert.match(res.payload.error, /Fecha inicio/i);
});
