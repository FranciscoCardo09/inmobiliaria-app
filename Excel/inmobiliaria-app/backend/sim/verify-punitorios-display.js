/**
 * Verificación del fix de punitorios en display/recibo + reparación de datos.
 * READ por defecto. Con --apply corre B1 (repair-multi-punitory-balance) y luego
 * B2 (repair-debt-applied-credit) contra la base apuntada por DATABASE_URL.
 *
 * SIEMPRE contra simdb (copia descartable), NUNCA prod:
 *   DATABASE_URL=postgresql://postgres:sim@localhost:55432/simdb \
 *     node -r ./sim/clock.js sim/verify-punitorios-display.js [--apply]
 *
 * El reloj se fija a 2026-06-29 (clock.js) para que los punitorios en vivo coincidan
 * con los números de referencia capturados de prod.
 */
if (global.__setNow) global.__setNow(2026, 6, 29); // determinismo: "hoy" = 2026-06-29
const prisma = require('../src/lib/prisma');
const reportSvc = require('../src/services/reportDataService');
const mrSvc = require('../src/services/monthlyRecordService');
const debtSvc = require('../src/services/debtService');
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const APPLY = process.argv.includes('--apply');

let failures = 0;
function check(label, actual, expected, tol = 1) {
  const ok = Math.abs((actual || 0) - expected) <= tol;
  console.log(`   ${ok ? '✓' : '✗'} ${label}: ${fmt(actual)} ${ok ? '==' : '!= esperado'} ${fmt(expected)}`);
  if (!ok) failures++;
}

async function dumpRusso(tag) {
  const t = await prisma.tenant.findFirst({ where: { name: { contains: 'Russo', mode: 'insensitive' } }, select: { id: true } });
  const c = await prisma.contract.findFirst({ where: { tenantId: t.id }, select: { id: true, groupId: true } });
  console.log(`\n######### ${tag} #########`);

  const records = await prisma.monthlyRecord.findMany({
    where: { contractId: c.id, periodYear: 2026, periodMonth: { in: [2, 3, 4, 5] } },
    orderBy: { periodMonth: 'asc' },
    include: { debt: true },
  });

  for (const r of records) {
    console.log(`\n=== ${r.periodMonth}/2026 status=${r.status} ===`);
    console.log(`   persisted: punitoryAmount(frozen)=${fmt(r.punitoryAmount)} totalDue=${fmt(r.totalDue)} balance=${fmt(r.balance)} prevBalance=${fmt(r.previousBalance)} amountPaid=${fmt(r.amountPaid)}`);

    // RECIBO global (Path B)
    const recibo = await reportSvc.getPagoEfectivoFromRecord(c.groupId, r.id, null);
    const punLine = recibo.conceptos.find((x) => /punitorio/i.test(x.concepto));
    console.log(`   RECIBO: total=${fmt(recibo.total)} punitorios=${punLine ? fmt(punLine.importe) : '(sin línea)'}`);

    if (r.debt) {
      const live = await debtSvc.calculateDebtPunitory(r.debt, new Date(), null, true);
      const liveTotal = (live.remainingDebt || 0) + (live.unpaidAccumulatedPunitory || 0) + (live.newPunitoryAmount || 0);
      console.log(`   DEUDA ${r.debt.status}: appliedCredit=${fmt(r.debt.appliedCredit)} accumPunit=${fmt(r.debt.accumulatedPunitory)} currentTotal=${fmt(r.debt.currentTotal)}`);
      console.log(`   DEUDA live: remaining=${fmt(live.remainingDebt)} unpaidAccum=${fmt(live.unpaidAccumulatedPunitory)} newPunit=${fmt(live.newPunitoryAmount)} => totalVivo=${fmt(liveTotal)}`);
    }
  }

  // Enrichment (Control Mensual / modal Historial) — usa upsert/recalc; correr por mes.
  console.log(`\n   --- enrichment (totalHistorico = lo que muestra el modal Historial) ---`);
  for (const m of [2, 3, 4, 5]) {
    const enriched = await mrSvc.getOrCreateMonthlyRecords(c.groupId, m, 2026);
    const rr = enriched.find((x) => x.contractId === c.id);
    if (rr) console.log(`   ${m}/2026: livePunitory=${fmt(rr.livePunitoryAmount)} totalHistorico=${fmt(rr.totalHistorico)} liveTotalDue=${fmt(rr.liveTotalDue)} totalPunitoriosHist=${fmt(rr.totalPunitoriosHistoricos)}`);
  }
  return { contractId: c.id, groupId: c.groupId, records };
}

(async () => {
  console.log(`Reloj simulado: ${new Date().toISOString().slice(0, 10)}`);
  await dumpRusso('ANTES (estado actual, con código YA arreglado)');

  if (APPLY) {
    console.log(`\n\n========== APLICANDO REPARACIONES ==========`);
    const { runRepair: runB1 } = require('../scripts/repair-multi-punitory-balance');
    const b1 = await runB1(prisma, { dryRun: false });
    console.log(`B1 (recalc records): ${b1.length} contratos tocados`);
    b1.forEach((r) => console.log(`   ${r.status} ${r.tenantName}`));

    const { runRepair: runB2 } = require('../scripts/repair-debt-applied-credit');
    const b2 = await runB2(prisma, { dryRun: false });
    console.log(`B2 (appliedCredit deudas): ${b2.length} deudas tocadas`);
    b2.forEach((r) => console.log(`   ${r.status} ${r.tenantName} [${r.label}] credit ${fmt(r.oldCredit)}→${fmt(r.newCredit)} total ${fmt(r.oldTotal)}→${fmt(r.newTotal)}`));

    const after = await dumpRusso('DESPUÉS de B1+B2');

    // ----- ASSERTS de referencia (Russo) -----
    console.log(`\n========== ASSERTS ==========`);
    const recs = after.records.reduce((acc, r) => { acc[r.periodMonth] = r; return acc; }, {});

    // Abril: saldado, balance 0, frozen punitoryAmount intacto (invariante)
    const abr = await prisma.monthlyRecord.findUnique({ where: { id: recs[4].id } });
    console.log(`Abril:`);
    check('balance Abril ≈ 0', abr.balance, 0);
    check('punitoryAmount (frozen) intacto = 129.626,54', abr.punitoryAmount, 129626.54, 0.5);
    const reciboAbr = await reportSvc.getPagoEfectivoFromRecord(after.groupId, abr.id, null);
    const punAbr = reciboAbr.conceptos.find((x) => /punitorio/i.test(x.concepto));
    check('recibo Abril punitorios ≈ 164.583,96', punAbr?.importe, 164583.96, 1);
    check('recibo Abril total ≈ 940.000', reciboAbr.total, 940000, 1);

    // Mayo: previousBalance 0, deuda sin crédito falso
    const may = await prisma.monthlyRecord.findUnique({ where: { id: recs[5].id }, include: { debt: true } });
    console.log(`Mayo:`);
    check('previousBalance Mayo ≈ 0', may.previousBalance, 0);
    check('deuda Mayo appliedCredit ≈ 0', may.debt.appliedCredit, 0, 0.5);
    const liveMay = await debtSvc.calculateDebtPunitory(may.debt, new Date(), null, true);
    const liveTotalMay = (liveMay.remainingDebt || 0) + (liveMay.unpaidAccumulatedPunitory || 0) + (liveMay.newPunitoryAmount || 0);
    console.log(`   deuda Mayo total vivo (esperado ~829.414 = 794.456,77 + 34.957,42): ${fmt(liveTotalMay)}`);

    console.log(`\n${failures === 0 ? '✅ TODOS LOS ASSERTS OK' : `❌ ${failures} ASSERTS FALLARON`}`);
  } else {
    console.log(`\n(Solo lectura. Pasá --apply para correr B1+B2 y los asserts.)`);
  }

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
