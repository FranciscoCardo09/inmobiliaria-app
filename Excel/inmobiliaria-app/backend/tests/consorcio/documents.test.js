const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { reportRows, decodeLogo, fileBaseName } = require('../../src/services/consorcio/reportRows');
const { generateRendicionDocx } = require('../../src/services/consorcio/rendicionDocx');
const { generateRendicionPdf } = require('../../src/services/consorcio/rendicionPdf');
const { extractPages } = require('../../src/services/consorcio/pdfText');
const { buildRendicion } = require('../../src/services/consorcio/rendicionBuilder');
const J = require('./helpers/julio');

const rubros = J.pureRubros();

// Un informe chico, armado por el builder real.
function report(over = {}) {
  return buildRendicion({
    title: 'Portal del Hierro , Torre I', year: 2026, month: 7, rubros,
    movements: [
      { id: 'c', amountCents: 428213491, status: 'AUTO', rubroId: 'r1', itemLabel: 'Gastos Comunes {mesAnterior}', date: 'x', description: '' },
      { id: 'l', amountCents: -90000000, status: 'REGLA', rubroId: 'r2', itemLabel: J.L.limpieza, date: 'x', description: '' },
    ],
    reserve: { cents: 457207857, source: 'INICIAL' },
    ...over,
  });
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('reportRows: formato del informe; los rubros vacíos no se imprimen', () => {
  const rows = reportRows(report());
  assert.deepStrictEqual(rows.map((r) => [r.type, r.text, r.amount].filter(Boolean)), [
    ['title', 'Portal del Hierro , Torre I'],
    ['subtitle', 'Rendición de cuentas mes de Julio de 2026'],
    ['heading', '01- Ingresos del periodo'],
    ['item', '- Gastos Comunes Junio - 26', '$ 4.282.134,91.-'],
    ['heading', '02- Servicio de Limpieza'],
    ['item', '- Limpieza espacios comunes y jardinería (Junio - 26)', '$ 900.000,00.-'],
    ['heading', '09- Fondo Común'],
    ['item', '- Reserva Caja', '$ 4.572.078,57.-'],
    ['total', '11- TOTAL CAJA', '$ 7.954.213,48.-'],
  ]);
});

test('reportRows: con bloqueos no genera y dice por qué', () => {
  assert.throws(() => reportRows(report({ reserve: null })), (e) => {
    assert.strictEqual(e.code, 'REPORT_BLOCKED');
    assert.match(e.message, /Reserva Caja/);
    assert.strictEqual(e.details.blockers.length, 1);
    return true;
  });
});

test('decodeLogo y nombre de archivo', () => {
  assert.strictEqual(decodeLogo(null), null);
  assert.strictEqual(decodeLogo('https://logo.png'), null);
  assert.strictEqual(decodeLogo(PNG_1PX).type, 'png');
  assert.strictEqual(decodeLogo('data:image/jpeg;base64,AAAA').type, 'jpg');
  assert.strictEqual(fileBaseName(report()), 'Rendicion_Portal_del_Hierro_Torre_I_2026-07');
});

async function docxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] === undefined ? '\t' : m[1])).join(''))
    .filter(Boolean);
}

test('Word: cada renglón del informe, en orden, con el importe tabulado', async () => {
  const buf = await generateRendicionDocx(report());
  assert.strictEqual(buf.subarray(0, 2).toString(), 'PK');
  const paragraphs = await docxText(buf);
  const expected = reportRows(report()).map((r) => (r.amount ? `${r.text}\t${r.amount}` : r.text));
  assert.deepStrictEqual(paragraphs, expected);
});

test('Word: con logo del grupo lo incluye', async () => {
  const zip = await JSZip.loadAsync(await generateRendicionDocx(report(), { logo: PNG_1PX }));
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')));
});

test('Word: con bloqueos no genera', async () => {
  await assert.rejects(generateRendicionDocx(report({ reserve: null })), (e) => e.code === 'REPORT_BLOCKED');
});

async function pdfLines(buffer) {
  const pages = await extractPages(buffer);
  return pages.flatMap((p) => p.lines.map((l) => l.tokens.map((t) => t.text).join(' ')));
}

test('PDF: cada renglón del informe con su importe en el mismo renglón', async () => {
  const lines = await pdfLines(await generateRendicionPdf(report()));
  const expected = reportRows(report()).map((r) => (r.amount ? `${r.text} ${r.amount}` : r.text));
  assert.deepStrictEqual(lines, expected);
});

test('PDF: con logo válido, con logo roto (se omite) y con muchas líneas (salta de hoja)', async () => {
  const conLogo = await generateRendicionPdf(report(), { logo: PNG_1PX });
  assert.ok((await pdfLines(conLogo)).includes('01- Ingresos del periodo'));
  const roto = await generateRendicionPdf(report(), { logo: 'data:image/png;base64,AAAA' });
  assert.ok((await pdfLines(roto)).includes('01- Ingresos del periodo'));

  const many = Array.from({ length: 80 }, (_, i) => ({
    id: `m${i}`, amountCents: -100, status: 'MANUAL', rubroId: 'r7', itemLabel: `Gasto número ${i}`, date: 'x', description: '',
  }));
  const big = await generateRendicionPdf(report({ movements: many }));
  const pages = await extractPages(big);
  assert.ok(pages.length >= 2);
  const all = pages.flatMap((p) => p.lines.map((l) => l.tokens.map((t) => t.text).join(' ')));
  assert.ok(all.includes('- Gasto número 79 $ 1,00.-'));
  assert.ok(all.at(-1).startsWith('11- TOTAL CAJA'));
});

test('PDF: con bloqueos no genera', async () => {
  await assert.rejects(generateRendicionPdf(report({ reserve: null })), (e) => e.code === 'REPORT_BLOCKED');
});
