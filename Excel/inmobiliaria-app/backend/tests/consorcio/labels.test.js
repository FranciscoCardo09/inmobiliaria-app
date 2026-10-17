const test = require('node:test');
const assert = require('node:assert');
const l = require('../../src/services/consorcio/labels');

test('renderLabel: variables del mes y del mes anterior', () => {
  assert.strictEqual(l.renderLabel('Gastos Comunes {mesAnterior}', 2026, 7), 'Gastos Comunes Junio - 26');
  assert.strictEqual(l.renderLabel('{mes}', 2026, 7), 'Julio - 26');
  assert.strictEqual(l.renderLabel('Impuesto (periodo {periodoAnterior})', 2026, 7), 'Impuesto (periodo 06/2026)');
  assert.strictEqual(l.renderLabel('{periodo}', 2026, 7), '07/2026');
  assert.strictEqual(l.renderLabel('Sin variables', 2026, 7), 'Sin variables');
});

test('renderLabel: enero toma diciembre del año anterior', () => {
  assert.strictEqual(l.renderLabel('{mesAnterior} / {periodoAnterior}', 2027, 1), 'Diciembre - 26 / 12/2026');
  assert.deepStrictEqual(l.previousMonth(2027, 1), { year: 2026, month: 12 });
  assert.deepStrictEqual(l.previousMonth(2026, 8), { year: 2026, month: 7 });
});

test('renderLabel: variable inexistente → error que lista las válidas', () => {
  assert.throws(() => l.renderLabel('Honorarios {mesPasado}', 2026, 7),
    (e) => e.code === 'BAD_LABEL_VARIABLE' && /\{mesAnterior\}/.test(e.message));
});

test('labelKey ignora mayúsculas y espacios repetidos', () => {
  assert.strictEqual(l.labelKey('  Service   Ascensor '), 'service ascensor');
  assert.strictEqual(l.monthName(12), 'Diciembre');
});
