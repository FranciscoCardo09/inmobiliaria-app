'use strict';

/**
 * Unit tests for buildLiquidacionFromRecord and computeGrandTotals.
 *
 * These are pure-function tests — no database, no fixtures.
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLiquidacionFromRecord,
  computeGrandTotals,
} = require('../src/services/reportDataService');

// ─── Minimal fixtures ─────────────────────────────────────────────────────────

const EMPRESA = {
  nombre: 'Test Inmobiliaria',
  subtitulo: '',
  direccion: '',
  ciudad: '',
  telefono: '',
  email: '',
  cuit: '',
  currency: 'ARS',
  banco: {},
};

/**
 * Returns a minimal valid monthlyRecord object. Override any field via the
 * second argument (top-level only — use contractOverrides for contract fields).
 */
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
      {
        isPrimary: true,
        tenant: { name: 'Juan Pérez', dni: '12345678', email: 'j@test.com', phone: null },
      },
    ],
    property: {
      address: 'Av. Test 123',
      floor: null,
      apartment: null,
      owner: { name: 'María García', dni: '20123456', email: null, phone: null, transferBeneficiary: null },
      transferBeneficiary: null,
    },
    rentHistory: [],
    ...contractOverrides,
  },
  ...overrides,
});

const MONTH = 4;
const YEAR = 2026;

// ─── buildLiquidacionFromRecord ───────────────────────────────────────────────

describe('buildLiquidacionFromRecord — isRentPaid and cobrado fields', () => {

  test('1. paid rental: isRentPaid=true, subtotalAlquileresCobrado equals rent+punitory', () => {
    const record = makeRecord({
      rentAmount: 100000,
      punitoryAmount: 5000,
      punitoryForgiven: false,
      amountPaid: 105000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.isRentPaid, true, 'isRentPaid should be true when isCancelled');
    assert.strictEqual(
      result.subtotalAlquileresCobrado,
      105000,
      'subtotalAlquileresCobrado = rentAmount + punitoryAmount for paid record'
    );
    assert.ok(result.honorariosCobrado >= 0, 'honorariosCobrado present on paid record');
    assert.strictEqual(result.subtotalAlquileres, 105000, 'subtotalAlquileres (due) unchanged');
  });

  test('2. unpaid rental: isRentPaid=false, cobrado fields are 0, due fields intact', () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: false,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.isRentPaid, false, 'isRentPaid should be false when not isCancelled');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0, 'nothing collected on unpaid');
    assert.strictEqual(result.honorariosCobrado, 0, 'no fees on uncollected rent');
    // Row still carries full due-amount so UI can display it
    assert.strictEqual(result.subtotalAlquileres, 100000, 'subtotalAlquileres (due) still present');
    assert.ok(Array.isArray(result.conceptos) && result.conceptos.length > 0, 'conceptos present');
  });

  test('3. partial payment treated as unpaid: cobrado fields are 0', () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 60000,
      balance: -40000,
      status: 'PARTIAL',
      isPaid: false,
      isCancelled: false,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.isRentPaid, false, 'partial → not paid per strict rule');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0, 'partial contributes 0 to cobrado');
    assert.strictEqual(result.honorariosCobrado, 0, 'no fees on partial payment');
  });

  test('4. debt cleared → record settled: isCancelled=true counts as paid', () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 100000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,  // forced by debtService when Debt.status flips to PAID
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.isRentPaid, true, 'debt-cleared record is paid');
    assert.strictEqual(result.subtotalAlquileresCobrado, 100000);
  });

  test('5. forgiven punitorios excluded from cobrado total', () => {
    const record = makeRecord({
      rentAmount: 100000,
      punitoryAmount: 5000,
      punitoryForgiven: true,   // punitorios forgiven
      amountPaid: 100000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.isRentPaid, true);
    assert.strictEqual(
      result.subtotalAlquileresCobrado,
      100000,
      'forgiven punitorios are NOT included in cobrado'
    );
    assert.strictEqual(result.subtotalAlquileres, 100000, 'subtotalAlquileres also excludes forgiven punitorios');
  });

  test('6. unpaid row with punitorios contributes 0 to cobrado', () => {
    const record = makeRecord({
      rentAmount: 100000,
      punitoryAmount: 3000,
      punitoryForgiven: false,
      amountPaid: 0,
      balance: -103000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: false,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.isRentPaid, false);
    assert.strictEqual(result.subtotalAlquileresCobrado, 0, 'unpaid + punitorios → 0 cobrado');
  });

  test('7a. zero-rent record contributes 0 regardless of paid status', () => {
    const record = makeRecord({
      rentAmount: 0,
      amountPaid: 0,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.subtotalAlquileresCobrado, 0, 'zero rent → 0 cobrado even if paid');
    assert.strictEqual(result.subtotalAlquileres, 0);
  });

  test('7b. manual admin settle (isCancelled=true, amountPaid=0) treated as paid', () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: true,  // admin manually marked as cancelled
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    // isCancelled is the sole source of truth
    assert.strictEqual(result.isRentPaid, true, 'isCancelled=true is authoritative');
    assert.strictEqual(result.subtotalAlquileresCobrado, 100000);
  });

  test('7c. amountPaid >= totalDue but isCancelled=false: treated as unpaid (no tolerance fallback)', () => {
    // Regression: old code had `amountPaid > 0 && balance >= -1` fallback that could
    // contradict the writer's -0.01 threshold. Now isCancelled is the only truth.
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 100000,
      balance: 0,
      status: 'PARTIAL',   // not yet recalculated
      isPaid: false,
      isCancelled: false,  // writer hasn't flushed yet
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(
      result.isRentPaid,
      false,
      'isCancelled=false means unpaid — no amountPaid tolerance fallback'
    );
    assert.strictEqual(result.subtotalAlquileresCobrado, 0);
    // Also verify isPaid / isCancelled on the returned object match the DB column
    assert.strictEqual(result.isPaid, false);
    assert.strictEqual(result.isCancelled, false);
  });

  test('honorarios computed when honorariosPercent provided, 0 for unpaid', () => {
    const options = { honorariosPercent: 10 };

    const paidRecord = makeRecord({
      rentAmount: 100000,
      amountPaid: 100000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
    });
    const unpaidRecord = makeRecord({
      id: 'mr-2',
      rentAmount: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: false,
    });

    const paid = buildLiquidacionFromRecord(paidRecord, EMPRESA, MONTH, YEAR, options);
    const unpaid = buildLiquidacionFromRecord(unpaidRecord, EMPRESA, MONTH, YEAR, options);

    assert.ok(paid.honorarios !== null, 'paid row has honorarios object');
    assert.ok(paid.honorariosCobrado > 0, 'paid row has positive honorariosCobrado');
    assert.strictEqual(unpaid.honorariosCobrado, 0, 'unpaid row: honorariosCobrado=0');
    // The hypothetical fee is still visible in honorarios.monto so UI can display it
    assert.ok(unpaid.honorarios !== null, 'unpaid row still has honorarios object for display');
  });
});

// ─── computeGrandTotals ───────────────────────────────────────────────────────

describe('computeGrandTotals', () => {

  const row = (isCancelled, rentAmount, punitoryAmount = 0, honorariosMonto = 0, total = null) => ({
    isRentPaid: !!isCancelled,
    subtotalAlquileres: rentAmount + punitoryAmount,
    subtotalAlquileresCobrado: isCancelled ? rentAmount + punitoryAmount : 0,
    total: total ?? rentAmount + punitoryAmount,
    honorarios: { monto: honorariosMonto },
    honorariosCobrado: isCancelled ? honorariosMonto : 0,
  });

  test('8. mixed array: grand totals sum only paid rows', () => {
    const data = [
      row(true,  100000),           // paid
      row(true,  150000),           // paid
      row(true,  200000),           // paid
      row(false, 80000),            // unpaid
      row(false, 120000),           // unpaid
      row(false, 90000),            // partial (also unpaid per strict rule)
    ];

    const result = computeGrandTotals(data);

    assert.strictEqual(result.grandSubtotalAlquileres, 450000, '3 paid rows summed');
    assert.strictEqual(result.grandSubtotalAlquileresUnpaid, 290000, '3 unpaid rows summed');
    assert.strictEqual(result.paidCount, 3);
    assert.strictEqual(result.unpaidCount, 3);
  });

  test('9. grand honorarios excludes unpaid rows', () => {
    const data = [
      row(true,  100000, 0, 10000),   // paid, honorarios 10000
      row(true,  150000, 0, 15000),   // paid, honorarios 15000
      row(false, 100000, 0, 10000),   // unpaid — should be excluded
    ];

    const result = computeGrandTotals(data);

    assert.strictEqual(result.grandHonorarios, 25000, 'only paid rows honorarios');
  });

  test('grand total sums paid rows total field only', () => {
    const data = [
      row(true,  100000, 5000, 0, 110000),   // paid, total=110000
      row(false, 80000, 0, 0, 80000),        // unpaid
    ];

    const result = computeGrandTotals(data);

    assert.strictEqual(result.grandTotal, 110000, 'only paid row total');
  });

  test('empty array returns zeroed object', () => {
    const result = computeGrandTotals([]);
    assert.strictEqual(result.grandSubtotalAlquileres, 0);
    assert.strictEqual(result.grandSubtotalAlquileresUnpaid, 0);
    assert.strictEqual(result.grandTotal, 0);
    assert.strictEqual(result.grandHonorarios, 0);
    assert.strictEqual(result.paidCount, 0);
    assert.strictEqual(result.unpaidCount, 0);
  });

  test('all paid: unpaid total is 0', () => {
    const data = [row(true, 100000), row(true, 200000)];
    const result = computeGrandTotals(data);
    assert.strictEqual(result.grandSubtotalAlquileresUnpaid, 0);
    assert.strictEqual(result.paidCount, 2);
    assert.strictEqual(result.unpaidCount, 0);
  });

  test('all unpaid: paid total is 0', () => {
    const data = [row(false, 100000), row(false, 200000)];
    const result = computeGrandTotals(data);
    assert.strictEqual(result.grandSubtotalAlquileres, 0);
    assert.strictEqual(result.paidCount, 0);
    assert.strictEqual(result.unpaidCount, 2);
  });
});
