/**
 * Idempotent repair for debts whose `appliedCredit` was inflated by a phantom
 * "saldo a favor" on the source MonthlyRecord.
 *
 * Background: the multi-punitory bug (see repair-multi-punitory-balance.js) left some
 * records with a FALSE positive `balance` that leaked forward as the next month's
 * `previousBalance`. If that next month closed into a Debt, the debt was created with
 * `appliedCredit = min(max(previousBalance,0), totalUnpaid)` — i.e. it absorbed the
 * phantom credit and undercharged by that amount. `repair-multi-punitory-balance.js`
 * fixes the RECORD chain (balance + previousBalance) but does NOT touch the Debt entity.
 *
 * This script re-syncs each OPEN/PARTIAL debt's `appliedCredit` to the (now corrected)
 * `monthlyRecord.previousBalance`, and recomputes `currentTotal` accordingly.
 *
 * SCOPE: por defecto SOLO REDUCE créditos inflados (oldCredit > newCredit) — que es
 * exactamente la dirección del bug del falso saldo a favor. NUNCA otorga crédito nuevo
 * (un appliedCredit demasiado BAJO es otro escenario distinto, no verificado, p. ej.
 * Ponce: 0→26.779 — NO se toca). Pasar `--allow-increase` para permitir aumentos
 * (caso por caso, con verificación previa). DEBE correrse DESPUÉS de
 * repair-multi-punitory-balance.js (que corrige previousBalance).
 *
 * It is SURGICAL and SAFE: it only ever changes `appliedCredit` and `currentTotal`.
 * It NEVER touches `unpaidRentAmount`, `unpaidServicesAmount`, `accumulatedPunitory`,
 * `amountPaid`, or the `payments` — payment imputation is independent of the credit
 * (debtService.js:165-168). The live modal (calculateDebtPunitory) reads `appliedCredit`,
 * so correcting the stored field makes every live view correct automatically.
 *
 * Idempotent: re-running changes nothing once synced (early-skip when within $0.01).
 *
 * Usage:
 *   node backend/scripts/repair-debt-applied-credit.js --dry-run   # report only
 *   node backend/scripts/repair-debt-applied-credit.js             # apply
 *   node backend/scripts/repair-debt-applied-credit.js --id <contractId>
 *
 * RUN ORDER: after repair-multi-punitory-balance.js (which corrects previousBalance).
 */

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * For each OPEN/PARTIAL debt linked to a MonthlyRecord, compute the credit the record
 * should pass forward and compare with the stored appliedCredit.
 * Returns [{ debtId, contractId, tenantName, label, oldCredit, newCredit, oldTotal, newTotal }]
 */
async function findAffected(prisma, { singleId = null, allowIncrease = false } = {}) {
  const debts = await prisma.debt.findMany({
    where: {
      status: { in: ['OPEN', 'PARTIAL'] },
      ...(singleId ? { contractId: singleId } : {}),
    },
    select: {
      id: true,
      contractId: true,
      periodLabel: true,
      appliedCredit: true,
      currentTotal: true,
      unpaidRentAmount: true,
      unpaidServicesAmount: true,
      accumulatedPunitory: true,
      amountPaid: true,
      monthlyRecord: { select: { previousBalance: true } },
      contract: { select: { tenant: { select: { name: true } } } },
    },
  });

  const affected = [];
  for (const d of debts) {
    if (!d.monthlyRecord) continue; // deuda sin record vinculado: no aplica
    const prevBalance = Math.max(d.monthlyRecord?.previousBalance || 0, 0);
    // El crédito no puede exceder lo que se debe (alquiler + servicios + punitorios acumulados).
    const grossOwed = round2((d.unpaidRentAmount || 0) + (d.unpaidServicesAmount || 0) + (d.accumulatedPunitory || 0));
    const newCredit = round2(Math.min(prevBalance, grossOwed));
    const oldCredit = round2(d.appliedCredit || 0);
    const newTotal = round2(grossOwed - newCredit - (d.amountPaid || 0));
    const oldTotal = round2(d.currentTotal || 0);

    // Por defecto solo removemos crédito inflado (la dirección del bug). Un crédito que
    // habría que AUMENTAR es otro escenario y se omite salvo --allow-increase.
    const isReduction = newCredit < oldCredit - 0.01;
    if (!allowIncrease && !isReduction) continue;

    if (Math.abs(newCredit - oldCredit) > 0.01 || Math.abs(newTotal - oldTotal) > 0.01) {
      affected.push({
        debtId: d.id,
        contractId: d.contractId,
        tenantName: d.contract?.tenant?.name?.trim() || '(sin nombre)',
        label: d.periodLabel || '(sin período)',
        oldCredit,
        newCredit,
        oldTotal,
        newTotal,
      });
    }
  }
  return affected;
}

async function repairOne(prisma, item) {
  await prisma.debt.update({
    where: { id: item.debtId },
    data: { appliedCredit: item.newCredit, currentTotal: Math.max(item.newTotal, 0) },
  });
}

async function runRepair(prisma, { dryRun = false, singleId = null, allowIncrease = false } = {}) {
  const affected = await findAffected(prisma, { singleId, allowIncrease });
  const results = [];
  for (const item of affected) {
    if (dryRun) {
      results.push({ ...item, status: 'would-repair' });
    } else {
      try {
        await repairOne(prisma, item);
        results.push({ ...item, status: 'repaired' });
      } catch (err) {
        results.push({ ...item, status: 'failed', error: err.message });
      }
    }
  }
  return results;
}

module.exports = { findAffected, repairOne, runRepair };

// CLI entrypoint
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes('--dry-run');
  const ALLOW_INCREASE = args.includes('--allow-increase');
  const SINGLE_ID = (() => {
    const i = args.indexOf('--id');
    return i !== -1 ? args[i + 1] : null;
  })();

  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  (async () => {
    console.log(`[repair-debt-credit] ${DRY_RUN ? 'DRY RUN' : 'APPLYING'}${SINGLE_ID ? ` (single: ${SINGLE_ID})` : ''}${ALLOW_INCREASE ? ' [allow-increase]' : ''}`);
    const results = await runRepair(prisma, { dryRun: DRY_RUN, singleId: SINGLE_ID, allowIncrease: ALLOW_INCREASE });
    if (results.length === 0) {
      console.log('[repair-debt-credit] No hay deudas con appliedCredit desincronizado.');
    }
    for (const r of results) {
      const line = `${r.tenantName} [${r.label}]: appliedCredit ${fmt(r.oldCredit)}→${fmt(r.newCredit)}, currentTotal ${fmt(r.oldTotal)}→${fmt(r.newTotal)}`;
      if (r.status === 'would-repair') console.log(`  - ${line}`);
      else if (r.status === 'repaired') console.log(`  ✓ ${line}`);
      else console.error(`  ✗ ${line} — ${r.error}`);
    }
    console.log(DRY_RUN ? '[repair-debt-credit] DRY RUN — sin cambios aplicados.' : '[repair-debt-credit] Listo.');
  })()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
}
