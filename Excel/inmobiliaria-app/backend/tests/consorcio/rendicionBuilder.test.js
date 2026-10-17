const test = require('node:test');
const assert = require('node:assert');
const { buildRendicion, lineKey } = require('../../src/services/consorcio/rendicionBuilder');
const { classifyAll } = require('../../src/services/consorcio/classifier');
const { reportRows } = require('../../src/services/consorcio/reportRows');
const { extractPages } = require('../../src/services/consorcio/pdfText');
const { parseStatement } = require('../../src/services/consorcio/statementParser');
const { layoutStatement, renderStatementPdf } = require('./helpers/statementPdf');
const J = require('./helpers/julio');
const julio = require('./fixtures/julio2026.json');

const rubros = J.pureRubros();

async function julioMovements() {
  const st = parseStatement(await extractPages(await renderStatementPdf(layoutStatement(julio))));
  const classified = classifyAll(st.movements.map((m) => ({ ...m, id: `m${m.index}` })), J.pureRules(), rubros);
  const movements = classified.map((m) => {
    if (m.status !== 'PENDIENTE') return m;
    if (m.cuit === J.CUIT.excluida) return { ...m, status: 'EXCLUIDO', note: J.EXCLUDED_NOTE };
    const [n, label] = J.MANUAL[-m.amountCents];
    return { ...m, status: 'MANUAL', rubroId: `r${n}`, itemLabel: label };
  });
  return { st, movements };
}

function julioInput(movements, st, over = {}) {
  return {
    title: 'Portal del Hierro , Torre I', year: 2026, month: 7, rubros, movements,
    adjustments: J.ADJUSTMENTS.map((a, i) => ({ id: `a${i}`, kind: a.kind, rubroId: `r${a.rubro}`, itemLabel: a.itemLabel, amountCents: a.amountCents, note: a.note })),
    reserve: { cents: J.RESERVE_CENTS, source: 'INICIAL' },
    lineOrder: [lineKey('r5', J.L.ascensor)],
    bankClosingCents: st.closingBalanceCents,
    ...over,
  };
}

test('julio 2026: reproduce exacto el informe hecho a mano', async () => {
  const { st, movements } = await julioMovements();
  const report = buildRendicion(julioInput(movements, st));
  assert.deepStrictEqual(report.blockers, []);
  assert.strictEqual(report.canGenerate, true);
  assert.deepStrictEqual(reportRows(report).map((r) => [r.type, r.text, r.amount].filter(Boolean)), J.EXPECTED_ROWS);
  assert.strictEqual(report.totals.totalCajaCents, 453313398);
  assert.strictEqual(report.totals.ingresosCents, 428213491);
  assert.strictEqual(report.totals.reserveCents, 457207857);
  assert.strictEqual(report.totals.reserveSource, 'INICIAL');

  // control contra el banco: $ 25.154,91 de diferencia (lo excluido + ajustes)
  assert.strictEqual(report.control.differenceCents, 2515491);
  assert.strictEqual(report.control.excludedCents, -27815100);
  assert.ok(report.warnings.some((w) => w.code === 'BANK_DIFFERENCE'));
  assert.strictEqual(report.excluded.length, 1);
  assert.strictEqual(report.excluded[0].note, J.EXCLUDED_NOTE);
});

test('cada línea explica de qué movimientos sale y qué ajuste tiene', async () => {
  const { st, movements } = await julioMovements();
  const report = buildRendicion(julioInput(movements, st));
  const lines = report.sections.flatMap((s) => s.lines);
  const vigilancia = lines.find((l) => l.label === '" Torres Gabriel "');
  assert.strictEqual(vigilancia.sources.length, 2);
  assert.ok(vigilancia.sources.every((s) => s.status === 'REGLA'));
  const materiales = lines.find((l) => l.template === J.L.materiales);
  assert.strictEqual(materiales.sources.length, 5); // 4 al proveedor + 1 a cuenta propia
  assert.strictEqual(materiales.finalCents, 6593769);
  const bancarios = lines.find((l) => l.template === J.L.bancarios);
  assert.deepStrictEqual(bancarios.adjustment, { adjustmentId: 'a2', fromCents: 12408706, toCents: 13763987, differenceCents: 1355281, note: 'Incluye gastos bancarios de junio' });
  const reserva = lines.find((l) => l.isReserve);
  assert.strictEqual(reserva.label, 'Reserva Caja');
});

test('sin orden guardado las líneas siguen el orden del extracto', async () => {
  const { st, movements } = await julioMovements();
  const report = buildRendicion(julioInput(movements, st, { lineOrder: null }));
  const s5 = report.sections.find((s) => s.rubro.number === 5);
  assert.deepStrictEqual(s5.lines.map((l) => l.label), [J.L.materiales, J.L.ascensor]);
});

const rid = (n) => `r${n}`;
const base = (over = {}) => ({
  title: 'T', year: 2026, month: 7, rubros,
  movements: [
    { id: 'c1', amountCents: 10000, status: 'AUTO', rubroId: rid(1), itemLabel: 'Gastos Comunes {mesAnterior}', date: '2026-07-02', description: 'QR' },
    { id: 'd1', amountCents: -3000, status: 'MANUAL', rubroId: rid(2), itemLabel: 'Limpieza', date: '2026-07-03', description: 'T' },
  ],
  reserve: { cents: 500, source: 'ANTERIOR' },
  ...over,
});

test('totales: reserva + ingresos − egresos', () => {
  const r = buildRendicion(base());
  assert.strictEqual(r.totals.totalCajaCents, 500 + 10000 - 3000);
  assert.strictEqual(r.control.bankClosingCents, null);
  assert.strictEqual(r.control.differenceCents, null);
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(r.total, { number: 11, label: 'TOTAL CAJA' });
});

test('un crédito en un rubro de egresos lo resta (reintegro) y una línea negativa avisa', () => {
  const r = buildRendicion(base({
    movements: [{ id: 'x', amountCents: 2000, status: 'MANUAL', rubroId: rid(4), itemLabel: 'Reintegro', date: '2026-07-01', description: 'R' }],
  }));
  assert.strictEqual(r.totals.egresosCents, -2000);
  assert.ok(r.warnings.some((w) => w.code === 'NEGATIVE_LINE'));
});

test('sin texto de ítem usa el texto automático del rubro o su nombre', () => {
  const r = buildRendicion(base({
    movements: [
      { id: 'a', amountCents: 100, status: 'AUTO', rubroId: rid(1), itemLabel: null, date: 'x', description: '' },
      { id: 'b', amountCents: -100, status: 'MANUAL', rubroId: rid(3), itemLabel: null, date: 'x', description: '' },
    ],
  }));
  const labels = r.sections.flatMap((s) => s.lines.map((l) => l.label));
  assert.deepStrictEqual(labels, ['Gastos Comunes Junio - 26', 'Servicio de Vigilancia', 'Reserva Caja']);
});

test('bloqueos: pendientes, excluidos sin nota, rubro inexistente', () => {
  const r = buildRendicion(base({
    movements: [
      { id: 'p', amountCents: -1, status: 'PENDIENTE', date: 'x', description: '' },
      { id: 'e', amountCents: -1, status: 'EXCLUIDO', note: '  ', date: 'x', description: '' },
      { id: 'e2', amountCents: -1, status: 'EXCLUIDO', date: 'x', description: '' },
      { id: 'u', amountCents: -1, status: 'MANUAL', rubroId: 'no-existe', itemLabel: 'X', date: 'x', description: '' },
    ],
  }));
  const codes = r.blockers.map((b) => b.code);
  assert.deepStrictEqual(codes, ['PENDING_MOVEMENTS', 'EXCLUDED_WITHOUT_NOTE', 'UNKNOWN_RUBRO']);
  assert.deepStrictEqual(r.blockers[0].movementIds, ['p']);
  assert.deepStrictEqual(r.blockers[1].movementIds, ['e', 'e2']);
  assert.strictEqual(r.canGenerate, false);
  assert.throws(() => reportRows(r), (e) => e.code === 'REPORT_BLOCKED' && e.status === 409);
  assert.strictEqual(r.excluded[1].note, null);
});

test('reserva: falta (con y sin motivo), sin rubro para mostrarla', () => {
  assert.match(buildRendicion(base({ reserve: null })).blockers[0].message, /Falta la Reserva Caja/);
  assert.strictEqual(buildRendicion(base({ reserve: null })).totals.reserveSource, null);
  assert.strictEqual(buildRendicion(base({ reserve: { cents: null, reason: 'Motivo X' } })).blockers[0].message, 'Motivo X');
  const sinRol = rubros.map((r) => ({ ...r, role: r.role === 'RESERVA' ? null : r.role }));
  assert.strictEqual(buildRendicion(base({ rubros: sinRol })).blockers[0].code, 'MISSING_RESERVE_RUBRO');
  assert.strictEqual(buildRendicion(base({ reserve: { cents: 0 } })).totals.reserveSource, null);
});

test('líneas manuales: se suman a su línea, con nota y monto > 0', () => {
  const ok = buildRendicion(base({
    adjustments: [
      { id: 'm1', kind: 'MANUAL', rubroId: rid(7), itemLabel: 'Caja chica', amountCents: 1500, note: 'Pago en efectivo' },
      { id: 'm2', kind: 'MANUAL', rubroId: rid(2), itemLabel: 'limpieza', amountCents: 500, note: 'Complemento' },
    ],
  }));
  const lines = ok.sections.flatMap((s) => s.lines);
  assert.strictEqual(lines.find((l) => l.label === 'Caja chica').finalCents, 1500);
  const limpieza = lines.find((l) => l.label === 'Limpieza');
  assert.strictEqual(limpieza.finalCents, 3500);
  assert.strictEqual(limpieza.manualSources[0].adjustmentId, 'm2');
  assert.deepStrictEqual(ok.blockers, []);

  const bad = buildRendicion(base({
    adjustments: [
      { id: 'x1', kind: 'MANUAL', rubroId: rid(7), itemLabel: 'Sin nota', amountCents: 100, note: '' },
      { id: 'x2', kind: 'MANUAL', rubroId: rid(7), itemLabel: 'Cero', amountCents: 0, note: 'n' },
      { id: 'x3', kind: 'MANUAL', rubroId: 'otro', itemLabel: 'Otro consorcio', amountCents: 100, note: 'n' },
      { id: 'x4', kind: 'MANUAL', rubroId: rid(7), itemLabel: 'Sin nota null', amountCents: -5, note: null },
    ],
  }));
  assert.deepStrictEqual(bad.blockers.map((b) => [b.code, b.adjustmentId]), [
    ['ADJUSTMENT_WITHOUT_NOTE', 'x1'], ['BAD_MANUAL_AMOUNT', 'x2'], ['UNKNOWN_RUBRO', 'x3'],
    ['ADJUSTMENT_WITHOUT_NOTE', 'x4'], ['BAD_MANUAL_AMOUNT', 'x4'],
  ]);
});

test('ajustes de monto: cambian el final; huérfano, duplicado, sin nota o negativo bloquean', () => {
  const ok = buildRendicion(base({ adjustments: [{ id: 'j', kind: 'AJUSTE', rubroId: rid(2), itemLabel: 'LIMPIEZA', amountCents: 3100, note: 'según factura' }] }));
  const limpieza = ok.sections[1].lines[0];
  assert.strictEqual(limpieza.computedCents, 3000);
  assert.strictEqual(limpieza.finalCents, 3100);
  assert.strictEqual(ok.totals.egresosCents, 3100);

  const bad = buildRendicion(base({
    adjustments: [
      { id: 'o', kind: 'AJUSTE', rubroId: rid(4), itemLabel: 'No existe', amountCents: 1, note: 'n' },
      { id: 'd1', kind: 'AJUSTE', rubroId: rid(2), itemLabel: 'Limpieza', amountCents: 1, note: ' ' },
      { id: 'd2', kind: 'AJUSTE', rubroId: rid(2), itemLabel: 'Limpieza', amountCents: 2, note: 'n' },
      { id: 'n', kind: 'AJUSTE', rubroId: rid(1), itemLabel: 'Gastos Comunes {mesAnterior}', amountCents: -1, note: null },
    ],
  }));
  assert.deepStrictEqual(bad.blockers.map((b) => [b.code, b.adjustmentId]), [
    ['ORPHAN_ADJUSTMENT', 'o'], ['ADJUSTMENT_WITHOUT_NOTE', 'd1'], ['DUPLICATE_ADJUSTMENT', 'd2'],
    ['ADJUSTMENT_WITHOUT_NOTE', 'n'], ['BAD_ADJUSTMENT_AMOUNT', 'n'],
  ]);
});

test('variables mal escritas en un texto bloquean en vez de romper', () => {
  const r = buildRendicion(base({
    movements: [{ id: 'z', amountCents: -1, status: 'MANUAL', rubroId: rid(2), itemLabel: 'Pago {mesPasado}', date: 'x', description: '' }],
  }));
  assert.strictEqual(r.blockers[0].code, 'BAD_LABEL_VARIABLE');
  assert.strictEqual(r.sections[1].lines[0].label, 'Pago {mesPasado}');
});

test('orden guardado: lo conocido primero, lo nuevo después en orden del extracto', () => {
  const movements = [
    { id: '1', amountCents: -1, status: 'MANUAL', rubroId: rid(5), itemLabel: 'A', date: 'x', description: '' },
    { id: '2', amountCents: -1, status: 'MANUAL', rubroId: rid(5), itemLabel: 'B', date: 'x', description: '' },
    { id: '3', amountCents: -1, status: 'MANUAL', rubroId: rid(5), itemLabel: 'C', date: 'x', description: '' },
    { id: '4', amountCents: -1, status: 'MANUAL', rubroId: rid(5), itemLabel: 'D', date: 'x', description: '' },
  ];
  const r = buildRendicion(base({ movements, lineOrder: [lineKey(rid(5), 'C'), lineKey(rid(5), 'A')] }));
  assert.deepStrictEqual(r.sections[4].lines.map((l) => l.label), ['C', 'A', 'B', 'D']);
});

test('consorcio sin rubros', () => {
  const r = buildRendicion(base({ rubros: [], movements: [] }));
  assert.deepStrictEqual(r.total, { number: 1, label: 'TOTAL CAJA' });
  assert.strictEqual(r.blockers[0].code, 'MISSING_RESERVE_RUBRO');
});
