const test = require('node:test');
const assert = require('node:assert');
const { createPayment, updatePayment, deletePayment } = require('../src/controllers/paymentsController');

// C-07: los tres endpoints legacy de escritura deben quedar deshabilitados (410 Gone),
// sin tocar la DB. No usar un mock plano {status,json} que se devuelve a sí mismo — al
// hacer `await controller(...)` Node lo trataría como thenable y corrompe el resultado
// (ver memoria inmobiliaria-sim-harness). Acá no hace falta await sobre el valor de
// retorno del controller de todos modos: solo inspeccionamos `res` después.
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

test('C-07: POST /payments (createPayment) devuelve 410 Gone', async () => {
  const res = makeRes();
  await createPayment({ params: { groupId: 'g1' }, body: {} }, res, () => {});
  assert.strictEqual(res.statusCode, 410);
  assert.strictEqual(res.body.success, false);
});

test('C-07: PUT /payments/:id (updatePayment) devuelve 410 Gone', async () => {
  const res = makeRes();
  await updatePayment({ params: { groupId: 'g1', id: 'p1' }, body: {} }, res, () => {});
  assert.strictEqual(res.statusCode, 410);
  assert.strictEqual(res.body.success, false);
});

test('C-07: DELETE /payments/:id (deletePayment) devuelve 410 Gone', async () => {
  const res = makeRes();
  await deletePayment({ params: { groupId: 'g1', id: 'p1' } }, res, () => {});
  assert.strictEqual(res.statusCode, 410);
  assert.strictEqual(res.body.success, false);
});
