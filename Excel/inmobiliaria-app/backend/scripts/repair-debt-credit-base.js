/*
 * Repara deudas creadas con la lógica vieja, donde el saldo a favor del mes anterior
 * REDUCÍA el alquiler impago (y por ende la base de punitorios). Ej.: Ponce Abril 2026,
 * unpaidRentAmount=395.976 (= 686.488 - crédito 290.512).
 *
 * Con la lógica nueva: unpaidRentAmount = alquiler completo, y el saldo a favor va en
 * Debt.appliedCredit (se resta del total, no de la base). Este script recrea las deudas
 * OPEN afectadas usando createDebtFromMonthlyRecord (lógica nueva).
 *
 * SOLO repara deudas OPEN sin pagos (amountPaid=0). Las PARTIAL afectadas se reportan
 * para revisión manual (tienen pagos y no se pueden recrear a ciegas).
 *
 * Requiere que la columna Debt.appliedCredit exista (deploy con prisma db push hecho).
 *
 * Usage:
 *   node backend/scripts/repair-debt-credit-base.js --dry-run
 *   node backend/scripts/repair-debt-credit-base.js
 *   node backend/scripts/repair-debt-credit-base.js --id <contractId>
 */
const round2 = (n) => Math.round(n * 100) / 100;

async function findAffected(prisma) {
  // Deudas cuyo MonthlyRecord de origen tenía saldo a favor (previousBalance>0) y que
  // todavía no fueron reparadas (appliedCredit=0).
  const debts = await prisma.debt.findMany({
    where: { status: { in: ['OPEN', 'PARTIAL'] }, appliedCredit: 0 },
    include: {
      monthlyRecord: { select: { id: true, previousBalance: true, rentAmount: true, periodMonth: true, periodYear: true } },
      contract: { include: { tenant: { select: { name: true } } } },
    },
  });
  return debts.filter((d) => d.monthlyRecord && (d.monthlyRecord.previousBalance || 0) > 0.5);
}

async function runRepair(prisma, debtSvc, mrSvc, { dryRun = false, singleId = null } = {}) {
  let affected = await findAffected(prisma);
  if (singleId) affected = affected.filter((d) => d.contractId === singleId);

  const results = [];
  for (const d of affected) {
    const tenant = d.contract?.tenant?.name?.trim() || '(sin nombre)';
    const detail = {
      contractId: d.contractId, tenant, debtId: d.id, status: d.status,
      period: `${d.monthlyRecord.periodMonth}/${d.monthlyRecord.periodYear}`,
      prevBalance: round2(d.monthlyRecord.previousBalance), unpaidRentBefore: round2(d.unpaidRentAmount),
      rentAmount: round2(d.monthlyRecord.rentAmount),
    };
    if (d.status === 'PARTIAL') { results.push({ ...detail, action: 'manual-review (PARTIAL con pagos)' }); continue; }
    if (dryRun) { results.push({ ...detail, action: 'would-recreate' }); continue; }
    try {
      const recordId = d.monthlyRecord.id;
      await prisma.debt.delete({ where: { id: d.id } });
      const record = await prisma.monthlyRecord.findUnique({
        where: { id: recordId },
        include: { transactions: { orderBy: { paymentDate: 'asc' } }, services: { include: { conceptType: { select: { category: true } } } } },
      });
      const created = await debtSvc.createDebtFromMonthlyRecord(record, d.contract);
      await mrSvc.recalculateMultipleRecords([recordId], null, true);
      results.push({ ...detail, action: created ? `recreada (unpaidRent=${round2(created.unpaidRentAmount)} appliedCredit=${round2(created.appliedCredit)})` : 'no-recreada (saldada)' });
    } catch (err) { results.push({ ...detail, action: `error: ${err.message}` }); }
  }
  return results;
}

module.exports = { findAffected, runRepair };

if (require.main === module) {
  require('dotenv').config();
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const debtSvc = require('../src/services/debtService');
  const mrSvc = require('../src/services/monthlyRecordService');
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes('--dry-run');
  const i = args.indexOf('--id'); const SINGLE_ID = i !== -1 ? args[i + 1] : null;
  (async () => {
    console.log(`[repair-credit-base] ${DRY_RUN ? 'DRY RUN' : 'APLICANDO'}${SINGLE_ID ? ` (${SINGLE_ID})` : ''}`);
    const results = await runRepair(prisma, debtSvc, mrSvc, { dryRun: DRY_RUN, singleId: SINGLE_ID });
    if (!results.length) console.log('  Sin deudas afectadas.');
    for (const r of results) console.log(`  ${r.tenant} ${r.period}: ${r.action} (alquiler ${r.rentAmount}, antes unpaidRent=${r.unpaidRentBefore}, crédito=${r.prevBalance})`);
    console.log(DRY_RUN ? '[repair-credit-base] DRY RUN — sin cambios.' : '[repair-credit-base] Listo.');
  })().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
