'use strict';

/**
 * Auditoría 2026-07 — Hallazgo #3: `computeGrandTotals` está duplicado como copia
 * espejo en `frontend/src/utils/reportTotals.js` (pantalla) y en
 * `backend/src/services/reportDataService.js` (PDF/Excel/DOCX/HTML). Este test
 * congela la paridad: si una copia cambia sin la otra, este test se pone rojo.
 *
 * También protege el fix del Hallazgo #4: `grandTotal` (y los desgloses por
 * concepto) deben incluir `cobradoOtrosPeriodos` (cobros de deudas de meses
 * anteriores efectivamente cobrados en el mes del reporte — criterio de caja).
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { computeGrandTotals: computeGrandTotalsBackend } = require('../src/services/reportDataService');

const FRONTEND_REPORT_TOTALS_URL =
  'file://' + path.resolve(__dirname, '../../frontend/src/utils/reportTotals.js');

// Row shape as produced by buildLiquidacionFromRecord (reportDataService.js:448-494)
const row = (overrides = {}) => ({
  paymentStatus: 'PAGADO',
  subtotalAlquileresCobrado: 0,
  pendingAmount: 0,
  amountPaid: 0,
  honorariosCobrado: 0,
  paidServicios: 0,
  paidPunitorios: 0,
  paidAlquiler: 0,
  saldoAFavor: 0,
  ...overrides,
});

const FIXTURES = {
  empty: [],
  mixed: [
    row({ paymentStatus: 'PAGADO', subtotalAlquileresCobrado: 105000, amountPaid: 105000, honorariosCobrado: 10500, paidAlquiler: 100000, paidPunitorios: 5000 }),
    row({ paymentStatus: 'SALDO A FAVOR', subtotalAlquileresCobrado: 100000, amountPaid: 120000, honorariosCobrado: 10000, saldoAFavor: 20000, paidAlquiler: 100000 }),
    row({ paymentStatus: 'PAGO PARCIAL', subtotalAlquileresCobrado: 60000, pendingAmount: 40000, amountPaid: 60000, honorariosCobrado: 6000, paidAlquiler: 60000, paidServicios: 0 }),
    row({ paymentStatus: 'NO COBRADO', subtotalAlquileresCobrado: 0, pendingAmount: 100000, amountPaid: 0, honorariosCobrado: 0 }),
    row({ paymentStatus: 'NO COBRADO', subtotalAlquileresCobrado: 0, pendingAmount: 80000, amountPaid: 0, honorariosCobrado: 0 }),
  ],
  allSameStatus: [
    row({ paymentStatus: 'PAGADO', subtotalAlquileresCobrado: 50000, amountPaid: 50000, honorariosCobrado: 5000 }),
    row({ paymentStatus: 'PAGADO', subtotalAlquileresCobrado: 70000, amountPaid: 70000, honorariosCobrado: 7000 }),
  ],
  withDecimals: [
    row({ paymentStatus: 'PAGADO', subtotalAlquileresCobrado: 27999.93, amountPaid: 133332.93, honorariosCobrado: 2799.99, paidAlquiler: 133333, paidPunitorios: 0 }),
    row({ paymentStatus: 'PAGO PARCIAL', subtotalAlquileresCobrado: 10000.5, pendingAmount: 5000.25, amountPaid: 10000.5, honorariosCobrado: 1000.05 }),
  ],
};

describe('Paridad computeGrandTotals — frontend vs backend (Hallazgo #3)', () => {
  test('ambas implementaciones existen y son funciones', async () => {
    const frontend = await import(FRONTEND_REPORT_TOTALS_URL);
    assert.strictEqual(typeof frontend.computeGrandTotals, 'function', 'frontend/src/utils/reportTotals.js debe exportar computeGrandTotals');
    assert.strictEqual(typeof computeGrandTotalsBackend, 'function');
  });

  for (const [name, data] of Object.entries(FIXTURES)) {
    test(`fixture "${name}": front y back producen el mismo objeto`, async () => {
      const frontend = await import(FRONTEND_REPORT_TOTALS_URL);
      const backendResult = computeGrandTotalsBackend(data);
      const frontendResult = frontend.computeGrandTotals(data);

      assert.deepStrictEqual(
        frontendResult,
        backendResult,
        `computeGrandTotals(front) debe ser idéntico a computeGrandTotals(back) para la fixture "${name}"`
      );
    });
  }
});

describe('Hallazgo #4 (FIX) — grandTotal incluye cobros de deudas de meses anteriores', () => {
  test('grandTotal suma amountPaid del período + cobradoOtrosPeriodos.total (caja real del mes)', () => {
    // Fila del período con amountPaid propio, más un bloque "cobrado en otros períodos"
    // (deudas de meses anteriores canceladas en este mes) que el modelo de caja cuenta
    // como "cobrado en el mes" (escenario "Juan": marzo cobra 42000 propios + 208000 de
    // ene/feb = 250000 de caja real).
    const data = [
      {
        ...row({ paymentStatus: 'PAGO PARCIAL', subtotalAlquileresCobrado: 42000, pendingAmount: 58000, amountPaid: 42000, honorariosCobrado: 4200, paidAlquiler: 42000 }),
        cobradoOtrosPeriodos: { total: 208000, alquiler: 200000, servicios: 0, iva: 0, punitorios: 8000, detalle: [] }, // ene + feb canceladas en marzo
      },
    ];

    const result = computeGrandTotalsBackend(data);

    assert.strictEqual(result.grandTotal, 250000, 'grandTotal = 42000 (propio) + 208000 (otros períodos) = caja real de marzo');
    assert.strictEqual(result.grandAlquilerCobrado, 242000, 'alquiler cobrado = 42000 (propio) + 200000 (ene/feb)');
    assert.strictEqual(result.grandPunitoriosCobrado, 8000, 'punitorios cobrados = 0 (propio, marzo) + 8000 (ene/feb congelados)');
  });

  test('filas sin cobradoOtrosPeriodos no cambian de comportamiento (fallback a 0)', () => {
    const data = [row({ paymentStatus: 'PAGADO', amountPaid: 50000, paidAlquiler: 50000 })];
    const result = computeGrandTotalsBackend(data);
    assert.strictEqual(result.grandTotal, 50000);
    assert.strictEqual(result.grandAlquilerCobrado, 50000);
  });
});
