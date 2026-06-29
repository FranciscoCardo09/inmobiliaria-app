/**
 * Repara el punitorio CONGELADO de deudas calculado con la regla vieja en el TRAMO 0
 * (antes del primer pago): usaba alquiler + servicios cuando, sin ningún pago, debe ir
 * SOLO sobre el alquiler (regla confirmada por el usuario 2026-06-29; el código actual
 * ya la aplica, pero las deudas pagadas con código viejo quedaron con el valor inflado).
 *
 * Detección: se "replayean" los pagos de cada deuda con el código ACTUAL
 * (calculateDebtPunitory + la acumulación de payDebt) para obtener el accumulatedPunitory
 * CORRECTO, y se compara con el guardado. Si el guardado es MAYOR (sobrecargo), se repara.
 *
 * Fix (idempotente): setea `accumulatedPunitory` al valor correcto y recomputa
 * `currentTotal = round2(unpaidRent + unpaidServices + accumCorrecto - appliedCredit - amountPaid)`.
 * NO toca pagos, ni unpaidRent/unpaidServices, ni amountPaid. Solo BAJA punitorios inflados.
 *
 * Las deudas YA PAGADAS (status PAID) afectadas se REPORTAN aparte (implican que el
 * inquilino pagó punitorios de más → requieren decisión de crédito/devolución) y NO se
 * tocan automáticamente.
 *
 * Uso:
 *   node backend/scripts/repair-debt-punitory-base.js --dry-run
 *   node backend/scripts/repair-debt-punitory-base.js
 *   node backend/scripts/repair-debt-punitory-base.js --id <contractId>
 */
const { round2 } = require('../src/utils/punitory');

// Normaliza una fecha a las 12:00 LOCAL del día CALENDARIO en UTC del timestamp guardado.
// Algunos pagos quedaron guardados a 00:00Z (=día anterior en hora local AR) y otros a 03:00Z;
// tomar los componentes UTC recupera el día calendario que se quiso registrar, y el mediodía
// evita corrimientos de zona en el conteo de días (replica cómo payDebt usó la fecha original).
const normDate = (dt) => new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 12, 0, 0);

// Replay de los pagos de la deuda con el código actual, espejando payDebt:
// en cada pago totalPunitoryOwed = unpaidAccumulatedPunitory + nuevo; accumulated := ese total.
// `prevRecPayFlag` fuerza la regla del TRAMO 0: 0 → sin pago (solo alquiler, regla NUEVA);
// >0 → como si hubo pago (alquiler+servicios, regla VIEJA). Solo cambia el tramo 0; los
// tramos posteriores ya tienen amountPaid>0 e idéntico cálculo en ambos casos.
// Devuelve { accumulated, firstSeg } (firstSeg = acumulado tras el 1er pago, sin ruido de TZ).
async function replayAccumulated(debt, calculateDebtPunitory, prevRecPayFlag) {
  const state = {
    id: debt.id,
    contractId: debt.contractId,
    monthlyRecordId: null,
    periodMonth: debt.periodMonth,
    periodYear: debt.periodYear,
    unpaidRentAmount: debt.unpaidRentAmount || 0,
    unpaidServicesAmount: debt.unpaidServicesAmount || 0,
    previousRecordPayment: prevRecPayFlag,
    appliedCredit: debt.appliedCredit || 0,
    accumulatedPunitory: 0,
    amountPaid: 0,
    lastPaymentDate: null,
    punitoryStartDate: debt.punitoryStartDate,
  };
  let firstSeg = null;
  for (const p of debt.payments) {
    const pd = normDate(p.paymentDate);
    const live = await calculateDebtPunitory(state, pd, null, true);
    const totalPunitoryOwed = round2((live.unpaidAccumulatedPunitory || 0) + (live.amount || 0));
    state.amountPaid = round2(state.amountPaid + p.amount);
    state.accumulatedPunitory = totalPunitoryOwed;
    state.lastPaymentDate = pd;
    if (firstSeg === null) firstSeg = totalPunitoryOwed;
  }
  return { accumulated: state.accumulatedPunitory, firstSeg: firstSeg || 0 };
}

async function findAffected(prisma, { singleId = null } = {}) {
  const { calculateDebtPunitory } = require('../src/services/debtService');
  const debts = await prisma.debt.findMany({
    where: {
      payments: { some: {} },
      ...(singleId ? { contractId: singleId } : {}),
    },
    include: {
      payments: { orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }] },
      contract: { select: { tenant: { select: { name: true } } } },
    },
  });

  const affected = [];
  for (const d of debts) {
    // Si hubo pago del mes antes de cerrar, el tramo 0 ya usaba base total (correcto) → no aplica.
    if ((d.previousRecordPayment || 0) > 0) continue;
    const stored = round2(d.accumulatedPunitory || 0);
    let oldR, newR;
    try {
      newR = await replayAccumulated(d, calculateDebtPunitory, 0);      // regla NUEVA (tramo0 = alquiler)
      oldR = await replayAccumulated(d, calculateDebtPunitory, 0.01);   // regla VIEJA (tramo0 = alq+serv)
    } catch (e) {
      affected.push({ debtId: d.id, contractId: d.contractId, tenantName: d.contract?.tenant?.name?.trim() || '?', label: d.periodLabel, status: d.status, error: e.message });
      continue;
    }
    // Con las fechas normalizadas, los replays reproducen los días originales, así que sus
    // valores ABSOLUTOS son confiables. correcto = newReplay (tramo0 solo alquiler).
    const correctAccum = round2(newR.accumulated);
    const overcharge = round2(oldR.accumulated - newR.accumulated); // efecto de servicios en tramo0
    if (overcharge <= 0.5) continue; // sin servicios en tramo0 → nada que reparar

    const grossOwed = round2((d.unpaidRentAmount || 0) + (d.unpaidServicesAmount || 0) + correctAccum);
    const newCurrentTotal = Math.max(round2(grossOwed - (d.appliedCredit || 0) - (d.amountPaid || 0)), 0);

    // Clasificación POR EL VALOR GUARDADO (idempotente):
    //  - stored ≈ oldReplay  → calculado con regla vieja → AFECTADO (reparar a newReplay).
    //  - stored ≈ newReplay  → ya está bien (o ya reparado) → OK.
    //  - otro                → revisar manual.
    const tol = Math.max(1, oldR.accumulated * 0.003);
    const matchOld = Math.abs(stored - oldR.accumulated) <= tol;
    const matchNew = Math.abs(stored - newR.accumulated) <= tol;

    const base = {
      debtId: d.id, contractId: d.contractId,
      tenantName: d.contract?.tenant?.name?.trim() || '?',
      label: d.periodLabel || '?', status: d.status,
      storedAccum: stored, correctAccum, overcharge,
      oldReplay: round2(oldR.accumulated), newReplay: round2(newR.accumulated),
      oldCurrentTotal: round2(d.currentTotal || 0), newCurrentTotal,
    };
    if (matchNew) { affected.push({ ...base, classify: 'already-correct' }); }
    else if (matchOld) { affected.push({ ...base, classify: 'affected' }); }
    else { affected.push({ ...base, classify: 'review' }); }
  }
  return affected;
}

async function repairOne(prisma, item) {
  await prisma.debt.update({
    where: { id: item.debtId },
    data: { accumulatedPunitory: item.correctAccum, currentTotal: item.newCurrentTotal },
  });
}

async function runRepair(prisma, { dryRun = false, singleId = null } = {}) {
  const found = await findAffected(prisma, { singleId });
  const results = [];
  for (const item of found) {
    if (item.error) { results.push({ ...item, action: 'error' }); continue; }
    if (item.classify === 'already-correct') { results.push({ ...item, action: 'ok' }); continue; }
    if (item.classify === 'review') { results.push({ ...item, action: 'review' }); continue; }
    // classify === 'affected'
    if (item.status === 'PAID') { results.push({ ...item, action: 'paid-skip' }); continue; }
    if (dryRun) { results.push({ ...item, action: 'would-repair' }); continue; }
    try { await repairOne(prisma, item); results.push({ ...item, action: 'repaired' }); }
    catch (e) { results.push({ ...item, action: 'error', error: e.message }); }
  }
  return results;
}

module.exports = { findAffected, repairOne, runRepair, replayAccumulated };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const SINGLE = (() => { const i = args.indexOf('--id'); return i !== -1 ? args[i + 1] : null; })();
  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  (async () => {
    console.log(`[repair-debt-punitory-base] ${DRY ? 'DRY RUN' : 'APLICANDO'}${SINGLE ? ` (${SINGLE})` : ''}`);
    const res = await runRepair(prisma, { dryRun: DRY, singleId: SINGLE });
    const paid = res.filter((r) => r.action === 'paid-skip');
    const fixed = res.filter((r) => r.action === 'would-repair' || r.action === 'repaired');
    const review = res.filter((r) => r.action === 'review');
    const errs = res.filter((r) => r.action === 'error');
    let totalOver = 0;
    for (const r of fixed) {
      totalOver += r.overcharge;
      console.log(`  ${r.action === 'repaired' ? '✓' : '-'} ${r.tenantName} [${r.label}] ${r.status}: accum ${fmt(r.storedAccum)}→${fmt(r.correctAccum)} (sobrecargo ${fmt(r.overcharge)}), total ${fmt(r.oldCurrentTotal)}→${fmt(r.newCurrentTotal)}`);
    }
    if (paid.length) {
      console.log(`\n  ⚠ Deudas PAID afectadas (inquilino pagó punitorios de más — NO tocadas, requieren decisión):`);
      paid.forEach((r) => console.log(`    · ${r.tenantName} [${r.label}]: accum ${fmt(r.storedAccum)}→${fmt(r.correctAccum)} (de más ${fmt(r.overcharge)})`));
    }
    if (review.length) {
      console.log(`\n  ? Para revisión manual (el accum guardado no matchea ni regla vieja ni nueva):`);
      review.forEach((r) => console.log(`    · ${r.tenantName} [${r.label}] ${r.status}: accum=${fmt(r.storedAccum)} (vieja=${fmt(r.oldReplay)}, nueva=${fmt(r.newReplay)})`));
    }
    if (errs.length) errs.forEach((r) => console.error(`  ✗ ${r.tenantName} [${r.label}]: ${r.error}`));
    console.log(`\nResumen: ${fixed.length} OPEN/PARTIAL a reparar (sobrecargo total ${fmt(totalOver)}), ${paid.length} PAID afectadas, ${review.length} a revisar, ${errs.length} errores.`);
    console.log(DRY ? '[dry-run] sin cambios.' : '[listo]');
  })().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
