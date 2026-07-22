'use strict';

/**
 * Regla de negocio (confirmada 2026-07-22, ver plan de la sesión): la base de
 * honorarios se calcula sobre el ALQUILER, con una única distinción entre las
 * dos categorías de ajuste que puede tener un mes:
 *
 *   - BONIFICACION → SÍ reduce la base de honorarios (se cobra sobre lo
 *     efectivamente cobrado).
 *   - DESCUENTO → NO reduce la base de honorarios (se cobra sobre el alquiler
 *     completo, como si el descuento no existiera). Única excepción: el
 *     descuento MANUAL cargado a mano en la UI (options.descuentosAlquiler)
 *     sigue restando siempre — es un ajuste aparte, no ligado a la categoría.
 *
 * Bug corregido: el motor de pagos (paymentTransactionService.js) no distingue
 * DESCUENTO de BONIFICACION al armar el concepto ALQUILER de cada pago — ambas
 * categorías reducen el mismo `servicesTotal`, y por lo tanto el monto que
 * queda tageado como ALQUILER siempre viene neto de las dos combinadas. Antes
 * de este fix, `reportDataService.js` restaba el descuento OTRA VEZ (double
 * count) y nunca devolvía la bonificación — el resultado era peor que si no
 * hiciera ningún ajuste.
 *
 * Caso real reportado por el usuario ("Godoy"): alquiler $680.000, un servicio
 * de categoría DESCUENTO de $85.833 → paga $594.167 completo. Los honorarios
 * deben calcularse sobre los $680.000 completos (test 1).
 *
 * Estos son pure-function tests (sin DB), mismo patrón que reportTotals.test.js.
 * Run: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLiquidacionFromRecord,
  computeGrandTotals,
} = require('../src/services/reportDataService');

const EMPRESA = {
  nombre: 'Test Inmobiliaria',
  subtitulo: '', direccion: '', ciudad: '', telefono: '', email: '', cuit: '',
  currency: 'ARS', banco: {},
};

const MONTH = 7;
const YEAR = 2026;

/** Mismo fixture helper que tests/reportTotals.test.js. */
const makeRecord = (overrides = {}, contractOverrides = {}) => ({
  id: 'mr-1',
  monthNumber: 5,
  rentAmount: 100000,
  punitoryAmount: 0,
  punitoryDays: 0,
  punitoryForgiven: false,
  includeIva: false,
  ivaAmount: 0,
  previousBalance: 0,
  amountPaid: 0,
  balance: -100000,
  status: 'PENDING',
  isPaid: false,
  isCancelled: false,
  fullPaymentDate: null,
  services: [],
  transactions: [],
  contract: {
    id: 'c-1',
    contractType: 'INQUILINO',
    tenant: null,
    contractTenants: [
      { isPrimary: true, tenant: { name: 'Juan Pérez', dni: '12345678', email: 'j@test.com', phone: null } },
    ],
    property: {
      address: 'Av. Test 123', floor: null, apartment: null,
      owner: { name: 'María García', dni: '20123456', email: null, phone: null, transferBeneficiary: null },
      transferBeneficiary: null,
    },
    rentHistory: [],
    ...contractOverrides,
  },
  ...overrides,
});

/** Servicio DESCUENTO o BONIFICACION del mes (MonthlyService). */
const makeAjusteService = (category, amount, id = `svc-${category.toLowerCase()}`) => ({
  id, amount, conceptType: { category, label: category === 'DESCUENTO' ? 'Descuento' : 'Bonificación', name: category },
});

/** Transacción con un único concepto ALQUILER (lo que graba el motor de pagos real). */
const makeAlquilerTx = (amount, extraConcepts = []) => ({
  paymentDate: new Date(YEAR, MONTH - 1, 10, 12, 0, 0),
  amount: amount + extraConcepts.reduce((s, c) => s + c.amount, 0),
  punitoryForgiven: false,
  concepts: [{ type: 'ALQUILER', amount }, ...extraConcepts],
});

describe('Honorarios: BONIFICACION resta la base, DESCUENTO no (regla 2026-07-22)', () => {

  test('1. DESCUENTO puro, pago completo (caso real Godoy): base = alquiler BRUTO completo', async () => {
    const record = makeRecord({
      rentAmount: 680000,
      services: [makeAjusteService('DESCUENTO', 85833)],
      amountPaid: 594167, // 680000 - 85833, lo que efectivamente debe y paga el inquilino
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(594167)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'PAGADO');
    assert.strictEqual(result.subtotalAlquileresCobrado, 680000, 'DESCUENTO no debe restar: base = alquiler completo');
    assert.strictEqual(result.honorariosCobrado, 68000, '10% de 680000');
  });

  test('2. BONIFICACION pura, pago completo: base = alquiler NETO (bonificación resta)', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)],
      amountPaid: 90000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(90000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 90000, 'BONIFICACION sí debe restar: base = alquiler neto');
    assert.strictEqual(result.honorariosCobrado, 9000, '10% de 90000');
  });

  test('3. Mixto (DESCUENTO + BONIFICACION), pago completo: solo la bonificación reduce la base', async () => {
    const record = makeRecord({
      rentAmount: 680000,
      services: [
        makeAjusteService('DESCUENTO', 20000),
        makeAjusteService('BONIFICACION', 85833),
      ],
      amountPaid: 574167, // 680000 - 20000 - 85833
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(574167)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 594167, '680000 - 85833 (descuento ignorado)');
  });

  test('4. Sin descuentos ni bonificaciones (regresión): base = alquiler completo, sin cambios', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 100000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(100000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 100000);
    assert.strictEqual(result.honorariosCobrado, 10000);
  });

  test('5. Pago PARCIAL, BONIFICACION pura: escala linealmente con el efectivo (ratio=1)', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)], // neto debido = 90000
      amountPaid: 45000, // 50% del neto
      balance: -45000,
      status: 'PARTIAL',
      isPaid: false,
      isCancelled: false,
      transactions: [makeAlquilerTx(45000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'PAGO PARCIAL');
    assert.strictEqual(result.subtotalAlquileresCobrado, 45000, 'bonificación pura: 1:1 con el efectivo cobrado');
  });

  test('6. Pago PARCIAL, DESCUENTO puro: el gross-up escala proporcionalmente (no de golpe)', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('DESCUENTO', 10000)], // neto debido = 90000
      amountPaid: 45000, // 50% del neto
      balance: -45000,
      status: 'PARTIAL',
      isPaid: false,
      isCancelled: false,
      transactions: [makeAlquilerTx(45000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    // 45000 pagado = 50% del neto (90000) → 50% del alquiler bruto (100000) = 50000
    assert.strictEqual(result.subtotalAlquileresCobrado, 50000, 'descuento puro: gross-up proporcional al % pagado');
  });

  test('7. NO COBRADO (amountPaid=0) con bonificación: honorariosCobrado=0 pase lo que pase', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)],
      amountPaid: 0,
      balance: -90000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: false,
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'NO COBRADO');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0);
    assert.strictEqual(result.honorariosCobrado, 0, 'no se cobran honorarios si no se cobró nada');
    assert.ok(result.honorarios !== null, 'honorarios object sigue presente para mostrar el % en preview');
  });

  test('8. Descuento MANUAL (UI) + BONIFICACION combinados: el manual sigue restando aparte', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)], // neto debido = 90000
      amountPaid: 90000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(90000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {
      honorariosPercent: 10,
      descuentosAlquiler: 5000, // manual, siempre resta
      holidays: [],
    });

    // subtotalAlquileresCobrado (display) NO se toca por el manual — sigue en 90000
    assert.strictEqual(result.subtotalAlquileresCobrado, 90000);
    // pero la BASE de honorarios sí resta el manual: 90000 - 5000 = 85000
    assert.strictEqual(result.honorarios.baseHonorarios, 85000);
    assert.strictEqual(result.honorariosCobrado, 8500, '10% de 85000');
  });

  test('9. Edge case: BONIFICACION cubre exactamente todo el alquiler (netRentDueReal=0) — sin NaN/negativos', async () => {
    const record = makeRecord({
      rentAmount: 50000,
      services: [makeAjusteService('BONIFICACION', 50000)], // neto debido = 0
      amountPaid: 0,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [], // nada que cobrar en efectivo, la bonificación cubre todo
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.ok(Number.isFinite(result.subtotalAlquileresCobrado), 'no debe dar NaN/Infinity');
    assert.ok(result.subtotalAlquileresCobrado >= 0, 'no debe dar negativo');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0, 'bonificación total → base de alquiler queda en 0');
  });

  test('10. Rama fallback (sin TransactionConcept reales, legacy/test): mismo resultado que la rama real', async () => {
    // Idéntico a test 1 (Godoy) pero SIN transactions — ejercita la rama fallback.
    const record = makeRecord({
      rentAmount: 680000,
      services: [makeAjusteService('DESCUENTO', 85833)],
      amountPaid: 594167,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      // sin transactions → sawConcepts=false → rama fallback
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 680000, 'rama fallback debe dar el mismo resultado que la rama real (test 1)');
    assert.strictEqual(result.honorariosCobrado, 68000);
  });

  test('11. computeGrandTotals: grandAlquilerCobrado y grandSubtotalAlquileres coinciden (unificación de totales)', async () => {
    const record = makeRecord({
      rentAmount: 680000,
      services: [makeAjusteService('DESCUENTO', 85833)],
      amountPaid: 594167,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(594167)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });
    const grand = computeGrandTotals([result]);

    // Sin punitorios en este fixture, ambos totales deben coincidir exactamente.
    assert.strictEqual(grand.grandSubtotalAlquileres, 680000);
    assert.strictEqual(grand.grandAlquilerCobrado, 680000, 'antes del fix, este total (paidAlquiler crudo) hubiera dado 594167');
    assert.strictEqual(grand.grandSubtotalAlquileres, grand.grandAlquilerCobrado, 'los dos totales de "alquiler cobrado" deben coincidir');
  });

});
