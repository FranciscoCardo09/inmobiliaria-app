/**
 * Repara la deuda de JUNIO 2026 de Ponce Emilia Roxana (contrato Los pinos 4171 T5 PB D).
 *
 * QUÉ PASÓ (2026-09-28 ~12:37): se cargó un pago de $401.653 sobre la deuda de junio y se
 * anuló desde el HISTORIAL DE PAGOS del mes. Ese camino (`deleteTransaction` →
 * `cancelDebtPayment(..., skipTransactionDeletion=true)`) borraba la PaymentTransaction
 * DESPUÉS de reconstruir el ancla de punitorios, así que `cancelDebtPayment` la contaba
 * como "pago previo al cierre", se iba por la rama `anchorIsPayment` y escribía en
 * `accumulatedPunitory` el punitorio impago del MonthlyRecord — que en un mes que nunca
 * tuvo un pago propio es $0. Los $146.523,92 devengados hasta el ancla desaparecieron.
 *
 * Con accumulatedPunitory = 0, `syncDebtAppliedCreditFromRecord` clampeó `appliedCredit`
 * al alquiler ($787.763) y junio pasó de $415.832,45 a $0, arrastrando un saldo a favor
 * de $297.880,83 a julio (que bajó de $1.213.155,02 a $1.038.165,22).
 *
 * QUÉ HACE: devuelve `accumulatedPunitory` a $146.523,92 (= originalAmount − alquiler, el
 * valor con el que nació la deuda: 1/6→1/7, 31 días × $787.763 × 0,6%) y recalcula la
 * cadena. `appliedCredit`, `currentTotal`, `totalDue` y el arrastre a julio/agosto los
 * reescribe el recálculo normal.
 *
 * El bug de código ya está arreglado (DebtPayment.punitoryBefore + exclusión de la
 * transacción que se está borrando). Esto es sólo el dato que quedó mal.
 *
 * USO:
 *   node scripts/repair-ponce-junio-2026.js           # dry-run (no escribe nada)
 *   node scripts/repair-ponce-junio-2026.js --apply   # aplica
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');

const DEBT_ID = '6e3fec39-2e29-4822-8949-73905fd1031c'; // Junio 2026
const RECORD_ID = '607da9ca-fc14-4e0a-866f-f2a7854dc57d';
const CONTRACT_ID = 'ae99532f-7700-4517-bf12-3a3d6b650919';

const APPLY = process.argv.includes('--apply');
const money = (n) => (n == null ? 'null' : `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function snapshot(label) {
  const debt = await prisma.debt.findUnique({ where: { id: DEBT_ID } });
  const records = await prisma.monthlyRecord.findMany({
    where: { contractId: CONTRACT_ID, periodYear: 2026, periodMonth: { in: [6, 7, 8, 9] } },
    orderBy: { periodMonth: 'asc' },
    select: { periodMonth: true, totalDue: true, balance: true, previousBalance: true },
  });
  console.log(`\n=== ${label} ===`);
  console.log(`  deuda junio: accPun=${money(debt.accumulatedPunitory)} appliedCredit=${money(debt.appliedCredit)} currentTotal=${money(debt.currentTotal)} status=${debt.status}`);
  for (const r of records) {
    console.log(`  ${String(r.periodMonth).padStart(2)}/2026  aFavorAnt=${money(r.previousBalance).padStart(16)}  total=${money(r.totalDue).padStart(16)}  balance=${money(r.balance)}`);
  }
  return debt;
}

(async () => {
  // El ancla de punitorios (`punitoryStartDate`) se guarda como medianoche LOCAL del
  // proceso que la creó, y `calculateDebtPunitory` la compara contra `new Date(y, m-1, 1)`.
  // Producción corre en UTC: corriendo esto desde ART el ancla no matchea, se toma la rama
  // "último pago" y cada mes cuenta UN DÍA DE MÁS. Hay que reparar en la misma TZ que el
  // servidor o los totales que se escriben no son los que el sistema va a mostrar.
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error('Correr con TZ=UTC (producción corre en UTC): TZ=UTC node scripts/repair-ponce-junio-2026.js --apply');
  }

  const before = await snapshot('ANTES');
  const alreadyOk = Math.abs((before.accumulatedPunitory || 0) - 146523.92) < 0.01;
  if (alreadyOk) {
    console.log('\nEl punitorio de la deuda ya está bien; sólo se re-sincroniza la cadena.');
  }
  if ((before.amountPaid || 0) !== 0) {
    throw new Error(`La deuda tiene pagos (amountPaid=${before.amountPaid}). Revisar a mano antes de tocar nada.`);
  }

  const target = Math.round(((before.originalAmount || 0) - 787763) * 100) / 100;
  if (Math.abs(target - 146523.92) > 0.01) {
    throw new Error(`originalAmount inesperado (${before.originalAmount}): el punitorio derivado da ${target}, no 146523.92.`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Escribiría accumulatedPunitory = ${money(target)} y recalcularía la cadena desde junio.`);
    console.log('[DRY-RUN] Volvé a correr con --apply para aplicarlo.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${CONTRACT_ID}'))`);
    await tx.debt.update({ where: { id: DEBT_ID }, data: { accumulatedPunitory: target } });
    await recalculateMultipleRecords([RECORD_ID], tx, true);
  }, { timeout: 30000 });

  await snapshot('DESPUÉS');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
