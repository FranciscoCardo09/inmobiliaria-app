// Prueba contra un extracto REAL (no se sube al repo por tener datos personales).
// Correr con:  CONSORCIO_REAL_PDF="/ruta/Extracto Julio - 26.pdf" npm run test:consorcio
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { extractPages } = require('../../src/services/consorcio/pdfText');
const { parseStatement } = require('../../src/services/consorcio/statementParser');

const file = process.env.CONSORCIO_REAL_PDF;

test('extracto real de julio 2026', { skip: !file && 'definí CONSORCIO_REAL_PDF para correrlo' }, async () => {
  const st = parseStatement(await extractPages(fs.readFileSync(file)));
  assert.strictEqual(st.movements.length, 101);
  assert.strictEqual(st.openingBalanceCents, 486183133);
  assert.strictEqual(st.closingBalanceCents, 455828889);
  const credits = st.movements.filter((m) => m.amountCents > 0).reduce((s, m) => s + m.amountCents, 0);
  assert.strictEqual(credits, 428213491);
  assert.strictEqual(st.movements.filter((m) => m.cuit).length, 20);
});
