const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// Cubre la extensión de payDebtsBulk/previewBulkDebtPayment para incluir el mes
// actual (MonthlyRecord abierto) como cola del waterfall de "Pagar varias".
//
// Invariante central bajo prueba: una Debt (mes cerrado) NUNCA debe quedar con
// saldo a favor. Con currentRecordId presente, cada deuda se topea a su total
// real y TODO excedente se reserva para registerPayment (el mes actual), que es
// el único que puede guardarlo como saldo a favor (previousBalance del mes
// siguiente). Sin currentRecordId se preserva el comportamiento histórico
// (la última deuda absorbe el excedente) para no romper el pago múltiple desde
// DebtList (solo deudas).

const GROUP = 'g1';
const CONTRACT = 'c1';

function buildService(prisma, { registerPaymentImpl, calculatePunitoryPreviewImpl } = {}) {
  const registerPaymentCalls = [];
  const registerPayment = registerPaymentImpl || (async (groupId, monthlyRecordId, data) => {
    registerPaymentCalls.push({ groupId, monthlyRecordId, data });
    return { transaction: { id: 'tx-stub' }, monthlyRecord: {} };
  });

  const svc = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      // No nos interesa el monto de punitorios en estos tests (salvo el dedicado
      // a forgivePunitorios): dejamos el motor en 0 para que los totales queden
      // limpios (== unpaidRentAmount) y las aserciones numéricas sean directas.
      calculatePunitoryV2: () => ({ amount: 0, days: 0, fromDate: null, toDate: null }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
    // payDebt/recalculo lazily requieren monthlyRecordService al final del path de éxito.
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
      recalculateMultipleRecords: async () => 0,
    },
    // Lazy require dentro de debtService (evita ciclo con paymentTransactionService,
    // que a su vez requiere debtService a nivel de módulo).
    './paymentTransactionService': {
      registerPayment,
      calculatePunitoryPreview: calculatePunitoryPreviewImpl || (async () => ({ amount: 0, days: 0 })),
    },
  });

  return { svc, registerPaymentCalls };
}

async function seedContract(prisma, overrides = {}) {
  await prisma.contract.create({
    data: {
      id: CONTRACT, groupId: GROUP, renewedFromContractId: null,
      startDate: new Date(2025, 0, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
      ...overrides,
    },
  });
}

async function makeRecord(prisma, { id, periodMonth, periodYear, status = 'PENDING', isCancelled = false, amountPaid = 0, monthNumber = null, rentAmount = 1000, servicesTotal = 0, ivaAmount = 0, previousBalance = 0 }) {
  return prisma.monthlyRecord.create({
    data: {
      id, groupId: GROUP, contractId: CONTRACT, periodMonth, periodYear, monthNumber,
      status, isCancelled, rentAmount, servicesTotal, amountPaid, previousBalance, ivaAmount,
    },
  });
}

async function makeDebt(prisma, { id, monthlyRecordId, periodMonth, periodYear, status = 'OPEN', amountPaid = 0, unpaidRentAmount = 1000, unpaidServicesAmount = 0 }) {
  return prisma.debt.create({
    data: {
      id, groupId: GROUP, contractId: CONTRACT, monthlyRecordId,
      periodMonth, periodYear, periodLabel: `M${periodMonth} ${periodYear}`,
      originalAmount: unpaidRentAmount + unpaidServicesAmount, unpaidRentAmount, unpaidServicesAmount,
      accumulatedPunitory: 0, currentTotal: unpaidRentAmount + unpaidServicesAmount, amountPaid, status,
      punitoryPercent: 0.006, punitoryStartDate: new Date(periodYear, periodMonth - 1, 1),
    },
  });
}

// --- Escenario del enunciado: mayo 150k (deuda), junio 100k (deuda), julio (mes actual) ---

test('pago 270k: mayo y junio se saldan exacto, el resto (20k) va al mes actual — ninguna deuda con saldo a favor', async () => {
  const prisma = makeFakePrisma();
  const { svc, registerPaymentCalls } = buildService(prisma);
  await seedContract(prisma);

  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17, rentAmount: 150000 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PARTIAL', monthNumber: 18, rentAmount: 100000 });
  await makeDebt(prisma, { id: 'd-jun', monthlyRecordId: 'mr-jun', periodMonth: 6, periodYear: 2026, unpaidRentAmount: 100000 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', monthNumber: 19 });

  const result = await svc.payDebtsBulk(GROUP, ['d-may', 'd-jun'], 270000, '2026-07-16', 'EFECTIVO', null, 'mr-jul', false);

  assert.deepStrictEqual(result.results.map((r) => r.status), ['PAID', 'PAID']);
  assert.deepStrictEqual(result.results.map((r) => r.allocated), [150000, 100000]);
  assert.strictEqual(result.remaining, 0, 'no debe quedar remanente sin aplicar');

  // Ninguna deuda recibió más de su total real (sin saldo a favor "adentro" de una deuda).
  const dMay = await prisma.debt.findUnique({ where: { id: 'd-may' } });
  const dJun = await prisma.debt.findUnique({ where: { id: 'd-jun' } });
  assert.strictEqual(dMay.amountPaid, 150000);
  assert.strictEqual(dJun.amountPaid, 100000);

  // El remanente (270000 - 250000 = 20000) se forwardeó íntegro a registerPayment (julio).
  assert.strictEqual(registerPaymentCalls.length, 1);
  assert.strictEqual(registerPaymentCalls[0].monthlyRecordId, 'mr-jul');
  assert.strictEqual(registerPaymentCalls[0].data.amount, 20000);
  assert.strictEqual(registerPaymentCalls[0].data.paymentDate, '2026-07-16');
  assert.deepStrictEqual(result.paidMonthlyRecordIds, ['mr-may', 'mr-jun', 'mr-jul']);
});

test('pago 300k (excede el total de mayo+junio): el excedente completo va al mes actual, no a la última deuda', async () => {
  const prisma = makeFakePrisma();
  const { svc, registerPaymentCalls } = buildService(prisma);
  await seedContract(prisma);

  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17, rentAmount: 150000 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PARTIAL', monthNumber: 18, rentAmount: 100000 });
  await makeDebt(prisma, { id: 'd-jun', monthlyRecordId: 'mr-jun', periodMonth: 6, periodYear: 2026, unpaidRentAmount: 100000 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', monthNumber: 19 });

  const result = await svc.payDebtsBulk(GROUP, ['d-may', 'd-jun'], 300000, '2026-07-16', 'EFECTIVO', null, 'mr-jul', false);

  const dMay = await prisma.debt.findUnique({ where: { id: 'd-may' } });
  const dJun = await prisma.debt.findUnique({ where: { id: 'd-jun' } });
  assert.strictEqual(dMay.amountPaid, 150000, 'mayo no debe recibir más que su total real');
  assert.strictEqual(dJun.amountPaid, 100000, 'junio (última deuda) tampoco debe absorber el excedente');
  assert.strictEqual(dMay.status, 'PAID');
  assert.strictEqual(dJun.status, 'PAID');

  assert.strictEqual(registerPaymentCalls.length, 1);
  assert.strictEqual(registerPaymentCalls[0].data.amount, 50000, 'todo el excedente (300000-250000) va al mes actual');
});

test('pago 200k: mayo se salda, junio queda parcial, el mes actual no se toca (remaining llega a 0 antes)', async () => {
  const prisma = makeFakePrisma();
  const { svc, registerPaymentCalls } = buildService(prisma);
  await seedContract(prisma);

  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17, rentAmount: 150000 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PARTIAL', monthNumber: 18, rentAmount: 100000 });
  await makeDebt(prisma, { id: 'd-jun', monthlyRecordId: 'mr-jun', periodMonth: 6, periodYear: 2026, unpaidRentAmount: 100000 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', monthNumber: 19 });

  const result = await svc.payDebtsBulk(GROUP, ['d-may', 'd-jun'], 200000, '2026-07-16', 'EFECTIVO', null, 'mr-jul', false);

  const dMay = await prisma.debt.findUnique({ where: { id: 'd-may' } });
  const dJun = await prisma.debt.findUnique({ where: { id: 'd-jun' } });
  assert.strictEqual(dMay.status, 'PAID');
  assert.strictEqual(dMay.amountPaid, 150000);
  assert.strictEqual(dJun.status, 'PARTIAL');
  assert.strictEqual(dJun.amountPaid, 50000);

  assert.strictEqual(registerPaymentCalls.length, 0, 'el mes actual no debe tocarse si el remanente llegó a 0 en las deudas');
  assert.deepStrictEqual(result.paidMonthlyRecordIds, ['mr-may', 'mr-jun']);
  assert.strictEqual(result.remaining, 0);
});

// --- Regresión: comportamiento histórico sin currentRecordId (DebtList) ---

test('REGRESIÓN sin currentRecordId: el excedente se sigue aplicando a la última deuda (comportamiento histórico)', async () => {
  const prisma = makeFakePrisma();
  const { svc, registerPaymentCalls } = buildService(prisma);
  await seedContract(prisma);

  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17, rentAmount: 150000 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PARTIAL', monthNumber: 18, rentAmount: 100000 });
  await makeDebt(prisma, { id: 'd-jun', monthlyRecordId: 'mr-jun', periodMonth: 6, periodYear: 2026, unpaidRentAmount: 100000 });

  const result = await svc.payDebtsBulk(GROUP, ['d-may', 'd-jun'], 300000, '2026-07-16', 'EFECTIVO', null);

  const dJun = await prisma.debt.findUnique({ where: { id: 'd-jun' } });
  assert.strictEqual(dJun.amountPaid, 150000, 'sin mes actual, la última deuda absorbe el excedente (50000 de SOBREPAGO)');
  assert.strictEqual(registerPaymentCalls.length, 0);
  assert.deepStrictEqual(result.paidMonthlyRecordIds, ['mr-may', 'mr-jun']);
});

// --- Validaciones ---

test('rechaza currentRecordId si el período tiene un hueco impago no incluido (ORDER_BLOCK)', async () => {
  const prisma = makeFakePrisma();
  const { svc } = buildService(prisma);
  await seedContract(prisma);

  // Mayo (deuda, seleccionada) — junio queda como PARTIAL con pago iniciado pero
  // NO se incluye en debtIds — julio es el mes actual que se intenta pagar.
  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jun', periodMonth: 6, periodYear: 2026, status: 'PARTIAL', amountPaid: 500, monthNumber: 18 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', monthNumber: 19 });

  await assert.rejects(
    () => svc.payDebtsBulk(GROUP, ['d-may'], 300000, '2026-07-16', 'EFECTIVO', null, 'mr-jul', false),
    (err) => {
      assert.strictEqual(err.code, 'ORDER_BLOCK');
      assert.strictEqual(err.blockingPeriod.periodMonth, 6);
      return true;
    }
  );
});

test('rechaza currentRecordId de otro contrato', async () => {
  const prisma = makeFakePrisma();
  const { svc } = buildService(prisma);
  await seedContract(prisma);
  await prisma.contract.create({
    data: {
      id: 'c-otro', groupId: GROUP, renewedFromContractId: null,
      startDate: new Date(2025, 0, 1), startMonth: 1, durationMonths: 24, rescindedAt: null,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await prisma.monthlyRecord.create({
    data: { id: 'mr-otro', groupId: GROUP, contractId: 'c-otro', periodMonth: 7, periodYear: 2026, status: 'PENDING', rentAmount: 1000, servicesTotal: 0, amountPaid: 0, previousBalance: 0, ivaAmount: 0 },
  });

  await assert.rejects(
    () => svc.payDebtsBulk(GROUP, ['d-may'], 150000, '2026-07-16', 'EFECTIVO', null, 'mr-otro', false),
    /mismo inquilino\/contrato/
  );
});

test('rechaza currentRecordId ya COMPLETE', async () => {
  const prisma = makeFakePrisma();
  const { svc } = buildService(prisma);
  await seedContract(prisma);
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'COMPLETE', monthNumber: 19 });

  await assert.rejects(
    () => svc.payDebtsBulk(GROUP, ['d-may'], 150000, '2026-07-16', 'EFECTIVO', null, 'mr-jul', false),
    /ya está completamente pagado/
  );
});

// --- forgivePunitorios propagado ---

test('forgivePunitorios=true se propaga a payDebt (punitorios en 0) y a registerPayment', async () => {
  const prisma = makeFakePrisma();
  const registerPaymentCalls = [];
  const svc = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/punitory': {
      // Punitorio SIEMPRE positivo si no se condona, para poder verificar el 0 forzado.
      calculatePunitoryV2: () => ({ amount: 9999, days: 10, fromDate: null, toDate: null }),
      getHolidaysForYear: async () => [],
      round2: (n) => Math.round(n * 100) / 100,
    },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'COMPLETE' }),
      recalculateMultipleRecords: async () => 0,
    },
    './paymentTransactionService': {
      registerPayment: async (groupId, monthlyRecordId, data) => {
        registerPaymentCalls.push({ groupId, monthlyRecordId, data });
        return { transaction: { id: 'tx-stub' }, monthlyRecord: {} };
      },
      calculatePunitoryPreview: async () => ({ amount: 0, days: 0 }),
    },
  });
  await seedContract(prisma);
  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17, rentAmount: 150000 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', monthNumber: 19 });

  const result = await svc.payDebtsBulk(GROUP, ['d-may'], 200000, '2026-07-16', 'EFECTIVO', null, 'mr-jul', true);

  const dMay = await prisma.debt.findUnique({ where: { id: 'd-may' } });
  assert.strictEqual(dMay.amountPaid, 150000, 'la deuda se topea a su total SIN punitorio (condonado), no queda sobrepago adentro');
  assert.strictEqual(dMay.status, 'PAID');

  const payments = await prisma.debtPayment.findMany({ where: { debtId: 'd-may' } });
  assert.strictEqual(payments.length, 1);
  assert.strictEqual(payments[0].punitoryAtPayment, 0, 'con forgivePunitorios el punitorio cobrado debe ser 0');
  assert.strictEqual(registerPaymentCalls[0].data.forgivePunitorios, true);
  assert.strictEqual(registerPaymentCalls[0].data.amount, 50000, 'el remanente (200000-150000) va al mes actual, no queda como sobrepago en la deuda');
});

// --- previewBulkDebtPayment con mes actual ---

test('previewBulkDebtPayment agrega un item RECORD para el mes actual, con IVA como línea aparte en las deudas', async () => {
  const prisma = makeFakePrisma();
  const { svc } = buildService(prisma, {
    calculatePunitoryPreviewImpl: async () => ({ amount: 555, days: 3 }),
  });
  await seedContract(prisma);

  // Deuda de mayo: su MonthlyRecord original tenía servicesTotal=200 + ivaAmount=100
  // (unpaidServicesAmount de la deuda = servicios+IVA = 300, coherente con calculateImputation).
  await makeRecord(prisma, { id: 'mr-may', periodMonth: 5, periodYear: 2026, status: 'PARTIAL', monthNumber: 17, rentAmount: 150000, servicesTotal: 200, ivaAmount: 100 });
  await makeDebt(prisma, { id: 'd-may', monthlyRecordId: 'mr-may', periodMonth: 5, periodYear: 2026, unpaidRentAmount: 150000, unpaidServicesAmount: 300 });
  await makeRecord(prisma, { id: 'mr-jul', periodMonth: 7, periodYear: 2026, status: 'PENDING', monthNumber: 19, rentAmount: 50000, servicesTotal: 200, ivaAmount: 400, previousBalance: 1000 });

  const preview = await svc.previewBulkDebtPayment(GROUP, ['d-may'], '2026-07-16', 'mr-jul');

  assert.strictEqual(preview.debts.length, 2);
  const [debtItem, recordItem] = preview.debts;
  assert.strictEqual(debtItem.type, 'DEBT');
  assert.strictEqual(debtItem.iva, 100);
  assert.strictEqual(debtItem.remainingServices, 200, 'servicios netos de IVA (300 - 100)');

  assert.strictEqual(recordItem.type, 'RECORD');
  assert.strictEqual(recordItem.id, 'mr-jul');
  assert.strictEqual(recordItem.iva, 400);
  assert.strictEqual(recordItem.remainingRent, 50000);
  assert.strictEqual(recordItem.punitory, 555);
  assert.strictEqual(recordItem.previousBalance, 1000);
  // totalDue = 50000 + 200 + 555 + 400 - 1000 = 50155; amountPaid=0 → totalToPay igual.
  assert.strictEqual(recordItem.totalToPay, 50155);
});
