const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function buildEnv(opts = {}) {
  const prisma = makeFakePrisma();
  const contractService = proxyquire('../src/services/contractService', {
    '../lib/prisma': prisma,
  });
  const debtService = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    // Avoid pulling in punitory math; we only need the chain logic.
    '../utils/punitory': {
      calculatePunitoryV2: () => ({ amount: 0, days: 0 }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
  });
  const controllerStubs = {
    '../lib/prisma': prisma,
    '../services/contractService': contractService,
    '../services/adjustmentService': {
      calculateNextAdjustmentMonth: () => null,
      isAdjustmentMonth: () => false,
    },
    '../utils/dateUtils': {
      // Mismo criterio que el parseLocalDate real: mediodía UTC, para que leer
      // el día/mes con getters locales no se corra de fecha (ver A-25).
      parseLocalDate: (s) => {
        if (!s) return new Date();
        const [y, m, d] = String(s).replace(/T.*/, '').split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      },
      getPeriodLabel: () => '',
      calculateCurrentContractMonth: () => 1,
    },
    '../utils/asyncHandler': (fn) => fn,
    '../utils/apiResponse': {
      success: (res, body) => res.send({ ok: true, data: body }),
      badRequest: (res, msg) => res.send({ ok: false, error: msg, status: 400 }),
      notFound: (res, msg) => res.send({ ok: false, error: msg, status: 404 }),
      created: (res, body, msg) => res.send({ ok: true, data: body, msg }),
    },
  };
  const contractsController = proxyquire('../src/controllers/contractsController', controllerStubs);
  return { prisma, contractService, debtService, contractsController };
}

function fakeRes() {
  return {
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function seedContract(prisma, overrides = {}) {
  const start = overrides.startDate || new Date('2024-01-01');
  const contract = await prisma.contract.create({
    data: {
      id: 'old-contract',
      groupId: 'g1',
      propertyId: 'p1',
      tenantId: 't1',
      contractType: 'INQUILINO',
      startDate: start,
      startMonth: 1,
      currentMonth: 1,
      durationMonths: 24,
      baseRent: 100000,
      active: true,
      rescindedAt: null,
      rescissionPenalty: null,
      renewedAt: null,
      renewedFromContractId: null,
      punitoryStartDay: 4,
      punitoryGraceDay: 10,
      punitoryPercent: 0.02,
      pagaIva: false,
      observations: null,
      comprobantes: [],
      adjustmentIndexId: null,
      nextAdjustmentMonth: null,
      ...overrides,
    },
  });
  await prisma.contractTenant.create({
    data: { contractId: contract.id, tenantId: 't1', isPrimary: true },
  });
  return contract;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

test('renewContract — creates a new Contract and links via renewedFromContractId', async () => {
  const { prisma, contractsController } = buildEnv();
  // The old contract must be EXPIRED for renewal to be allowed. Use an old start.
  const oldStart = new Date('2020-01-01');
  await seedContract(prisma, { startDate: oldStart });

  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: '2026-06-01', durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();

  await contractsController.renewContract(req, res);

  assert.strictEqual(res.payload.ok, true, `renewal failed: ${JSON.stringify(res.payload)}`);
  const newContractId = res.payload.data.id;
  assert.notStrictEqual(newContractId, 'old-contract', 'should return a NEW contract id');

  // Old contract: active=false, renewedAt set, untouched startDate/duration
  const oldAfter = await prisma.contract.findUnique({ where: { id: 'old-contract' } });
  assert.strictEqual(oldAfter.active, false, 'old contract should be inactive');
  assert.ok(oldAfter.renewedAt, 'old contract should have renewedAt set');
  assert.strictEqual(oldAfter.startMonth, 1, 'old startMonth preserved');
  assert.strictEqual(oldAfter.durationMonths, 24, 'old durationMonths preserved');
  assert.strictEqual(oldAfter.baseRent, 100000, 'old baseRent preserved');

  // New contract: starts at 1, points to old via renewedFromContractId
  const newContract = await prisma.contract.findUnique({ where: { id: newContractId } });
  assert.strictEqual(newContract.active, true);
  assert.strictEqual(newContract.startMonth, 1);
  assert.strictEqual(newContract.durationMonths, 24);
  assert.strictEqual(newContract.baseRent, 150000);
  assert.strictEqual(newContract.renewedFromContractId, 'old-contract');
});

test('renewContract — clones ContractTenants to the new contract', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { startDate: new Date('2020-01-01') });
  // Add a secondary tenant
  await prisma.contractTenant.create({
    data: { contractId: 'old-contract', tenantId: 't2', isPrimary: false },
  });

  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: '2026-06-01', durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  const newId = res.payload.data.id;
  const cloned = await prisma.contractTenant.findMany({ where: { contractId: newId } });
  assert.strictEqual(cloned.length, 2, 'both tenants cloned');
  assert.ok(cloned.find((t) => t.tenantId === 't1' && t.isPrimary === true));
  assert.ok(cloned.find((t) => t.tenantId === 't2' && t.isPrimary === false));
});

test('renewContract — does NOT touch old MonthlyRecord/Debt/Payment', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, { startDate: new Date('2020-01-01') });

  // Seed some historical data on the old contract
  const mr = await prisma.monthlyRecord.create({
    data: {
      groupId: 'g1',
      contractId: 'old-contract',
      monthNumber: 5,
      periodMonth: 5,
      periodYear: 2020,
      rentAmount: 100000,
      totalDue: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
    },
  });
  await prisma.debt.create({
    data: {
      groupId: 'g1',
      contractId: 'old-contract',
      monthlyRecordId: mr.id,
      periodLabel: 'Mayo 2020',
      periodMonth: 5,
      periodYear: 2020,
      originalAmount: 100000,
      unpaidRentAmount: 100000,
      currentTotal: 100000,
      punitoryPercent: 0.02,
      punitoryStartDate: new Date('2020-05-04'),
      status: 'OPEN',
    },
  });
  await prisma.payment.create({
    data: {
      groupId: 'g1',
      contractId: 'old-contract',
      monthNumber: 5,
      periodMonth: 5,
      periodYear: 2020,
      totalDue: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
    },
  });

  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: '2026-06-01', durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  // All historical rows must still belong to the OLD contract
  const mrAfter = await prisma.monthlyRecord.findUnique({ where: { id: mr.id } });
  assert.strictEqual(mrAfter.contractId, 'old-contract', 'MR stays with old contract');
  const debts = await prisma.debt.findMany({ where: { contractId: 'old-contract' } });
  assert.strictEqual(debts.length, 1, 'old debt preserved');
  const payments = await prisma.payment.findMany({ where: { contractId: 'old-contract' } });
  assert.strictEqual(payments.length, 1, 'old payment preserved');
});

test('renewContract — rejects when contract is already renewed', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedContract(prisma, {
    startDate: new Date('2020-01-01'),
    active: false,
    renewedAt: new Date('2026-01-01'),
  });

  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: '2026-06-01', durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  // El guard de renewedAt corre primero: un contrato ya renovado no se renueva
  // de nuevo, tenga el estado que tenga.
  assert.strictEqual(res.payload.ok, false);
  assert.strictEqual(res.payload.status, 400);
});

// ─────────────────────────────────────────────────────────────
// Renovación anticipada (contrato ACTIVE "por vencer")
// ─────────────────────────────────────────────────────────────

// Fechas relativas a hoy para que los tests no caduquen con el calendario.
function monthStart(offsetMonths) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Contrato que arrancó hace 22 meses y dura 24 => vence el mes que viene:
// status ACTIVE, isExpiringSoon true.
function seedExpiringSoon(prisma) {
  return seedContract(prisma, { startDate: monthStart(-22), durationMonths: 24 });
}
// El mes siguiente al vencimiento (= el mes subsiguiente al actual).
const nextPeriodStart = () => ymd(monthStart(2));

test('renewContract — renovación anticipada: el contrato viejo sigue ACTIVO y el nuevo queda programado', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: nextPeriodStart(), durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  assert.strictEqual(res.payload.ok, true, `renovación anticipada falló: ${JSON.stringify(res.payload)}`);

  // Clave del feature: el viejo NO se desactiva. Si se desactivara, dejaría de
  // generar MonthlyRecord y desaparecería de Control Mensual en sus meses restantes.
  const oldAfter = await prisma.contract.findUnique({ where: { id: 'old-contract' } });
  assert.strictEqual(oldAfter.active, true, 'el contrato viejo debe seguir operativo');
  assert.ok(oldAfter.renewedAt, 'el contrato viejo queda marcado como renovado');

  const newContract = await prisma.contract.findUnique({ where: { id: res.payload.data.id } });
  assert.strictEqual(newContract.active, true);
  assert.strictEqual(newContract.renewedFromContractId, 'old-contract');
  assert.strictEqual(newContract.startMonth, 1);
  assert.ok(new Date(newContract.startDate) > new Date(), 'el contrato nuevo arranca en el futuro');
});

test('renewContract — rechaza renovar un contrato activo al que le quedan más de 2 meses', async () => {
  const { prisma, contractsController } = buildEnv();
  // Arrancó hace 6 meses, dura 24 => quedan 18.
  await seedContract(prisma, { startDate: monthStart(-6), durationMonths: 24 });

  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: ymd(monthStart(18)), durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  assert.strictEqual(res.payload.ok, false);
  assert.strictEqual(res.payload.status, 400);
  assert.match(res.payload.error, /próximos a vencer/);
});

test('renewContract — rechaza una fecha de inicio que se superpone con el contrato viejo', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  // Este mes: el contrato viejo todavía está corriendo => se superpondría y
  // Control Mensual mostraría dos filas para la misma propiedad.
  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: ymd(monthStart(0)), durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  assert.strictEqual(res.payload.ok, false);
  assert.strictEqual(res.payload.status, 400);
  assert.match(res.payload.error, /posterior al vencimiento/);

  const oldAfter = await prisma.contract.findUnique({ where: { id: 'old-contract' } });
  assert.strictEqual(oldAfter.renewedAt, null, 'no debe marcarse como renovado si falló');
});

test('renewContract — rechaza dejar meses en blanco entre el contrato viejo y el nuevo', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  // Arranca 3 meses después del vencimiento: quedarían meses sin contrato.
  const req = {
    params: { groupId: 'g1', id: 'old-contract' },
    body: { startDate: ymd(monthStart(5)), durationMonths: 24, baseRent: 150000 },
  };
  const res = fakeRes();
  await contractsController.renewContract(req, res);

  assert.strictEqual(res.payload.ok, false);
  assert.match(res.payload.error, /mes siguiente al vencimiento/);
});

test('renewContract — un contrato con renovación anticipada no se puede renovar dos veces', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  const body = { startDate: nextPeriodStart(), durationMonths: 24, baseRent: 150000 };
  const first = fakeRes();
  await contractsController.renewContract({ params: { groupId: 'g1', id: 'old-contract' }, body }, first);
  assert.strictEqual(first.payload.ok, true);

  // Sigue ACTIVE (no se desactivó), así que el guard que lo frena es renewedAt.
  const second = fakeRes();
  await contractsController.renewContract({ params: { groupId: 'g1', id: 'old-contract' }, body }, second);

  assert.strictEqual(second.payload.ok, false);
  assert.match(second.payload.error, /ya fue renovado/);
});

test('rescindContract — no se puede rescindir un contrato con renovación programada', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  await contractsController.renewContract(
    { params: { groupId: 'g1', id: 'old-contract' }, body: { startDate: nextPeriodStart(), durationMonths: 24, baseRent: 150000 } },
    fakeRes()
  );

  const res = fakeRes();
  await contractsController.rescindContract(
    { params: { groupId: 'g1', id: 'old-contract' }, body: { rescissionDate: ymd(monthStart(0)) } },
    res
  );

  assert.strictEqual(res.payload.ok, false);
  assert.match(res.payload.error, /renovación programada/);
});

// ─────────────────────────────────────────────────────────────
// Cancelar una renovación programada
// ─────────────────────────────────────────────────────────────

test('undoRenewal — borra el contrato nuevo y devuelve el viejo a su estado previo', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  const renewRes = fakeRes();
  await contractsController.renewContract(
    { params: { groupId: 'g1', id: 'old-contract' }, body: { startDate: nextPeriodStart(), durationMonths: 24, baseRent: 150000 } },
    renewRes
  );
  const newId = renewRes.payload.data.id;

  const res = fakeRes();
  await contractsController.undoRenewal({ params: { groupId: 'g1', id: 'old-contract' } }, res);

  assert.strictEqual(res.payload.ok, true, `undo falló: ${JSON.stringify(res.payload)}`);

  const deleted = await prisma.contract.findUnique({ where: { id: newId } });
  assert.strictEqual(deleted, null, 'el contrato nuevo debe borrarse');

  const oldAfter = await prisma.contract.findUnique({ where: { id: 'old-contract' } });
  assert.strictEqual(oldAfter.renewedAt, null, 'el viejo deja de estar marcado como renovado');
  assert.strictEqual(oldAfter.active, true, 'el viejo vuelve a quedar operativo');
});

test('undoRenewal — no cancela si el contrato nuevo ya tiene pagos registrados', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  const renewRes = fakeRes();
  await contractsController.renewContract(
    { params: { groupId: 'g1', id: 'old-contract' }, body: { startDate: nextPeriodStart(), durationMonths: 24, baseRent: 150000 } },
    renewRes
  );
  const newId = renewRes.payload.data.id;

  await prisma.monthlyRecord.create({
    data: { id: 'mr-new', contractId: newId, groupId: 'g1', monthNumber: 1, amountPaid: 50000 },
  });

  const res = fakeRes();
  await contractsController.undoRenewal({ params: { groupId: 'g1', id: 'old-contract' } }, res);

  assert.strictEqual(res.payload.ok, false);
  assert.match(res.payload.error, /pagos registrados/);
  assert.ok(await prisma.contract.findUnique({ where: { id: newId } }), 'el contrato nuevo no se borra');
});

test('undoRenewal — 400 si el contrato no tiene ninguna renovación', async () => {
  const { prisma, contractsController } = buildEnv();
  await seedExpiringSoon(prisma);

  const res = fakeRes();
  await contractsController.undoRenewal({ params: { groupId: 'g1', id: 'old-contract' } }, res);

  assert.strictEqual(res.payload.ok, false);
  assert.match(res.payload.error, /no tiene una renovación/);
});

test('canPayCurrentMonth — finds debts across the entire renewal chain', async () => {
  const { prisma, debtService } = buildEnv();

  // Old contract with an open debt
  await prisma.contract.create({
    data: { id: 'old', groupId: 'g1', renewedFromContractId: null, active: false, renewedAt: new Date() },
  });
  await prisma.contract.create({
    data: { id: 'new', groupId: 'g1', renewedFromContractId: 'old', active: true, renewedAt: null },
  });
  const oldMR = await prisma.monthlyRecord.create({
    data: {
      groupId: 'g1', contractId: 'old', monthNumber: 1, periodMonth: 1, periodYear: 2025,
      rentAmount: 100, totalDue: 100, amountPaid: 0, balance: -100, status: 'PENDING',
    },
  });
  await prisma.debt.create({
    data: {
      id: 'debt-old', groupId: 'g1', contractId: 'old', monthlyRecordId: oldMR.id,
      periodLabel: 'Enero 2025', periodMonth: 1, periodYear: 2025,
      originalAmount: 100, unpaidRentAmount: 100, currentTotal: 100,
      punitoryPercent: 0.02, punitoryStartDate: new Date('2025-01-04'),
      status: 'OPEN', amountPaid: 0, accumulatedPunitory: 0,
    },
  });

  const result = await debtService.canPayCurrentMonth('g1', 'new');
  assert.strictEqual(result.canPay, false, 'must be blocked because old contract has debt');
  assert.strictEqual(result.debts.length, 1);
  assert.strictEqual(result.debts[0].id, 'debt-old');
});

test('canPayCurrentMonth — returns canPay=true when no debts in chain', async () => {
  const { prisma, debtService } = buildEnv();
  await prisma.contract.create({
    data: { id: 'new', groupId: 'g1', renewedFromContractId: null, active: true },
  });
  const result = await debtService.canPayCurrentMonth('g1', 'new');
  assert.strictEqual(result.canPay, true);
  assert.deepStrictEqual(result.debts, []);
});

test('getOpenDebts — expands contractId filter to the full chain', async () => {
  const { prisma, debtService } = buildEnv();
  await prisma.contract.create({ data: { id: 'old', groupId: 'g1', active: false, renewedAt: new Date() } });
  await prisma.contract.create({ data: { id: 'new', groupId: 'g1', renewedFromContractId: 'old', active: true } });
  const oldMR = await prisma.monthlyRecord.create({
    data: {
      groupId: 'g1', contractId: 'old', monthNumber: 2, periodMonth: 2, periodYear: 2025,
      rentAmount: 100, totalDue: 100, amountPaid: 0, balance: -100, status: 'PENDING',
    },
  });
  await prisma.debt.create({
    data: {
      groupId: 'g1', contractId: 'old', monthlyRecordId: oldMR.id,
      periodLabel: 'Feb 2025', periodMonth: 2, periodYear: 2025,
      originalAmount: 100, unpaidRentAmount: 100, currentTotal: 100,
      punitoryPercent: 0.02, punitoryStartDate: new Date('2025-02-04'),
      status: 'OPEN', amountPaid: 0, accumulatedPunitory: 0,
    },
  });

  const debts = await debtService.getOpenDebts('g1', 'new');
  assert.strictEqual(debts.length, 1);
  assert.strictEqual(debts[0].contractId, 'old', 'finds the old contract debt through the chain');
});
