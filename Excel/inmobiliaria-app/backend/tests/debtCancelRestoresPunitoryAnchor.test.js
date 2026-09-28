const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const realDateUtils = require('../src/utils/dateUtils');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// BUG (2026-09-28, deuda de junio 2026 de un contrato con saldo a favor arrastrado)
//
// INVARIANTE: cargar un pago sobre una deuda y anularlo tiene que dejar la deuda —y por
// lo tanto el monto del mes— EXACTAMENTE como estaba. No importa por qué pantalla se
// anule.
//
// `payDebt` pisa `accumulatedPunitory` con el bruto a la fecha del pago y mueve el ancla.
// Al anular, `cancelDebtPayment` tenía que ADIVINAR el valor anterior re-devengando, y las
// dos ramas daban mal:
//
//  1. Anulando desde el HISTORIAL DE PAGOS del mes (`deleteTransaction` →
//     `cancelDebtPayment(..., skipTransactionDeletion=true)`): ese camino borra la
//     PaymentTransaction DESPUÉS, así que el conteo de "transacciones que quedan" todavía
//     la incluía. La rama `anchorIsPayment` creía que el mes había tenido un pago propio
//     pre-cierre y escribía el punitorio impago del MonthlyRecord — $0 en un mes que nunca
//     se pagó. Junio pasó de $415.832,45 a $0 y arrastró $297.880,83 de saldo a favor
//     fantasma a julio (que bajó de $1.213.155,02 a $1.038.165,22).
//
//  2. Anulando desde DEUDAS (camino standalone): se devengaba el catch-up día 1 → HOY
//     ($567.189,36 en vez de los $146.523,92 con los que nació la deuda), y junio subía a
//     $567.189,36.
//
// FIX: `payDebt` guarda `punitoryBefore` (foto del ancla previa al pago) y anular restaura
// ese valor tal cual. Para filas viejas sin la foto queda la reconstrucción heurística,
// ahora con el conteo de transacciones corregido (`excludeTransactionId`).
//
// Montos del caso real: alquiler $787.763, sin servicios, saldo a favor arrastrado del mes
// anterior $1.085.643,83, deuda nacida el 1/7 con accumulatedPunitory $146.523,92
// (31 días × $787.763 × 0,6%).
// ============================================================================

let HOY = '2026-09-28';

const CONTRACT = {
  id: 'c-test', groupId: 'g1',
  punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
};

const RECORD = {
  id: 'mr-jun', contractId: 'c-test', groupId: 'g1',
  periodMonth: 6, periodYear: 2026, monthNumber: 31,
  status: 'PENDING', punitoryForgiven: false, includeIva: false,
  rentAmount: 787763, servicesTotal: 0, ivaAmount: 0,
  amountPaid: 0, previousBalance: 1085643.83,
  punitoryAmount: 0, punitoryDays: 0,
  transactions: [],
};

const DEBT = {
  id: 'd-jun', groupId: 'g1', contractId: 'c-test', monthlyRecordId: 'mr-jun',
  periodLabel: 'Junio 2026', periodMonth: 6, periodYear: 2026,
  originalAmount: 934286.92,
  unpaidRentAmount: 787763, unpaidServicesAmount: 0,
  previousRecordPayment: 0, appliedCredit: 1085643.83,
  accumulatedPunitory: 146523.92,
  currentTotal: 0, amountPaid: 0,
  punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 5, 1),
  lastPaymentDate: null, status: 'OPEN', payments: [],
};

function buildService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    '../utils/dateUtils': { ...realDateUtils, getTodayLocalString: () => HOY },
    // El recálculo del MonthlyRecord es otro subsistema; acá sólo interesa la Deuda.
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => {},
      recalculateMultipleRecords: async () => {},
    },
  });
}

// Réplica de `_punitoryOutsideConcepts` (monthlyRecordService.js): es el término por el que
// `accumulatedPunitory` entra en el `totalDue` que ve el usuario en Control Mensual.
const punitoryOutsideConcepts = (debt, live) => {
  const base = realPunitory.round2((debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0));
  const creditOnPunitory = realPunitory.round2(Math.min(
    Math.max((debt.appliedCredit || 0) - base, 0), debt.accumulatedPunitory || 0,
  ));
  const liveUnpaid = realPunitory.round2((live.unpaidAccumulatedPunitory || 0) + (live.amount || 0));
  return realPunitory.round2(liveUnpaid + creditOnPunitory);
};

const totalDueJunio = (debt, live) => realPunitory.round2(
  RECORD.rentAmount + RECORD.servicesTotal + punitoryOutsideConcepts(debt, live) - RECORD.previousBalance,
);

async function seed(prisma) {
  await prisma.contract.create({ data: { ...CONTRACT } });
  await prisma.monthlyRecord.create({ data: { ...RECORD } });
  await prisma.debt.create({ data: { ...DEBT } });
  return prisma.debt.findUnique({ where: { id: 'd-jun' } });
}

async function payAndEmbed(debtService, prisma, { amount, paymentDate }) {
  await debtService.payDebt('d-jun', amount, paymentDate, 'TRANSFERENCIA');
  const payments = await prisma.debtPayment.findMany({ where: { debtId: 'd-jun' } });
  // El fake no resuelve `include`: la relación va embebida en la fila.
  await prisma.debt.update({ where: { id: 'd-jun' }, data: { payments } });
  return payments[payments.length - 1];
}

test('el monto del mes sale de accumulatedPunitory (línea base del caso real)', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  const debt = await seed(prisma);

  HOY = '2026-09-28';
  let live = await debtService.calculateDebtPunitory(debt, HOY, null, true);
  assert.strictEqual(totalDueJunio(debt, live), 415832.45, 'junio al 28/09, como lo mostró el sistema');

  HOY = '2026-09-25';
  live = await debtService.calculateDebtPunitory(debt, HOY, null, true);
  assert.strictEqual(totalDueJunio(debt, live), 401652.72, 'junio al 25/09 (fecha de la transferencia)');

  HOY = '2026-09-28';
});

test('anular desde DEUDAS devuelve la deuda y el monto del mes al estado exacto previo', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  const before = await seed(prisma);
  const liveBefore = await debtService.calculateDebtPunitory(before, HOY, null, true);
  const totalBefore = totalDueJunio(before, liveBefore);

  const payment = await payAndEmbed(debtService, prisma, { amount: 401653, paymentDate: '2026-09-25' });
  const { debt: after } = await debtService.cancelDebtPayment('d-jun', payment.id);

  assert.strictEqual(after.amountPaid, 0, 'el pago se revierte por completo');
  assert.strictEqual(after.lastPaymentDate, null, 'el ancla vuelve a punitoryStartDate');
  assert.strictEqual(
    after.accumulatedPunitory, 146523.92,
    'punitorio devengado hasta el ancla; antes del fix quedaba en 567.189,36 (catch-up día 1 → HOY)',
  );

  const liveAfter = await debtService.calculateDebtPunitory(after, HOY, null, true);
  assert.strictEqual(totalDueJunio(after, liveAfter), totalBefore, 'junio vuelve a $415.832,45');
});

test('anular desde el HISTORIAL DE PAGOS del mes no borra los punitorios devengados', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  const before = await seed(prisma);
  const liveBefore = await debtService.calculateDebtPunitory(before, HOY, null, true);
  const totalBefore = totalDueJunio(before, liveBefore);

  const payment = await payAndEmbed(debtService, prisma, { amount: 401653, paymentDate: '2026-09-25' });
  const [ptx] = await prisma.paymentTransaction.findMany({ where: { monthlyRecordId: 'mr-jun' } });

  // Exactamente como lo invoca `deleteTransaction`: la PaymentTransaction del pago TODAVÍA
  // existe cuando corre `cancelDebtPayment` (la borra después, en la misma transacción).
  await debtService.cancelDebtPayment('d-jun', payment.id, true, prisma, ptx.id);
  const after = await prisma.debt.findUnique({ where: { id: 'd-jun' } });

  assert.strictEqual(
    after.accumulatedPunitory, 146523.92,
    'antes del fix quedaba en $0: la mora del mes desaparecía entera',
  );

  const liveAfter = await debtService.calculateDebtPunitory(after, HOY, null, true);
  assert.strictEqual(totalDueJunio(after, liveAfter), totalBefore, 'junio vuelve a $415.832,45');
});

test('sin la foto (pagos anteriores a punitoryBefore) el conteo de transacciones ya no confunde el ancla', async () => {
  const prisma = makeFakePrisma();
  const debtService = buildService(prisma);
  await seed(prisma);

  const payment = await payAndEmbed(debtService, prisma, { amount: 401653, paymentDate: '2026-09-25' });
  // Fila legacy: sin `punitoryBefore`, se cae a la reconstrucción heurística.
  await prisma.debtPayment.update({ where: { id: payment.id }, data: { punitoryBefore: null } });
  const legacyPayments = await prisma.debtPayment.findMany({ where: { debtId: 'd-jun' } });
  await prisma.debt.update({ where: { id: 'd-jun' }, data: { payments: legacyPayments } });
  const [ptx] = await prisma.paymentTransaction.findMany({ where: { monthlyRecordId: 'mr-jun' } });

  await debtService.cancelDebtPayment('d-jun', payment.id, true, prisma, ptx.id);
  const after = await prisma.debt.findUnique({ where: { id: 'd-jun' } });

  // La heurística devenga el catch-up día 1 → HOY (no es exacta), pero lo que NO puede
  // volver a pasar es que un mes sin pagos propios se clasifique como "ancla = pago" y se
  // le escriba $0.
  assert.strictEqual(
    after.accumulatedPunitory, realPunitory.round2(787763 * 0.006 * 120),
    '1/06 → 28/09 = 120 días sobre el alquiler; antes del fix: $0',
  );
});
