const test = require('node:test');
const assert = require('node:assert');
const { parseBulkSelection } = require('../src/controllers/debtsController');

// Selección de "Pagar varios": Deudas (`debtIds`) y meses sin cerrar (`pendingRecordIds`, ver
// services/unclosedMonths.js). Antes exigía al menos una Deuda: un mes sin cerrar solo no se
// podía cobrar por acá.

test('acepta sólo deudas, sólo meses sin cerrar, o los dos', () => {
  assert.deepStrictEqual(parseBulkSelection({ debtIds: ['d1'] }), { debtIds: ['d1'], pendingRecordIds: [] });
  assert.deepStrictEqual(parseBulkSelection({ pendingRecordIds: ['r1'] }), { debtIds: [], pendingRecordIds: ['r1'] });
  assert.deepStrictEqual(
    parseBulkSelection({ debtIds: ['d1'], pendingRecordIds: ['r1'] }),
    { debtIds: ['d1'], pendingRecordIds: ['r1'] },
  );
});

test('rechaza una selección vacía', () => {
  assert.deepStrictEqual(parseBulkSelection({}), { error: 'Debe seleccionar al menos una deuda' });
  assert.deepStrictEqual(parseBulkSelection({ debtIds: [], pendingRecordIds: [] }), { error: 'Debe seleccionar al menos una deuda' });
});

test('rechaza formas inválidas', () => {
  for (const body of [
    { debtIds: 'd1' },
    { debtIds: [1] },
    { debtIds: [''] },
    { pendingRecordIds: {} },
    { debtIds: ['d1'], pendingRecordIds: [null] },
  ]) {
    assert.deepStrictEqual(parseBulkSelection(body), { error: 'Selección inválida' }, JSON.stringify(body));
  }
});
