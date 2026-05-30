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
      parseLocalDate: (s) => (s ? new Date(s) : new Date()),
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

  // A contract with active=false + renewedAt has status='RENEWED', not EXPIRED,
  // so the controller's status guard rejects it before reaching the renewedAt check.
  assert.strictEqual(res.payload.ok, false);
  assert.strictEqual(res.payload.status, 400);
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
