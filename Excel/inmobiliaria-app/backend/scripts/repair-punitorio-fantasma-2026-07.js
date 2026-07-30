/**
 * Reparación de un solo uso — registros con punitorio fantasma guardado (2026-07-30).
 *
 * Mismo bug que el caso Biassi (ver scripts/repair-biassi-julio-2026.js y
 * tests/punitoryStaleRecalc.test.js): `_recalculateCore` le pasaba a
 * `computeLiveRecordPunitory` el `record` crudo de la DB en vez de los
 * `servicesTotal`/`amountPaid`/`previousBalance` que acababa de recomputar, y
 * `registerPaymentCore` recalcula ANTES de persistir `amountPaid`. Cargar un pago
 * con fecha retroactiva devengaba mora desde la fecha del pago hasta el día de la
 * carga, sobre un mes que ya estaba cancelado.
 *
 * POR QUÉ IMPORTA aunque la pantalla los muestre bien: Control Mensual recalcula
 * en vivo en cada carga (`liveTotalDue`/`liveBalance`, y pisa el status a COMPLETE
 * en memoria), así que estos 4 se VEN cancelados. Pero el CIERRE MENSUAL selecciona
 * por el status GUARDADO (`monthlyCloseService.js`: `status: { in: ['PENDING',
 * 'PARTIAL'] }`) y llama a `createDebtFromMonthlyRecord` — o sea que al cerrar el
 * mes les generaría una deuda a inquilinos que ya pagaron. Además el saldo a favor
 * chico (Falco +20, Donemberg +0,50) no se arrastra, porque el arrastre lee el
 * balance guardado (negativo) y lo toma como 0.
 *
 * NO repara datos a mano: dispara el recálculo con el código ya corregido. Cada
 * registro arrastra hacia adelante el resto de los meses de su contrato.
 *
 * Uso:
 *   node scripts/repair-punitorio-fantasma-2026-07.js          # dry-run
 *   node scripts/repair-punitorio-fantasma-2026-07.js --apply
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');

const APPLY = process.argv.includes('--apply');
const r2 = (n) => Math.round(n * 100) / 100;

// Ninguno tiene saldo a favor del mes anterior, así que alcanza con arrancar en el
// propio registro (el arrastre hacia adelante lo hace _recalculateCore).
const TARGETS = [
  { label: 'Marquez Gomez Diego Roman — Los Pinos 3989 T1 2A — 07/2026',
    recordId: 'ab72d27d-a9ce-4f6f-9180-1d757062f610', contractId: '22fa988d-a566-4b79-81e0-4d2cb580e8d1', monthNumber: 32 },
  { label: 'Xotta Marilena Margarita — Perez Correa 253 Dto1 — 05/2026',
    recordId: 'a8a605ac-c67e-487b-a15c-a9fba0b3807f', contractId: '84fb2ae8-f8a2-421c-96e1-babf945a7ce3', monthNumber: 15 },
  { label: 'Donemberg Nadia — Bv San Juan 1594 PA — 07/2026',
    recordId: 'aab61a50-5852-4d1b-a06b-a976418e0911', contractId: '0a3e813a-2e5b-47d6-b223-e3ca8d4a9f69', monthNumber: 4 },
  { label: 'Falco Sanchez Carolina — Cabo 2º R. A. Moreno 6662/6670 L17 PhB — 07/2026',
    recordId: 'ee25c680-24e4-4913-adeb-335e4a8d7476', contractId: 'b6806dd1-2650-499a-9e0c-bc7a95e8df60', monthNumber: 8 },
];

const SNAPSHOT = {
  select: {
    id: true, monthNumber: true, periodMonth: true, periodYear: true,
    rentAmount: true, servicesTotal: true, previousBalance: true, punitoryAmount: true,
    totalDue: true, amountPaid: true, balance: true, status: true,
  },
};

const snapshot = (t) => prisma.monthlyRecord.findMany({
  ...SNAPSHOT,
  where: { contractId: t.contractId, monthNumber: { gte: t.monthNumber } },
  orderBy: { monthNumber: 'asc' },
});

const show = (rows) => {
  for (const r of rows) {
    console.log(
      `   [${String(r.periodMonth).padStart(2, '0')}/${r.periodYear}] mes#${r.monthNumber}` +
      ` totalDue=${r2(r.totalDue)} amountPaid=${r2(r.amountPaid)} balance=${r2(r.balance)}` +
      ` prevBal=${r2(r.previousBalance)} punit=${r2(r.punitoryAmount)} ${r.status}`
    );
  }
};

async function main() {
  let failures = 0;

  for (const t of TARGETS) {
    console.log(`\n${'='.repeat(78)}\n${t.label}\n${'='.repeat(78)}`);
    const before = await snapshot(t);
    if (!before.length) { console.log('   !! no se encontraron registros'); failures++; continue; }
    console.log('   ANTES:');
    show(before);

    if (!APPLY) continue;

    await recalculateMultipleRecords([t.recordId], null, true);

    const after = await snapshot(t);
    console.log('   DESPUES:');
    show(after);

    const target = after.find((r) => r.id === t.recordId);
    const cargos = r2(target.rentAmount + target.servicesTotal - target.previousBalance);
    const ok = target.status === 'COMPLETE' && target.balance >= -1 && r2(target.totalDue) === cargos;
    console.log(`   ${ok ? 'OK' : 'ATENCION'}: totalDue=${r2(target.totalDue)} (cargos=${cargos}) balance=${r2(target.balance)} ${target.status}`);
    if (!ok) failures++;
  }

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Volvé a correr con --apply para aplicar.');
    return;
  }
  if (failures) {
    console.log(`\n${failures} registro(s) no quedaron como se esperaba. Revisar antes de cerrar el mes.`);
    process.exitCode = 1;
  } else {
    console.log('\nTodos los registros quedaron CANCELADOS con su saldo real.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
