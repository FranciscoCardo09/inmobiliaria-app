// PDF de la rendición (mismo contenido que el Word).
const PDFDocument = require('pdfkit');
const { reportRows, decodeLogo } = require('./reportRows');

const MARGIN = 60;
const PAGE_W = 595.28;
const CONTENT_W = PAGE_W - MARGIN * 2;

async function generateRendicionPdf(report, { logo = null } = {}) {
  const rows = reportRows(report);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: report.subtitle } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const img = decodeLogo(logo);
    if (img) {
      try {
        doc.image(img.buffer, MARGIN, MARGIN, { fit: [70, 70] });
        doc.y = MARGIN + 80;
      } catch (e) { /* logo inválido: se imprime sin logo */ }
    }

    const amountRow = (text, amount, font, size) => {
      const y = doc.y;
      doc.font(font).fontSize(size).text(text, MARGIN + (font === 'Helvetica' ? 14 : 0), y, { width: CONTENT_W - 140, lineBreak: true });
      const afterText = doc.y;
      doc.font(font).fontSize(size).text(amount, MARGIN, y, { width: CONTENT_W, align: 'right' });
      doc.y = Math.max(afterText, doc.y);
    };

    for (const row of rows) {
      if (doc.y > 760) doc.addPage();
      if (row.type === 'title') {
        doc.font('Helvetica-Bold').fontSize(13).text(row.text, MARGIN, doc.y, { underline: true });
        doc.moveDown(0.4);
      } else if (row.type === 'subtitle') {
        doc.font('Helvetica-Bold').fontSize(11).text(row.text, MARGIN, doc.y);
        doc.moveDown(0.8);
      } else if (row.type === 'heading') {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(10).text(row.text, MARGIN, doc.y);
        doc.moveDown(0.15);
      } else if (row.type === 'item') {
        amountRow(row.text, row.amount, 'Helvetica', 10);
        doc.moveDown(0.1);
      } else {
        doc.moveDown(1);
        amountRow(row.text, row.amount, 'Helvetica-Bold', 11);
      }
    }
    doc.end();
  });
}

module.exports = { generateRendicionPdf };
