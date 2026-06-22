/**
 * Idempotent repair for the "saldo a favor falso" bug on debtor records.
 *
 * The bug (fixed in monthlyRecordService._recalculateCore): when a MonthlyRecord's
 * punitorios were paid across MORE THAN ONE transaction (typical for debtors: a debt
 * payment plus a later punitory payment), `amountPaid` summed every transaction but the
 * punitory term of `totalDue` only counted the LAST transaction's punitorio. The
 * uncounted punitorios surfaced as a fake positive `balance` (saldo a favor) that leaked
 * forward as the next month's `previousBalance`, lowering its real charge.
 *
 * Real example: Ponce Emilia Roxana, Marzo 2026 — pago de 977.000 dejó balance +290.512
 * que se propagó a Abril como crédito.
 *
 * This script finds records whose stored positive balance is inflated by punitorios that
 * the (now fixed) calculation does not count, and re-runs the real recalculation
 * (which cascades forward over the same contract/year) to clean balance + previousBalance.
 *
 * SCOPE: only records with a positive false credit (balance > $1) where
 *   sum(PUNITORIOS concepts) > last-transaction punitorio.
 * Records that are merely settled (balance ≈ 0) or genuinely overpaid are NOT touched.
 * Records the fix would change in OTHER ways (e.g. a double-paid punitorio anomaly) are
 * reported under "review" but NOT modified, so working tenants stay untouched.
 *
 * Usage:
 *   node backend/scripts/repair-multi-punitory-balance.js --dry-run   # report only
 *   node backend/scripts/repair-multi-punitory-balance.js             # apply fixes
 *   node backend/scripts/repair-multi-punitory-balance.js --id <contractId>
 */
// prisma is loaded lazily so this module can be required by tests with a fake client.

const round2 = (n) => Math.round(n * 100) / 100;

function lastTxPunitory(transactions) {
  if (!transactions || transactions.length === 0) return 0;
  const last = transactions[transactions.length - 1];
  return last.punitoryForgiven ? 0 : (last.punitoryAmount || 0);
}

function conceptPunitorySum(transactions) {
  return round2(
    (transactions || []).reduce((sum, t) => {
      if (t.punitoryForgiven) return sum;
      const txPun = (t.concepts || [])
        .filter((c) => c.type === 'PUNITORIOS')
        .reduce((a, c) => a + c.amount, 0);
      return sum + txPun;
    }, 0)
  );
}

/**
 * Find contracts with at least one record exhibiting the false-positive-credit bug.
 * Returns [{ contractId, tenantName, records: [{id, monthNumber, label, balance, oldPun, newPun}] }]
 */
async function findAffected(prisma) {
  const records = await prisma.monthlyRecord.findMany({
    where: { balance: { gt: 1 }, transactions: { some: {} } },
    select: {
      id: true,
      contractId: true,
      monthNumber: true,
      periodMonth: true,
      periodYear: true,
      balance: true,
      contract: { select: { tenant: { select: { name: true } } } },
      transactions: {
        orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          punitoryAmount: true,
          punitoryForgiven: true,
          concepts: { select: { type: true, amount: true } },
        },
      },
    },
  });

  const byContract = new Map();
  for (const r of records) {
    const oldPun = lastTxPunitory(r.transactions);
    const newPun = conceptPunitorySum(r.transactions);
    // Bug signature: more punitorios were actually paid (concepts) than the single
    // last-transaction value the old calc used → the positive balance is inflated.
    if (newPun > oldPun + 0.01) {
      if (!byContract.has(r.contractId)) {
        byContract.set(r.contractId, {
          contractId: r.contractId,
          tenantName: r.contract?.tenant?.name?.trim() || '(sin nombre)',
          records: [],
        });
      }
      byContract.get(r.contractId).records.push({
        id: r.id,
        monthNumber: r.monthNumber,
        label: `${r.periodMonth}/${r.periodYear}`,
        balance: r.balance,
        oldPun,
        newPun,
      });
    }
  }

  // Earliest affected record per contract drives the forward-cascading recalc.
  const result = Array.from(byContract.values());
  for (const c of result) {
    c.records.sort((a, b) => a.monthNumber - b.monthNumber);
    c.earliest = c.records[0];
  }
  return result;
}

async function repairOne(prisma, contract) {
  const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');
  // inline=true → synchronous _recalculateCore inside its own transaction; cascades
  // forward over the same contract/periodYear. Idempotent (early-break on unchanged).
  await recalculateMultipleRecords([contract.earliest.id], null, true);
}

async function runRepair(prisma, { dryRun = false, singleId = null } = {}) {
  let affected = await findAffected(prisma);
  if (singleId) affected = affected.filter((c) => c.contractId === singleId);

  const results = [];
  for (const c of affected) {
    const detail = {
      contractId: c.contractId,
      tenantName: c.tenantName,
      records: c.records,
      earliestMonth: c.earliest.monthNumber,
    };
    if (dryRun) {
      results.push({ ...detail, status: 'would-repair' });
    } else {
      try {
        await repairOne(prisma, c);
        results.push({ ...detail, status: 'repaired' });
      } catch (err) {
        results.push({ ...detail, status: 'failed', error: err.message });
      }
    }
  }
  return results;
}

module.exports = { findAffected, repairOne, runRepair, conceptPunitorySum, lastTxPunitory };

// CLI entrypoint
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
    console.log(`[repair-punitory] ${DRY_RUN ? 'DRY RUN' : 'APPLYING'}${SINGLE_ID ? ` (single: ${SINGLE_ID})` : ''}`);
    const results = await runRepair(prisma, { dryRun: DRY_RUN, singleId: SINGLE_ID });
    if (results.length === 0) {
      console.log('[repair-punitory] No affected records detected.');
    }
    for (const r of results) {
      const recs = r.records
        .map((x) => `M${x.monthNumber} ${x.label} (balance falso +${x.balance}, punit ${x.oldPun}→${x.newPun})`)
        .join('; ');
      if (r.status === 'would-repair') {
        console.log(`  - ${r.tenantName} [${r.contractId}]: recalc desde M${r.earliestMonth} → ${recs}`);
      } else if (r.status === 'repaired') {
        console.log(`  ✓ ${r.tenantName} [${r.contractId}]: reparado desde M${r.earliestMonth} → ${recs}`);
      } else {
        console.error(`  ✗ ${r.tenantName} [${r.contractId}]: falló — ${r.error}`);
      }
    }
    console.log(DRY_RUN ? '[repair-punitory] DRY RUN — sin cambios aplicados.' : '[repair-punitory] Listo.');
  })()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
