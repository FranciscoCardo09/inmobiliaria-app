const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// Bug reportado por el usuario (2026-07-13): el recibo PDF de un pago en
// efectivo de una DEUDA no mostraba los punitorios pagados ni que la deuda
// tenía un saldo a favor aplicado, aunque el modal en pantalla (DebtPaymentModal)
// sí los muestra.
//
// Causa raíz:
//  1. `payDebt` (debtService.js) arma los `concepts` de la transacción pero
//     nunca creaba un concepto A_FAVOR — a diferencia de `registerPayment`
//     (paymentTransactionService.js), que sí lo hace.
//  2. El armador del recibo `getPagoEfectivoFromRecord` (reportDataService.js)
//     filtraba `c.amount > 0`, lo que además descartaría cualquier línea de
//     crédito (amount 0/negativo) aunque existiera.
//
// Fix (decisión del usuario): el recibo de deuda muestra los renglones de lo
// pagado EN EFECTIVO (modelo ya existente) + una nota informativa de saldo a
// favor (amount:0, el monto va en la descripción) SOLO en el 1er pago de la
// deuda; en pagos posteriores de la MISMA deuda se omite (el crédito ya se
// mostró una vez). El cálculo de punitorios NO se toca en absoluto.
// ============================================================================

const GROUP = 'g1';
const CONTRACT = 'c1';

// Punitorio fijo (5000, 12 días) en todos los tests — el fix no toca la fórmula
// de punitorios, solo qué renglones arma/muestra el recibo, así que se stubea
// para tener números predecibles.
function buildDebtService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      calculatePunitoryV2: () => ({ amount: 5000, days: 12, fromDate: '2026-06-10', toDate: '2026-06-22' }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
      recalculateMultipleRecords: async () => 0,
    },
  });
}

async function seedContract(prisma) {
  await prisma.contract.create({
    data: {
      id: CONTRACT, groupId: GROUP, renewedFromContractId: null,
      startDate: new Date(2025, 0, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
}

async function seedDebt(prisma, overrides = {}) {
  return prisma.debt.create({
    data: {
      id: 'd1', groupId: GROUP, contractId: CONTRACT, monthlyRecordId: null,
      periodMonth: 6, periodYear: 2026, periodLabel: 'Junio 2026',
      unpaidRentAmount: 160000, unpaidServicesAmount: 0, appliedCredit: 0,
      accumulatedPunitory: 0, amountPaid: 0, previousRecordPayment: 0,
      currentTotal: 160000, status: 'OPEN',
      punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 5, 10),
      ...overrides,
    },
  });
}

// Extrae el array de concepts creado por la última transacción de una deuda.
// fakePrisma no expande el nested-write de Prisma (`concepts: { create: [...] }`),
// así que el row guardado tiene `concepts` literalmente como `{ create: [...] }`.
async function lastTransactionConcepts(prisma, contractId) {
  const txs = await prisma.paymentTransaction.findMany({ where: {} });
  const mine = txs.filter((t) => t.groupId === GROUP);
  const last = mine[mine.length - 1];
  return last.concepts.create;
}

test('payDebt: 1er pago con saldo a favor → agrega nota informativa A_FAVOR (amount 0) y muestra los punitorios pagados', async () => {
  const prisma = makeFakePrisma();
  const svc = buildDebtService(prisma);
  await seedContract(prisma);
  // $160.000 de alquiler, $50.000 de saldo a favor → neto a pagar $110.000 + $5.000 punitorios
  await seedDebt(prisma, { appliedCredit: 50000 });

  await svc.payDebt('d1', 115000, '2026-07-13', 'EFECTIVO', null);

  const concepts = await lastTransactionConcepts(prisma, CONTRACT);
  const favor = concepts.find((c) => c.type === 'A_FAVOR');
  const alquiler = concepts.find((c) => c.type === 'ALQUILER_DEUDA');
  const punitorios = concepts.find((c) => c.type === 'PUNITORIOS');
  const sobrepago = concepts.find((c) => c.type === 'SOBREPAGO');

  assert.ok(favor, 'debe existir un concepto A_FAVOR informativo');
  assert.equal(favor.amount, 0, 'el A_FAVOR informativo no resta nada de nuevo del efectivo');
  assert.match(favor.description, /\$50000|\$50\.000/, 'la descripción debe mencionar el monto del crédito');

  assert.ok(alquiler, 'debe mostrar el alquiler pagado');
  assert.equal(alquiler.amount, 110000);

  assert.ok(punitorios, 'los punitorios pagados en efectivo deben aparecer');
  assert.equal(punitorios.amount, 5000);

  assert.equal(sobrepago, undefined, 'no debe haber sobrepago (pago exacto)');
});

test('payDebt: 2do pago de la MISMA deuda → NO repite la nota de saldo a favor', async () => {
  const prisma = makeFakePrisma();
  const svc = buildDebtService(prisma);
  await seedContract(prisma);
  await seedDebt(prisma, { appliedCredit: 50000 });

  // 1er pago parcial (deja punitorios y parte del alquiler para el 2do pago)
  await svc.payDebt('d1', 50000, '2026-07-13', 'EFECTIVO', null);
  const firstConcepts = await lastTransactionConcepts(prisma, CONTRACT);
  assert.ok(firstConcepts.find((c) => c.type === 'A_FAVOR'), 'el 1er pago sí debe mostrar la nota');

  // 2do pago: liquida el resto ($110.000 alquiler - $50.000 ya pagado = $60.000, + $5.000 punitorios)
  await svc.payDebt('d1', 65000, '2026-07-14', 'EFECTIVO', null);
  const secondConcepts = await lastTransactionConcepts(prisma, CONTRACT);

  assert.equal(
    secondConcepts.find((c) => c.type === 'A_FAVOR'),
    undefined,
    'el saldo a favor ya se mostró en el 1er pago; el 2do no debe repetirlo'
  );
  assert.ok(secondConcepts.find((c) => c.type === 'PUNITORIOS'), 'los punitorios del 2do pago sí deben aparecer');
});

test('payDebt: sin saldo a favor → sin nota A_FAVOR, punitorios visibles, todo en efectivo', async () => {
  const prisma = makeFakePrisma();
  const svc = buildDebtService(prisma);
  await seedContract(prisma);
  await seedDebt(prisma, { appliedCredit: 0, unpaidRentAmount: 100000 });

  await svc.payDebt('d1', 105000, '2026-07-13', 'EFECTIVO', null);

  const concepts = await lastTransactionConcepts(prisma, CONTRACT);
  assert.equal(concepts.find((c) => c.type === 'A_FAVOR'), undefined, 'sin crédito, no hay nota de saldo a favor');
  const alquiler = concepts.find((c) => c.type === 'ALQUILER_DEUDA');
  const punitorios = concepts.find((c) => c.type === 'PUNITORIOS');
  assert.equal(alquiler.amount, 100000);
  assert.equal(punitorios.amount, 5000);
  assert.equal(alquiler.amount + punitorios.amount, 105000, 'los conceptos deben sumar exactamente el efectivo pagado');
});

test('payDebt: el crédito cubre parte de los punitorios → igual se muestra la porción pagada en efectivo + la nota informativa', async () => {
  const prisma = makeFakePrisma();
  const svc = buildDebtService(prisma);
  await seedContract(prisma);
  // Crédito ($104.000) cubre TODO el alquiler ($100.000) y $4.000 de los $5.000 de punitorios.
  // Queda $1.000 de punitorios a pagar en efectivo.
  await seedDebt(prisma, { appliedCredit: 104000, unpaidRentAmount: 100000 });

  await svc.payDebt('d1', 1000, '2026-07-13', 'EFECTIVO', null);

  const concepts = await lastTransactionConcepts(prisma, CONTRACT);
  const favor = concepts.find((c) => c.type === 'A_FAVOR');
  const alquiler = concepts.find((c) => c.type === 'ALQUILER_DEUDA');
  const punitorios = concepts.find((c) => c.type === 'PUNITORIOS');

  assert.ok(favor, 'debe mostrar la nota de saldo a favor (cubrió alquiler + parte de punitorios)');
  assert.match(favor.description, /\$104000|\$104\.000/);
  assert.equal(alquiler, undefined, 'el alquiler ya lo cubrió el crédito, no hay porción en efectivo');
  assert.ok(punitorios, 'la porción de punitorios pagada en efectivo debe aparecer');
  assert.equal(punitorios.amount, 1000, 'solo el neto tras el crédito ($5.000 - $4.000)');
});

// ============================================================================
// Segunda mitad: el armador del recibo (`getPagoEfectivoFromRecord`,
// reportDataService.js) — probado con un `targetTx.concepts` construido a
// mano (la forma real que produciría `payDebt` con un Prisma real, no la
// fake de estos tests que no expande nested-writes). Esto fija el
// comportamiento del filtro/mapeo de conceptos de forma aislada.
// ============================================================================

function buildReportService(prisma) {
  return proxyquire('../src/services/reportDataService', {
    '../lib/prisma': prisma,
  });
}

function baseContractForReceipt() {
  return {
    id: CONTRACT,
    contractType: 'INQUILINO',
    tenant: { id: 't1', name: 'Juan Pérez', dni: '20123456' },
    contractTenants: [],
    rescindedAt: null,
    property: { id: 'p1', address: 'Calle Falsa 123', owner: { id: 'o1', name: 'Propietario SA', dni: '30111222' } },
  };
}

async function seedGroupAndRecordWithTx(prisma, txConcepts, txAmount) {
  await prisma.group.create({ data: { id: GROUP, name: 'Test SRL', currency: 'ARS' } });
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr1', groupId: GROUP, contractId: CONTRACT,
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      rentAmount: 0, servicesTotal: 0, includeIva: false, previousBalance: 0,
      contract: baseContractForReceipt(),
      services: [],
      transactions: [
        { id: 'tx1', paymentDate: new Date(2026, 6, 13), paymentMethod: 'EFECTIVO', amount: txAmount, receiptNumber: null, concepts: txConcepts },
      ],
      debt: null,
    },
  });
}

test('recibo de deuda (targetTx): muestra la nota de saldo a favor y los punitorios; suma == TOTAL en efectivo', async () => {
  const prisma = makeFakePrisma();
  const reportSvc = buildReportService(prisma);
  await seedGroupAndRecordWithTx(prisma, [
    { type: 'A_FAVOR', amount: 0, description: 'Saldo a favor aplicado a esta deuda: $50000 (ya descontado del total a pagar)' },
    { type: 'ALQUILER_DEUDA', description: 'Pago deuda alquiler', amount: 110000 },
    { type: 'PUNITORIOS', description: 'Punitorios por mora', amount: 5000 },
  ], 115000);

  const data = await reportSvc.getPagoEfectivoFromRecord(GROUP, 'mr1', 'tx1');

  const favorRow = data.conceptos.find((c) => c.concepto.includes('Saldo a favor'));
  const alquilerRow = data.conceptos.find((c) => c.concepto === 'Pago deuda alquiler');
  const punitoriosRow = data.conceptos.find((c) => c.concepto === 'Punitorios por mora');

  assert.ok(favorRow, 'el renglón informativo de saldo a favor debe pasar el filtro');
  assert.ok(alquilerRow);
  assert.ok(punitoriosRow, 'los punitorios pagados deben verse en el recibo de deuda');
  assert.equal(data.total, 115000);
  assert.equal(
    data.conceptos.reduce((s, c) => s + c.importe, 0),
    115000,
    'los renglones (favor=0 + alquiler + punitorios) deben sumar el efectivo pagado'
  );
});

test('recibo de deuda (targetTx): un A_FAVOR negativo (de otro flujo) sigue excluido — sin cambio de comportamiento', async () => {
  const prisma = makeFakePrisma();
  const reportSvc = buildReportService(prisma);
  await seedGroupAndRecordWithTx(prisma, [
    { type: 'A_FAVOR', amount: -30000, description: 'Saldo a favor del mes anterior' },
    { type: 'ALQUILER', description: 'Alquiler mes 7', amount: 70000 },
  ], 70000);

  const data = await reportSvc.getPagoEfectivoFromRecord(GROUP, 'mr1', 'tx1');

  assert.equal(data.conceptos.find((c) => c.concepto.includes('Saldo a favor')), undefined,
    'un A_FAVOR con monto negativo real sigue descartado, tal cual el comportamiento previo');
  assert.equal(data.total, 70000);
});
