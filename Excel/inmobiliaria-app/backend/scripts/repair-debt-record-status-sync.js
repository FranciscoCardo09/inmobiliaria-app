/**
 * Repara la desincronización Debt.status vs MonthlyRecord.status reportada por el
 * usuario (2026-07-14): el desglose de "deuda saldada" mostraba un período como
 * saldado mientras Control Mensual mostraba "Pago Parcial" para el mismo mes.
 *
 * Causa raíz (fixeada en debtService.js `recalculateDebtFromMonthlyRecord`): esa
 * función decidía PAID/PARTIAL comparando `amountPaid >= totalBase` (SIN punitorios
 * ni saldo a favor aplicado) y nunca sincronizaba el MonthlyRecord — a diferencia de
 * `payDebt()`, que sí lo hace. Quedaban Deudas marcadas 'PAID' con el mes congelado
 * en 'PARTIAL' (o, en algún caso, deudas marcadas 'PAID' con saldo real pendiente).
 *
 * Este script SOLO repara el caso seguro: `Debt.status === 'PAID'` Y `currentTotal`
 * realmente ~0 (misma tolerancia $1 que payDebt) → sincroniza el MonthlyRecord a
 * COMPLETE. Si `currentTotal` NO es ~0 (la deuda se marcó PAID incorrectamente, con
 * saldo real pendiente), NO se toca nada automáticamente — se reporta aparte para
 * decisión manual (reabrir la deuda cambia lo que el inquilino/propietario ve como
 * saldado, no es un cambio inocuo).
 *
 * Uso:
 *   node backend/scripts/repair-debt-record-status-sync.js --dry-run
 *   node backend/scripts/repair-debt-record-status-sync.js
 *   node backend/scripts/repair-debt-record-status-sync.js --id <contractId>
 */

async function findAffected(prisma, { singleId = null } = {}) {
  const debts = await prisma.debt.findMany({
    where: {
      status: 'PAID',
      ...(singleId ? { contractId: singleId } : {}),
    },
    select: {
      id: true, contractId: true, monthlyRecordId: true, periodLabel: true,
      currentTotal: true, lastPaymentDate: true, closedAt: true,
      contract: { select: { tenant: { select: { name: true } }, property: { select: { address: true } } } },
    },
  });

  const mrIds = debts.map((d) => d.monthlyRecordId);
  const records = await prisma.monthlyRecord.findMany({
    where: { id: { in: mrIds } },
    select: { id: true, status: true, fullPaymentDate: true },
  });
  const recById = new Map(records.map((r) => [r.id, r]));

  const affected = [];
  for (const d of debts) {
    const record = recById.get(d.monthlyRecordId);
    if (!record || record.status === 'COMPLETE') continue; // ya en sincro

    const label = `${d.contract?.tenant?.name?.trim() || '?'} — ${d.contract?.property?.address || '?'} [${d.periodLabel || '?'}]`;
    const currentTotal = Number(d.currentTotal || 0);

    if (currentTotal <= 1) {
      affected.push({ debtId: d.id, monthlyRecordId: d.monthlyRecordId, label, currentTotal, classify: 'safe-sync' });
    } else {
      // status='PAID' pero saldo real pendiente: la deuda se cerró mal, no el record.
      // No se auto-repara: requiere decisión (¿reabrir la deuda? ¿condonar el resto?).
      affected.push({ debtId: d.id, monthlyRecordId: d.monthlyRecordId, label, currentTotal, classify: 'review-paid-with-balance' });
    }
  }
  return affected;
}

async function repairOne(prisma, item) {
  const debt = await prisma.debt.findUnique({ where: { id: item.debtId }, select: { lastPaymentDate: true, closedAt: true } });
  await prisma.monthlyRecord.update({
    where: { id: item.monthlyRecordId },
    data: {
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      fullPaymentDate: debt.lastPaymentDate || debt.closedAt || new Date(),
    },
  });
}

async function runRepair(prisma, { dryRun = false, singleId = null } = {}) {
  const found = await findAffected(prisma, { singleId });
  const results = [];
  for (const item of found) {
    if (item.classify === 'review-paid-with-balance') { results.push({ ...item, action: 'review' }); continue; }
    if (dryRun) { results.push({ ...item, action: 'would-repair' }); continue; }
    try { await repairOne(prisma, item); results.push({ ...item, action: 'repaired' }); }
    catch (e) { results.push({ ...item, action: 'error', error: e.message }); }
  }
  return results;
}

module.exports = { findAffected, repairOne, runRepair };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const SINGLE = (() => { const i = args.indexOf('--id'); return i !== -1 ? args[i + 1] : null; })();
  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  (async () => {
    console.log(`[repair-debt-record-status-sync] ${DRY ? 'DRY RUN' : 'APLICANDO'}${SINGLE ? ` (${SINGLE})` : ''}`);
    const res = await runRepair(prisma, { dryRun: DRY, singleId: SINGLE });
    const fixed = res.filter((r) => r.action === 'would-repair' || r.action === 'repaired');
    const review = res.filter((r) => r.action === 'review');
    const errs = res.filter((r) => r.action === 'error');
    for (const r of fixed) {
      console.log(`  ${r.action === 'repaired' ? '✓' : '-'} ${r.label}: MonthlyRecord → COMPLETE (Debt.currentTotal=${fmt(r.currentTotal)})`);
    }
    if (review.length) {
      console.log(`\n  ⚠ Deudas 'PAID' con saldo pendiente real (NO tocadas, requieren decisión manual):`);
      review.forEach((r) => console.log(`    · ${r.label}: currentTotal=${fmt(r.currentTotal)} (revisar si la deuda se cerró mal)`));
    }
    if (errs.length) errs.forEach((r) => console.error(`  ✗ ${r.label}: ${r.error}`));
    console.log(`\nResumen: ${fixed.length} sincronizados, ${review.length} a revisar manualmente, ${errs.length} errores.`);
    console.log(DRY ? '[dry-run] sin cambios.' : '[listo]');
  })().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
