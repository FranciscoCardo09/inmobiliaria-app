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

const { buildConceptosDeudaPagada } = require('../src/services/reportDataService');

test('buildConceptosDeudaPagada: agrega "Ajuste de X%" al label de alquiler cuando hubo ajuste ese mes', () => {
  const rec = { periodMonth: 6, periodYear: 2026, monthNumber: 5, rentAmount: 100000, services: [], includeIva: false, ivaAmount: 0 };
  const det = { alquiler: 100000, servicios: 0, punitorios: 0 };
  const rentHistory = [{ effectiveFromMonth: 5, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 10 }];
  const items = buildConceptosDeudaPagada(rec, det, rentHistory);
  const alquilerItem = items.find((i) => i.tipo === 'ALQUILER_DEUDA');
  assert.ok(alquilerItem, 'debe haber un item de alquiler');
  assert.ok(alquilerItem.label.includes('Ajuste de 10%'), `label fue: "${alquilerItem.label}"`);
});

test('buildConceptosDeudaPagada: sin ajuste ese mes no agrega sufijo', () => {
  const rec = { periodMonth: 6, periodYear: 2026, monthNumber: 5, rentAmount: 100000, services: [], includeIva: false, ivaAmount: 0 };
  const det = { alquiler: 100000, servicios: 0, punitorios: 0 };
  const items = buildConceptosDeudaPagada(rec, det, []);
  const alquilerItem = items.find((i) => i.tipo === 'ALQUILER_DEUDA');
  assert.ok(!alquilerItem.label.includes('Ajuste'), `label fue: "${alquilerItem.label}"`);
});

const { groupTransaccionesByFecha } = require('../src/services/reportDataService');

test('groupTransaccionesByFecha: dos TRANSFERENCIA el mismo día NO se agrupan', () => {
  const txs = [
    { fecha: '2026-06-10T12:00:00', monto: 1000, metodo: 'TRANSFERENCIA', conceptos: [] },
    { fecha: '2026-06-10T15:00:00', monto: 2000, metodo: 'TRANSFERENCIA', conceptos: [] },
  ];
  const result = groupTransaccionesByFecha(txs);
  assert.strictEqual(result.length, 2, 'cada transferencia debe quedar en su propia fila');
});

test('groupTransaccionesByFecha: dos EFECTIVO el mismo día SÍ se agrupan (comportamiento previo)', () => {
  const txs = [
    { fecha: '2026-06-10T12:00:00', monto: 1000, metodo: 'EFECTIVO', conceptos: [] },
    { fecha: '2026-06-10T15:00:00', monto: 2000, metodo: 'EFECTIVO', conceptos: [] },
  ];
  const result = groupTransaccionesByFecha(txs);
  assert.strictEqual(result.length, 1, 'ambos pagos en efectivo del mismo día deben quedar en una sola fila');
  assert.strictEqual(result[0].monto, 3000);
});

test('groupTransaccionesByFecha: EFECTIVO en días distintos NO se agrupan', () => {
  const txs = [
    { fecha: '2026-06-10T12:00:00', monto: 1000, metodo: 'EFECTIVO', conceptos: [] },
    { fecha: '2026-06-11T12:00:00', monto: 2000, metodo: 'EFECTIVO', conceptos: [] },
  ];
  const result = groupTransaccionesByFecha(txs);
  assert.strictEqual(result.length, 2);
});

test('groupTransaccionesByFecha: EFECTIVO y TRANSFERENCIA el mismo día nunca se mezclan', () => {
  const txs = [
    { fecha: '2026-06-10T12:00:00', monto: 1000, metodo: 'EFECTIVO', conceptos: [] },
    { fecha: '2026-06-10T13:00:00', monto: 2000, metodo: 'TRANSFERENCIA', conceptos: [] },
    { fecha: '2026-06-10T14:00:00', monto: 500, metodo: 'EFECTIVO', conceptos: [] },
  ];
  const result = groupTransaccionesByFecha(txs);
  assert.strictEqual(result.length, 2, 'una fila de efectivo agrupado + una fila de transferencia, nunca mezcladas');
  const efectivoRow = result.find((r) => r.metodo === 'EFECTIVO');
  const transferenciaRow = result.find((r) => r.metodo === 'TRANSFERENCIA');
  assert.strictEqual(efectivoRow.monto, 1500);
  assert.strictEqual(transferenciaRow.monto, 2000);
});
