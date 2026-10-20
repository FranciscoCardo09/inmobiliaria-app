/**
 * Repara la deuda de JULIO 2026 de Yocsina 1615 (Asociación Civil Compartir).
 *
 * Julio se pagó el 18/07 con el sobrante de la deuda de Junio ($1.017.110,08) más $10.457 en
 * efectivo (sobraron $0,08). El cierre del 31/07 —con el doble conteo del tramo pago→cierre,
 * arreglado el 14/08— le inventó mora y creó una deuda de Julio. El 14/08
 * `repair-punitorio-doble-conteo-cierre.js` bajó la mora y dejó `currentTotal` en $0 pero no
 * cerró la deuda: quedó OPEN con neto −$0,08, devengando mora fantasma desde el 18/07 y
 * bloqueando el cobro de Agosto (orden cronológico).
 *
 * Fix: se BORRA la deuda de Julio (no tiene pagos propios y el cierre de hoy no la crearía:
 * `createDebtFromMonthlyRecord` devuelve null con neto ≤ $1) y se limpia la condonación de
 * $11.142,92 del 21/07, que perdonaba un saldo que no existía. Marcarla PAID en vez de borrarla
 * no alcanza: `_punitoryOutsideConcepts` repondría como "mora pagada con crédito" los $10.457
 * que el recibo ya imputó a PUNITORIOS (Julio quedaría debiendo $10.456,92), y la condonación
 * vieja se arrastraría a Agosto como $686 de saldo a favor falso.
 * Después se recalcula la cadena desde Julio. Agosto y Septiembre (deudas reales) no cambian.
 *
 * Uso (desde inmobiliaria-app/backend):
 *   TZ=UTC node scripts/repair-yocsina-julio-2026.js           # dry-run
 *   TZ=UTC node scripts/repair-yocsina-julio-2026.js --apply
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');
const { calculateDebtPunitory, isDebtSettledAtAnchor, canPayCurrentMonth } = require('../src/services/debtService');
const { getTodayLocalString } = require('../src/utils/dateUtils');

const CONTRACT_ID = '8a23b1ff-46f8-4e3e-9714-ed55ce294584';
const DEBT_ID = 'e75d30e0-b916-4ddd-b802-e7dc3d0dbd19'; // deuda de julio 2026
const RECORD_ID = '7bfe106c-36a1-4556-a362-2d6406c3080f'; // julio 2026: el primero a recalcular

const APPLY = process.argv.includes('--apply');
const money = (n) => (n == null ? 'null' : `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function snapshot(label) {
  const records = await prisma.monthlyRecord.findMany({
    where: { contractId: CONTRACT_ID, periodYear: 2026, periodMonth: { in: [7, 8, 9, 10] } },
    orderBy: { periodMonth: 'asc' },
    include: { debt: true },
  });
  console.log(`\n=== ${label} ===`);
  for (const r of records) {
    const d = r.debt;
    let live = '';
    if (d && d.status !== 'PAID') {
      const p = await calculateDebtPunitory(d, getTodayLocalString(), null, true);
      live = `  en vivo=${money(p.remainingDebt + (p.unpaidAccumulatedPunitory || 0) + p.amount)} (mora ${money(p.amount)})`;
    }
    console.log(
      `  ${String(r.periodMonth).padStart(2)}/2026  aFavorAnt=${money(r.previousBalance).padStart(16)}`
      + `  total=${money(r.totalDue).padStart(16)}  balance=${money(r.balance).padStart(16)}`
      + `  mes=${r.status}${d ? `  deuda=${d.status} (${money(d.currentTotal)})${live}` : ''}`,
    );
  }
  const group = await prisma.contract.findUnique({ where: { id: CONTRACT_ID }, select: { groupId: true } });
  const order = await canPayCurrentMonth(group.groupId, CONTRACT_ID, { periodMonth: 8, periodYear: 2026 });
  console.log(`  ¿Se puede cobrar Agosto? ${order.canPay ? 'SÍ' : `NO — ${order.message}`}`);
}

(async () => {
  // Producción corre en UTC: desde ART el ancla de punitorios no matchea y se cuenta un día de más.
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error('Correr con TZ=UTC (producción corre en UTC).');
  }

  const debt = await prisma.debt.findUnique({ where: { id: DEBT_ID } });
  if (!debt) {
    console.log('La deuda de Julio ya no existe: nada que hacer.');
    return;
  }
  console.log(`Deuda ${debt.periodLabel}: status=${debt.status} currentTotal=${money(debt.currentTotal)} saldadaAlAncla=${isDebtSettledAtAnchor(debt)}`);
  if (debt.status === 'PAID') {
    console.log('Ya está PAID: nada que hacer.');
    return;
  }
  if (!isDebtSettledAtAnchor(debt)) {
    throw new Error('La deuda ya no está cubierta por el crédito: revisar a mano antes de tocarla.');
  }

  await snapshot('ANTES');

  if (!APPLY) {
    console.log('\n[DRY-RUN] Borraría la deuda de Julio, limpiaría la condonación de $11.142,92 y recalcularía la cadena desde Julio. Volvé a correr con --apply.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${CONTRACT_ID}'))`);
    const payments = await tx.debtPayment.count({ where: { debtId: DEBT_ID } });
    if (payments > 0) throw new Error('La deuda tiene pagos propios: no se puede borrar.');
    await tx.debt.delete({ where: { id: DEBT_ID } });
    await tx.monthlyRecord.update({
      where: { id: RECORD_ID },
      data: { balanceForgiven: 0, balanceForgivenAt: null },
    });
    await recalculateMultipleRecords([RECORD_ID], tx, true);
  }, { timeout: 30000 });

  await snapshot('DESPUÉS');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
