// Convierte la rendición armada en los renglones que imprimen el Word y el PDF,
// con el mismo formato que el informe que se hacía a mano:
//   01- Ingresos del periodo
//      - Gastos Comunes Junio - 26 ........ $ 4.282.134,91.-
//   …
//   11- TOTAL CAJA ........................ $ 4.533.133,98.-
// Los rubros sin líneas no se imprimen (mantienen su número igual).
const { ConsorcioError } = require('./errors');
const { formatReportAmount } = require('./money');

function num(n) {
  return String(n).padStart(2, '0');
}

function reportRows(report) {
  if (!report.canGenerate) {
    throw new ConsorcioError('REPORT_BLOCKED',
      `Todavía no se puede generar el informe: ${report.blockers.map((b) => b.message).join(' ')}`, 409,
      { blockers: report.blockers });
  }
  const rows = [
    { type: 'title', text: report.title },
    { type: 'subtitle', text: report.subtitle },
  ];
  for (const section of report.sections) {
    if (!section.lines.length) continue;
    rows.push({ type: 'heading', text: `${num(section.rubro.number)}- ${section.rubro.name}` });
    for (const line of section.lines) {
      rows.push({ type: 'item', text: `- ${line.label}`, amount: formatReportAmount(line.finalCents) });
    }
  }
  rows.push({
    type: 'total',
    text: `${num(report.total.number)}- ${report.total.label}`,
    amount: formatReportAmount(report.totals.totalCajaCents),
  });
  return rows;
}

// "data:image/png;base64,..." → { buffer, type } | null
function decodeLogo(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  return { buffer: Buffer.from(m[2], 'base64'), type: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' };
}

function fileBaseName(report) {
  const safe = String(report.title).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Rendicion_${safe}_${report.year}-${num(report.month)}`;
}

module.exports = { reportRows, decodeLogo, fileBaseName };
