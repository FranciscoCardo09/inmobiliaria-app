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
      100000,
      'subtotalAlquileresCobrado = ONLY rentAmount for paid record'
    );
    assert.ok(result.honorariosCobrado >= 0, 'honorariosCobrado present on paid record');
    assert.strictEqual(result.subtotalAlquileres, 100000, 'subtotalAlquileres (due) is now only rent');
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

  test('3. partial payment: cobrado reflects allocated amounts, paymentStatus=PAGO PARCIAL', () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 60000,
      balance: -40000,
      status: 'PARTIAL',
      isPaid: false,
      isCancelled: false,
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    assert.strictEqual(result.paymentStatus, 'PAGO PARCIAL', 'partial payment → PAGO PARCIAL');
    assert.strictEqual(result.isRentPaid, false, 'partial → not fully paid');
    assert.strictEqual(result.subtotalAlquileresCobrado, 60000, 'partial allocates paid amount to rent');
    assert.ok(result.pendingAmount > 0, 'pending amount should be > 0');
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

  test('7b. admin cancelled with amountPaid=0: paymentStatus=NO COBRADO (amountPaid drives status)', () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: true,  // admin manually marked as cancelled
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    // paymentStatus is driven by amountPaid, not isCancelled
    assert.strictEqual(result.paymentStatus, 'NO COBRADO', 'amountPaid=0 → NO COBRADO regardless of isCancelled');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0);
  });

  test('7c. amountPaid >= totalDue but isCancelled=false: classified by amountPaid vs total', () => {
    // paymentStatus is now driven by amountPaid vs total, not by isCancelled
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 100000,
      balance: 0,
      status: 'PARTIAL',   // not yet recalculated
      isPaid: false,
      isCancelled: false,  // writer hasn't flushed yet
    });

    const result = buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR);

    // amountPaid (100000) >= total (100000) → PAGADO
    assert.strictEqual(result.paymentStatus, 'PAGADO', 'amountPaid >= total → PAGADO');
    assert.strictEqual(result.isRentPaid, true, 'fully paid by amount');
    assert.strictEqual(result.subtotalAlquileresCobrado, 100000);
    // DB columns are passed through as-is
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

  // Helper: creates a row for computeGrandTotals with the 4-state payment model
  const row = (status, rentAmount, punitoryAmount = 0, honorariosMonto = 0, total = null, amountPaid = null) => {
    const isPaid = status === 'PAGADO' || status === 'SALDO A FAVOR';
    const isPartial = status === 'PAGO PARCIAL';
    const effectiveAmountPaid = amountPaid ?? (isPaid ? (total ?? rentAmount + punitoryAmount) : (isPartial ? Math.round((total ?? rentAmount + punitoryAmount) * 0.6) : 0));
    return {
      paymentStatus: status,
      isRentPaid: isPaid,
      subtotalAlquileres: rentAmount + punitoryAmount,
      subtotalAlquileresCobrado: isPaid ? rentAmount + punitoryAmount : (isPartial ? effectiveAmountPaid : 0),
      total: total ?? rentAmount + punitoryAmount,
      amountPaid: effectiveAmountPaid,
      pendingAmount: isPaid ? 0 : Math.max(0, (total ?? rentAmount + punitoryAmount) - effectiveAmountPaid),
      honorarios: { monto: honorariosMonto },
      honorariosCobrado: isPaid ? honorariosMonto : (isPartial ? Math.round(honorariosMonto * 0.6) : 0),
    };
  };

  test('8. mixed array: grand totals sum all rows for subtotalAlquileresCobrado', () => {
    const data = [
      row('PAGADO',      100000),                    // paid
      row('PAGADO',      150000),                    // paid
      row('PAGADO',      200000),                    // paid
      row('NO COBRADO',  80000),                     // unpaid
      row('NO COBRADO',  120000),                    // unpaid
      row('PAGO PARCIAL', 90000, 0, 0, null, 54000), // partial: paid 54000
    ];

    const result = computeGrandTotals(data);

    // grandSubtotalAlquileres sums ALL rows' subtotalAlquileresCobrado
    assert.strictEqual(result.grandSubtotalAlquileres, 450000 + 54000, 'paid + partial cobrado summed');
    assert.strictEqual(result.grandSubtotalAlquileresUnpaid, 200000, '2 unpaid rows pending summed');
    assert.strictEqual(result.paidCount, 3);
    assert.strictEqual(result.unpaidCount, 2);
    assert.strictEqual(result.partialCount, 1);
  });

  test('9. grand honorarios excludes unpaid rows', () => {
    const data = [
      row('PAGADO',      100000, 0, 10000),   // paid, honorarios 10000
      row('PAGADO',      150000, 0, 15000),   // paid, honorarios 15000
      row('NO COBRADO',  100000, 0, 10000),   // unpaid — should be excluded
    ];

    const result = computeGrandTotals(data);

    assert.strictEqual(result.grandHonorarios, 25000, 'only paid rows honorarios');
  });

  test('grand total sums amountPaid from ALL rows', () => {
    const data = [
      row('PAGADO',     100000, 5000, 0, 110000, 110000), // paid, amountPaid=110000
      row('NO COBRADO', 80000, 0, 0, 80000, 0),           // unpaid, amountPaid=0
    ];

    const result = computeGrandTotals(data);

    assert.strictEqual(result.grandTotal, 110000, 'sum of all amountPaid');
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
    const data = [row('PAGADO', 100000), row('PAGADO', 200000)];
    const result = computeGrandTotals(data);
    assert.strictEqual(result.grandSubtotalAlquileresUnpaid, 0);
    assert.strictEqual(result.paidCount, 2);
    assert.strictEqual(result.unpaidCount, 0);
  });

  test('all unpaid: cobrado total is 0', () => {
    const data = [row('NO COBRADO', 100000), row('NO COBRADO', 200000)];
    const result = computeGrandTotals(data);
    // grandSubtotalAlquileres sums subtotalAlquileresCobrado which is 0 for NO COBRADO
    assert.strictEqual(result.grandSubtotalAlquileres, 0, 'no cobrado → 0 collected');
    assert.strictEqual(result.paidCount, 0);
    assert.strictEqual(result.unpaidCount, 2);
  });
});
