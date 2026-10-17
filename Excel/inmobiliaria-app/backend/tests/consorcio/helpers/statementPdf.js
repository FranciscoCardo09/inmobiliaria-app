// Genera extractos PDF sintéticos con el mismo layout que el del Banco Roela
// (posiciones x/y medidas del extracto real de julio 2026), para probar el
// parser de punta a punta sin subir datos reales al repo.
//
//   layoutStatement(spec)  → páginas con renglones "lógicos" (se pueden romper a mano en los tests)
//   renderStatementPdf(layout, opts) → Buffer del PDF
const PDFDocument = require('pdfkit');
const { formatNumber } = require('../../../src/services/consorcio/money');

const PAGE_H = 841.89;
const ROW = 14.2;
const MULTI_ROW = 19.1;
const BALANCE_GAP = 17.3;
const X = { date: 31.1, voucherRight: 168.5, concept: 194.8, desc: 236.9, amountRight: 567 };

const money = (cents) => `${cents < 0 ? '-' : ''}$ ${formatNumber(Math.abs(cents))}`;

// spec: { header, opening: { date, cents }, movements: [{ date, voucher, concept, desc, cents }] }
// Inserta un "Saldo al" después de cada día (como el banco) y reparte en hojas.
function layoutStatement(spec, { rowsPerPage = 38 } = {}) {
  const rows = [{ kind: 'opening', date: spec.opening.date, cents: spec.opening.cents }];
  let balance = spec.opening.cents;
  const all = spec.movements;
  all.forEach((m, i) => {
    if (i === 0 && m.date !== spec.opening.date) rows.push({ kind: 'daily', date: spec.opening.date, cents: balance });
    rows.push({ kind: 'movement', ...m });
    balance += m.cents;
    const next = all[i + 1];
    if (!next || next.date !== m.date) rows.push({ kind: 'daily', date: m.date, cents: balance });
  });
  if (!all.length) rows.push({ kind: 'daily', date: spec.opening.date, cents: balance });

  const pages = [];
  let current = [];
  for (const r of rows) {
    if (current.length >= rowsPerPage) {
      pages.push(current);
      current = [];
    }
    current.push(r);
  }
  pages.push(current);
  return { header: spec.header, pages };
}

function right(doc, text, rightX, y) {
  doc.text(text, rightX - doc.widthOfString(text), y, { lineBreak: false });
}

// opts: { omitFooterOn: [n], footerTotal, noHeaderRow, noTitle, extraPage1Lines: [text] }
function renderStatementPdf(layout, opts = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const h = layout.header;
    const total = opts.footerTotal || layout.pages.length;

    layout.pages.forEach((rows, pi) => {
      doc.addPage({ size: 'A4', margin: 0 });
      doc.font('Helvetica-Bold').fontSize(12);
      if (!opts.noTitle) doc.text('Extracto de Cuenta', 244.1, 22, { lineBreak: false });
      doc.text(`entre el ${h.from} y el ${h.to}`, 212.4, 36, { lineBreak: false });

      let y;
      doc.font('Helvetica').fontSize(9.75);
      if (pi === 0) {
        doc.text(h.accountName, 23.7, 78, { lineBreak: false });
        (opts.extraPage1Lines || []).forEach((t, i) => doc.text(t, 23.7, 90 + i * 0.1, { lineBreak: false }));
        doc.text('1° Titular:', 22.6, 104, { lineBreak: false });
        doc.text(`${h.holderName} ${h.holderCuit}`, 73, 104, { lineBreak: false });
        if (h.cbu) {
          doc.text('C.B.U.:', 22.6, 118, { lineBreak: false });
          doc.text(h.cbu, 59.8, 118, { lineBreak: false });
        }
        doc.text(`Nro.${h.accountNumber}`, 347.1, 126, { lineBreak: false });
        doc.text(`Sucursal: ${h.branch}`, 418, 126, { lineBreak: false });
        if (!opts.noHeaderRow) {
          [['Fecha', 41.1], ['Comprobante', 96.1], ['Concepto', 179.4], ['Descripción', 241.2], ['Importe', 509.3]]
            .forEach(([t, x]) => doc.text(t, x, 150, { lineBreak: false }));
        }
        y = 168;
      } else {
        y = 60;
      }

      for (const r of rows) {
        if (r.kind === 'opening') {
          doc.text(r.date, X.date, y, { lineBreak: false });
          doc.text('Saldo Al Inicio', X.desc, y, { lineBreak: false });
          right(doc, money(r.cents), X.amountRight, y);
          y += ROW;
        } else if (r.kind === 'daily') {
          y += 3;
          doc.text('Saldo al', 343, y, { lineBreak: false });
          doc.text(r.date, 384.4, y, { lineBreak: false });
          right(doc, money(r.cents), X.amountRight, y);
          y += BALANCE_GAP;
        } else if (r.kind === 'raw') {
          // renglón arbitrario: [{ text, x }]
          r.tokens.forEach((t) => doc.text(t.text, t.x, y + (r.dy || 0), { lineBreak: false }));
          y += r.advance ?? ROW;
        } else {
          const multi = Array.isArray(r.desc);
          const rowY = multi ? y + 5.6 : y;
          doc.text(r.date, X.date, rowY, { lineBreak: false });
          if (r.voucher) right(doc, r.voucher, X.voucherRight, rowY);
          doc.text(r.concept, X.concept, rowY, { lineBreak: false });
          if (multi) {
            doc.text(r.desc[0], X.desc, y, { lineBreak: false });
            if (r.desc[1]) doc.text(r.desc[1], X.desc, y + 11.2, { lineBreak: false });
          } else if (r.desc) {
            doc.text(r.desc, X.desc, rowY, { lineBreak: false });
          }
          right(doc, r.amountText || money(r.cents), X.amountRight, rowY);
          y += multi ? MULTI_ROW : ROW;
        }
      }

      if (!(opts.omitFooterOn || []).includes(pi + 1)) {
        doc.text(`Página ${pi + 1} de ${total}`, 264.3, PAGE_H - 30, { lineBreak: false });
        doc.text('1/8/2026 15:35:40', 491.2, PAGE_H - 30, { lineBreak: false });
      }
    });
    doc.end();
  });
}

module.exports = { layoutStatement, renderStatementPdf, PAGE_H };
