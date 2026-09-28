/**
 * Resincroniza la cadena de meses de un contrato a partir de junio 2026.
 *
 * HISTORIA (2026-09-28). Tres incidentes encadenados sobre el mismo contrato:
 *
 *  1. Se cargó un pago sobre la deuda de junio y se anuló desde el historial de pagos.
 *     `cancelDebtPayment` clasificó mal el ancla (la PaymentTransaction todavía no estaba
 *     borrada) y escribió `accumulatedPunitory = 0`: la mora de junio desapareció.
 *     → Reparado con este script (primera corrida) + fix en el código (`punitoryBefore`).
 *
 *  2. Al recalcular, `_recalculateCore` usaba el `openDebt` leído ANTES de
 *     `syncDebtAppliedCreditFromRecord`, así que el mes quedaba corto un recálculo.
 *
 *  3. Con el pago de $1.900.000 ya registrado aparecieron tres errores de mezcla entre el
 *     punitorio CONGELADO y el saldo a favor: la deuda cobraba de más ($401.652,72 cuando
 *     debía $255.128,80), una deuda cubierta entera por crédito quedaba OPEN, y al saldarse
 *     la mora pagada con crédito se caía del bruto del mes (saldo a favor fantasma).
 *
 * Los tres están arreglados en el código. Esto sólo fuerza el recálculo de los meses que
 * quedaron escritos con los números viejos: no inventa ni pisa ningún monto a mano.
 *
 * USO (producción corre en UTC — ver la guarda de abajo):
 *   TZ=UTC node scripts/repair-ponce-junio-2026.js           # dry-run
 *   TZ=UTC node scripts/repair-ponce-junio-2026.js --apply
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');

const CONTRACT_ID = 'ae99532f-7700-4517-bf12-3a3d6b650919';
const RECORD_ID = '607da9ca-fc14-4e0a-866f-f2a7854dc57d'; // junio 2026: el primero a recalcular

const APPLY = process.argv.includes('--apply');
const money = (n) => (n == null ? 'null' : `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function snapshot(label) {
  const records = await prisma.monthlyRecord.findMany({
    where: { contractId: CONTRACT_ID, periodYear: 2026, periodMonth: { in: [6, 7, 8, 9] } },
    orderBy: { periodMonth: 'asc' },
    include: { debt: true },
  });
  console.log(`\n=== ${label} ===`);
  for (const r of records) {
    const d = r.debt;
    console.log(
      `  ${String(r.periodMonth).padStart(2)}/2026  aFavorAnt=${money(r.previousBalance).padStart(16)}`
      + `  total=${money(r.totalDue).padStart(16)}  balance=${money(r.balance).padStart(16)}`
      + `  mes=${r.status}${d ? `  deuda=${d.status} (${money(d.currentTotal)})` : ''}`,
    );
  }
}

(async () => {
  // El ancla de punitorios (`punitoryStartDate`) se guarda como medianoche LOCAL del
  // proceso que la creó, y `calculateDebtPunitory` la compara contra `new Date(y, m-1, 1)`.
  // Producción corre en UTC: corriendo esto desde ART el ancla no matchea, se toma la rama
  // "último pago" y cada mes cuenta UN DÍA DE MÁS.
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error('Correr con TZ=UTC (producción corre en UTC).');
  }

  await snapshot('ANTES');

  if (!APPLY) {
    console.log('\n[DRY-RUN] Recalcularía la cadena desde junio 2026. Volvé a correr con --apply.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${CONTRACT_ID}'))`);
    await recalculateMultipleRecords([RECORD_ID], tx, true);
  }, { timeout: 30000 });

  await snapshot('DESPUÉS');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
