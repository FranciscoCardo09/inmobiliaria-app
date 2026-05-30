const test = require('node:test');
const assert = require('node:assert');
const { makeFakePrisma } = require('./helpers/fakePrisma');
const { findBrokenContracts, runRepair, getCalendarPeriod } = require('../scripts/repair-broken-renewals');

// Helper: simulate the legacy buggy-renewal state on a single contract.
async function seedBrokenContract(prisma) {
  // Originally: startDate=2024-01-01, durationMonths=12 (so months 1..12 = 2024-01..2024-12)
  // After buggy renewal: startDate overwritten to 2026-01-01, startMonth=1, durationMonths=24.
  // BUT the historical MRs still exist with monthNumber 1..12 + periodMonth/Year of 2024.
  const contract = await prisma.contract.create({
    data: {
      id: 'broken',
      groupId: 'g1',
      propertyId: 'p1',
      tenantId: 't1',
      contractType: 'INQUILINO',
      startDate: new Date('2026-01-01'),
      startMonth: 1,
      currentMonth: 1,
      durationMonths: 24,
      baseRent: 200000, // post-renewal rent
      active: true,
      renewedAt: null,
      renewedFromContractId: null,
      punitoryStartDay: 4,
      punitoryGraceDay: 10,
      punitoryPercent: 0.02,
      pagaIva: false,
      comprobantes: [],
    },
  });

  // Historical MRs from the pre-renewal period (2024-01..2024-12)
  // Their monthNumber is 1..12, but the period maps to 2024 (not 2026 as the current contract implies).
  for (let m = 1; m <= 12; m++) {
    await prisma.monthlyRecord.create({
      data: {
        groupId: 'g1',
        contractId: 'broken',
        monthNumber: m,
        periodMonth: m,
        periodYear: 2024,
        rentAmount: 100000, // historical rent
        totalDue: 100000,
        amountPaid: m === 5 ? 50000 : 0,
        balance: m === 5 ? -50000 : -100000,
        status: m === 5 ? 'PARTIAL' : 'PENDING',
      },
    });
  }

  // A debt on the May 2024 record (partially paid)
  const mayMR = (await prisma.monthlyRecord.findFirst({
    where: { contractId: 'broken', periodMonth: 5, periodYear: 2024 },
  }));
  await prisma.debt.create({
    data: {
      id: 'debt-may',
      groupId: 'g1',
      contractId: 'broken',
      monthlyRecordId: mayMR.id,
      periodLabel: 'Mayo 2024',
      periodMonth: 5,
      periodYear: 2024,
      originalAmount: 100000,
      unpaidRentAmount: 50000,
      currentTotal: 50000,
      amountPaid: 50000,
      accumulatedPunitory: 0,
      punitoryPercent: 0.02,
      punitoryStartDate: new Date('2024-05-04'),
      status: 'PARTIAL',
    },
  });

  // A Payment for May (historical)
  await prisma.payment.create({
    data: {
      groupId: 'g1', contractId: 'broken', monthNumber: 5,
      periodMonth: 5, periodYear: 2024,
      totalDue: 100000, amountPaid: 50000, balance: -50000, status: 'PARTIAL',
    },
  });

  // ContractTenant link
  await prisma.contractTenant.create({
    data: { contractId: 'broken', tenantId: 't1', isPrimary: true },
  });

  // An initial RentHistory (historical) and a RENOVACION one created by the buggy code
  await prisma.rentHistory.create({
    data: {
      contractId: 'broken',
      effectiveFromMonth: 1,
      rentAmount: 100000,
      reason: 'INICIAL',
      appliedAt: new Date('2024-01-01'),
    },
  });
  await prisma.rentHistory.create({
    data: {
      contractId: 'broken',
      effectiveFromMonth: 1,
      rentAmount: 200000,
      reason: 'RENOVACION',
      appliedAt: new Date('2026-01-01'),
    },
  });

  return contract;
}

test('getCalendarPeriod - simple mapping', () => {
  // Use local-tz Date construction so we don't trip over UTC parsing of YYYY-MM-DD strings.
  const startDate = new Date(2026, 0, 1); // Jan 1, 2026 local
  assert.deepStrictEqual(getCalendarPeriod(startDate, 1, 1), { periodMonth: 1, periodYear: 2026 });
  assert.deepStrictEqual(getCalendarPeriod(startDate, 1, 13), { periodMonth: 1, periodYear: 2027 });
});

test('findBrokenContracts - detects historical MRs that fall outside current epoch', async () => {
  const prisma = makeFakePrisma();
  await seedBrokenContract(prisma);

  const broken = await findBrokenContracts(prisma);
  assert.strictEqual(broken.length, 1, 'should detect the broken contract');
  assert.strictEqual(broken[0].contract.id, 'broken');
  assert.strictEqual(broken[0].outOfEpoch.length, 12, 'all 12 historical MRs are out of current epoch');
  assert.strictEqual(broken[0].inEpoch.length, 0, 'no MRs match the current epoch yet');
});

test('findBrokenContracts - ignores already-repaired contracts', async () => {
  const prisma = makeFakePrisma();
  await prisma.contract.create({
    data: {
      id: 'good',
      groupId: 'g1',
      startDate: new Date('2026-01-01'),
      startMonth: 1,
      durationMonths: 24,
      renewedFromContractId: 'old', // already linked to a previous contract
    },
  });
  await prisma.monthlyRecord.create({
    data: {
      groupId: 'g1', contractId: 'good',
      monthNumber: 1, periodMonth: 1, periodYear: 2026,
      rentAmount: 100, totalDue: 100, amountPaid: 0, balance: -100, status: 'PENDING',
    },
  });
  const broken = await findBrokenContracts(prisma);
  assert.strictEqual(broken.length, 0, 'already-linked contract is skipped');
});

test('runRepair - splits the broken contract into old + linked', async () => {
  const prisma = makeFakePrisma();
  await seedBrokenContract(prisma);

  const results = await runRepair(prisma);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'repaired');
  const oldId = results[0].oldContractId;

  // Verify the current contract is now linked to the new "old" one
  const current = await prisma.contract.findUnique({ where: { id: 'broken' } });
  assert.strictEqual(current.renewedFromContractId, oldId);

  // The "old" contract should have all 12 historical MRs
  const oldMRs = await prisma.monthlyRecord.findMany({ where: { contractId: oldId } });
  assert.strictEqual(oldMRs.length, 12);

  // The Debt for May 2024 must have moved to the old contract too
  const debt = await prisma.debt.findUnique({ where: { id: 'debt-may' } });
  assert.strictEqual(debt.contractId, oldId);

  // Payment for May should also move
  const may2024Payments = await prisma.payment.findMany({
    where: { periodMonth: 5, periodYear: 2024 },
  });
  assert.strictEqual(may2024Payments.length, 1);
  assert.strictEqual(may2024Payments[0].contractId, oldId);

  // The OLD contract should be inactive + renewedAt set
  const oldContract = await prisma.contract.findUnique({ where: { id: oldId } });
  assert.strictEqual(oldContract.active, false);
  assert.ok(oldContract.renewedAt, 'old contract has renewedAt set');
  assert.strictEqual(oldContract.baseRent, 100000, 'old baseRent comes from earliest RentHistory');
});

test('runRepair - is idempotent (second run is a no-op)', async () => {
  const prisma = makeFakePrisma();
  await seedBrokenContract(prisma);

  const first = await runRepair(prisma);
  assert.strictEqual(first.length, 1);

  const second = await runRepair(prisma);
  assert.strictEqual(second.length, 0, 'no candidates left after a successful repair');
});

test('runRepair - infers startDate so original monthNumbers stay in range (yocsina-like)', async () => {
  // Realistic scenario: the original contract was at month 22-24 of its
  // duration when it was renewed. The buggy renewContract reset startDate to
  // the new period and durationMonths to 24, leaving the historical MRs
  // (monthNumber 22, 23, 24) outside the current Contract's [1..24] range.
  // The repair must infer the original startDate so those monthNumbers fall
  // BACK into a valid range, not just throw them into a 3-month bucket.
  const prisma = makeFakePrisma();
  await prisma.contract.create({
    data: {
      id: 'yocsina-like',
      groupId: 'g1',
      propertyId: 'p1',
      tenantId: 't1',
      contractType: 'INQUILINO',
      startDate: new Date(2026, 4, 1), // May 2026 (post-renewal)
      startMonth: 1,
      currentMonth: 1,
      durationMonths: 24,
      baseRent: 900000,
      active: true,
      renewedAt: null,
      renewedFromContractId: null,
      punitoryStartDay: 4,
      punitoryGraceDay: 10,
      punitoryPercent: 0.02,
      pagaIva: false,
      comprobantes: [],
    },
  });
  // 3 out-of-epoch MRs: monthNumber 22, 23, 24; periods Feb/Mar/Apr 2026.
  for (let i = 0; i < 3; i++) {
    await prisma.monthlyRecord.create({
      data: {
        groupId: 'g1', contractId: 'yocsina-like',
        monthNumber: 22 + i, periodMonth: 2 + i, periodYear: 2026,
        rentAmount: 901388, totalDue: 901388, amountPaid: 0,
        balance: -901388, status: 'PENDING',
      },
    });
  }
  await prisma.contractTenant.create({
    data: { contractId: 'yocsina-like', tenantId: 't1', isPrimary: true },
  });

  const [result] = await runRepair(prisma);
  assert.strictEqual(result.status, 'repaired');

  const oldContract = await prisma.contract.findUnique({ where: { id: result.oldContractId } });
  // TIGHT range: the inferred contract must cover EXACTLY monthNumbers 22..24,
  // with no phantom months before 22 (which would otherwise be auto-created as
  // fake debts when browsing Control Mensual).
  assert.strictEqual(oldContract.startMonth, 22, 'startMonth = min observed monthNumber');
  assert.strictEqual(oldContract.durationMonths, 3, 'duration = max - min + 1');
  // startDate = first record's period, so getMonthNumber(Feb 2026) === 22.
  assert.strictEqual(oldContract.startDate.getFullYear(), 2026);
  assert.strictEqual(oldContract.startDate.getMonth(), 1, 'February (0-indexed)');

  // Sanity: every moved record's monthNumber falls inside [22..24].
  const endMonth = oldContract.startMonth + oldContract.durationMonths - 1;
  const movedMRs = await prisma.monthlyRecord.findMany({ where: { contractId: oldContract.id } });
  for (const mr of movedMRs) {
    assert.ok(mr.monthNumber >= oldContract.startMonth && mr.monthNumber <= endMonth,
      `mn ${mr.monthNumber} must be within [${oldContract.startMonth}..${endMonth}]`);
  }
});

test('runRepair - dryRun reports without mutating', async () => {
  const prisma = makeFakePrisma();
  await seedBrokenContract(prisma);

  const results = await runRepair(prisma, { dryRun: true });
  assert.strictEqual(results[0].status, 'would-repair');
  assert.strictEqual(results[0].outOfEpochCount, 12);

  // Nothing changed
  const current = await prisma.contract.findUnique({ where: { id: 'broken' } });
  assert.strictEqual(current.renewedFromContractId, null);
  const contractCount = (await prisma.contract.findMany({})).length;
  assert.strictEqual(contractCount, 1, 'no extra contract created');
});
