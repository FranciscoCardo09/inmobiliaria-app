/**
 * Reparación de un solo uso — Biassi Gonzalo Amir, julio 2026.
 *
 * Contexto (2026-07-30): el mes cancelaba justo — cargos $768.478 cubiertos con
 * $767.918 en efectivo el 08/07 más $560 de saldo a favor de junio — pero tras
 * borrar y volver a cargar el pago quedó con `totalDue = 857.455,57` y saldo
 * `-89.537,57`: $648.823 × 0,6% × 23 días de mora inventada.
 *
 * Causa raíz y fix de CÓDIGO (ya aplicados, ver tests/punitoryStaleRecalc.test.js):
 *   1. `_recalculateCore` le pasaba a `computeLiveRecordPunitory` el `record` crudo
 *      de la DB en vez de los `servicesTotal`/`amountPaid`/`previousBalance` que
 *      acababa de recomputar. `registerPaymentCore` recalcula ANTES de persistir
 *      `amountPaid`, así que la base de punitorios veía "sin ningún pago".
 *   2. `computePunitoryBase` no contaba el saldo a favor como plata cobrada, y
 *      dejaba los $560 del crédito devengando mora todos los días.
 *
 * Este script NO repara datos a mano: sólo dispara el recálculo del registro con
 * el código ya corregido. Arranca desde JUNIO (mes #5) para que el saldo a favor
 * de $560 se reconstruya en cadena en vez de tomarse del valor persistido.
 *
 * Uso (contra la DATABASE_URL configurada):
 *   node scripts/repair-biassi-julio-2026.js          # dry-run, no escribe
 *   node scripts/repair-biassi-julio-2026.js --apply  # aplica
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');

const CONTRACT_ID = '51a769b0-ad1e-4b27-bb7c-2c5fa335340a'; // Av. Figueroa Alcorta 482 Dto 5
const JUNIO_2026 = 'da1662f4-0999-4507-92a2-6c685b29a140';  // mes #5 — cabecera de la cadena
const JULIO_2026 = '7c6e8df1-7c4b-44ae-ac1c-a3c59bca192b';  // mes #6 — el registro roto

const APPLY = process.argv.includes('--apply');
const r2 = (n) => Math.round(n * 100) / 100;

const SNAPSHOT = {
  select: {
    id: true, monthNumber: true, periodMonth: true, periodYear: true,
    rentAmount: true, servicesTotal: true, previousBalance: true,
    punitoryAmount: true, totalDue: true, amountPaid: true, balance: true, status: true,
  },
};

const show = (label, rows) => {
  console.log(`\n--- ${label} ---`);
  for (const r of rows) {
    console.log(
      `[${String(r.periodMonth).padStart(2, '0')}/${r.periodYear}] mes#${r.monthNumber}` +
      ` totalDue=${r2(r.totalDue)} amountPaid=${r2(r.amountPaid)} balance=${r2(r.balance)}` +
      ` punit=${r2(r.punitoryAmount)} prevBal=${r2(r.previousBalance)} ${r.status}`
    );
  }
};

async function main() {
  const where = { contractId: CONTRACT_ID, monthNumber: { gte: 5 } };
  const before = await prisma.monthlyRecord.findMany({ ...SNAPSHOT, where, orderBy: { monthNumber: 'asc' } });
  if (!before.length) throw new Error(`No se encontraron registros para el contrato ${CONTRACT_ID}`);
  show('ANTES', before);

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Volvé a correr con --apply para aplicar.');
    return;
  }

  // Un solo recálculo desde junio; _recalculateCore arrastra hacia adelante solo.
  await recalculateMultipleRecords([JUNIO_2026], null, true);

  const after = await prisma.monthlyRecord.findMany({ ...SNAPSHOT, where, orderBy: { monthNumber: 'asc' } });
  show('DESPUES', after);

  const julio = after.find((r) => r.id === JULIO_2026);
  const ok = julio && r2(julio.totalDue) === 767918 && r2(julio.balance) === 0 && julio.status === 'COMPLETE';
  console.log(`\n${ok ? 'OK' : 'ATENCION'}: julio 2026 -> totalDue=${r2(julio?.totalDue)} balance=${r2(julio?.balance)} status=${julio?.status}`);
  if (!ok) {
    console.log('Se esperaba totalDue=767918 / balance=0 / COMPLETE. Revisar antes de dar por buena la reparación.');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
