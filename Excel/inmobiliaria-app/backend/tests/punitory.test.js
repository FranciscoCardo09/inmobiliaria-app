/**
 * Tests for punitory calculation logic.
 *
 * Covers:
 *  1. calculateImputation — distribución de pagos en orden servicios→IVA→alquiler→punitorios
 *  2. calculateDebtPunitory — regla de base (confirmada por el usuario 2026-06-29,
 *     re-confirmada 2026-07-11; ver memoria punitory-base-rule):
 *       - SIN ningún pago todavía → punitorios SOLO sobre el alquiler, sin importar
 *         si hay servicios impagos (los servicios NO activan la base ampliada).
 *       - DESPUÉS de un pago → punitorios compuestos sobre el saldo restante TOTAL
 *         (alquiler + servicios pendientes + punitorios acumulados impagos).
 *       - El saldo a favor (appliedCredit) nunca activa la base ampliada: se resta
 *         recién al final, sobre remainingDebt, no sobre la base de punitorios.
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
const { calculatePunitoryV2, computePunitoryBase, computeLiveRecordPunitory, debtDelinquencyDays } = require('../src/utils/punitory');

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

  test('CASO 1b: sin pagos, tiene servicios impagos — la base del PUNITORIO sigue siendo SOLO alquiler', async () => {
    // Total adeudado (remainingDebt) = 100k alquiler + 200k servicios = 300k, pero sin
    // ningún pago todavía los servicios NO activan la base ampliada: los punitorios
    // corren solo sobre el alquiler (regla confirmada 2026-06-29, re-confirmada 2026-07-11).
    const debt = makeDebt({ unpaidRentAmount: 100000, unpaidServicesAmount: 200000, amountPaid: 0 });
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    const expectedPunitory = round(100000 * RATE * DAYS); // SOLO alquiler
    assert.equal(r.amount, expectedPunitory);
    assert.equal(r.remainingDebt, 300000); // el TOTAL adeudado (no la base del punitorio) sí incluye servicios
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

  // ── A-01 (AUDITORIA_FUNCIONAL_2026-07-10.md) — CORREGIDO 2026-07-11 ──
  // Cuando una deuda nace de un MonthlyRecord que tuvo un pago PARCIAL antes del cierre
  // (`previousRecordPayment > 0`), pero la deuda en sí todavía no recibió ningún pago
  // (`debt.amountPaid === 0`), el gate de `unpaidAccumulatedPunitory` usaba una condición
  // MÁS ANGOSTA (`debt.amountPaid > 0`) que `hasPayment` (`debt.amountPaid > 0 ||
  // debt.previousRecordPayment > 0`) — la MISMA condición que ya usaba correctamente
  // `compoundBase` unas líneas más abajo. Antes del fix, los punitorios congelados
  // impagos (`accumulatedPunitory`, seteados al crear la deuda) quedaban afuera del
  // compoundBase Y de `unpaidAccumulatedPunitory` (el valor que `payDebt` suma al total
  // a cobrar) — se perdían del monto a cobrar. Fix: usar `hasPayment` en ambos lugares.
  test('A-01: deuda nacida de un mes con pago parcial NO pierde los punitorios congelados impagos', async () => {
    // Mes: alquiler 100k, pago parcial de 50k antes del cierre (previousRecordPayment),
    // con 5k de punitorios devengados y NUNCA pagados, congelados al crear la deuda
    // (accumulatedPunitory). La deuda en sí (amountPaid) todavía no recibió ningún pago.
    const debt = makeDebt({
      unpaidRentAmount: 50000, // 100k - 50k ya pagados del mes
      unpaidServicesAmount: 0,
      accumulatedPunitory: 5000, // punitorios congelados IMPAGOS del mes
      amountPaid: 0, // sin pagos de la DEUDA todavía
      punitoryStartDate: new Date(2026, 2, 20), // último pago del MES (20-mar)
    });
    debt.previousRecordPayment = 50000; // el MES sí tuvo un pago parcial antes del cierre
    const preloaded = fakePreloaded(debt.contractId, RATE);
    const r = await calculateDebtPunitory(debt, PAYMENT_DATE, preloaded);

    // days: 20-mar a 5-abr inclusive = 17 días (igual que CASO 2/2b)
    const days = 17;

    // unpaidAccumulatedPunitory debe preservar los 5000 congelados (hasPayment=true por
    // previousRecordPayment, aunque debt.amountPaid siga en 0).
    assert.equal(r.unpaidAccumulatedPunitory, 5000);

    // compoundBase = 50000(base) + 5000(acumulado impago) = 55000 (interés compuesto).
    const compoundBase = 55000;
    const expectedAmount = round(compoundBase * RATE * days); // 5610
    assert.equal(r.amount, expectedAmount);

    // Monto real que payDebt cobraría (unpaidAccumulatedPunitory + result.amount):
    const totalPunitoryOwed = round(r.unpaidAccumulatedPunitory + r.amount);
    assert.equal(totalPunitoryOwed, 10610); // 5000 + 5610
  });

  // ── A-02 (AUDITORIA_FUNCIONAL_2026-07-10.md) — CORREGIDO 2026-07-11 ──
  // `payDebt` imputa el saldo a favor (`appliedCredit`) ANTES que el efectivo (regla
  // Brunello, confirmada) — pero `calculateDebtPunitory` decidía cuánto fue a punitorios
  // mirando solo `debt.amountPaid` (efectivo) vs `totalBase`, sin enterarse de que
  // `appliedCredit` ya cubrió parte de `totalBase` en ese mismo pago. Efectivo que, según
  // los CONCEPTOS reales del pago, sí pagó punitorios, "resucitaba" como impago en el
  // siguiente cálculo. Fix: `paidToPunitory`/`amountPaidToPunitory` ahora consideran
  // efectivo + crédito aplicado, no solo efectivo.
  test('A-02: efectivo que pagó punitorios NO resucita como impago cuando hay appliedCredit', async () => {
    const periodMonth = 3, periodYear = 2026; // igual que PAYMENT_DATE/RATE/DAYS de arriba (36 días 1-mar a 5-abr)
    const baseDebt = () => makeDebt({
      unpaidRentAmount: 100000,
      unpaidServicesAmount: 0,
      accumulatedPunitory: 0,
      amountPaid: 0,
      periodMonth,
      periodYear,
      punitoryStartDate: new Date(2026, 2, 1), // 1-mar: mes nunca pagado antes del cierre
    });
    const preloaded = fakePreloaded('contract-1', RATE);

    // PASO 1: estado de la deuda ANTES de pagar (como la lee payDebt en la línea 537,
    // antes de aplicar el pago). appliedCredit=20000 (saldo a favor de un mes anterior).
    const debtBeforePayment = { ...baseDebt(), appliedCredit: 20000 };
    const r1 = await calculateDebtPunitory(debtBeforePayment, PAYMENT_DATE, preloaded);
    const totalPunitoryOwedStep1 = round(r1.unpaidAccumulatedPunitory + r1.amount);
    assert.equal(totalPunitoryOwedStep1, round(100000 * RATE * DAYS)); // 21600: sin pagos, solo alquiler (36 días)

    // Imputación de payDebt (mismas fórmulas que debtService.js:564-586) para un pago en
    // EFECTIVO de $85.000: el crédito ($20.000) cubre alquiler primero (no hay servicios);
    // de los $85.000 en efectivo, $80.000 terminan en alquiler y $5.000 en PUNITORIOS.
    const credit = debtBeforePayment.appliedCredit;
    const cashAmount = 85000;
    const creditOnRent = Math.min(credit, debtBeforePayment.unpaidRentAmount);
    const cashRentTarget = round(Math.max(debtBeforePayment.unpaidRentAmount - creditOnRent, 0)); // 80000
    const rentPortion = Math.min(cashRentTarget, cashAmount); // 80000
    const afterRent = round(cashAmount - rentPortion); // 5000
    const punitoryPortion = Math.min(afterRent, totalPunitoryOwedStep1); // 5000: EFECTIVO real a punitorios
    assert.equal(rentPortion, 80000);
    assert.equal(punitoryPortion, 5000, 'de los $85.000, $5.000 se imputan a PUNITORIOS (concepto real del pago)');

    // Estado de la deuda DESPUÉS del pago (igual que debtService.js:610-638): amountPaid
    // y accumulatedPunitory se actualizan; appliedCredit y unpaidRentAmount NO cambian.
    const debtAfterPayment = {
      ...debtBeforePayment,
      amountPaid: round(debtBeforePayment.amountPaid + cashAmount), // 85000
      accumulatedPunitory: totalPunitoryOwedStep1, // 21600 (el total adeudado al momento de pagar)
      lastPaymentDate: PAYMENT_DATE,
    };

    // PASO 2: "siguiente preview" (sin pagar nada más, mismo día).
    const r2 = await calculateDebtPunitory(debtAfterPayment, PAYMENT_DATE, preloaded);

    // remainingDebt = max(remainingBase(15000) - appliedCredit(20000), 0) = 0: la base
    // (alquiler) queda saldada entre el efectivo y el crédito. Correcto, no es la parte
    // en discusión (el problema es unpaidAccumulatedPunitory, abajo).
    assert.equal(r2.remainingDebt, 0, 'la base (alquiler) queda saldada entre efectivo y crédito');

    // unpaidAccumulatedPunitory reconoce los $5000 ya cobrados en efectivo a punitorios:
    // 21600 (total al momento de pagar) - 5000 (ya cobrados) = 16600.
    assert.equal(r2.unpaidAccumulatedPunitory, 16600);
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
    // Sin pagos → la base del PUNITORIO es SOLO alquiler (regla confirmada 2026-06-29,
    // re-confirmada 2026-07-11); remainingDebt (el total adeudado) sí incluye servicios.
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
    assert.equal(r.amount, expectedPunitory, 'punitorios SOLO sobre alquiler (sin pagos, servicios no activan la base ampliada)');
    assert.equal(r.remainingDebt, ALQUILER + SERVICIOS, 'deuda total (remainingDebt) sí incluye servicios');
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

// ─── computePunitoryBase — base ÚNICA de punitorios de mes abierto (A-03/A-04) ─
// LOGICA.md §4.3: sin pago → solo alquiler; con pago parcial → saldo restante
// (alquiler + servicios + IVA impago − pagos), sin restar nunca el saldo a
// favor. Única fuente de verdad para display, cobro y catch-up de cierre.
describe('computePunitoryBase — base única (LOGICA §4.3)', () => {
  test('sin ningún pago real → base = solo alquiler, aunque haya servicios/IVA', () => {
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 21000, amountPaid: 0 });
    assert.equal(base, 100000);
  });

  test('con pago parcial → base = saldo restante (alquiler + servicios + IVA − pagado)', () => {
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 21000, amountPaid: 10000 });
    assert.equal(base, 141000); // 100000+30000+21000-10000
  });

  test('pago que cubre todo → base = 0 (nunca negativa)', () => {
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 21000, amountPaid: 500000 });
    assert.equal(base, 0);
  });

  test('sin servicios ni IVA → base = alquiler impago neto', () => {
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: 0, ivaAmount: 0, amountPaid: 40000 });
    assert.equal(base, 60000);
  });

  test('campos ausentes (undefined) se tratan como 0', () => {
    const base = computePunitoryBase({ rentAmount: 100000 });
    assert.equal(base, 100000);
  });
});

// ─── computeLiveRecordPunitory — MES ABIERTO compone sobre punitorio pendiente ─
// Confirmado por el usuario 2026-07-14 (ver memoria punitory-base-rule, que
// dejaba esto pendiente "si el usuario lo pide"): igual que el motor de deudas
// (calculateDebtPunitory, rama remainingBase<=0), una vez que alquiler+servicios
// están cubiertos por pagos pero queda punitorio congelado impago, los
// punitorios NUEVOS se calculan COMPUESTOS sobre ese saldo pendiente — no se
// congelan en $0. Caso real: contrato C07_multi_same_month, pago que cubre el
// alquiler completo pero deja $10.800 de punitorios sin pagar.
describe('computeLiveRecordPunitory — mes abierto compone sobre punitorio pendiente (2026-07-14)', () => {
  const CONTRACT = { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006 };

  function baseRecord(overrides = {}) {
    return {
      periodMonth: 7,
      periodYear: 2026,
      rentAmount: 400000,
      servicesTotal: 0,
      amountPaid: 400000, // rent fully paid; only punitorios remain
      includeIva: false,
      punitoryAmount: 10800, // congelado del último pago (no cubrió punitorios)
      punitoryDays: 6,
      punitoryForgiven: false,
      isPostExpiry: false,
      transactions: [
        { paymentDate: new Date(2026, 6, 14), concepts: [{ type: 'ALQUILER', amount: 400000 }], punitoryForgiven: false },
      ],
      ...overrides,
    };
  }

  test('mismo día del último pago → sin punitorio nuevo, muestra el congelado tal cual', () => {
    const r = computeLiveRecordPunitory(baseRecord(), CONTRACT, [], { isFullyPaid: false, calculationDate: '2026-07-14' });
    assert.equal(r.amount, 10800);
    assert.equal(r.newPunitory, 0);
  });

  test('10 días después del último pago → compone: 10800 + (10800*0.6%*11 días inclusive)', () => {
    const r = computeLiveRecordPunitory(baseRecord(), CONTRACT, [], { isFullyPaid: false, calculationDate: '2026-07-24' });
    const expectedNew = round(10800 * 0.006 * 11); // 14→24 inclusive = 11 días
    assert.equal(r.newPunitory, expectedNew);
    assert.equal(r.amount, round(10800 + expectedNew));
    assert.equal(r.days, 11);
  });

  test('sin nada pendiente de punitorio (frozen=0) → no compone nada (no hay base)', () => {
    const r = computeLiveRecordPunitory(baseRecord({ punitoryAmount: 0 }), CONTRACT, [], { isFullyPaid: false, calculationDate: '2026-07-24' });
    assert.equal(r.amount, 0);
    assert.equal(r.newPunitory, 0);
  });

  test('mes con alquiler TODAVÍA impago (base>0) sigue por la rama normal, no la compuesta', () => {
    // amountPaid=0 → punitoryBase = rentAmount (100000) > 0, rama normal.
    const r = computeLiveRecordPunitory(
      baseRecord({ rentAmount: 100000, amountPaid: 0, punitoryAmount: 0, transactions: [] }),
      CONTRACT, [], { isFullyPaid: false, calculationDate: '2026-07-24' }
    );
    // Debe usar el alquiler (100000) como base, no fallar ni devolver el congelado sin más.
    assert.ok(r.newPunitory > 0, 'debe calcular punitorios en vivo sobre el alquiler impago');
  });
});

// ============================================================================
// debtDelinquencyDays (2026-07-14): días TOTALES de atraso de una deuda, para
// mostrar al usuario — no confundir con los `days` de calculatePunitoryV2 (que
// cuentan solo desde el último pago, correctos para el interés compuesto pero
// engañosos como etiqueta con pagos en varias tandas).
// ============================================================================
describe('debtDelinquencyDays', () => {
  test('deuda con 5 pagos intermedios a lo largo de 20 días → 20 días, no 2', () => {
    // punitoryStartDate el 1/3; el ÚLTIMO de 5 pagos (que salda la deuda) fue el 20/3 →
    // calculatePunitoryV2 con lastPaymentDate del pago anterior (18/3) daría "2 días",
    // pero el atraso REAL de la deuda es 1/3 → 20/3 = 20 días.
    const debt = {
      status: 'PAID',
      punitoryStartDate: new Date(2026, 2, 1), // 1/3/2026
      lastPaymentDate: new Date(2026, 2, 20),  // 20/3/2026 (pago #5, el que la salda)
      closedAt: new Date(2026, 2, 20),
    };
    assert.equal(debtDelinquencyDays(debt), 20);
  });

  test('deuda todavía abierta (no PAID) → días desde el inicio hasta la fecha de corte (hoy o la pasada)', () => {
    const debt = {
      status: 'PARTIAL',
      punitoryStartDate: new Date(2026, 2, 1), // 1/3/2026
      lastPaymentDate: new Date(2026, 2, 5),   // irrelevante: no está PAID, no se usa
    };
    assert.equal(debtDelinquencyDays(debt, new Date(2026, 2, 15)), 15, 'usa la fecha de corte provista (endDate en vivo / hoy), no lastPaymentDate');
  });

  test('sin punitoryStartDate → 0 (no revienta)', () => {
    assert.equal(debtDelinquencyDays({ status: 'PAID' }), 0);
    assert.equal(debtDelinquencyDays(null), 0);
  });

  test('deuda saldada el mismo día que empezó a correr el punitorio → 1 día (inclusive)', () => {
    const debt = {
      status: 'PAID',
      punitoryStartDate: new Date(2026, 2, 10),
      lastPaymentDate: new Date(2026, 2, 10),
    };
    assert.equal(debtDelinquencyDays(debt), 1);
  });
});
