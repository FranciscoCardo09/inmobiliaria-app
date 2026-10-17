const test = require('node:test');
const assert = require('node:assert');
const { extractPages } = require('../../src/services/consorcio/pdfText');
const { parseStatement, parseCounterparty, parseDate } = require('../../src/services/consorcio/statementParser');
const { layoutStatement, renderStatementPdf } = require('./helpers/statementPdf');
const julio = require('./fixtures/julio2026.json');

const clone = (x) => JSON.parse(JSON.stringify(x));

async function parseLayout(layout, opts) {
  return parseStatement(await extractPages(await renderStatementPdf(layout, opts)));
}

async function rejectsWith(layout, code, opts) {
  await assert.rejects(parseLayout(layout, opts), (e) => {
    assert.strictEqual(e.code, code, e.message);
    return true;
  });
}

// Extracto chico para probar casos puntuales.
function smallSpec(movements) {
  return {
    header: clone(julio.header),
    opening: { date: '01/07/2026', cents: 100000 },
    movements: movements || [
      { date: '02/07/2026', voucher: '5001', concept: '580', desc: 'CREDITO POR COBRO QR CON TRANSF. DIST. TIT.', cents: 50000 },
      { date: '02/07/2026', voucher: null, concept: '148', desc: 'IMPUESTO LEY 25413', cents: -300 },
      { date: '03/07/2026', voucher: '91872', concept: '190', desc: ['TRANSF.INTERB.DISTINTO TIT. 20111111112', 'PROVEEDOR MATERIALES'], cents: -20000 },
    ],
  };
}

// ─────────── Casos que tienen que andar ───────────

test('julio 2026 (sintético): lee los 101 movimientos y cuadra al centavo', async () => {
  const st = await parseLayout(layoutStatement(julio));
  assert.strictEqual(st.movements.length, 101);
  assert.strictEqual(st.movements.filter((m) => m.amountCents > 0).length, 18);
  assert.strictEqual(st.movements.filter((m) => m.amountCents < 0).length, 83);
  assert.strictEqual(st.openingBalanceCents, 486183133);
  assert.strictEqual(st.closingBalanceCents, 455828889);
  assert.deepStrictEqual(st.period, { from: '2026-07-01', to: '2026-07-31' });
  assert.strictEqual(st.cbu, '2470005610000009999990');
  assert.strictEqual(st.accountName, 'EDIFICIO DE PRUEBA 123');
  assert.strictEqual(st.holderName, 'TITULAR DE PRUEBA');
  assert.strictEqual(st.holderCuit, '27000000001');
  assert.strictEqual(st.accountNumber, '099999/9');
  assert.strictEqual(st.branch, 'Sucursal Prueba');

  const byConcept = {};
  for (const m of st.movements) byConcept[m.conceptCode] = (byConcept[m.conceptCode] || 0) + m.amountCents;
  assert.strictEqual(byConcept['580'], 232024100);
  assert.strictEqual(byConcept['190'], -302659029);
  const credits = st.movements.filter((m) => m.amountCents > 0).reduce((s, m) => s + m.amountCents, 0);
  assert.strictEqual(credits, 428213491); // "Gastos Comunes Junio - 26"
  const sum = st.movements.reduce((s, m) => s + m.amountCents, 0);
  assert.strictEqual(st.openingBalanceCents + sum, st.closingBalanceCents);
  assert.ok(st.dailyBalances.length >= 13);
});

test('descripción en dos renglones (arriba y abajo del monto) se une, con CUIT y contraparte', async () => {
  const st = await parseLayout(layoutStatement(julio));
  const limpieza = st.movements.find((m) => m.cuit === '23444444445');
  assert.strictEqual(limpieza.description, 'TRANSF.INTERB.DISTINTO TIT. 23444444445 LIMPIEZA SERVICIOS INTEGRALES');
  assert.strictEqual(limpieza.counterparty, 'LIMPIEZA SERVICIOS INTEGRALES');
  assert.strictEqual(limpieza.amountCents, -90000000);
  assert.strictEqual(limpieza.ownAccount, false);
  const propia = st.movements.find((m) => m.amountCents === -50000000);
  assert.strictEqual(propia.ownAccount, true);
  assert.strictEqual(propia.conceptCode, '172');
  // las descripciones partidas se pegan bien también en las hojas 2 y 3
  for (const page of [2, 3]) {
    const mv = st.movements.find((m) => m.page === page && m.cuit);
    assert.ok(mv.counterparty, `hoja ${page}`);
  }
});

test('movimientos sin comprobante y con comprobante', async () => {
  const st = await parseLayout(layoutStatement(smallSpec()));
  assert.strictEqual(st.movements[0].voucher, '5001');
  assert.strictEqual(st.movements[1].voucher, null);
  assert.strictEqual(st.movements[1].conceptCode, '148');
  assert.strictEqual(st.movements[1].cuit, null);
  assert.strictEqual(st.closingBalanceCents, 129700);
});

test('mes sin movimientos: saldo final = inicial (con y sin "Saldo al")', async () => {
  const st = await parseLayout(layoutStatement(smallSpec([])));
  assert.strictEqual(st.movements.length, 0);
  assert.strictEqual(st.closingBalanceCents, 100000);
  const layout = layoutStatement(smallSpec([]));
  layout.pages[0] = layout.pages[0].filter((r) => r.kind !== 'daily');
  const st2 = await parseLayout(layout);
  assert.strictEqual(st2.closingBalanceCents, 100000);
});

test('movimientos idénticos tienen huellas distintas', async () => {
  const mv = { date: '02/07/2026', voucher: null, concept: '130', desc: 'I.V.A.', cents: -100 };
  const st = await parseLayout(layoutStatement(smallSpec([mv, mv])));
  assert.notStrictEqual(st.movements[0].fingerprint, st.movements[1].fingerprint);
  assert.ok(st.movements[1].fingerprint.endsWith('#2'));
});

test('descripción de un renglón arriba del monto', async () => {
  const layout = layoutStatement(smallSpec([
    { date: '02/07/2026', voucher: '1', concept: '190', desc: ['A LA PRIMERA'], cents: -100 },
    { date: '02/07/2026', voucher: '2', concept: '190', desc: ['A LA SEGUNDA'], cents: -100 },
  ]));
  const st = await parseLayout(layout);
  assert.strictEqual(st.movements[0].description, 'A LA PRIMERA');
  assert.strictEqual(st.movements[1].description, 'A LA SEGUNDA');
});

test('una línea suelta entre dos movimientos va al más cercano (en los dos sentidos)', async () => {
  for (const [dy, expected] of [[-6.7, 1], [-7.5, 0]]) {
    const layout = layoutStatement(smallSpec([
      { date: '02/07/2026', voucher: '1', concept: '148', desc: '', cents: -100 },
      { date: '02/07/2026', voucher: '2', concept: '148', desc: '', cents: -100 },
    ]));
    // sin avanzar el renglón: queda entre el primero y el segundo, a menos de 9pt de ambos
    layout.pages[0].splice(3, 0, { kind: 'raw', dy, advance: 0, tokens: [{ text: 'NOTA', x: 236.9 }] });
    const st = await parseLayout(layout);
    assert.strictEqual(st.movements[expected].description, 'NOTA', `dy=${dy}`);
    assert.strictEqual(st.movements[1 - expected].description, '', `dy=${dy}`);
  }
});

test('una fecha dentro de la columna de descripción es texto, no un movimiento', async () => {
  const layout = layoutStatement(smallSpec([{ date: '02/07/2026', voucher: '1', concept: '190', desc: 'PAGO FACTURA', cents: -100 }]));
  layout.pages[0].splice(3, 0, { kind: 'raw', dy: -8, advance: 0, tokens: [{ text: '01/07/2026', x: 236.9 }, { text: 'VENCIDA', x: 300 }] });
  const st = await parseLayout(layout);
  assert.strictEqual(st.movements[0].description, 'PAGO FACTURA 01/07/2026 VENCIDA');
});

test('líneas extra del encabezado se ignoran', async () => {
  const st = await parseLayout(layoutStatement(smallSpec()), { extraPage1Lines: ['Moneda: Pesos'] });
  assert.strictEqual(st.accountName, 'EDIFICIO DE PRUEBA 123');
});

test('parseCounterparty', () => {
  assert.deepStrictEqual(parseCounterparty('TRANSF.INTERB.MISMO TIT. 27000000001 TITULAR'), { cuit: '27000000001', counterparty: 'TITULAR', ownAccount: true });
  assert.deepStrictEqual(parseCounterparty('TRANSF. 30555555556'), { cuit: '30555555556', counterparty: null, ownAccount: false });
  assert.deepStrictEqual(parseCounterparty('I.V.A.'), { cuit: null, counterparty: null, ownAccount: false });
});

test('parseDate valida fechas reales', () => {
  assert.strictEqual(parseDate('06/07/2026'), '2026-07-06');
  assert.throws(() => parseDate('31/02/2026', null), (e) => e.code === 'BAD_DATE');
  assert.throws(() => parseDate('15/13/2026', null), (e) => e.code === 'BAD_DATE');
  assert.throws(() => parseDate('2026-07-06', null), (e) => e.code === 'BAD_DATE');
});

// ─────────── Casos que tienen que fallar ───────────

test('sin páginas → NO_TEXT', () => {
  assert.throws(() => parseStatement([]), (e) => e.code === 'NO_TEXT');
  assert.throws(() => parseStatement(null), (e) => e.code === 'NO_TEXT');
});

test('sin título "Extracto de Cuenta" → NOT_A_STATEMENT', async () => {
  await rejectsWith(layoutStatement(smallSpec()), 'NOT_A_STATEMENT', { noTitle: true });
});

test('sin período → NOT_A_STATEMENT', async () => {
  const spec = smallSpec();
  spec.header.from = 'julio';
  await rejectsWith(layoutStatement(spec), 'NOT_A_STATEMENT');
});

test('período invertido → BAD_PERIOD', async () => {
  const spec = smallSpec();
  spec.header.from = '31/7/2026';
  spec.header.to = '1/7/2026';
  await rejectsWith(layoutStatement(spec), 'BAD_PERIOD');
});

test('período con fecha imposible → BAD_DATE', async () => {
  const spec = smallSpec();
  spec.header.to = '32/7/2026';
  await rejectsWith(layoutStatement(spec), 'BAD_DATE');
});

test('sin fila de títulos → NOT_A_STATEMENT', async () => {
  await rejectsWith(layoutStatement(smallSpec()), 'NOT_A_STATEMENT', { noHeaderRow: true });
});

test('sin CBU → MISSING_CBU', async () => {
  const spec = smallSpec();
  spec.header.cbu = null;
  await rejectsWith(layoutStatement(spec), 'MISSING_CBU');
});

test('falta el pie de una hoja → MISSING_PAGES', async () => {
  await rejectsWith(layoutStatement(julio), 'MISSING_PAGES', { omitFooterOn: [2] });
});

test('el pie dice más hojas de las que hay → MISSING_PAGES', async () => {
  await rejectsWith(layoutStatement(smallSpec()), 'MISSING_PAGES', { footerTotal: 3 });
});

test('sin "Saldo Al Inicio" → MISSING_OPENING_BALANCE (con y sin movimientos)', async () => {
  const layout = layoutStatement(smallSpec());
  layout.pages[0].shift();
  await rejectsWith(layout, 'MISSING_OPENING_BALANCE');
  const empty = layoutStatement(smallSpec([]));
  empty.pages[0] = [];
  await rejectsWith(empty, 'MISSING_OPENING_BALANCE');
});

test('"Saldo Al Inicio" repetido → UNRECOGNIZED_LINE', async () => {
  const layout = layoutStatement(smallSpec());
  layout.pages[0].push({ ...layout.pages[0][0] });
  await rejectsWith(layout, 'UNRECOGNIZED_LINE');
});

test('saldo diario que no cuadra → DAILY_BALANCE_MISMATCH con el detalle', async () => {
  const layout = layoutStatement(smallSpec());
  const daily = layout.pages[0].find((r) => r.kind === 'daily' && r.date === '02/07/2026');
  daily.cents += 1;
  await assert.rejects(parseLayout(layout), (e) => {
    assert.strictEqual(e.code, 'DAILY_BALANCE_MISMATCH');
    assert.strictEqual(e.details.printedCents - e.details.computedCents, 1);
    assert.match(e.message, /02\/07\/2026/);
    return true;
  });
});

test('falta un renglón (se lo "comió" el PDF) → DAILY_BALANCE_MISMATCH', async () => {
  const layout = layoutStatement(julio);
  const idx = layout.pages[0].findIndex((r) => r.kind === 'movement' && r.concept === '130');
  layout.pages[0].splice(idx, 1);
  await rejectsWith(layout, 'DAILY_BALANCE_MISMATCH');
});

test('sin saldo final después del último movimiento → MISSING_CLOSING_BALANCE', async () => {
  const layout = layoutStatement(smallSpec());
  layout.pages[0].pop();
  await rejectsWith(layout, 'MISSING_CLOSING_BALANCE');
});

test('movimiento fuera del período → DATE_OUT_OF_PERIOD', async () => {
  const spec = smallSpec([{ date: '01/08/2026', voucher: '1', concept: '580', desc: 'CREDITO', cents: 100 }]);
  await rejectsWith(layoutStatement(spec), 'DATE_OUT_OF_PERIOD');
});

test('fecha imposible en un movimiento → BAD_DATE', async () => {
  const spec = smallSpec([{ date: '31/06/2026', voucher: '1', concept: '580', desc: 'CREDITO', cents: 100 }]);
  await rejectsWith(layoutStatement(spec), 'BAD_DATE');
});

test('importe ilegible en movimiento / saldo inicial / saldo diario → BAD_AMOUNT', async () => {
  const mv = layoutStatement(smallSpec());
  mv.pages[0].find((r) => r.kind === 'movement').amountText = '$ 500,0';
  await rejectsWith(mv, 'BAD_AMOUNT');

  const op = layoutStatement(smallSpec());
  op.pages[0][0] = { kind: 'raw', tokens: [{ text: '01/07/2026', x: 31.1 }, { text: 'Saldo Al Inicio', x: 236.9 }, { text: '$ 1.0,00', x: 520 }] };
  await rejectsWith(op, 'BAD_AMOUNT');

  const daily = layoutStatement(smallSpec());
  const i = daily.pages[0].findIndex((r) => r.kind === 'daily');
  daily.pages[0][i] = { kind: 'raw', tokens: [{ text: 'Saldo al', x: 343 }, { text: '02/07/2026', x: 384.4 }, { text: '$ 12', x: 520 }] };
  await rejectsWith(daily, 'BAD_AMOUNT');
});

test('renglones que no se entienden → UNRECOGNIZED_LINE (no se saltean)', async () => {
  const cases = [
    // movimiento sin código de concepto
    [{ text: '02/07/2026', x: 31.1 }, { text: 'SIN CODIGO', x: 236.9 }, { text: '-$ 1,00', x: 530 }],
    // tres códigos numéricos
    [{ text: '02/07/2026', x: 31.1 }, { text: '11', x: 110 }, { text: '22', x: 150 }, { text: '190', x: 194.8 }, { text: 'X', x: 236.9 }, { text: '-$ 1,00', x: 530 }],
    // texto en la columna de códigos
    [{ text: '02/07/2026', x: 31.1 }, { text: '190', x: 194.8 }, { text: 'RARO', x: 200 }, { text: '-$ 1,00', x: 530 }],
    // texto suelto a la izquierda
    [{ text: 'TEXTO RARO', x: 50 }],
    // texto suelto en la columna de importe
    [{ text: 'XYZ', x: 530 }],
    // fecha + importe sin nada más
    [{ text: '02/07/2026', x: 31.1 }, { text: '-$ 1,00', x: 530 }],
    // importe suelto sin fecha
    [{ text: 'ALGO', x: 236.9 }, { text: '-$ 1,00', x: 530 }],
  ];
  for (const tokens of cases) {
    const layout = layoutStatement(smallSpec());
    layout.pages[0].splice(1, 0, { kind: 'raw', tokens });
    await rejectsWith(layout, 'UNRECOGNIZED_LINE');
  }
});

test('descripción que no corresponde a ningún movimiento → ORPHAN_DESCRIPTION', async () => {
  const layout = layoutStatement(smallSpec());
  const i = layout.pages[0].findIndex((r) => r.kind === 'daily');
  layout.pages[0].splice(i + 1, 0, { kind: 'raw', tokens: [{ text: 'TEXTO HUERFANO', x: 236.9 }] }, { kind: 'raw', tokens: [{ text: 'OTRO', x: 236.9 }] });
  await rejectsWith(layout, 'ORPHAN_DESCRIPTION');
});
