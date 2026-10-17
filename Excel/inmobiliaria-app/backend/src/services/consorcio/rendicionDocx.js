// Word de la rendición (mismo formato que el informe hecho a mano).
const { Document, Packer, Paragraph, TextRun, ImageRun, TabStopType, AlignmentType } = require('docx');
const { reportRows, decodeLogo } = require('./reportRows');

const FONT = 'Arial';
const AMOUNT_TAB = 8500; // twips: importes alineados a la derecha

function paragraphFor(row) {
  switch (row.type) {
    case 'title':
      return new Paragraph({
        children: [new TextRun({ text: row.text, bold: true, underline: {}, size: 24, font: FONT })],
        spacing: { after: 120 },
      });
    case 'subtitle':
      return new Paragraph({
        children: [new TextRun({ text: row.text, bold: true, size: 22, font: FONT })],
        spacing: { after: 240 },
      });
    case 'heading':
      return new Paragraph({
        children: [new TextRun({ text: row.text, bold: true, size: 20, font: FONT })],
        spacing: { before: 160, after: 40 },
      });
    case 'item':
      return new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: AMOUNT_TAB }],
        indent: { left: 280 },
        children: [new TextRun({ text: `${row.text}\t${row.amount}`, size: 20, font: FONT })],
      });
    default: // total
      return new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: AMOUNT_TAB }],
        spacing: { before: 280 },
        children: [new TextRun({ text: `${row.text}\t${row.amount}`, bold: true, size: 22, font: FONT })],
      });
  }
}

async function generateRendicionDocx(report, { logo = null } = {}) {
  const rows = reportRows(report);
  const children = [];
  const img = decodeLogo(logo);
  if (img) {
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new ImageRun({ type: img.type, data: img.buffer, transformation: { width: 90, height: 90 } })],
    }));
  }
  for (const row of rows) children.push(paragraphFor(row));

  const doc = new Document({
    creator: 'Inmobiliaria',
    title: report.subtitle,
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1417, right: 1701, bottom: 1417, left: 1701 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { generateRendicionDocx };
