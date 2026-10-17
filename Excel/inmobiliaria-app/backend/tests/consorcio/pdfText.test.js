const test = require('node:test');
const assert = require('node:assert');
const PDFDocument = require('pdfkit');
const { extractPages, groupLines, isPdfBuffer } = require('../../src/services/consorcio/pdfText');

function pdf(draw, opts = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', ...opts });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    draw(doc);
    doc.end();
  });
}

test('isPdfBuffer', () => {
  assert.strictEqual(isPdfBuffer(Buffer.from('%PDF-1.7 ...')), true);
  assert.strictEqual(isPdfBuffer(Buffer.from('hola mundo')), false);
  assert.strictEqual(isPdfBuffer(Buffer.from('%PDF')), false);
  assert.strictEqual(isPdfBuffer('%PDF-1.7'), false);
});

test('groupLines: agrupa por renglón, ordena por x y fusiona fragmentos pegados', () => {
  const lines = groupLines([
    { str: 'B', x: 100, y: 500, width: 10 },
    { str: 'A', x: 10, y: 501, width: 20 },
    { str: '  ', x: 40, y: 500, width: 5 },
    { str: 'CD', x: 110.5, y: 500, width: 10 },
    { str: 'abajo', x: 10, y: 480, width: 30 },
  ]);
  assert.deepStrictEqual(lines.map((l) => l.tokens.map((t) => t.text)), [['A', 'BCD'], ['abajo']]);
  assert.strictEqual(lines[0].tokens[1].width, 20.5);
});

test('extractPages: no es PDF', async () => {
  await assert.rejects(extractPages(Buffer.from('esto no es un pdf')), (e) => e.code === 'NOT_PDF');
});

test('extractPages: PDF dañado', async () => {
  await assert.rejects(extractPages(Buffer.from('%PDF-1.4\nbasura sin estructura')), (e) => e.code === 'PDF_UNREADABLE');
});

test('extractPages: PDF con contraseña', async () => {
  const buf = await pdf((d) => d.text('secreto'), { userPassword: 'clave', ownerPassword: 'otra' });
  await assert.rejects(extractPages(buf), (e) => e.code === 'PDF_ENCRYPTED');
});

test('extractPages: PDF sin texto (escaneado)', async () => {
  const buf = await pdf((d) => d.rect(50, 50, 100, 100).fill('#000'));
  await assert.rejects(extractPages(buf), (e) => e.code === 'NO_TEXT');
});

test('extractPages: devuelve renglones por página', async () => {
  const buf = await pdf((d) => {
    d.text('Primera', 50, 50);
    d.addPage();
    d.text('Segunda', 50, 50);
  });
  const pages = await extractPages(buf);
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[1].number, 2);
  assert.strictEqual(pages[1].lines[0].tokens[0].text, 'Segunda');
});
