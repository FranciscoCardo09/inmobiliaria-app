/**
 * Repara el DOBLE CONTEO de punitorios de las deudas nacidas de un mes con pago parcial
 * (bug 2026-08-14, caso Brunello Ana Carolina — Julio 2026).
 *
 * INVARIANTE del motor de deudas: `accumulatedPunitory` es el punitorio bruto devengado
 * HASTA EL ANCLA (`lastPaymentDate ?? punitoryStartDate`); `calculateDebtPunitory` suma el
 * tramo vivo DESDE el ancla. `createDebtFromMonthlyRecord` (y `recalculateDebtFromMonthlyRecord`)
 * lo rompían: con un pago parcial pre-cierre el ancla queda en la fecha de ESE pago, pero
 * guardaban en `accumulatedPunitory` el congelado MÁS el catch-up desde esa misma fecha hasta
 * el día del cierre. Ese tramo se cobraba dos veces y encima compuesto (el acumulado impago
 * entra al `compoundBase` del tramo vivo).
 *
 * Detección: deuda con `monthlyRecordId`, SIN pagos propios (`amountPaid = 0` y sin
 * DebtPayment — con pagos, `accumulatedPunitory` es responsabilidad de payDebt), cuyo
 * MonthlyRecord TIENE transacciones (ancla = fecha de pago), y
 * `accumulatedPunitory > calculateImputation(record).unpaidPunitory + 0.5`.
 *
 * Fix (idempotente): `accumulatedPunitory` = punitorio impago del MonthlyRecord,
 * `originalAmount` = total original del mes, y `currentTotal` recomputado. NO toca pagos,
 * ni `unpaidRentAmount`/`unpaidServicesAmount`, ni `amountPaid`, ni `punitoryStartDate`.
 * Sólo BAJA punitorios inflados, nunca los sube.
 *
 * Las deudas YA PAGADAS (status PAID) se REPORTAN aparte y NO se tocan (implican que el
 * inquilino pagó punitorios de más → requieren decisión de crédito/devolución).
 *
 * Al final recalcula los MonthlyRecords afectados, porque el "Total" de Control Mensual
 * (`_recalculateCore`) lee `openDebt.accumulatedPunitory` tal cual.
 *
 * Uso:
 *   node backend/scripts/repair-punitorio-doble-conteo-cierre.js --dry-run
 *   node backend/scripts/repair-punitorio-doble-conteo-cierre.js
 *   node backend/scripts/repair-punitorio-doble-conteo-cierre.js --id <contractId>
 */
const { round2 } = require('../src/utils/punitory');

async function findAffected(prisma, { singleId = null } = {}) {
  const { calculateImputation } = require('../src/services/debtService');

  const debts = await prisma.debt.findMany({
    where: {
      amountPaid: 0,
      ...(singleId ? { contractId: singleId } : {}),
    },
    include: {
      payments: true,
      contract: { select: { tenant: { select: { name: true } } } },
    },
  });

  const affected = [];
  for (const d of debts) {
    // Con pagos propios el acumulado lo maneja payDebt (grossPunitoryToDate): fuera de alcance.
    if ((d.payments || []).length > 0) continue;

    const mr = await prisma.monthlyRecord.findUnique({
      where: { id: d.monthlyRecordId },
      select: {
        id: true, rentAmount: true, servicesTotal: true, ivaAmount: true,
        amountPaid: true, punitoryAmount: true, previousBalance: true,
        _count: { select: { transactions: true } },
      },
    });
    if (!mr) continue;

    // Sin transacciones el ancla es el día 1 del período y el catch-up es legítimo
    // (calculateDebtPunitory lo ignora vía hasPayment=false, no hay duplicación).
    if ((mr._count?.transactions || 0) === 0) continue;

    const imputation = calculateImputation(mr);
    const correctAccum = round2(imputation.unpaidPunitory);
    const stored = round2(d.accumulatedPunitory || 0);
    const overcharge = round2(stored - correctAccum);
    if (overcharge <= 0.5) continue; // ya correcto (o ya reparado): idempotente

    const newCurrentTotal = Math.max(round2(
      (d.unpaidRentAmount || 0) + (d.unpaidServicesAmount || 0) + correctAccum
      - (d.appliedCredit || 0) - (d.amountPaid || 0)
    ), 0);

    affected.push({
      debtId: d.id,
      contractId: d.contractId,
      monthlyRecordId: mr.id,
      tenantName: d.contract?.tenant?.name?.trim() || '?',
      label: d.periodLabel || '?',
      status: d.status,
      storedAccum: stored,
      correctAccum,
      overcharge,
      oldCurrentTotal: round2(d.currentTotal || 0),
      newCurrentTotal,
      newOriginalAmount: round2(imputation.totalOriginal),
    });
  }
  return affected;
}

/**
 * Pasada INFORMATIVA (read-only): deudas nacidas de un mes con pago parcial que YA tienen
 * pagos propios. Ahí `accumulatedPunitory` fue reescrito por payDebt (grossPunitoryToDate),
 * así que no se puede derivar el valor correcto sin replayear los pagos — y el exceso contra
 * el punitorio congelado del mes incluye devengo LEGÍTIMO posterior al cierre. Se listan
 * solo para que quede constancia de que el sobrecargo original pudo haberse cobrado; no se
 * tocan (el inquilino ya pagó: cualquier corrección es una decisión de crédito/devolución).
 */
async function findPaidSuspects(prisma, { singleId = null } = {}) {
  const debts = await prisma.debt.findMany({
    where: {
      previousRecordPayment: { gt: 0 },
      amountPaid: { gt: 0 },
      ...(singleId ? { contractId: singleId } : {}),
    },
    include: { contract: { select: { tenant: { select: { name: true } } } } },
  });

  const suspects = [];
  for (const d of debts) {
    const mr = await prisma.monthlyRecord.findUnique({
      where: { id: d.monthlyRecordId },
      select: { punitoryAmount: true },
    });
    if (!mr) continue;
    const excess = round2((d.accumulatedPunitory || 0) - (mr.punitoryAmount || 0));
    if (excess <= 0.5) continue;
    suspects.push({
      debtId: d.id,
      tenantName: d.contract?.tenant?.name?.trim() || '?',
      label: d.periodLabel || '?',
      status: d.status,
      storedAccum: round2(d.accumulatedPunitory || 0),
      frozenRecord: round2(mr.punitoryAmount || 0),
      excess,
    });
  }
  return suspects;
}

async function repairOne(prisma, item) {
  await prisma.debt.update({
    where: { id: item.debtId },
    data: {
      accumulatedPunitory: item.correctAccum,
      currentTotal: item.newCurrentTotal,
      originalAmount: item.newOriginalAmount,
    },
  });
}

async function runRepair(prisma, { dryRun = false, singleId = null } = {}) {
  const found = await findAffected(prisma, { singleId });
  const results = [];
  for (const item of found) {
    if (item.status === 'PAID') { results.push({ ...item, action: 'paid-skip' }); continue; }
    if (dryRun) { results.push({ ...item, action: 'would-repair' }); continue; }
    try { await repairOne(prisma, item); results.push({ ...item, action: 'repaired' }); }
    catch (e) { results.push({ ...item, action: 'error', error: e.message }); }
  }

  // Realinear Control Mensual: _recalculateCore usa openDebt.accumulatedPunitory.
  if (!dryRun) {
    const recordIds = [...new Set(results.filter((r) => r.action === 'repaired').map((r) => r.monthlyRecordId))];
    if (recordIds.length > 0) {
      const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');
      // inline=true: el modo async marca los records como dirty y dispara un
      // setImmediate(processDirtyRecords) fire-and-forget, que muere cuando el script
      // termina. Acá tiene que completarse antes de salir.
      await recalculateMultipleRecords(recordIds, null, true);
    }
  }

  return results;
}

module.exports = { findAffected, findPaidSuspects, repairOne, runRepair };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const SINGLE = (() => { const i = args.indexOf('--id'); return i !== -1 ? args[i + 1] : null; })();
  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  (async () => {
    console.log(`[repair-punitorio-doble-conteo-cierre] ${DRY ? 'DRY RUN' : 'APLICANDO'}${SINGLE ? ` (${SINGLE})` : ''}`);
    const res = await runRepair(prisma, { dryRun: DRY, singleId: SINGLE });
    const paid = res.filter((r) => r.action === 'paid-skip');
    const fixed = res.filter((r) => r.action === 'would-repair' || r.action === 'repaired');
    const errs = res.filter((r) => r.action === 'error');
    let totalOver = 0;
    for (const r of fixed) {
      totalOver += r.overcharge;
      console.log(`  ${r.action === 'repaired' ? '✓' : '-'} ${r.tenantName} [${r.label}] ${r.status}: accum ${fmt(r.storedAccum)}→${fmt(r.correctAccum)} (sobrecargo ${fmt(r.overcharge)}), total ${fmt(r.oldCurrentTotal)}→${fmt(r.newCurrentTotal)}`);
    }
    if (paid.length) {
      console.log(`\n  ⚠ Deudas PAID afectadas (el inquilino pagó punitorios de más — NO tocadas, requieren decisión):`);
      paid.forEach((r) => console.log(`    · ${r.tenantName} [${r.label}]: accum ${fmt(r.storedAccum)}→${fmt(r.correctAccum)} (de más ${fmt(r.overcharge)})`));
    }
    if (errs.length) errs.forEach((r) => console.error(`  ✗ ${r.tenantName} [${r.label}]: ${r.error}`));

    const suspects = await findPaidSuspects(prisma, { singleId: SINGLE });
    if (suspects.length) {
      console.log(`\n  ℹ Deudas con pagos propios nacidas de un mes con pago parcial (NO se tocan). El`);
      console.log(`    "exceso" es una COTA SUPERIOR: mezcla el sobrecargo del bug con devengo legítimo`);
      console.log(`    posterior al cierre. Revisar a mano solo si el monto lo justifica:`);
      suspects.forEach((r) => console.log(`    · ${r.tenantName} [${r.label}] ${r.status}: accum ${fmt(r.storedAccum)} vs congelado del mes ${fmt(r.frozenRecord)} (exceso ≤ ${fmt(r.excess)})`));
    }

    console.log(`\nResumen: ${fixed.length} deuda(s) abierta(s) a reparar (sobrecargo total ${fmt(totalOver)}), ${paid.length} PAID afectadas, ${suspects.length} con pagos propios a revisar, ${errs.length} errores.`);
    console.log(DRY ? '[dry-run] sin cambios.' : '[listo]');
  })().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
