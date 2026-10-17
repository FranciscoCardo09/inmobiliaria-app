// Tests de la lógica pura de la pantalla de Consorcios. Correr con: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMoney, parseMoneyInput, countByStatus, filterMovements, formatDate, movementWho,
  renderLabelPreview, itemLabelOptions, moveLine, blockerSummary, bulkItems, stripDataUrl, STATUS_INFO, monthName,
} from './consorcio.js'

test('formatMoney', () => {
  assert.equal(formatMoney(428213491), '$ 4.282.134,91')
  assert.equal(formatMoney(5), '$ 0,05')
  assert.equal(formatMoney(-2515491), '-$ 25.154,91')
  assert.equal(formatMoney(null), '—')
  assert.equal(formatMoney(undefined), '—')
})

test('parseMoneyInput: lo que escribe el usuario', () => {
  assert.equal(parseMoneyInput('4.282.134,91'), 428213491)
  assert.equal(parseMoneyInput('$ 137.639,87'), 13763987)
  assert.equal(parseMoneyInput('4282134,91'), 428213491)
  assert.equal(parseMoneyInput('8392'), 839200)
  assert.equal(parseMoneyInput('1.500'), 150000)
  assert.equal(parseMoneyInput('1500.5'), 150050)
  assert.equal(parseMoneyInput('1500,5'), 150050)
  assert.equal(parseMoneyInput('-1.000,00'), -100000)
})

test('parseMoneyInput: rechaza lo ambiguo o inválido', () => {
  for (const bad of ['', null, 'abc', '1,2,3', '1.50.0', '12.34.5', '1,234', '10.0000', '1.5,00', '99999999999999999,00', ',50', '1,234.5']) {
    assert.equal(parseMoneyInput(bad), null, String(bad))
  }
})

const MOVS = [
  { id: '1', status: 'PENDIENTE', description: 'TRANSF. 27777777778 VIGILANCIA PRIVADA', cuit: '27777777778', counterparty: 'VIGILANCIA PRIVADA', conceptCode: '190', amountCents: -54120000 },
  { id: '2', status: 'AUTO', description: 'IMPUESTO LEY 25413', cuit: null, counterparty: null, conceptCode: '148', amountCents: -300 },
  { id: '3', status: 'EXCLUIDO', description: 'TRANSF. 27222222223 PERSONA', cuit: '27222222223', counterparty: 'PERSONA', conceptCode: '190', amountCents: -100 },
  { id: '4', status: 'MANUAL', description: 'JARDINERÍA', cuit: null, counterparty: 'JARDINERÍA', conceptCode: '190', amountCents: -100 },
]

test('countByStatus', () => {
  assert.deepEqual(countByStatus(MOVS), { PENDIENTE: 1, AUTO: 1, REGLA: 0, MANUAL: 1, EXCLUIDO: 1 })
  assert.deepEqual(countByStatus([{ status: 'NUEVO' }]).NUEVO, 1)
  assert.ok(Object.keys(STATUS_INFO).every((k) => STATUS_INFO[k].help))
})

test('filterMovements por filtro y búsqueda (sin acentos)', () => {
  const ids = (f, q) => filterMovements(MOVS, f, q).map((m) => m.id)
  assert.deepEqual(ids('PENDIENTES'), ['1'])
  assert.deepEqual(ids('TRANSFERENCIAS'), ['1', '3'])
  assert.deepEqual(ids('EXCLUIDOS'), ['3'])
  assert.deepEqual(ids('TODOS'), ['1', '2', '3', '4'])
  assert.deepEqual(ids('TODOS', 'vigilancia'), ['1'])
  assert.deepEqual(ids('TODOS', 'jardineria'), ['4'])
  assert.deepEqual(ids('TODOS', '541.200'), ['1'])
  assert.deepEqual(ids('TODOS', '148'), ['2'])
  assert.deepEqual(ids('TODOS', '   '), ['1', '2', '3', '4'])
  assert.deepEqual(ids('TODOS', null), ['1', '2', '3', '4'])
})

test('formatDate, movementWho, monthName', () => {
  assert.equal(formatDate('2026-07-06'), '06/07/2026')
  assert.equal(movementWho(MOVS[0]), 'VIGILANCIA PRIVADA (CUIT 27777777778)')
  assert.equal(movementWho(MOVS[1]), 'IMPUESTO LEY 25413')
  assert.equal(movementWho(MOVS[3]), 'JARDINERÍA')
  assert.equal(monthName(7), 'Julio')
})

test('renderLabelPreview: igual que el backend, avisa variables desconocidas', () => {
  assert.deepEqual(renderLabelPreview('Gastos Comunes {mesAnterior}', 2026, 7), { text: 'Gastos Comunes Junio - 26', unknown: [] })
  assert.deepEqual(renderLabelPreview('{mes} {periodo} {periodoAnterior}', 2027, 1), { text: 'Enero - 27 01/2027 12/2026', unknown: [] })
  assert.deepEqual(renderLabelPreview('Pago {mesPasado}', 2026, 7), { text: 'Pago {mesPasado}', unknown: ['mesPasado'] })
  assert.deepEqual(renderLabelPreview(null, 2026, 7), { text: '', unknown: [] })
})

const REPORT = {
  canGenerate: false,
  blockers: [{ message: 'Faltan clasificar 2 movimiento(s).' }],
  sections: [
    { rubro: { id: 'r5' }, lines: [{ key: 'r5::a', template: 'A' }, { key: 'r5::b', template: 'B' }, { key: 'r5::c', template: 'B' }] },
    { rubro: { id: 'r9' }, lines: [{ key: 'r9::__reserva__', template: '__reserva__', isReserve: true }, { key: 'r9::e', template: 'Espejo' }] },
  ],
}

test('itemLabelOptions: textos usados en el rubro, sin repetir ni la reserva', () => {
  assert.deepEqual(itemLabelOptions(REPORT, 'r5'), ['A', 'B'])
  assert.deepEqual(itemLabelOptions(REPORT, 'r9'), ['Espejo'])
  assert.deepEqual(itemLabelOptions(REPORT, 'zz'), [])
  assert.deepEqual(itemLabelOptions(null, 'r5'), [])
})

test('moveLine: sube/baja dentro del rubro; en los bordes no cambia', () => {
  assert.deepEqual(moveLine(REPORT, 'r5::b', 'up'), ['r9::__reserva__', 'r9::e', 'r5::b', 'r5::a', 'r5::c'])
  assert.deepEqual(moveLine(REPORT, 'r5::b', 'down'), ['r9::__reserva__', 'r9::e', 'r5::a', 'r5::c', 'r5::b'])
  const all = ['r5::a', 'r5::b', 'r5::c', 'r9::__reserva__', 'r9::e']
  assert.deepEqual(moveLine(REPORT, 'r5::a', 'up'), all)
  assert.deepEqual(moveLine(REPORT, 'r9::e', 'down'), all)
  assert.deepEqual(moveLine(REPORT, 'no-existe', 'up'), all)
})

test('blockerSummary', () => {
  assert.deepEqual(blockerSummary(REPORT), ['Faltan clasificar 2 movimiento(s).'])
  assert.deepEqual(blockerSummary({ canGenerate: true, blockers: [] }), [])
  assert.deepEqual(blockerSummary(null), [])
})

test('bulkItems', () => {
  assert.deepEqual(bulkItems(['a', 'b'], { action: 'ASIGNAR', rubroId: 'r1', itemLabel: 'X', remember: 'SIEMPRE' }), [
    { movementId: 'a', action: 'ASIGNAR', rubroId: 'r1', itemLabel: 'X', remember: 'SIEMPRE' },
    { movementId: 'b', action: 'ASIGNAR', rubroId: 'r1', itemLabel: 'X', remember: 'SIEMPRE' },
  ])
  assert.deepEqual(bulkItems(['a'], { action: 'ASIGNAR', rubroId: 'r1', itemLabel: 'X', note: 'n' }), [
    { movementId: 'a', action: 'ASIGNAR', rubroId: 'r1', itemLabel: 'X', remember: null, note: 'n' },
  ])
  assert.deepEqual(bulkItems(['a'], { action: 'EXCLUIR', note: 'no va' }), [{ movementId: 'a', action: 'EXCLUIR', note: 'no va' }])
  assert.deepEqual(bulkItems(['a'], { action: 'AUTO' }), [{ movementId: 'a', action: 'AUTO' }])
})

test('stripDataUrl', () => {
  assert.equal(stripDataUrl('data:application/pdf;base64,JVBERi0='), 'JVBERi0=')
  assert.equal(stripDataUrl('JVBERi0='), 'JVBERi0=')
})
