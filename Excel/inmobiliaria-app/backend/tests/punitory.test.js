/**
 * Tests for punitory calculation logic.
 *
 * Covers:
 *  1. calculateImputation — distribución de pagos en orden servicios→IVA→alquiler→punitorios
 *  2. calculateDebtPunitory — regla de base:
 *       - Sin pagos: punitorios sobre alquiler
 *       - Con pagos: punitorios sobre saldo restante total (servicios+alquiler-pagado)
 *       - Base totalmente pagada: solo punitorios acumulados
 *  3. calculatePunitoryV2 — verificación de la fórmula base × % × días
 *
 * Run with:
 *   node --test tests/punitory.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { calculateImputation, calculateDebtPunitory } = require('../src/services/debtService');
const { calculatePunitoryV2 } = require('../src/utils/punitory');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round = (n) => Math.round(n * 100) / 100;

/**
 * Build a fake preloaded object so calculateDebtPunitory doesn't hit the DB.
 * punitoryPercent: daily rate (e.g. 0.006 = 0.6%)
 */
function fakePreloaded(contractId, punitoryPercent = 0.006) {
  return {
    contractMap: new Map([[contractId, {
      id: contractId,
      punitoryStartDay: 4,
      punitoryGraceDay: 10,
      punitoryPercent,
    }]]),
    holidayMap: new Map([[2026, []]]),
  };
}

/**
 * Build a minimal debt object for testing.
 */
function makeDebt({
  contractId = 'contract-1',
  periodMonth = 3,
  periodYear = 2026,
  unpaidRentAmount = 100000,
  unpaidServicesAmount = 0,
  accumulatedPunitory = 0,
  amountPaid = 0,
  lastPaymentDate = null,
  punitoryStartDate = new Date(2026, 2, 1), // 2026-03-01
  punitoryPercent = 0.006,
} = {}) {
  return {
    id: 'debt-1',
    contractId,
    periodMonth,
    periodYear,
    unpaidRentAmount,
    unpaidServicesAmount,
    accumulatedPunitory,
    amountPaid,
    lastPaymentDate,
    punitoryStartDate,
    punitoryPercent,
    status: 'OPEN',
  };
}

// ─── calculateImputation ──────────────────────────────────────────────────────

describe('calculateImputation', () => {

  test('sin pagos: todo queda impago', () => {
    const record = {
      rentAmount: 100000,
      servicesTotal: 50000,
      punitoryAmount: 10000,
      ivaAmount: 0,
      amountPaid: 0,
    };
    const r = calculateImputation(record);
    assert.equal(r.unpaidRent, 100000);
    assert.equal(r.unpaidServices, 50000);
    assert.equal(r.unpaidPunitory, 10000);
    assert.equal(r.servicesCovered, 0);
    assert.equal(r.rentCovered, 0);
    assert.equal(r.totalUnpaid, 160000); // rent + services + punitorios
  });

  test('pago exacto de servicios: cubre servicios, queda alquiler y punitorios', () => {
    const record = {
      rentAmount: 100000,
      servicesTotal: 50000,
      punitoryAmount: 5000,
      ivaAmount: 0,
      amountPaid: 50000,
    };
    const r = calculateImputation(record);
    assert.equal(r.servicesCovered, 50000);
    assert.equal(r.unpaidServices, 0);
    assert.equal(r.rentCovered, 0);
    assert.equal(r.unpaidRent, 100000);
    assert.equal(r.unpaidPunitory, 5000);
  });

  test('pago cubre servicios + parte alquiler', () => {
    const record = {
      rentAmount: 100000,
      servicesTotal: 50000,
      punitoryAmount: 0,
      ivaAmount: 0,
      amountPaid: 80000, // 50k servicios + 30k alquiler
    };
    const r = calculateImputation(record);
    assert.equal(r.servicesCovered, 50000);
    assert.equal(r.unpaidServices, 0);
    assert.equal(r.rentCovered, 30000);
    assert.equal(r.unpaidRent, 70000);
  });

  test('pago total cubre todo', () => {
    const record = {
      rentAmount: 100000,
      servicesTotal: 50000,
      punitoryAmount: 5000,
      ivaAmount: 0,
      amountPaid: 155000,
    };
    const r = calculateImputation(record);
    assert.equal(r.unpaidRent, 0);
    assert.equal(r.unpaidServices, 0);
    assert.equal(r.unpaidPunitory, 0);
    assert.equal(r.totalUnpaid, 0);
  });

  test('incluye IVA en unpaidServices cuando no se paga nada', () => {
    const record = {
      rentAmount: 100000,
      servicesTotal: 20000,
      punitoryAmount: 0,
      ivaAmount: 21000, // 21% de 100k
      amountPaid: 0,
    };
    const r = calculateImputation(record);
    // unpaidServices = (servicesTotal - servicesCovered) + unpaidIva
    assert.equal(r.unpaidServices, 20000 + 21000);
    assert.equal(r.unpaidRent, 100000);
  });

  test('pago parcial — servicios no cubiertos quedan en unpaidServices', () => {
    const record = {
      rentAmount: 100000,
      servicesTotal: 200000,
      punitoryAmount: 0,
      ivaAmount: 0,
      amountPaid: 150000, // cubre 150k de 200k servicios
    };
    const r = calculateImputation(record);
    assert.equal(r.servicesCovered, 150000);
    assert.equal(r.unpaidServices, 50000);
    assert.equal(r.unpaidRent, 100000); // sin cubrir, se acabó el dinero en servicios
    assert.equal(r.totalUnpaid, 150000);
  });

});

// ─── calculatePunitoryV2 (pure) ────────────────────────────────────────────────

describe('calculatePunitoryV2 — fórmula base × % × días', () => {

  test('mes pasado sin pagos previos: desde día 1 hasta fecha de pago', () => {
    // Mes marzo 2026, paga el 5 de abril → 36 días (1/3 a 5/4 inclusive)
    const payDate = new Date(2026, 3, 5); // 5-abr-2026
    const r = calculatePunitoryV2(payDate, 3, 2026, 100000, 4, 10, 0.006, []);
    assert.equal(r.days, 36);
    assert.equal(r.amount, round(100000 * 0.006 * 36)); // $21600
  });

  test('mes actual, dentro del período de gracia: $0', () => {
    const payDate = new Date(2026, 3, 5); // 5-abr-2026 (mes actual = abril)
    const r = calculatePunitoryV2(payDate, 4, 2026, 100000, 4, 10, 0.006, []);
    assert.equal(r.amount, 0);
    assert.equal(r.days, 0);
  });

  test('mes actual, fuera del período de gracia: desde startDay hasta hoy', () => {
    const payDate = new Date(2026, 3, 15); // 15-abr-2026
    const r = calculatePunitoryV2(payDate, 4, 2026, 100000, 4, 10, 0.006, []);
    // días desde el 4/4 hasta 15/4 inclusive = 12
    assert.equal(r.days, 12);
    assert.equal(r.amount, round(100000 * 0.006 * 12));
  });

  test('con pago previo: solo días desde ese pago', () => {
    // Último pago el 1/3, nuevo pago el 5/4 → desde 1/3 a 5/4 = 36 días
    const payDate = new Date(2026, 3, 5);
    const lastPay = new Date(2026, 2, 1); // 1-mar-2026
    const r = calculatePunitoryV2(payDate, 3, 2026, 100000, 4, 10, 0.006, [], lastPay);
    assert.equal(r.days, 36);
    assert.equal(r.amount, round(100000 * 0.006 * 36));
  });

  test('base 0: siempre $0', () => {
    const payDate = new Date(2026, 3, 5);
    const r = calculatePunitoryV2(payDate, 3, 2026, 0, 4, 10, 0.006, []);
    assert.equal(r.amount, 0);
  });

});

// ─── calculateDebtPunitory — regla de base ────────────────────────────────────

describe('calculateDebtPunitory — regla de base para punitorios', () => {

  // Fecha de pago fija: 5 de abril 2026 → 36 días desde 1/3
  const PAYMENT_DATE = new Date(2026, 3, 5);
  const RATE = 0.006;
  const DAYS = 36;

  test('CASO 1: sin pagos ni servicios — base = alquiler completo', async () => {
    const debt = makeDebt({ unpaidRentAmount: 100000, unpaidServicesAmount: 0, amountPaid: 0 });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    const expected = round(100000 * RATE * DAYS);
    assert.equal(r.amount, expected);
    assert.equal(r.days, DAYS);
    assert.equal(r.remainingDebt, 100000);
  });

  test('CASO 1b: sin pagos, tiene servicios — base = solo alquiler (no servicios)', async () => {
    // Total = 100k alquiler + 200k servicios = 300k, pero base punitorios = 100k
    const debt = makeDebt({ unpaidRentAmount: 100000, unpaidServicesAmount: 200000, amountPaid: 0 });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    const expectedPunitory = round(100000 * RATE * DAYS); // solo alquiler
    assert.equal(r.amount, expectedPunitory);
    assert.equal(r.remainingDebt, 300000); // servicios + alquiler completo
    assert.equal(r.remainingServices, 200000);
    assert.equal(r.remainingRent, 100000);
  });

  test('CASO 2: pago parcial — base = saldo restante total', async () => {
    // Total = 300k (100k alquiler + 200k servicios), pagó 250k → saldo = 50k
    const debt = makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 200000,
      amountPaid: 250000,
      lastPaymentDate: new Date(2026, 2, 20), // 20-mar
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    // saldo restante = 300k - 250k = 50k
    // días desde 20/3 hasta 5/4 = 17 días (inclusive)
    const remainingBase = 300000 - 250000; // 50000
    const days = 17;
    const expectedPunitory = round(remainingBase * RATE * days);

    assert.equal(r.remainingDebt, remainingBase, 'remainingDebt debe ser 50k');
    assert.equal(r.days, days, 'días desde el último pago');
    assert.equal(r.amount, expectedPunitory, `punitorios sobre saldo restante ${remainingBase}`);
  });

  test('CASO 2b: pago parcial solo cubre servicios — base = saldo restante (servicios aún impagos + alquiler)', async () => {
    // Total = 100k alquiler + 200k servicios = 300k, pagó 150k
    // Saldo = 150k → base punitorios = 150k
    const debt = makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 200000,
      amountPaid: 150000,
      lastPaymentDate: new Date(2026, 2, 15),
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    const remainingBase = 300000 - 150000; // 150000
    // días desde 15/3 hasta 5/4 = 22 días (inclusive)
    const days = 22;
    const expectedPunitory = round(remainingBase * RATE * days);

    assert.equal(r.remainingDebt, remainingBase, 'remainingDebt debe ser 150k');
    assert.equal(r.days, days);
    assert.equal(r.amount, expectedPunitory);
    // Detalle de servicios y alquiler restantes
    assert.equal(r.remainingServices, 50000, '200k - 150k = 50k servicios restantes');
    assert.equal(r.remainingRent, 100000, 'alquiler sin cubrir');
  });

  test('CASO 3: base totalmente pagada — solo punitorios acumulados', async () => {
    // Alquiler 100k, servicios 50k, pagó 150k → base pagada; quedan punitorios acumulados 20k
    const debt = makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 50000,
      amountPaid: 150000, // cubre todo el base
      accumulatedPunitory: 20000,
      lastPaymentDate: new Date(2026, 2, 1),
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    assert.equal(r.remainingDebt, 0, 'base ya pagada');
    // Hay punitorios: acumulados + nuevos sobre acumulados
    assert.ok(r.amount > 0, 'debe haber punitorios sobre los acumulados');
  });

  test('CASO 4: todo pagado incluidos punitorios — $0', async () => {
    // Paga más que el total → todo saldado
    const debt = makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 50000,
      amountPaid: 200000, // más que suficiente
      accumulatedPunitory: 0,
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    assert.equal(r.amount, 0);
    assert.equal(r.remainingDebt, 0);
  });

  test('CASO 5: ejemplo del usuario — $565k alquiler + $4.9k servicios, sin pagos', async () => {
    // Ejemplo real del usuario: alquiler $565354, servicios $4955
    // Sin pagos → base punitorios = alquiler = 565354
    const ALQUILER = 565354;
    const SERVICIOS = 4955;
    const debt = makeDebt({
      unpaidRentAmount: ALQUILER,
      unpaidServicesAmount: SERVICIOS,
      amountPaid: 0,
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    const expectedPunitory = round(ALQUILER * RATE * DAYS);
    assert.equal(r.amount, expectedPunitory, 'punitorios solo sobre alquiler');
    assert.equal(r.remainingDebt, ALQUILER + SERVICIOS, 'deuda base = alquiler + servicios');
    assert.equal(r.days, DAYS);
  });

  test('CASO 6: pago exacto del total base — saldo $0, verifica punitorios acumulados', async () => {
    const debt = makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 50000,
      amountPaid: 150000, // paga exactamente todo el base
      accumulatedPunitory: 5000,
      lastPaymentDate: new Date(2026, 2, 30),
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    assert.equal(r.remainingDebt, 0);
    // Punitorios sobre los acumulados desde el 30/3 hasta 5/4
    assert.ok(r.amount > 0);
  });

  test('totalToPay = remainingDebt + punitorios', async () => {
    const debt = makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 50000,
      amountPaid: 80000,
      lastPaymentDate: new Date(2026, 2, 15),
    });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    const totalToPay = r.remainingDebt + r.amount;
    // Verificar que está bien calculado (no es NaN ni negativo)
    assert.ok(totalToPay > 0, 'totalToPay debe ser positivo');
    assert.ok(!isNaN(totalToPay), 'totalToPay no debe ser NaN');
    // remainingDebt = 150k - 80k = 70k
    assert.equal(r.remainingDebt, 70000);
  });

});
