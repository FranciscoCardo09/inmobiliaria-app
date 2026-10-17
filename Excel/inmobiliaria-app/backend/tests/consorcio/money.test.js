const test = require('node:test');
const assert = require('node:assert');
const m = require('../../src/services/consorcio/money');

test('parseAmount: formatos del extracto', () => {
  assert.strictEqual(m.parseAmount('$ 4.861.831,33'), 486183133);
  assert.strictEqual(m.parseAmount('-$ 13.237,00'), -1323700);
  assert.strictEqual(m.parseAmount('-$ 3,01'), -301);
  assert.strictEqual(m.parseAmount('$ 0,05'), 5);
  assert.strictEqual(m.parseAmount('  $1.000,00  '), 100000);
});

test('parseAmount: rechaza lo ilegible (no adivina)', () => {
  for (const bad of ['$ 1.000', '$ 1,5', '1.000,00', '$ 1.00,00', '$ 12345,00', 'abc', '', '$ -1,00']) {
    assert.throws(() => m.parseAmount(bad), (e) => e.code === 'BAD_AMOUNT', bad);
  }
});

test('isAmountText', () => {
  assert.strictEqual(m.isAmountText('-$ 1.656,79'), true);
  assert.strictEqual(m.isAmountText('IMPUESTO LEY 25413'), false);
});

test('formatos de salida', () => {
  assert.strictEqual(m.formatNumber(428213491), '4.282.134,91');
  assert.strictEqual(m.formatNumber(0), '0,00');
  assert.strictEqual(m.formatNumber(5), '0,05');
  assert.strictEqual(m.formatNumber(-123456), '-1.234,56');
  assert.strictEqual(m.formatReportAmount(428213491), '$ 4.282.134,91.-');
  assert.strictEqual(m.formatAmount(-2515491), '$ -25.154,91');
});

test('formatNumber / toCents rechazan montos que no son centavos enteros', () => {
  assert.throws(() => m.formatNumber(1.5), (e) => e.code === 'BAD_AMOUNT');
  assert.throws(() => m.toCents('12.3'), (e) => e.code === 'BAD_AMOUNT');
  assert.throws(() => m.assertCents(Number.MAX_SAFE_INTEGER + 2), (e) => e.code === 'BAD_AMOUNT');
  assert.strictEqual(m.toCents(null), null);
  assert.strictEqual(m.toCents(undefined), null);
  assert.strictEqual(m.toCents('100'), 100);
});
