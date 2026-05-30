/**
 * Idempotent repair script for contracts corrupted by the legacy renewContract bug.
 *
 * The bug: pre-fix, renewContract mutated the same Contract row (overwrote startDate,
 * startMonth=1, currentMonth=1, durationMonths) instead of creating a new Contract.
 * This left MonthlyRecord rows of the previous period with monthNumbers OUTSIDE the
 * current Contract's [startMonth..endMonth] range. The fix splits such contracts in
 * two: a new inactive Contract holds the old records, and the existing Contract gets
 * linked via renewedFromContractId.
 *
 * Usage:
 *   node backend/scripts/repair-broken-renewals.js              # apply fixes
 *   node backend/scripts/repair-broken-renewals.js --dry-run    # report only
 *   node backend/scripts/repair-broken-renewals.js --id <uuid>  # repair one contract
 */
// Note: prisma is loaded lazily so this module can be required by tests with
// a fake client without booting a real Prisma connection.

function getCalendarPeriod(startDate, startMonth, monthNumber) {
  const start = new Date(startDate);
  const monthsToAdd = monthNumber - startMonth;
  const d = new Date(start.getFullYear(), start.getMonth() + monthsToAdd, 1);
  return { periodMonth: d.getMonth() + 1, periodYear: d.getFullYear() };
}

async function findBrokenContracts(prisma) {
  // A contract is broken if it has at least one MonthlyRecord whose periodMonth/year
  // does NOT match what the Contract's current startDate/startMonth implies for that
  // monthNumber. Such records belong to a previous (pre-renewal) epoch.
  const candidates = await prisma.contract.findMany({
    where: { renewedFromContractId: null },
    select: {
      id: true,
      groupId: true,
      startDate: true,
      startMonth: true,
      durationMonths: true,
      baseRent: true,
      propertyId: true,
      tenantId: true,
      contractType: true,
      adjustmentIndexId: true,
      punitoryStartDay: true,
      punitoryGraceDay: true,
      punitoryPercent: true,
      pagaIva: true,
      observations: true,
      comprobantes: true,
    },
  });

  const broken = [];
  for (const c of candidates) {
    const mrs = await prisma.monthlyRecord.findMany({
      where: { contractId: c.id },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
      select: { id: true, monthNumber: true, periodMonth: true, periodYear: true, amountPaid: true },
    });
    if (mrs.length === 0) continue;

    const inEpoch = [];
    const outOfEpoch = [];
    for (const mr of mrs) {
      const expected = getCalendarPeriod(c.startDate, c.startMonth, mr.monthNumber);
      if (expected.periodMonth === mr.periodMonth && expected.periodYear === mr.periodYear) {
        inEpoch.push(mr);
      } else {
        outOfEpoch.push(mr);
      }
    }
    if (outOfEpoch.length > 0) {
      broken.push({ contract: c, inEpoch, outOfEpoch });
    }
  }
  return broken;
}

async function repairOne(prisma, { contract: c, outOfEpoch }) {
  // Build the metadata for the inferred OLD contract from the out-of-epoch records.
  const sorted = [...outOfEpoch].sort((a, b) => {
    if (a.periodYear !== b.periodYear) return a.periodYear - b.periodYear;
    return a.periodMonth - b.periodMonth;
  });
  const first = sorted[0];
  // Build a TIGHT range that covers exactly the observed monthNumbers, so no
  // empty (phantom) months get auto-created when the user browses Control
  // Mensual. We keep the original monthNumbers intact by setting:
  //   startMonth = min observed monthNumber
  //   startDate  = the first record's period (so getMonthNumber(firstPeriod) == startMonth)
  //   durationMonths = max - min + 1
  const minMonthNumber = first.monthNumber; // sorted chronologically → smallest mn
  const maxMonthNumber = Math.max(...sorted.map((mr) => mr.monthNumber));
  const oldStartDate = new Date(first.periodYear, first.periodMonth - 1, 1);
  const oldStartMonth = minMonthNumber;
  const oldDurationMonths = maxMonthNumber - minMonthNumber + 1;

  // Approximate the renewal date as the current Contract's startDate.
  const renewedAt = new Date(c.startDate);

  // Pick baseRent for the OLD contract: first RentHistory entry, else current baseRent.
  const firstRH = await prisma.rentHistory.findFirst({
    where: { contractId: c.id },
    orderBy: { effectiveFromMonth: 'asc' },
    select: { rentAmount: true },
  });
  const oldBaseRent = firstRH?.rentAmount ?? c.baseRent;

  const outIds = outOfEpoch.map((mr) => mr.id);
  const outPeriods = outOfEpoch.map((mr) => ({ periodMonth: mr.periodMonth, periodYear: mr.periodYear }));

  return prisma.$transaction(async (tx) => {
    // Create the inferred OLD contract
    const oldContract = await tx.contract.create({
      data: {
        groupId: c.groupId,
        propertyId: c.propertyId,
        tenantId: c.tenantId,
        contractType: c.contractType,
        startDate: oldStartDate,
        startMonth: oldStartMonth,
        currentMonth: oldStartMonth,
        durationMonths: oldDurationMonths,
        baseRent: oldBaseRent,
        adjustmentIndexId: c.adjustmentIndexId,
        nextAdjustmentMonth: null,
        active: false,
        punitoryStartDay: c.punitoryStartDay,
        punitoryGraceDay: c.punitoryGraceDay,
        punitoryPercent: c.punitoryPercent,
        pagaIva: c.pagaIva,
        observations: c.observations,
        comprobantes: c.comprobantes,
        renewedAt,
      },
    });

    // Clone ContractTenants
    const oldTenants = await tx.contractTenant.findMany({
      where: { contractId: c.id },
      select: { tenantId: true, isPrimary: true },
    });
    if (oldTenants.length > 0) {
      await tx.contractTenant.createMany({
        data: oldTenants.map((t) => ({
          contractId: oldContract.id,
          tenantId: t.tenantId,
          isPrimary: t.isPrimary,
        })),
      });
    }

    // Move MonthlyRecords (and their cascade-related rows stay attached via FK)
    await tx.monthlyRecord.updateMany({
      where: { id: { in: outIds } },
      data: { contractId: oldContract.id },
    });

    // Move Debts whose monthlyRecordId points to the moved MRs
    await tx.debt.updateMany({
      where: { monthlyRecordId: { in: outIds } },
      data: { contractId: oldContract.id },
    });

    // Move Payments matching the moved periods
    for (const p of outPeriods) {
      await tx.payment.updateMany({
        where: { contractId: c.id, periodMonth: p.periodMonth, periodYear: p.periodYear },
        data: { contractId: oldContract.id },
      });
    }

    // Move RentHistory entries created before the inferred renewal date
    await tx.rentHistory.updateMany({
      where: { contractId: c.id, appliedAt: { lt: renewedAt } },
      data: { contractId: oldContract.id },
    });

    // Link the current contract to the inferred old one
    await tx.contract.update({
      where: { id: c.id },
      data: { renewedFromContractId: oldContract.id },
    });

    return oldContract;
  });
}

async function runRepair(prisma, { dryRun = false, singleId = null } = {}) {
  let candidates = await findBrokenContracts(prisma);
  if (singleId) {
    candidates = candidates.filter((b) => b.contract.id === singleId);
  }
  const results = [];
  for (const item of candidates) {
    if (dryRun) {
      results.push({ contractId: item.contract.id, status: 'would-repair', outOfEpochCount: item.outOfEpoch.length });
    } else {
      try {
        const created = await repairOne(prisma, item);
        results.push({ contractId: item.contract.id, status: 'repaired', oldContractId: created.id });
      } catch (err) {
        results.push({ contractId: item.contract.id, status: 'failed', error: err.message });
      }
    }
  }
  return results;
}

module.exports = { findBrokenContracts, repairOne, runRepair, getCalendarPeriod };

// CLI entrypoint: only runs if invoked directly via `node scripts/repair-broken-renewals.js`.
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes('--dry-run');
  const SINGLE_ID = (() => {
    const i = args.indexOf('--id');
    return i !== -1 ? args[i + 1] : null;
  })();

  (async () => {
    console.log(`[repair] ${DRY_RUN ? 'DRY RUN' : 'APPLYING'}${SINGLE_ID ? ` (single: ${SINGLE_ID})` : ''}`);
    const results = await runRepair(prisma, { dryRun: DRY_RUN, singleId: SINGLE_ID });
    if (results.length === 0) {
      console.log(`[repair] No broken contracts detected.`);
    }
    for (const r of results) {
      if (r.status === 'would-repair') {
        console.log(`  - ${r.contractId}: ${r.outOfEpochCount} out-of-epoch MR(s) would be split off.`);
      } else if (r.status === 'repaired') {
        console.log(`  - ${r.contractId}: repaired (old contract = ${r.oldContractId}).`);
      } else {
        console.error(`  ✗ ${r.contractId}: failed — ${r.error}`);
      }
    }
    console.log(DRY_RUN ? `[repair] DRY RUN — no changes applied.` : `[repair] Done.`);
  })()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
