/**
 * Reparación de un solo uso — Ciuro Felipe (Azpeitia 1909 PB F): ajuste duplicado
 * en agosto 2026 heredado del índice anterior.
 *
 * QUÉ PASÓ
 *   El contrato estaba en ICL Cuatrimestral (freq=4 → ajustes en los meses 5, 9, 13…).
 *   El 23/07/2026 14:41 corrió el lote "aplicar ajustes del mes que viene" de ese
 *   índice y le grabó un AJUSTE_AUTOMATICO en el mes 5 (= agosto 2026):
 *   650.000 × 1,1214 = 728.910.
 *   El 27/07/2026 se corrigió el contrato a ICL Trimestral (freq=3 → ajustes en 4,
 *   7, 10…) y se aplicó el ajuste que SÍ correspondía, en el mes 4 (= julio 2026):
 *   650.000 × 1,0896 = 708.240.
 *   Pero cambiar el índice NO limpia el historial del índice viejo
 *   (`contractsController.js` solo emite el aviso ADJUSTMENTS_FROM_PREVIOUS_INDEX),
 *   así que la fila del mes 5 quedó viva.
 *
 * POR QUÉ IMPORTA
 *   El alquiler de cada mes se resuelve como "última fila de rent_history con
 *   effectiveFromMonth <= mes" (`monthlyRecordService.calculateRentForMonth`), así
 *   que desde agosto en adelante rige 728.910 en vez de 708.240 (+20.670/mes).
 *   Peor: el próximo ajuste (mes 7 = octubre) usa `getRentBeforeMonth`, que tomaría
 *   728.910 como base — el error se capitaliza y queda para siempre.
 *
 * POR QUÉ NO SE PUEDE DESHACER DESDE LA UI
 *   El botón "Deshacer" de Ajustes va por `undoAdjustmentForCalendar`, que filtra
 *   con `isAdjustmentMonth(startMonth, mes, freq)`. Con freq=3 el mes 5 no es mes de
 *   ajuste, así que la fila es invisible e inalcanzable desde la pantalla.
 *
 * QUÉ HACE ESTE SCRIPT
 *   1. Borra la fila AJUSTE_AUTOMATICO del mes 5 (misma semántica que el "deshacer"
 *      de Ajustes, que también borra la fila de rent_history).
 *   2. Resincroniza `rentAmount` de los registros mensuales abiertos desde el mes 5
 *      usando `calculateRentForMonth` — la MISMA función que usa la app; no escribe
 *      montos a mano.
 *   3. Dispara `recalculateMultipleRecords` para arrastrar totales/saldos hacia adelante.
 *
 * QUÉ NO TOCA
 *   - Meses 1..4: el 1 está COMPLETE y el 2, 3 y 4 ya están cerrados en Deuda.
 *     Julio (mes 4) queda con su 708.240, que es el valor correcto.
 *   - El índice: el contrato queda en ICL Trimestral, como está hoy.
 *   - `baseRent` (708.240) y `nextAdjustmentMonth` (7 = octubre): ya son correctos.
 *
 * Uso:
 *   DATABASE_URL=<prod> node scripts/repair-ciuro-ajuste-agosto-2026.js           # dry-run
 *   DATABASE_URL=<prod> node scripts/repair-ciuro-ajuste-agosto-2026.js --apply
 */
const prisma = require('../src/lib/prisma');
const { calculateRentForMonth, recalculateMultipleRecords } = require('../src/services/monthlyRecordService');

const APPLY = process.argv.includes('--apply');
const r2 = (n) => Math.round(n * 100) / 100;

const CONTRACT_ID = '8a992dee-bb77-43ce-bde5-47844c943393';
const ORPHAN_HISTORY_ID = '1808e085-8da7-48fe-b756-45f559e3b304';
const FROM_MONTH = 5; // agosto 2026

const SNAPSHOT = {
  select: {
    id: true, monthNumber: true, periodMonth: true, periodYear: true,
    rentAmount: true, ivaAmount: true, servicesTotal: true, previousBalance: true,
    punitoryAmount: true, totalDue: true, amountPaid: true, balance: true, status: true,
  },
};

const snapshot = () => prisma.monthlyRecord.findMany({
  ...SNAPSHOT,
  where: { contractId: CONTRACT_ID },
  orderBy: { monthNumber: 'asc' },
});

const show = (rows) => {
  for (const r of rows) {
    const mark = r.monthNumber >= FROM_MONTH ? '*' : ' ';
    console.log(
      `  ${mark} [${String(r.periodMonth).padStart(2, '0')}/${r.periodYear}] mes#${String(r.monthNumber).padStart(2)}` +
      ` rent=${r2(r.rentAmount)} svc=${r2(r.servicesTotal)} prevBal=${r2(r.previousBalance)}` +
      ` punit=${r2(r.punitoryAmount)} totalDue=${r2(r.totalDue)} paid=${r2(r.amountPaid)}` +
      ` balance=${r2(r.balance)} ${r.status}`
    );
  }
};

async function main() {
  const contract = await prisma.contract.findUnique({
    where: { id: CONTRACT_ID },
    include: { adjustmentIndex: { select: { name: true, frequencyMonths: true } },
      property: { select: { address: true } }, tenant: { select: { name: true } } },
  });
  if (!contract) throw new Error(`No existe el contrato ${CONTRACT_ID}`);

  console.log(`${'='.repeat(80)}`);
  console.log(`${contract.tenant?.name} — ${contract.property.address}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`  índice: ${contract.adjustmentIndex?.name} (freq=${contract.adjustmentIndex?.frequencyMonths})` +
    ` | startMonth=${contract.startMonth} | baseRent=${contract.baseRent}` +
    ` | nextAdjustmentMonth=${contract.nextAdjustmentMonth}`);

  // --- Guarda 1: la fila a borrar tiene que existir y estar realmente fuera del cronograma
  const orphan = await prisma.rentHistory.findUnique({ where: { id: ORPHAN_HISTORY_ID } });
  if (!orphan) {
    console.log('\nLa fila huérfana ya no existe: nada que reparar.');
    return;
  }
  const sm = contract.startMonth || 1;
  const freq = contract.adjustmentIndex.frequencyMonths;
  const enCronograma = orphan.effectiveFromMonth > sm && (orphan.effectiveFromMonth - sm) % freq === 0;
  if (orphan.contractId !== CONTRACT_ID || orphan.reason !== 'AJUSTE_AUTOMATICO' || enCronograma) {
    throw new Error(
      `ABORTA: la fila ${ORPHAN_HISTORY_ID} no es la huérfana esperada ` +
      `(contractId=${orphan.contractId} reason=${orphan.reason} mes=${orphan.effectiveFromMonth} enCronograma=${enCronograma})`
    );
  }
  console.log(`\n  A BORRAR: rent_history mes ${orphan.effectiveFromMonth} $${orphan.rentAmount}` +
    ` ${orphan.adjustmentPercent}% ${orphan.reason} (creada ${orphan.createdAt.toISOString().slice(0, 19)})`);
  console.log(`  meses de ajuste válidos con freq=${freq}: ` +
    Array.from({ length: Math.ceil(contract.durationMonths / freq) }, (_, k) => sm + (k + 1) * freq)
      .filter((m) => m <= sm + contract.durationMonths - 1).join(', '));

  // --- Guarda 2: ningún mes a tocar puede estar cobrado o cerrado
  const target = await prisma.monthlyRecord.findMany({
    where: { contractId: CONTRACT_ID, monthNumber: { gte: FROM_MONTH } },
    include: { transactions: { select: { id: true } }, debt: { select: { id: true, status: true } } },
    orderBy: { monthNumber: 'asc' },
  });
  const locked = target.filter((r) => r.status === 'COMPLETE' || r.amountPaid > 0 || r.debt || r.transactions.length);
  if (locked.length) {
    throw new Error(`ABORTA: hay meses >= ${FROM_MONTH} cobrados o cerrados: ` +
      locked.map((r) => `mes#${r.monthNumber}(${r.status})`).join(', '));
  }

  const before = await snapshot();
  console.log('\nANTES:');
  show(before);

  if (!APPLY) {
    // Mostrar qué alquiler quedaría en cada mes, sin escribir nada.
    console.log('\nPREVISTO (sin la fila huérfana):');
    const rows = await prisma.rentHistory.findMany({
      where: { contractId: CONTRACT_ID, id: { not: ORPHAN_HISTORY_ID } },
      orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
    });
    for (const r of target) {
      const hit = rows.find((h) => h.effectiveFromMonth <= r.monthNumber);
      const nuevo = hit ? hit.rentAmount : contract.baseRent;
      console.log(`    mes#${String(r.monthNumber).padStart(2)} [${String(r.periodMonth).padStart(2, '0')}/${r.periodYear}]` +
        ` rent ${r2(r.rentAmount)} -> ${r2(nuevo)}${nuevo === r.rentAmount ? ' (sin cambio)' : ''}`);
    }
    console.log('\nDRY-RUN: no se escribió nada. Volvé a correr con --apply para aplicar.');
    return;
  }

  // --- 1) Borrar la fila huérfana
  await prisma.rentHistory.delete({ where: { id: ORPHAN_HISTORY_ID } });
  console.log(`\n  [1/3] borrada rent_history ${ORPHAN_HISTORY_ID}`);

  // --- 2) Resincronizar rentAmount con la MISMA función que usa la app
  let resynced = 0;
  for (const r of target) {
    const rent = await calculateRentForMonth(contract, r.monthNumber);
    if (rent === r.rentAmount) continue;
    await prisma.monthlyRecord.update({
      where: { id: r.id },
      data: { rentAmount: rent, ivaAmount: r.includeIva ? rent * 0.21 : 0 },
    });
    console.log(`  [2/3] mes#${r.monthNumber}: rentAmount ${r2(r.rentAmount)} -> ${r2(rent)}`);
    resynced++;
  }
  if (!resynced) console.log('  [2/3] ningún rentAmount necesitaba resincronizarse');

  // --- 3) Cascada de totales/saldos hacia adelante
  const first = target.find((r) => r.monthNumber === FROM_MONTH) || target[0];
  await recalculateMultipleRecords([first.id], null, true);
  console.log(`  [3/3] recálculo en cascada desde mes#${first.monthNumber}`);

  const after = await snapshot();
  console.log('\nDESPUES:');
  show(after);

  // --- Verificación de post-condiciones
  const expected = 708240;
  const problems = [];
  for (const r of after.filter((x) => x.monthNumber >= FROM_MONTH)) {
    if (r2(r.rentAmount) !== expected) problems.push(`mes#${r.monthNumber} rent=${r2(r.rentAmount)} (esperado ${expected})`);
  }
  const julio = after.find((r) => r.monthNumber === 4);
  if (julio && r2(julio.rentAmount) !== expected) problems.push(`julio (mes#4) cambió a ${r2(julio.rentAmount)}`);
  const stillThere = await prisma.rentHistory.findUnique({ where: { id: ORPHAN_HISTORY_ID } });
  if (stillThere) problems.push('la fila huérfana sigue existiendo');
  const c2 = await prisma.contract.findUnique({ where: { id: CONTRACT_ID }, select: { baseRent: true, nextAdjustmentMonth: true, adjustmentIndexId: true } });
  if (c2.baseRent !== expected) problems.push(`baseRent quedó en ${c2.baseRent}`);
  if (c2.nextAdjustmentMonth !== 7) problems.push(`nextAdjustmentMonth quedó en ${c2.nextAdjustmentMonth} (esperado 7 = octubre)`);
  if (c2.adjustmentIndexId !== contract.adjustmentIndexId) problems.push('cambió el índice de ajuste');

  if (problems.length) {
    console.log('\nATENCION:\n  - ' + problems.join('\n  - '));
    process.exitCode = 1;
  } else {
    console.log(`\nOK: agosto en adelante queda en $${expected}; julio intacto; ` +
      'índice ICL Trimestral y próximo ajuste en el mes 7 (octubre 2026).');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
