/*
 * Tests puros (sin DB) para la detección de ajuste de alquiler compartida
 * entre las 3 secciones del reporte de Liquidación (mes actual, deudas
 * acumuladas, deudas pagadas).
 * Run: cd backend && node --test test/reportDataAjuste.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { findAjusteForMonth } = require('../src/services/reportDataService');

test('findAjusteForMonth: encuentra un ajuste real en el mes de contrato exacto', () => {
  const rentHistory = [
    { effectiveFromMonth: 1, reason: 'INICIAL', adjustmentPercent: null },
    { effectiveFromMonth: 5, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 12.5 },
  ];
  const found = findAjusteForMonth(rentHistory, 5);
  assert.ok(found, 'debe encontrar el ajuste del mes 5');
  assert.strictEqual(found.adjustmentPercent, 12.5);
});

test('findAjusteForMonth: ignora el ajuste INICIAL', () => {
  const rentHistory = [{ effectiveFromMonth: 1, reason: 'INICIAL', adjustmentPercent: 0 }];
  assert.strictEqual(findAjusteForMonth(rentHistory, 1), undefined);
});

test('findAjusteForMonth: sin match en ese mes devuelve undefined', () => {
  const rentHistory = [{ effectiveFromMonth: 5, reason: 'AJUSTE_MANUAL', adjustmentPercent: 8 }];
  assert.strictEqual(findAjusteForMonth(rentHistory, 3), undefined);
});

test('findAjusteForMonth: rentHistory vacío/null no rompe', () => {
  assert.strictEqual(findAjusteForMonth(null, 1), undefined);
  assert.strictEqual(findAjusteForMonth([], 1), undefined);
});
