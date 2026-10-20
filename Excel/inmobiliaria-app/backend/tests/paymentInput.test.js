'use strict';

// Auditoría 2026-10-20: validación de la entrada de los pagos (utils/paymentInput.js).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parsePaymentAmount, parsePaymentDate, parsePaymentMethod } = require('../src/utils/paymentInput');

describe('parsePaymentAmount', () => {
  test('formato argentino: "1.500,50" es $1.500,50 (antes se grababa $1,50)', () => {
    assert.equal(parsePaymentAmount('1.500,50'), 1500.5);
    assert.equal(parsePaymentAmount('1.500.000'), 1500000);
    assert.equal(parsePaymentAmount('$ 727.805'), 727805);
  });
  test('decimal con punto y números', () => {
    assert.equal(parsePaymentAmount('1500.5'), 1500.5);
    assert.equal(parsePaymentAmount(727805.123), 727805.12);
  });
  test('rechaza basura, cero, negativos, Infinity y montos absurdos', () => {
    for (const v of ['abc', 'Infinity', '', '0', -5, 0, '1,2,3', null, undefined, {}, 1e12, '0.001']) {
      assert.throws(() => parsePaymentAmount(v), { code: 'PAYMENT_INPUT' }, String(v));
    }
  });
});

describe('parsePaymentDate', () => {
  const TODAY = '2026-10-20';
  test('fecha válida, hoy y sin valor (= hoy)', () => {
    assert.equal(parsePaymentDate('2026-10-15', TODAY), '2026-10-15');
    assert.equal(parsePaymentDate('2026-10-20T00:00:00.000Z', TODAY), '2026-10-20');
    assert.equal(parsePaymentDate(undefined, TODAY), TODAY);
  });
  test('rechaza fechas imposibles (antes "2026-13-45" se grababa 14/02/2027)', () => {
    for (const v of ['2026-13-45', '2026-02-30', '15/10/2026', 'ayer']) {
      assert.throws(() => parsePaymentDate(v, TODAY), { code: 'PAYMENT_INPUT' }, v);
    }
  });
  test('rechaza fechas futuras (un pago fechado en 2031 generó 1.418 días de mora) y muy viejas', () => {
    assert.throws(() => parsePaymentDate('2026-10-21', TODAY), /futura/);
    assert.throws(() => parsePaymentDate('2031-01-01', TODAY), /futura/);
    assert.throws(() => parsePaymentDate('2019-12-31', TODAY), { code: 'PAYMENT_INPUT' });
  });
});

describe('parsePaymentMethod', () => {
  test('EFECTIVO por defecto, TRANSFER viejo → TRANSFERENCIA, rechaza el resto', () => {
    assert.equal(parsePaymentMethod(undefined), 'EFECTIVO');
    assert.equal(parsePaymentMethod('transferencia'), 'TRANSFERENCIA');
    assert.equal(parsePaymentMethod('TRANSFER'), 'TRANSFERENCIA');
    assert.throws(() => parsePaymentMethod('BITCOIN'), { code: 'PAYMENT_INPUT' });
  });
});
