// PDF Templates - PDFKit generators for professional reports
const PDFDocument = require('pdfkit');
const { MONTH_NAMES } = require('./reportDataService');

// ============================================
// CONSTANTS
// ============================================

const COLORS = {
  primary: '#003087',
  headerBg: '#003087',
  headerText: '#FFFFFF',
  altRow: '#F0F0F0',
  text: '#333333',
  textLight: '#666666',
  border: '#CCCCCC',
  totalBg: '#003087',
  totalText: '#FFFFFF',
  success: '#16a34a',
  warning: '#ea580c',
  danger: '#dc2626',
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 50,
};

const contentWidth = PAGE.width - PAGE.margin * 2;

// ============================================
// HELPERS
// ============================================

const formatCurrency = (amount, currency = 'ARS') => {
  if (amount == null) return '-';
  const prefix = currency === 'ARS' ? '$' : currency + ' ';
  return prefix + Number(amount).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatDate = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

/**
 * Draw institutional header (H&H style)
 */
const drawHeader = (doc, empresaData) => {
  const headerHeight = 80;

  // Header background
  doc.rect(0, 0, PAGE.width, headerHeight).fill(COLORS.headerBg);

  // Logo text
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(COLORS.headerText)
    .text('H&H', PAGE.margin, 15, { continued: true })
    .font('Helvetica')
    .fontSize(16)
    .text('  INMOBILIARIA', { continued: false });

  // Company details
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.headerText);

  const rightX = PAGE.width - PAGE.margin - 200;
  doc.text(empresaData.direccion || 'Av. Marcelo T. de Alvear 1234', rightX, 18, { width: 200, align: 'right' });
  doc.text(empresaData.ciudad || 'Córdoba, Argentina', rightX, 30, { width: 200, align: 'right' });
  doc.text(`Tel: ${empresaData.telefono || '(351) 555-0100'}`, rightX, 42, { width: 200, align: 'right' });
  doc.text(`CUIT: ${empresaData.cuit || '30-12345678-9'}`, rightX, 54, { width: 200, align: 'right' });

  // Reset color
  doc.fillColor(COLORS.text);

  return headerHeight + 20;
};

/**
 * Draw footer
 */
const drawFooter = (doc, empresaData, pageNumber) => {
  const footerY = PAGE.height - 40;

  doc
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .moveTo(PAGE.margin, footerY - 10)
    .lineTo(PAGE.width - PAGE.margin, footerY - 10)
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(COLORS.textLight)
    .text(
      `${empresaData.nombre || 'H&H Inmobiliaria'} - CUIT: ${empresaData.cuit || '30-12345678-9'} - ${empresaData.direccion || 'Av. Marcelo T. de Alvear 1234'}, ${empresaData.ciudad || 'Córdoba'}`,
      PAGE.margin,
      footerY - 5,
      { width: contentWidth - 50, align: 'left' }
    );

  if (pageNumber) {
    doc.text(`Pág. ${pageNumber}`, PAGE.width - PAGE.margin - 40, footerY - 5, {
      width: 40,
      align: 'right',
    });
  }

  doc.fillColor(COLORS.text);
};

/**
 * Draw a table with headers, rows, optional total row
 * Returns the Y position after the table
 */
const drawTable = (doc, startY, headers, rows, options = {}) => {
  const {
    colWidths = null,
    totalRow = null,
    fontSize = 9,
    headerFontSize = 9,
    rowHeight = 22,
    headerHeight = 24,
  } = options;

  // Calculate column widths
  const numCols = headers.length;
  const widths = colWidths || headers.map(() => contentWidth / numCols);

  let y = startY;

  // Check if we need a new page
  const checkNewPage = (requiredSpace) => {
    if (y + requiredSpace > PAGE.height - 60) {
      doc.addPage();
      y = PAGE.margin;
      return true;
    }
    return false;
  };

  // Draw header row
  checkNewPage(headerHeight);
  doc.rect(PAGE.margin, y, contentWidth, headerHeight).fill(COLORS.headerBg);

  let x = PAGE.margin;
  doc.font('Helvetica-Bold').fontSize(headerFontSize).fillColor(COLORS.headerText);

  headers.forEach((header, i) => {
    const align = i === 0 ? 'left' : 'right';
    const padding = i === 0 ? 8 : 0;
    const textWidth = i === 0 ? widths[i] - 8 : widths[i] - 8;
    doc.text(header, x + padding, y + (headerHeight - headerFontSize) / 2, {
      width: textWidth,
      align,
    });
    x += widths[i];
  });

  y += headerHeight;
  doc.fillColor(COLORS.text);

  // Draw data rows
  rows.forEach((row, rowIndex) => {
    checkNewPage(rowHeight);

    // Alternating row background
    if (rowIndex % 2 === 1) {
      doc.rect(PAGE.margin, y, contentWidth, rowHeight).fill(COLORS.altRow);
    }

    x = PAGE.margin;
    doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.text);

    row.forEach((cell, i) => {
      const align = i === 0 ? 'left' : 'right';
      const padding = i === 0 ? 8 : 0;
      const textWidth = widths[i] - 8;
      doc.text(String(cell ?? '-'), x + padding, y + (rowHeight - fontSize) / 2, {
        width: textWidth,
        align,
      });
      x += widths[i];
    });

    y += rowHeight;
  });

  // Draw total row
  if (totalRow) {
    checkNewPage(headerHeight);
    doc.rect(PAGE.margin, y, contentWidth, headerHeight).fill(COLORS.totalBg);

    x = PAGE.margin;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.totalText);

    totalRow.forEach((cell, i) => {
      const align = i === 0 ? 'left' : 'right';
      const padding = i === 0 ? 8 : 0;
      const textWidth = widths[i] - 8;
      doc.text(String(cell ?? ''), x + padding, y + (headerHeight - 12) / 2, {
        width: textWidth,
        align,
      });
      x += widths[i];
    });

    y += headerHeight;
  }

  doc.fillColor(COLORS.text);
  return y;
};

// ============================================
// LIQUIDACION PDF
// ============================================

const generateLiquidacionPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Header
    let y = drawHeader(doc, data.empresa);

    // Title
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(COLORS.primary)
      .text(`LIQUIDACIÓN - ${data.periodo.label.toUpperCase()}`, PAGE.margin, y, {
        width: contentWidth,
        align: 'center',
      });
    y += 30;

    // Info section
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);

    const infoLeftX = PAGE.margin;
    const infoRightX = PAGE.margin + contentWidth / 2;

    doc.font('Helvetica-Bold').text('Inquilino:', infoLeftX, y);
    doc.font('Helvetica').text(data.inquilino.nombre, infoLeftX + 70, y);
    y += 15;

    doc.font('Helvetica-Bold').text('DNI/CUIT:', infoLeftX, y);
    doc.font('Helvetica').text(data.inquilino.dni, infoLeftX + 70, y);

    const propAddress = [
      data.propiedad.direccion,
      data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null,
      data.propiedad.depto ? data.propiedad.depto : null,
    ].filter(Boolean).join(', ');

    doc.font('Helvetica-Bold').text('Propiedad:', infoRightX, y - 15);
    doc.font('Helvetica').text(propAddress, infoRightX + 70, y - 15, { width: contentWidth / 2 - 70 });

    doc.font('Helvetica-Bold').text('Propietario:', infoRightX, y);
    doc.font('Helvetica').text(data.propietario.nombre, infoRightX + 70, y);

    y += 25;

    // Separator line
    doc
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.width - PAGE.margin, y)
      .stroke();
    y += 15;

    // Concepts table
    const headers = ['CONCEPTO', 'BASE', 'IMPORTE'];
    const colWidths = [contentWidth * 0.5, contentWidth * 0.25, contentWidth * 0.25];

    const rows = data.conceptos.map((c) => [
      c.concepto,
      c.base != null ? formatCurrency(c.base, data.currency) : '-',
      formatCurrency(c.importe, data.currency),
    ]);

    const totalRow = ['TOTAL A PAGAR', '', formatCurrency(data.total, data.currency)];

    y = drawTable(doc, y, headers, rows, { colWidths, totalRow });
    y += 20;

    // Status section
    const statusColor = data.isPaid ? COLORS.success : data.estado === 'PARTIAL' ? COLORS.warning : COLORS.danger;
    const statusLabel = data.isPaid ? 'PAGADO' : data.estado === 'PARTIAL' ? 'PAGO PARCIAL' : 'PENDIENTE';

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(statusColor)
      .text(`Estado: ${statusLabel}`, PAGE.margin, y);

    if (data.fechaPago) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(`  |  Fecha de pago: ${formatDate(data.fechaPago)}`, PAGE.margin + 150, y);
    }

    if (data.amountPaid > 0 && !data.isPaid) {
      y += 18;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(`Pagado: ${formatCurrency(data.amountPaid, data.currency)}  |  Saldo: ${formatCurrency(Math.abs(data.balance), data.currency)}`, PAGE.margin, y);
    }

    // Footer
    drawFooter(doc, data.empresa, 1);

    doc.end();
  });
};

// ============================================
// ESTADO DE CUENTAS PDF
// ============================================

const generateEstadoCuentasPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    let pageNum = 1;

    // Header
    let y = drawHeader(doc, data.empresa);

    // Title
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(COLORS.primary)
      .text('ESTADO DE CUENTAS', PAGE.margin, y, { width: contentWidth, align: 'center' });
    y += 25;

    // Info
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    doc.font('Helvetica-Bold').text(`Inquilino: `, PAGE.margin, y, { continued: true });
    doc.font('Helvetica').text(data.inquilino.nombre);
    y += 15;
    doc.font('Helvetica-Bold').text(`Propiedad: `, PAGE.margin, y, { continued: true });
    doc.font('Helvetica').text(data.propiedad.direccion);
    y += 20;

    // Summary boxes
    const boxWidth = contentWidth / 3 - 5;
    const boxHeight = 50;

    // Total Pagado
    doc.rect(PAGE.margin, y, boxWidth, boxHeight).fill('#e8f5e9');
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.textLight).text('Total Pagado', PAGE.margin + 8, y + 8);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.success).text(formatCurrency(data.resumen.totalPagado, data.currency), PAGE.margin + 8, y + 25);

    // Total Adeudado
    doc.rect(PAGE.margin + boxWidth + 5, y, boxWidth, boxHeight).fill('#fce4ec');
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.textLight).text('Total Adeudado', PAGE.margin + boxWidth + 13, y + 8);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.danger).text(formatCurrency(data.resumen.totalAdeudado, data.currency), PAGE.margin + boxWidth + 13, y + 25);

    // Balance
    const balColor = data.resumen.balance >= 0 ? COLORS.success : COLORS.danger;
    doc.rect(PAGE.margin + (boxWidth + 5) * 2, y, boxWidth, boxHeight).fill('#e3f2fd');
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.textLight).text('Balance', PAGE.margin + (boxWidth + 5) * 2 + 8, y + 8);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(balColor).text(formatCurrency(data.resumen.balance, data.currency), PAGE.margin + (boxWidth + 5) * 2 + 8, y + 25);

    y += boxHeight + 20;
    doc.fillColor(COLORS.text);

    // History table
    const headers = ['Período', 'Alquiler', 'Servicios', 'Total', 'Pagado', 'Saldo', 'Estado'];
    const colWidths = [
      contentWidth * 0.18,
      contentWidth * 0.13,
      contentWidth * 0.13,
      contentWidth * 0.14,
      contentWidth * 0.14,
      contentWidth * 0.14,
      contentWidth * 0.14,
    ];

    const rows = data.historial.map((h) => [
      h.periodo,
      formatCurrency(h.alquiler, data.currency),
      formatCurrency(h.servicios, data.currency),
      formatCurrency(h.totalDue, data.currency),
      formatCurrency(h.amountPaid, data.currency),
      formatCurrency(h.balance, data.currency),
      h.isPaid ? 'Pagado' : h.status === 'PARTIAL' ? 'Parcial' : 'Pendiente',
    ]);

    y = drawTable(doc, y, headers, rows, { colWidths, fontSize: 8, headerFontSize: 8, rowHeight: 18, headerHeight: 20 });

    drawFooter(doc, data.empresa, pageNum);
    doc.end();
  });
};

// ============================================
// RESUMEN EJECUTIVO PDF
// ============================================

const generateResumenEjecutivoPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    let y = drawHeader(doc, { nombre: data.empresa.nombre });

    // Title
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(COLORS.primary)
      .text(`RESUMEN EJECUTIVO - ${data.periodo.label.toUpperCase()}`, PAGE.margin, y, {
        width: contentWidth,
        align: 'center',
      });
    y += 35;

    // KPI Boxes (2x3 grid)
    const kpis = [
      { label: 'Ingresos del Mes', value: formatCurrency(data.kpis.ingresosMes, data.currency), color: COLORS.success },
      { label: 'Total Facturado', value: formatCurrency(data.kpis.totalDueMes, data.currency), color: COLORS.primary },
      { label: '% Cobranza', value: `${data.kpis.cobranza}%`, color: COLORS.primary },
      { label: 'Deuda Total', value: formatCurrency(data.kpis.totalDeuda, data.currency), color: COLORS.danger },
      { label: 'Punitorios del Mes', value: formatCurrency(data.kpis.punitoryMes, data.currency), color: COLORS.warning },
      { label: 'Ocupación', value: `${data.kpis.ocupacion}%`, color: COLORS.primary },
    ];

    const boxW = (contentWidth - 20) / 3;
    const boxH = 65;

    kpis.forEach((kpi, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = PAGE.margin + col * (boxW + 10);
      const by = y + row * (boxH + 10);

      doc.rect(bx, by, boxW, boxH).lineWidth(1).strokeColor(COLORS.border).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.textLight).text(kpi.label, bx + 10, by + 10, { width: boxW - 20 });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(kpi.color).text(kpi.value, bx + 10, by + 30, { width: boxW - 20 });
    });

    y += 2 * (boxH + 10) + 20;
    doc.fillColor(COLORS.text);

    // Variation note
    if (data.kpis.variacionIngresos !== null) {
      const varSign = parseFloat(data.kpis.variacionIngresos) >= 0 ? '+' : '';
      const varColor = parseFloat(data.kpis.variacionIngresos) >= 0 ? COLORS.success : COLORS.danger;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.textLight).text('Variación vs. mes anterior: ', PAGE.margin, y, { continued: true });
      doc.font('Helvetica-Bold').fillColor(varColor).text(`${varSign}${data.kpis.variacionIngresos}%`);
      y += 20;
    }

    // Payment status summary
    y += 10;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.primary).text('Estado de Pagos del Mes', PAGE.margin, y);
    y += 20;

    const statusHeaders = ['Estado', 'Cantidad', 'Porcentaje'];
    const statusColWidths = [contentWidth * 0.4, contentWidth * 0.3, contentWidth * 0.3];
    const total = data.estadoPagos.total || 1;
    const statusRows = [
      ['Pagados', String(data.estadoPagos.pagados), `${((data.estadoPagos.pagados / total) * 100).toFixed(0)}%`],
      ['Parciales', String(data.estadoPagos.parciales), `${((data.estadoPagos.parciales / total) * 100).toFixed(0)}%`],
      ['Pendientes', String(data.estadoPagos.pendientes), `${((data.estadoPagos.pendientes / total) * 100).toFixed(0)}%`],
    ];

    y = drawTable(doc, y, statusHeaders, statusRows, { colWidths: statusColWidths });

    // Additional info
    y += 20;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    doc.text(`Contratos activos: ${data.kpis.contratosActivos}`, PAGE.margin, y);
    y += 15;
    doc.text(`Propiedades totales: ${data.kpis.totalPropiedades}`, PAGE.margin, y);
    y += 15;
    doc.text(`Deudas abiertas: ${data.kpis.deudasAbiertas}`, PAGE.margin, y);

    drawFooter(doc, { nombre: data.empresa.nombre, cuit: '30-12345678-9' }, 1);
    doc.end();
  });
};

// ============================================
// CARTA DOCUMENTO PDF
// ============================================

const generateCartaDocumentoPDF = (data, customMessage) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);

    // Title
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(COLORS.primary)
      .text('CARTA DOCUMENTO', PAGE.margin, y, { width: contentWidth, align: 'center' });
    y += 10;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.textLight)
      .text('INTIMACIÓN DE PAGO', PAGE.margin, y, { width: contentWidth, align: 'center' });
    y += 30;

    // Date
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    doc.text(`Córdoba, ${formatDate(data.fecha)}`, PAGE.margin, y, { width: contentWidth, align: 'right' });
    y += 25;

    // Addressee
    doc.font('Helvetica-Bold').text('Sr./Sra.:', PAGE.margin, y);
    doc.font('Helvetica').text(data.deudor.nombre, PAGE.margin + 60, y);
    y += 15;
    doc.font('Helvetica-Bold').text('DNI/CUIT:', PAGE.margin, y);
    doc.font('Helvetica').text(data.deudor.dni, PAGE.margin + 60, y);
    y += 15;
    doc.font('Helvetica-Bold').text('Propiedad:', PAGE.margin, y);
    doc.font('Helvetica').text(data.propiedad.direccion, PAGE.margin + 60, y);
    y += 25;

    // Separator
    doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).stroke();
    y += 15;

    // Body text
    const defaultMessage = `Por la presente, nos dirigimos a Ud. en nuestra calidad de administradores del inmueble sito en ${data.propiedad.direccion}, a fin de intimarlo al pago de las sumas adeudadas en concepto de alquiler, conforme al detalle que se indica a continuación.`;

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(customMessage || defaultMessage, PAGE.margin, y, {
        width: contentWidth,
        align: 'justify',
        lineGap: 4,
      });

    y = doc.y + 20;

    // Debt table
    if (data.deudas.length > 0) {
      const headers = ['Período', 'Monto Adeudado', 'Punitorios'];
      const colWidths = [contentWidth * 0.4, contentWidth * 0.3, contentWidth * 0.3];
      const rows = data.deudas.map((d) => [
        d.periodo,
        formatCurrency(d.monto, data.currency),
        formatCurrency(d.punitorios, data.currency),
      ]);
      const totalRow = ['TOTAL ADEUDADO', formatCurrency(data.totalDeuda, data.currency), ''];

      y = drawTable(doc, y, headers, rows, { colWidths, totalRow });
      y += 20;
    }

    // Closing text
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(
        'Le informamos que, de no efectuarse el pago dentro de los próximos 10 (diez) días hábiles, se procederá a iniciar las acciones legales correspondientes, sin perjuicio de los punitorios que continúen devengándose.',
        PAGE.margin,
        y,
        { width: contentWidth, align: 'justify', lineGap: 4 }
      );

    y = doc.y + 30;

    // Signature
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Sin otro particular, lo saluda atentamente,', PAGE.margin, y);
    y += 40;

    doc.font('Helvetica-Bold').text('________________________', PAGE.margin, y);
    y += 15;
    doc.font('Helvetica').text(data.empresa.nombre || 'H&H Inmobiliaria', PAGE.margin, y);

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

module.exports = {
  generateLiquidacionPDF,
  generateEstadoCuentasPDF,
  generateResumenEjecutivoPDF,
  generateCartaDocumentoPDF,
  formatCurrency,
  formatDate,
  COLORS,
};
