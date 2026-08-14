const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-03 / A-04 / C-01 (AUDITORIA_FUNCIONAL_2026-07-10.md): base ÚNICA de
// punitorios, unificación de totalDue, y saldo a favor que sobrevive.
//
// Regla de referencia (LOGICA.md §4.3, confirmada por el usuario 2026-07-11):
//   - Sin ningún pago real: base = SOLO el alquiler.
//   - Con pagos parciales: base = saldo restante = alquiler + servicios + IVA
//     impago − pagos reales. El saldo a favor del mes anterior NUNCA reduce
//     la base (se descuenta del total al final).
//
// `computeLivePunitoryAmount` en monthlyRecordService.js (usada por el
// display de getOrCreateMonthlyRecords Y por _recalculateCore) ya implementaba
// esta regla correctamente antes de este fix. Los dos outliers eran:
//   (A) paymentTransactionService.js (cobro): usaba `unpaidRentForPunitory`,
//       una base rent-only que nunca incluía servicios/IVA impagos.
//   (B) debtService.js createDebtFromMonthlyRecord (catch-up al cerrar el
//       mes): usaba `unpaidRent`, también rent-only.
// Los tres ahora llaman a la misma función (computePunitoryBase,
// src/utils/punitory.js). Los tests 1 y 2 fijan que, con un pago parcial,
// la base pasa a ser el saldo restante (antes daba rent-only, ver git log de
// este archivo para el valor previo). El test 3 fija la unificación de
// totalDue (A-04) dentro de `_recalculateCore`; el test 5 fija el mismo fix
// pero en el OTRO camino (el refresh persistido de `getOrCreateMonthlyRecords`,
// vía integración real con fakePrisma) — ambos usan ahora el punitorio VIVO
// en vez del congelado. El test 4 fija C-01 en la creación de un mes nuevo:
// el excedente de saldo a favor ya no se destruye al crear el registro.
//
// Caso de referencia usado en los tests 1-2: alquiler $100.000, servicios
// $30.000, IVA 21% ($21.000), con un pago parcial real de $10.000 ya
// aplicado. Saldo restante (regla LOGICA) = 100000+30000+21000-10000 =
// $141.000.
// ============================================================================

test('A-03 (cobro): con pago parcial, la base incluye servicios+IVA impagos (saldo restante), no solo alquiler', async (t) => {
  const prisma = makeFakePrisma();
  let capturedBase = null;

  const svc = proxyquire('../src/services/paymentTransactionService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
      calculatePunitoryV2: (paymentDate, pm, py, baseRent, ...rest) => {
        capturedBase = baseRent;
        return { amount: 0, days: 0, fromDate: null, toDate: null };
      },
    },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'PARTIAL' }),
      recalculateMultipleRecords: async () => 0,
    },
    './debtService': {
      canPayCurrentMonth: async () => ({ canPay: true }),
    },
  });

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-1', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 30000,
      includeIva: true, amountPaid: 10000, // pago parcial YA aplicado (mes en curso)
      previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [],
      contract: { id: 'c1', punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006, rescindedAt: null },
    },
  });

  await svc.registerPayment('g1', 'mr-1', {
    paymentDate: '2026-07-20',
    amount: 5000,
    paymentMethod: 'TRANSFERENCIA', // evita el branch de numeración de recibo (requiere tx.paymentTransaction.count, no soportado por fakePrisma)
  });

  // saldo restante = rent + services + iva - amountPaid = 100000+30000+21000-10000 = 141000
  assert.strictEqual(capturedBase, 141000, 'la base de cobro debe ser el saldo restante (LOGICA §4.3), no solo el alquiler');
});

test('2026-07-14: cobro con alquiler ya cubierto pero punitorio pendiente compone sobre el saldo de punitorio, no da $0', async (t) => {
  // Caso real: contrato C07_multi_same_month. Pago 1 (09/07, $100.000) + pago 2
  // (14/07, $300.000) cubren el alquiler completo ($400.000) pero dejan $10.800 de
  // punitorio congelado sin pagar. Un tercer pago el 18/07 (4 días después) debe
  // cobrar punitorios NUEVOS compuestos sobre esos $10.800 pendientes — antes de este
  // fix, `unpaidRentForPunitory` daba 0 (alquiler ya cubierto) y calculatePunitoryV2
  // se llamaba con base 0 → $0 de interés nuevo, y cualquier pago que cubriera el
  // compuesto real quedaba mal imputado como SOBREPAGO (saldo a favor falso).
  const prisma = makeFakePrisma();
  let capturedBase = null;

  const svc = proxyquire('../src/services/paymentTransactionService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
      calculatePunitoryV2: (paymentDate, pm, py, baseRent, ...rest) => {
        capturedBase = baseRent;
        // 5 días (14→18 inclusive) al 0.6% diario sobre 10800 = 324
        return { amount: 324, days: 5, fromDate: null, toDate: null };
      },
    },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
      recalculateMultipleRecords: async () => 0,
    },
    './debtService': {
      canPayCurrentMonth: async () => ({ canPay: true }),
    },
  });

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-c07', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'PARTIAL', rentAmount: 400000, servicesTotal: 0,
      includeIva: false, amountPaid: 400000, // alquiler YA cubierto por pagos anteriores
      previousBalance: 0, punitoryAmount: 10800, punitoryDays: 6, punitoryForgiven: false,
      services: [],
      contract: { id: 'c1', punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006, rescindedAt: null },
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      id: 'tx-prev', groupId: 'g1', monthlyRecordId: 'mr-c07',
      paymentDate: new Date(2026, 6, 14, 12, 0, 0), amount: 300000,
      punitoryForgiven: false,
      concepts: [{ type: 'ALQUILER', amount: 300000 }], // este pago NO tocó punitorios
    },
  });

  await svc.registerPayment('g1', 'mr-c07', {
    paymentDate: '2026-07-18',
    amount: 11124,
    paymentMethod: 'TRANSFERENCIA',
  });

  assert.strictEqual(capturedBase, 10800, 'la base del interés nuevo debe ser el punitorio pendiente (10800), no 0');

  // fakePrisma no resuelve el nested write `concepts: { create: [...] }` de Prisma
  // real (solo guarda el objeto literal) — leer los conceptos ahí en vez de la
  // tabla transactionConcept (que fakePrisma nunca puebla para este patrón).
  const newTx = await prisma.paymentTransaction.findFirst({ where: { monthlyRecordId: 'mr-c07', amount: 11124 } });
  const concepts = newTx.concepts.create;
  const punitorios = concepts.find((c) => c.type === 'PUNITORIOS');
  const sobrepago = concepts.find((c) => c.type === 'SOBREPAGO');

  assert.ok(punitorios, 'debe existir un concepto PUNITORIOS');
  assert.strictEqual(punitorios.amount, 11124, 'PUNITORIOS debe ser el total compuesto (10800 + 324), no solo el congelado');
  assert.strictEqual(sobrepago, undefined, 'NO debe generar SOBREPAGO — el pago cubre exactamente lo compuesto, sin saldo a favor falso');
});

// A-03 (cierre) — REESCRITO 2026-08-14 (caso Brunello Ana Carolina julio 2026).
//
// Antes este test fijaba que el "catch-up" de `createDebtFromMonthlyRecord` (punitorio
// devengado entre el último pago y el cierre) usara el saldo restante total ($141.000) en
// vez de rent-only. El bug de fondo era otro: con un pago parcial, el ancla de la deuda
// (`punitoryStartDate`) queda en la fecha de ESE pago, así que `calculateDebtPunitory` ya
// devenga en vivo el mismo tramo — el catch-up lo cobraba una segunda vez, y encima compuesto
// (entra al `compoundBase`). Ahora el catch-up solo corre cuando el ancla es el día 1 del
// período (mes sin ningún pago), y la regla "base = saldo restante total" la aplica el tramo
// vivo. Este test fija las dos mitades: cero catch-up al cerrar, y base $141.000 (+ punitorio
// congelado impago) en el único cálculo que queda.
test('A-03 (cierre): con pago parcial no hay catch-up al cerrar; el tramo vivo usa el saldo restante total', async (t) => {
  const prisma = makeFakePrisma();
  const capturedBases = [];

  const debtService = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      ...realPunitory,
      getHolidaysForYear: async () => [],
      // Delegar al cálculo REAL, pero registrar cada base con la que se lo invoca.
      calculatePunitoryV2: (...args) => {
        capturedBases.push(args[3]);
        return realPunitory.calculatePunitoryV2(...args);
      },
    },
  });

  const FROZEN = 5400; // punitorio congelado del pago parcial del 15/07, sin imputar
  const monthlyRecord = {
    id: 'mr-2', periodMonth: 7, periodYear: 2026,
    status: 'PARTIAL', punitoryForgiven: false,
    rentAmount: 100000, servicesTotal: 30000, ivaAmount: 21000,
    amountPaid: 10000, // pago parcial ya aplicado antes del cierre
    previousBalance: 0, punitoryAmount: FROZEN,
    transactions: [{ paymentDate: new Date(2026, 6, 15, 12, 0, 0) }],
  };
  const contract = {
    groupId: 'g1', id: 'c1',
    punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
  };
  await prisma.monthlyRecord.create({ data: { ...monthlyRecord } });
  await prisma.contract.create({ data: { ...contract } });

  const debt = await debtService.createDebtFromMonthlyRecord(monthlyRecord, contract);

  assert.deepStrictEqual(capturedBases, [], 'cerrar un mes con pago parcial NO debe devengar catch-up (lo hace el tramo vivo desde el ancla)');
  assert.strictEqual(debt.accumulatedPunitory, FROZEN, 'accumulatedPunitory = punitorio congelado impago, sin sumarle el tramo posterior al ancla');
  assert.strictEqual(debt.punitoryStartDate.getTime(), new Date(2026, 6, 15, 12, 0, 0).getTime(), 'el ancla es la fecha del pago parcial');
  assert.strictEqual(debt.currentTotal, 146400, 'currentTotal = 100000 alquiler + 41000 servicios+IVA + 5400 punitorio');

  // El tramo vivo (ancla 15/07 → 14/08, ambas inclusive = 31 días) sí usa el saldo
  // restante total ($141.000) más el punitorio congelado impago (interés compuesto).
  const live = await debtService.calculateDebtPunitory(debt, '2026-08-14', null, true);

  assert.deepStrictEqual(capturedBases, [146400], 'un único cálculo, con base = saldo restante total (141000) + punitorio impago (5400)');
  assert.strictEqual(live.days, 31, 'días del tramo: 15/07 → 14/08 ambas inclusive');
  assert.strictEqual(live.unpaidAccumulatedPunitory, FROZEN);
  assert.strictEqual(live.amount, realPunitory.round2(146400 * 0.006 * 31));
  assert.strictEqual(live.grossPunitoryToDate, realPunitory.round2(FROZEN + 146400 * 0.006 * 31));
});

test('A-04: el refresh persistido del GET y _recalculateCore ya no divergen (ambos usan el punitorio VIVO)', async (t) => {
  const prisma = makeFakePrisma();

  // NOTA: `calculatePunitoryV2` NO se puede stubear vía proxyquire acá — dentro de
  // punitory.js, `computeLiveRecordPunitory` la llama como referencia directa del
  // mismo archivo (no a través de `module.exports`), así que un stub en el objeto
  // que proxyquire inyecta a monthlyRecordService nunca la intercepta; el cálculo
  // real (fecha real de "hoy") corre igual. Antes este test asumía que sí (stub de
  // "$999" fijo) y quedó rompiéndose apenas la fecha real dejó de coincidir por
  // casualidad con ese valor. Ahora el test calcula el punitorio vivo ESPERADO
  // llamando a la misma función real (`realPunitory.computeLiveRecordPunitory`)
  // con el mismo record/contrato, así queda determinístico para cualquier fecha.
  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': { calculateDebtPunitory: async () => ({}) },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });

  const FROZEN_PUNITORY = 500; // valor persistido (congelado del último pago), ya desactualizado
  const CONTRACT = { punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const TRANSACTIONS = [{
    paymentDate: new Date(2026, 6, 15, 12, 0, 0), amount: 10000,
    punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 10000 }],
  }];

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-3', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'PARTIAL', rentAmount: 100000,
      servicesTotal: 30000, // consistente con el services[] de abajo (no un valor stale)
      amountPaid: 10000,    // consistente con transactions[] de abajo
      includeIva: true, previousBalance: 0,
      punitoryAmount: FROZEN_PUNITORY, punitoryDays: 3, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false,
      services: [{ amount: 30000, conceptType: { category: 'SERVICIO' } }],
      transactions: TRANSACTIONS,
      contract: CONTRACT,
    },
  });

  // Punitorio vivo esperado = misma función real que usa _recalculateCore, con el
  // mismo record/contrato/holidays ([]) y opciones (isFullyPaid:false).
  const expectedLivePunitory = realPunitory.computeLiveRecordPunitory(
    { rentAmount: 100000, servicesTotal: 30000, amountPaid: 10000, includeIva: true,
      punitoryAmount: FROZEN_PUNITORY, punitoryForgiven: false, isPostExpiry: false,
      periodMonth: 7, periodYear: 2026, transactions: TRANSACTIONS },
    CONTRACT,
    [],
    { isFullyPaid: false }
  ).amount;

  const recordIva = round2ForTest(100000 * 0.21);
  const unifiedTotalDue = round2ForTest(100000 + 30000 + expectedLivePunitory + recordIva - 0);

  await monthlyRecordService.recalculateMultipleRecords(['mr-3'], null, true);
  const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-3' } });

  assert.strictEqual(updated.totalDue, unifiedTotalDue, '_recalculateCore usa el mismo punitorio vivo que computeLiveRecordPunitory');
});

test('C-01 (creación): el excedente de saldo a favor sobrevive al crear el registro del mes siguiente', async (t) => {
  const prisma = makeFakePrisma();

  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      calculateDebtPunitory: async () => ({}),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });

  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
      rescindedAt: null, baseRent: 100000, pagaIva: false,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
    },
  });

  // Julio 2026 (mes 7) ya existe con un saldo a favor grande (ej: sobrepago de $300.000).
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 400000, totalDue: 100000, balance: 300000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [], transactions: [],
    },
  });

  // Agosto 2026 (mes 8) NO existe todavía: getOrCreateMonthlyRecords debe crearlo,
  // arrastrando los $300.000 de crédito de julio. El alquiler de agosto es $100.000, muy
  // por debajo del crédito: totalDue = 100000-300000 = -200000 (negativo).
  await monthlyRecordService.getOrCreateMonthlyRecords('g1', 8, 2026);

  const created = await prisma.monthlyRecord.findFirst({ where: { contractId: 'c1', periodMonth: 8, periodYear: 2026 } });

  assert.strictEqual(created.totalDue, 0, 'totalDue persistido sigue clampeado a 0 (no se puede deber negativo)');
  assert.strictEqual(created.balance, 200000, 'el excedente de crédito (300000-100000=200000) sobrevive como balance positivo, no se destruye');
});

test('A-04 (refresh del GET, integración): usa el punitorio VIVO cuando prevBalanceChanged dispara el refresh', async (t) => {
  const prisma = makeFakePrisma();

  // NOTA: igual que en el test A-04 anterior, `calculatePunitoryV2` no se puede
  // stubear vía proxyquire (llamada interna directa dentro de punitory.js, no a
  // través de module.exports) — el cálculo real corre con la fecha real de "hoy".
  // El test calcula el punitorio vivo ESPERADO llamando a la misma función real
  // con el mismo record/contrato, para quedar determinístico en cualquier fecha.
  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      calculateDebtPunitory: async () => ({}),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });

  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24,
      rescindedAt: null, baseRent: 100000, pagaIva: true,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: null, contractTenants: [], property: null,
    },
  });

  // Julio 2026: mes ya pagado, con crédito final de $50.000.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-jul', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'COMPLETE', rentAmount: 100000, servicesTotal: 0, includeIva: true,
      previousBalance: 0, amountPaid: 150000, totalDue: 100000, balance: 50000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services: [], transactions: [],
    },
  });

  const FROZEN_PUNITORY = 500; // congelado del último pago del mes, ya desactualizado
  const CONTRACT = { punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const TRANSACTIONS = [{
    paymentDate: new Date(2026, 7, 15, 12, 0, 0), amount: 20000,
    punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 20000 }],
  }];

  // Agosto 2026 YA EXISTE, con previousBalance STALE (0, todavía no refrescado con el
  // balance real de julio) — dispara prevBalanceChanged en getOrCreateMonthlyRecords.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-ago', groupId: 'g1', contractId: 'c1',
      periodMonth: 8, periodYear: 2026, monthNumber: 8,
      status: 'PARTIAL', rentAmount: 100000, servicesTotal: 30000, includeIva: true,
      previousBalance: 0, amountPaid: 20000, totalDue: 101000, balance: -81000,
      punitoryAmount: FROZEN_PUNITORY, punitoryDays: 2, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false,
      services: [{ amount: 30000, conceptType: { category: 'SERVICIO' } }],
      transactions: TRANSACTIONS,
    },
  });

  // Punitorio vivo esperado = misma función real que usa el refresh del GET, con el
  // mismo record/contrato/holidays ([]) y opciones (isFullyPaid:false).
  const expectedLivePunitory = realPunitory.computeLiveRecordPunitory(
    { rentAmount: 100000, servicesTotal: 30000, amountPaid: 20000, includeIva: true,
      punitoryAmount: FROZEN_PUNITORY, punitoryForgiven: false, isPostExpiry: false,
      periodMonth: 8, periodYear: 2026, transactions: TRANSACTIONS },
    CONTRACT,
    [],
    { isFullyPaid: false }
  ).amount;

  await monthlyRecordService.getOrCreateMonthlyRecords('g1', 8, 2026);

  const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-ago' } });

  // totalDue = rent(100000) + services(30000) + punitorio VIVO + iva(21000) - prevBalance(50000)
  const expectedTotalDue = round2ForTest(100000 + 30000 + expectedLivePunitory + 21000 - 50000);
  assert.strictEqual(updated.totalDue, expectedTotalDue, 'el refresh del GET usa el mismo punitorio vivo que computeLiveRecordPunitory (no el congelado)');
  assert.strictEqual(updated.previousBalance, 50000, 'previousBalance se refrescó al balance real de julio');
});

function round2ForTest(n) {
  return Math.round(n * 100) / 100;
}
