// PDF Templates - Professional minimalist design (black/gray)
const PDFDocument = require('pdfkit');
const { MONTH_NAMES } = require('./reportDataService');

// ============================================
// DESIGN TOKENS - Professional minimalist (black/gray)
// ============================================

const C = {
  // Primary accent - used sparingly (5%) for logo/titles only
  brand: '#2B6CB0',
  brandDark: '#1E4E8C',
  brandLight: '#F0F4F8',

  // Text hierarchy - 90% black, rest gray
  black: '#000000',
  dark: '#333333',
  medium: '#666666',
  muted: '#999999',
  light: '#CCCCCC',

  // Backgrounds
  white: '#FFFFFF',
  snow: '#FAFAFA',
  cloud: '#F5F5F5',
  line: '#E0E0E0',

  // Status (muted versions)
  green: '#2D7A4F',
  greenBg: '#F0F7F3',
  amber: '#8B6914',
  amberBg: '#FBF8F0',
  red: '#B91C1C',
  redBg: '#FDF2F2',
  purple: '#6B4FA0',
};

// A4 with 20mm margins (56.69pt)
const PAGE = { width: 595.28, height: 841.89, margin: 56.69 };
const W = PAGE.width - PAGE.margin * 2; // content width

const F = { r: 'Helvetica', b: 'Helvetica-Bold', i: 'Helvetica-Oblique' };

// ============================================
// FORMAT
// ============================================

const fmt = (amount, currency = 'ARS') => {
  if (amount == null) return '-';
  const p = currency === 'ARS' ? '$ ' : currency + ' ';
  return p + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtDateLong = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
};

// ============================================
// PRIMITIVES
// ============================================

const rrect = (doc, x, y, w, h, r = 6) => {
  doc.moveTo(x + r, y)
    .lineTo(x + w - r, y).quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r).quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h).quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y);
};

const fillR = (doc, x, y, w, h, color, r = 6) => {
  doc.save(); rrect(doc, x, y, w, h, r); doc.fill(color); doc.restore();
};

const strokeR = (doc, x, y, w, h, color, lw = 0.75, r = 6) => {
  doc.save(); doc.lineWidth(lw).strokeColor(color); rrect(doc, x, y, w, h, r); doc.stroke(); doc.restore();
};

// ============================================
// HEADER - Professional minimalist (black/gray)
// ============================================

const drawHeader = (doc, emp) => {
  // Thin top line (black, not colored)
  doc.rect(0, 0, PAGE.width, 1.5).fill(C.black);

  // White header area with bottom rule
  doc.rect(0, 1.5, PAGE.width, 64).fill(C.white);
  doc.strokeColor(C.black).lineWidth(0.5).moveTo(PAGE.margin, 66).lineTo(PAGE.width - PAGE.margin, 66).stroke();

  // Logo - 25x25mm (approx 71pt) B/N sutil, top-left
  let tx = PAGE.margin;
  if (emp.logo && emp.logo.startsWith('data:image')) {
    try {
      const buf = Buffer.from(emp.logo.split(',')[1], 'base64');
      doc.image(buf, PAGE.margin, 8, { height: 50 });
      tx = PAGE.margin + 58;
    } catch (e) { /* skip */ }
  }

  // Company name - bold black
  doc.font(F.b).fontSize(14).fillColor(C.black)
    .text(emp.nombre || 'Inmobiliaria', tx, 12, { width: 260 });

  // Contact line
  const parts = [emp.direccion, emp.ciudad].filter(Boolean).join(' | ');
  if (parts) {
    doc.font(F.r).fontSize(8).fillColor(C.dark).text(parts, tx, 30, { width: 260 });
  }

  // Right side - CUIT, phones, emails
  const rx = PAGE.width - PAGE.margin - 160;
  let ry = 12;
  doc.font(F.r).fontSize(8).fillColor(C.dark);
  if (emp.cuit) { doc.text(`CUIT ${emp.cuit}`, rx, ry, { width: 160, align: 'right' }); ry += 12; }
  if (emp.telefono) {
    const phones = emp.telefono.split(';').map(p => p.trim()).filter(Boolean);
    for (const p of phones) { doc.text(p, rx, ry, { width: 160, align: 'right' }); ry += 10; }
  }
  if (emp.email) {
    const emails = emp.email.split(';').map(e => e.trim()).filter(Boolean);
    for (const e of emails) { doc.text(e, rx, ry, { width: 160, align: 'right' }); ry += 10; }
  }

  doc.fillColor(C.black);
  return 84;
};

// ============================================
// FOOTER
// ============================================

const drawFooter = (doc, emp, pg) => {
  const fy = PAGE.height - 30;
  doc.strokeColor(C.light).lineWidth(0.3).moveTo(PAGE.margin, fy - 6).lineTo(PAGE.width - PAGE.margin, fy - 6).stroke();

  const parts = ['Generado por ' + (emp.nombre || 'Inmobiliaria')];
  if (emp.cuit) parts.push(`CUIT ${emp.cuit}`);

  doc.font(F.r).fontSize(7).fillColor(C.muted)
    .text(parts.join('  |  '), PAGE.margin, fy, { width: W - 40 });
  if (pg) doc.text(`${pg}`, PAGE.width - PAGE.margin - 30, fy, { width: 30, align: 'right' });
  doc.fillColor(C.black);
};

// ============================================
// TITLE - Minimal centered
// ============================================

const drawTitle = (doc, y, title, sub) => {
  doc.font(F.b).fontSize(13).fillColor(C.black)
    .text(title.toUpperCase(), PAGE.margin, y, { width: W, align: 'left', characterSpacing: 1.5 });
  y += 18;

  if (sub) {
    doc.font(F.r).fontSize(9).fillColor(C.medium)
      .text(sub, PAGE.margin, y, { width: W, align: 'left' });
    y += 14;
  }

  // Thin black rule
  doc.strokeColor(C.black).lineWidth(0.8)
    .moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).stroke();

  return y + 16;
};

// ============================================
// INFO CARD - Clean with thin border
// ============================================

const drawInfo = (doc, y, left, right) => {
  const rows = Math.max(left.length, (right || []).length);
  const h = rows * 16 + 16;

  // Light background with thin border
  fillR(doc, PAGE.margin, y, W, h, C.snow, 2);
  strokeR(doc, PAGE.margin, y, W, h, C.line, 0.5, 2);

  const lx = PAGE.margin + 14;
  const mx = PAGE.margin + W / 2 + 8;
  let ly = y + 10;

  for (const [k, v] of left) {
    doc.font(F.r).fontSize(8).fillColor(C.medium).text(k, lx, ly);
    doc.font(F.b).fontSize(9).fillColor(C.black).text(v || '-', lx + 70, ly, { width: W / 2 - 90 });
    ly += 16;
  }

  if (right) {
    let ry2 = y + 10;
    for (const [k, v] of right) {
      doc.font(F.r).fontSize(8).fillColor(C.medium).text(k, mx, ry2);
      doc.font(F.b).fontSize(9).fillColor(C.black).text(v || '-', mx + 70, ry2, { width: W / 2 - 90 });
      ry2 += 16;
    }
  }

  doc.fillColor(C.black);
  return y + h + 12;
};

// ============================================
// METRIC CARDS - Minimalist with thin border
// ============================================

const drawMetrics = (doc, y, items) => {
  const gap = 10;
  const n = items.length;
  const bw = (W - gap * (n - 1)) / n;
  const bh = 50;

  items.forEach((it, i) => {
    const bx = PAGE.margin + i * (bw + gap);

    fillR(doc, bx, y, bw, bh, C.white, 2);
    strokeR(doc, bx, y, bw, bh, C.line, 0.5, 2);

    // Label
    doc.font(F.r).fontSize(7).fillColor(C.medium)
      .text(it.label.toUpperCase(), bx + 10, y + 10, { width: bw - 20, characterSpacing: 0.5 });

    // Value
    doc.font(F.b).fontSize(14).fillColor(C.black)
      .text(it.value, bx + 10, y + 26, { width: bw - 20 });
  });

  doc.fillColor(C.black);
  return y + bh + 14;
};

// ============================================
// TABLE - Professional black/gray (no color fills)
// ============================================

const drawTable = (doc, startY, headers, rows, opts = {}) => {
  const {
    colWidths = null, totalRow = null,
    fontSize = 8.5, headerFontSize = 7.5,
    rowHeight = 22, headerHeight = 26,
    colAligns = null,
  } = opts;

  const n = headers.length;
  const widths = colWidths || headers.map(() => W / n);
  const aligns = colAligns || headers.map((_, i) => i === 0 ? 'left' : 'right');
  let y = startY;

  const newPage = (need) => {
    if (y + need > PAGE.height - 50) { doc.addPage(); y = PAGE.margin; return true; }
    return false;
  };

  // Header - black text on light gray background
  newPage(headerHeight);
  fillR(doc, PAGE.margin, y, W, headerHeight, C.cloud, 0);

  let x = PAGE.margin;
  doc.font(F.b).fontSize(headerFontSize).fillColor(C.dark);
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), x + 8, y + (headerHeight - headerFontSize) / 2, {
      width: widths[i] - 16, align: aligns[i], characterSpacing: 0.4,
    });
    x += widths[i];
  });
  y += headerHeight;

  // Bottom line after header
  doc.strokeColor(C.black).lineWidth(0.5)
    .moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).stroke();

  // Rows - alternating light gray, bottom borders
  rows.forEach((row, rowIdx) => {
    newPage(rowHeight);

    // Alternating row background
    if (rowIdx % 2 === 1) {
      doc.rect(PAGE.margin, y, W, rowHeight).fill(C.snow);
    }

    // Bottom border
    doc.strokeColor(C.line).lineWidth(0.3)
      .moveTo(PAGE.margin, y + rowHeight - 0.5)
      .lineTo(PAGE.width - PAGE.margin, y + rowHeight - 0.5).stroke();

    x = PAGE.margin;
    doc.font(F.r).fontSize(fontSize).fillColor(C.black);

    row.forEach((cell, i) => {
      const str = String(cell ?? '-');
      if (i === 0) doc.font(F.r).fillColor(C.black);
      else doc.font(F.r).fillColor(C.dark);

      doc.text(str, x + 8, y + (rowHeight - fontSize) / 2, {
        width: widths[i] - 16, align: aligns[i],
      });
      x += widths[i];
    });

    y += rowHeight;
  });

  // Total row - black background, white text
  if (totalRow) {
    newPage(headerHeight + 4);
    y += 4;

    fillR(doc, PAGE.margin, y, W, headerHeight, C.black, 0);

    x = PAGE.margin;
    doc.font(F.b).fontSize(10).fillColor(C.white);
    totalRow.forEach((cell, i) => {
      doc.text(String(cell ?? ''), x + 8, y + (headerHeight - 10) / 2, {
        width: widths[i] - 16, align: aligns[i],
      });
      x += widths[i];
    });
    y += headerHeight;
  }

  doc.fillColor(C.black);
  return y;
};

// ============================================
// SECTION TITLE
// ============================================

const drawSection = (doc, y, title) => {
  doc.font(F.b).fontSize(10).fillColor(C.black).text(title.toUpperCase(), PAGE.margin, y, { characterSpacing: 0.5 });
  y += 14;
  doc.strokeColor(C.black).lineWidth(0.5).moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).stroke();
  y += 10;
  doc.fillColor(C.black);
  return y;
};

// ============================================
// STATUS PILL
// ============================================

const drawPill = (doc, x, y, label, color, bg) => {
  doc.font(F.b).fontSize(7);
  const pw = doc.widthOfString(label) + 14;
  fillR(doc, x, y, pw, 15, bg || C.cloud, 3);
  strokeR(doc, x, y, pw, 15, C.line, 0.3, 3);
  doc.fillColor(color || C.black).text(label, x + 7, y + 3.5);
  doc.fillColor(C.black);
  return x + pw + 6;
};

// ============================================
// PDF GENERATORS
// ============================================

const generateLiquidacionPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);
    
    // Title
    y = drawTitle(doc, y, 'Liquidación', `${data.periodo.label}${data.periodo.labelVencido ? ' · Mes vencido: ' + data.periodo.labelVencido : ''}`);

    // Property and tenant info
    const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');
    y = drawInfo(doc, y, [
      ['Propiedad', addr],
      ['Inquilino', `${data.inquilino.nombre}${data.inquilino.dni ? ` - DNI: ${data.inquilino.dni}` : ''}`],
      ['Propietario', `${data.propietario.nombre}${data.propietario.dni ? ` - DNI: ${data.propietario.dni}` : ''}`],
    ]);

    // Detail table
    const rows = data.conceptos.map(c => [c.concepto, fmt(c.importe, data.currency)]);
    y = drawTable(doc, y, ['Concepto', 'Importe'], rows, {
      colWidths: [W * 0.7, W * 0.3],
      fontSize: 8.5,
      headerFontSize: 8,
      colAligns: ['left', 'right']
    });

    // Total - black box
    y += 8;
    const totalH = 34;
    fillR(doc, PAGE.margin, y, W, totalH, C.black, 0);

    doc.font(F.b).fontSize(11).fillColor(C.white)
      .text('TOTAL A PAGAR', PAGE.margin + 14, y + 10);
    doc.text(fmt(data.total, data.currency), PAGE.margin + 14, y + 10, { width: W - 28, align: 'right' });
    y += totalH + 10;

    // Amount in words
    if (data.totalEnLetras) {
      doc.font(F.r).fontSize(8).fillColor(C.dark)
        .text(`Son: ${data.totalEnLetras}`, PAGE.margin + 4, y, { width: W - 8 });
      y += 18;
    }

    // Honorarios section
    if (data.honorarios) {
      y += 4;
      const honH = 50;
      fillR(doc, PAGE.margin, y, W, honH, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, honH, C.line, 0.5, 0);

      doc.font(F.r).fontSize(9).fillColor(C.dark)
        .text(`Honorarios (${data.honorarios.porcentaje}%):`, PAGE.margin + 12, y + 10);
      doc.font(F.b).fillColor(C.black)
        .text(fmt(data.honorarios.monto, data.currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });

      doc.font(F.b).fontSize(10).fillColor(C.black)
        .text('Neto a transferir:', PAGE.margin + 12, y + 30);
      doc.text(fmt(data.honorarios.netoTransferir, data.currency), PAGE.margin + 12, y + 30, { width: W - 24, align: 'right' });

      y += honH + 10;
    }

    // Payments section
    if (data.transacciones && data.transacciones.length > 0) {
      y += 12;
      y = drawSection(doc, y, 'Pagos Registrados');

      // Payments table
      const payRows = data.transacciones.map(t => {
        const metodo = t.metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo';
        return [fmtDate(t.fecha), metodo, fmt(t.monto, data.currency)];
      });

      y = drawTable(doc, y, ['Fecha', 'Método', 'Monto'], payRows, {
        colWidths: [W * 0.3, W * 0.35, W * 0.35],
        fontSize: 8.5,
        headerFontSize: 7.5,
        colAligns: ['left', 'left', 'right']
      });

      // Payment summary
      y += 12;
      fillR(doc, PAGE.margin, y, W, 50, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, 50, C.line, 0.5, 0);

      doc.font(F.b).fontSize(9).fillColor(C.black)
        .text('Total Pagado:', PAGE.margin + 12, y + 10);
      doc.text(fmt(data.amountPaid, data.currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });

      if (data.balance !== 0) {
        const balLabel = data.balance > 0 ? 'Saldo a Favor:' : 'Saldo Pendiente:';

        doc.fillColor(C.dark)
          .text(balLabel, PAGE.margin + 12, y + 28);
        doc.font(F.b).fillColor(C.black)
          .text(fmt(Math.abs(data.balance), data.currency), PAGE.margin + 12, y + 28, { width: W - 24, align: 'right' });
      }

      y += 50 + 10;
    }

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

const generateEstadoCuentasPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);
    y = drawTitle(doc, y, 'Estado de Cuentas', `${data.inquilino.nombre} · ${data.propiedad.direccion}`);

    y = drawMetrics(doc, y, [
      { label: 'Total Pagado', value: fmt(data.resumen.totalPagado, data.currency) },
      { label: 'Total Adeudado', value: fmt(data.resumen.totalAdeudado, data.currency) },
      { label: 'Balance', value: fmt(data.resumen.balance, data.currency) },
    ]);

    const rows = data.historial.map(h => [
      h.periodo, fmt(h.alquiler, data.currency), fmt(h.servicios, data.currency),
      fmt(h.totalDue, data.currency), fmt(h.amountPaid, data.currency), fmt(h.balance, data.currency),
      h.isPaid ? 'Pagado' : h.status === 'PARTIAL' ? 'Parcial' : 'Pendiente',
    ]);

    y = drawTable(doc, y, ['Período', 'Alquiler', 'Servicios', 'Total', 'Pagado', 'Saldo', 'Estado'], rows, {
      colWidths: [W * .16, W * .14, W * .13, W * .14, W * .14, W * .14, W * .15],
      fontSize: 7.5, headerFontSize: 6.5, rowHeight: 18, headerHeight: 22,
    });

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

const generateResumenEjecutivoPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);
    y = drawTitle(doc, y, 'Resumen Ejecutivo', data.periodo.label);

    y = drawMetrics(doc, y, [
      { label: 'Ingresos', value: fmt(data.kpis.ingresosMes, data.currency) },
      { label: 'Facturado', value: fmt(data.kpis.totalDueMes, data.currency) },
      { label: 'Cobranza', value: `${data.kpis.cobranza}%` },
    ]);
    y = drawMetrics(doc, y, [
      { label: 'Deuda Total', value: fmt(data.kpis.totalDeuda, data.currency) },
      { label: 'Punitorios', value: fmt(data.kpis.punitoryMes, data.currency) },
      { label: 'Ocupación', value: `${data.kpis.ocupacion}%` },
    ]);

    if (data.kpis.variacionIngresos !== null) {
      const v = parseFloat(data.kpis.variacionIngresos);
      doc.font(F.r).fontSize(9).fillColor(C.medium).text('Variación vs. mes anterior: ', PAGE.margin, y, { continued: true });
      doc.font(F.b).fillColor(C.black).text(`${v >= 0 ? '+' : ''}${data.kpis.variacionIngresos}%`);
      y += 20;
    }

    y = drawSection(doc, y, 'Estado de Pagos');
    const total = data.estadoPagos.total || 1;
    y = drawTable(doc, y, ['Estado', 'Cantidad', 'Porcentaje'], [
      ['Pagados', String(data.estadoPagos.pagados), `${((data.estadoPagos.pagados / total) * 100).toFixed(0)}%`],
      ['Parciales', String(data.estadoPagos.parciales), `${((data.estadoPagos.parciales / total) * 100).toFixed(0)}%`],
      ['Pendientes', String(data.estadoPagos.pendientes), `${((data.estadoPagos.pendientes / total) * 100).toFixed(0)}%`],
    ], { colWidths: [W * .4, W * .3, W * .3] });

    y += 14;
    y = drawSection(doc, y, 'General');
    [[' Contratos activos', data.kpis.contratosActivos], ['Propiedades', data.kpis.totalPropiedades], ['Deudas abiertas', data.kpis.deudasAbiertas]].forEach(([k, v]) => {
      doc.font(F.r).fontSize(8.5).fillColor(C.muted).text(`${k}:`, PAGE.margin, y, { continued: true });
      doc.font(F.b).fillColor(C.dark).text(` ${v}`);
      y += 14;
    });

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

const generateCartaDocumentoPDF = (data, customMessage) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);
    y = drawTitle(doc, y, 'Carta Documento', 'Intimación de Pago');

    const city = data.empresa.ciudad || 'Córdoba';
    doc.font(F.r).fontSize(9).fillColor(C.medium)
      .text(`${city}, ${fmtDateLong(data.fecha)}`, PAGE.margin, y, { width: W, align: 'right' });
    y += 22;

    y = drawInfo(doc, y, [['Sr./Sra.', data.deudor.nombre], ['DNI/CUIT', data.deudor.dni], ['Propiedad', data.propiedad.direccion]]);

    const defaultMsg = `Por la presente, nos dirigimos a Ud. en nuestra calidad de administradores del inmueble sito en ${data.propiedad.direccion}, a fin de intimarlo al pago de las sumas adeudadas en concepto de alquiler, conforme al detalle que se indica a continuación.`;
    doc.font(F.r).fontSize(9.5).fillColor(C.dark).text(customMessage || defaultMsg, PAGE.margin, y, { width: W, align: 'justify', lineGap: 5 });
    y = doc.y + 18;

    if (data.deudas.length > 0) {
      y = drawSection(doc, y, 'Detalle de Deuda');
      const rows = data.deudas.map(d => [d.periodo, fmt(d.monto, data.currency), fmt(d.punitorios, data.currency)]);
      y = drawTable(doc, y, ['Período', 'Monto Adeudado', 'Punitorios'], rows, {
        colWidths: [W * .4, W * .3, W * .3], totalRow: ['Total Adeudado', fmt(data.totalDeuda, data.currency), ''],
      });
      y += 18;
    }

    doc.font(F.r).fontSize(9.5).fillColor(C.dark)
      .text('Le informamos que, de no efectuarse el pago dentro de los próximos 10 (diez) días hábiles, se procederá a iniciar las acciones legales correspondientes, sin perjuicio de los punitorios que continúen devengándose.', PAGE.margin, y, { width: W, align: 'justify', lineGap: 5 });
    y = doc.y + 30;

    doc.font(F.i).fontSize(9).fillColor(C.medium).text('Sin otro particular, lo saluda atentamente,', PAGE.margin, y);
    y += 32;
    doc.strokeColor(C.light).lineWidth(0.5).moveTo(PAGE.margin, y).lineTo(PAGE.margin + 160, y).stroke();
    y += 6;
    doc.font(F.b).fontSize(8.5).fillColor(C.black).text(data.empresa.nombre || 'Inmobiliaria', PAGE.margin, y);
    if (data.empresa.cuit) { y += 12; doc.font(F.r).fontSize(7.5).fillColor(C.muted).text(`CUIT ${data.empresa.cuit}`, PAGE.margin, y); }

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

const generatePagoEfectivoPDF = (data) => {
  return new Promise((resolve, reject) => {
    // Compact receipt - dynamic height based on content
    const rW = 420; // receipt width
    const rMargin = 20;
    const rContent = rW - rMargin * 2;
    // Estimate height: base ~280 + ~15 per concept row
    const estimatedH = 280 + (data.conceptos.length * 15);
    const rH = Math.max(320, Math.min(estimatedH, 520));
    const doc = new PDFDocument({ size: [rW, rH], margin: rMargin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    const emp = data.empresa;
    let y = rMargin;

    // ── TOP ROW: Left (logo + company info) | Right (receipt box) ──
    const leftW = rContent * 0.58;
    const rightW = rContent * 0.38;
    const rightX = rMargin + leftW + rContent * 0.04;

    // Logo
    let lx = rMargin + 4;
    if (emp.logo && emp.logo.startsWith('data:image')) {
      try {
        const buf2 = Buffer.from(emp.logo.split(',')[1], 'base64');
        doc.image(buf2, lx, y, { height: 32 });
        lx += 38;
      } catch (e) { /* skip */ }
    }

    // Company name + contact
    doc.font(F.b).fontSize(9).fillColor(C.black)
      .text(emp.nombre || 'Inmobiliaria', lx, y, { width: leftW - 40 });
    y += 12;
    doc.font(F.r).fontSize(7).fillColor(C.dark);
    if (emp.direccion) { doc.text(emp.direccion, lx, y, { width: leftW - 40 }); y += 9; }
    if (emp.telefono) {
      const phones = emp.telefono.split(';').map(p => p.trim()).filter(Boolean);
      for (const p of phones) { doc.text(p, lx, y, { width: leftW - 40 }); y += 9; }
    }
    if (emp.email) {
      const emails = emp.email.split(';').map(e => e.trim()).filter(Boolean);
      for (const e of emails) { doc.text(e, lx, y, { width: leftW - 40 }); y += 9; }
    }

    // Right: Receipt number box
    const boxY = rMargin;
    const boxH = 48;
    doc.roundedRect(rightX, boxY, rightW, boxH, 4)
      .strokeColor(C.black).lineWidth(0.8).stroke();

    doc.font(F.r).fontSize(7).fillColor(C.dark)
      .text(`N° ${data.receiptNumber}`, rightX, boxY + 6, { width: rightW, align: 'center' });
    doc.font(F.b).fontSize(11).fillColor(C.black)
      .text('RECIBO', rightX, boxY + 17, { width: rightW, align: 'center' });
    doc.font(F.r).fontSize(7.5).fillColor(C.dark)
      .text(fmtDate(data.fecha), rightX, boxY + 33, { width: rightW, align: 'center' });

    y = Math.max(y, boxY + boxH + 6);

    // ── Fiscal line: CUIT, ING. BRUTOS, Fecha Inicio Act ──
    y += 4;
    doc.font(F.r).fontSize(6.5).fillColor(C.medium);
    const fiscalParts = [];
    if (emp.cuit) fiscalParts.push(`CUIT: ${emp.cuit}`);
    if (emp.ingBrutos) fiscalParts.push(`ING. BRUTOS: ${emp.ingBrutos}`);
    if (emp.fechaInicioAct) fiscalParts.push(`Inicio Act.: ${emp.fechaInicioAct}`);
    if (fiscalParts.length > 0) {
      doc.text(fiscalParts.join('    '), rMargin + 4, y, { width: rContent });
      y += 10;
    }

    // ── IVA condition centered bar ──
    if (emp.ivaCondicion) {
      y += 2;
      doc.strokeColor(C.black).lineWidth(0.5)
        .moveTo(rMargin, y).lineTo(rMargin + rContent, y).stroke();
      y += 5;
      doc.font(F.b).fontSize(8).fillColor(C.black)
        .text(emp.ivaCondicion, rMargin, y, { width: rContent, align: 'center' });
      y += 12;
      doc.strokeColor(C.black).lineWidth(0.5)
        .moveTo(rMargin, y).lineTo(rMargin + rContent, y).stroke();
      y += 8;
    }

    // ── Client data ──
    doc.font(F.r).fontSize(8).fillColor(C.dark);
    doc.text('Señor/es:', rMargin + 4, y, { continued: true });
    doc.font(F.b).text(` ${data.inquilino.nombre}${data.inquilino.dni ? ` - DNI: ${data.inquilino.dni}` : ''}`);
    y += 13;
    doc.font(F.r).fontSize(8).fillColor(C.dark);
    doc.text('Domicilio:', rMargin + 4, y, { continued: true });
    doc.font(F.b).text(` ${data.propiedad.direccion}`);
    y += 13;
    doc.font(F.r).fontSize(8).fillColor(C.dark);
    doc.text('Período:', rMargin + 4, y, { continued: true });
    doc.font(F.b).text(` ${data.periodo.label}`);
    y += 13;
    if (data.propietario?.nombre) {
      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text('Por cuenta y orden de:', rMargin + 4, y, { continued: true });
      doc.font(F.b).text(` ${data.propietario.nombre}${data.propietario.dni ? ` - DNI: ${data.propietario.dni}` : ''}`);
      y += 13;
    }
    y += 3;

    // ── Detail table ──
    const tblX = rMargin + 4;
    const tblW = rContent - 8;
    const col1W = tblW * 0.65;
    const col2W = tblW * 0.35;

    // Header
    doc.strokeColor(C.black).lineWidth(0.5);
    doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
    y += 4;
    doc.font(F.b).fontSize(7.5).fillColor(C.black);
    doc.text('Concepto', tblX + 4, y, { width: col1W });
    doc.text('Importe', tblX + col1W, y, { width: col2W, align: 'right' });
    y += 11;
    doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
    y += 5;

    // Rows
    for (const c of data.conceptos) {
      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text(c.concepto, tblX + 4, y, { width: col1W });
      doc.text(fmt(c.importe, data.currency), tblX + col1W, y, { width: col2W, align: 'right' });
      y += 13;
    }

    // Total row
    doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
    y += 5;
    doc.font(F.b).fontSize(9).fillColor(C.black);
    doc.text('TOTAL', tblX + 4, y, { width: col1W });
    doc.text(fmt(data.total, data.currency), tblX + col1W, y, { width: col2W, align: 'right' });
    y += 13;
    doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
    y += 10;

    // ── Amount in words ──
    doc.font(F.r).fontSize(7.5).fillColor(C.dark)
      .text(`Son: ${data.totalEnLetras}`, rMargin + 4, y, { width: rContent });
    y += 14;

    // ── Outer border (drawn last, wraps content tightly) ──
    const borderBottom = y + 4;
    doc.roundedRect(rMargin - 4, rMargin - 4, rContent + 8, borderBottom - rMargin + 8, 6)
      .strokeColor(C.black).lineWidth(1.2).stroke();

    doc.end();
  });
};

const generateMultiPagoEfectivoPDF = (dataArray) => {
  // For multi receipts, put them on separate pages with same format
  return new Promise((resolve, reject) => {
    const rW = 420;
    const rMargin = 20;
    const rContent = rW - rMargin * 2;
    // Use max estimated height across all receipts
    const maxConcepts = Math.max(...dataArray.map(d => d.conceptos.length), 2);
    const rH = Math.max(320, Math.min(280 + maxConcepts * 15, 520));
    const doc = new PDFDocument({ size: [rW, rH], margin: rMargin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    dataArray.forEach((data, idx) => {
      if (idx > 0) doc.addPage();

      const emp = data.empresa;
      let y = rMargin;

      const leftW = rContent * 0.58;
      const rightW = rContent * 0.38;
      const rightX = rMargin + leftW + rContent * 0.04;

      let lx = rMargin + 4;
      if (emp.logo && emp.logo.startsWith('data:image')) {
        try {
          const buf2 = Buffer.from(emp.logo.split(',')[1], 'base64');
          doc.image(buf2, lx, y, { height: 32 });
          lx += 38;
        } catch (e) { /* skip */ }
      }

      doc.font(F.b).fontSize(9).fillColor(C.black).text(emp.nombre || 'Inmobiliaria', lx, y, { width: leftW - 40 });
      y += 12;
      doc.font(F.r).fontSize(7).fillColor(C.dark);
      if (emp.direccion) { doc.text(emp.direccion, lx, y, { width: leftW - 40 }); y += 9; }
      if (emp.telefono) {
        const phones = emp.telefono.split(';').map(p => p.trim()).filter(Boolean);
        for (const p of phones) { doc.text(p, lx, y, { width: leftW - 40 }); y += 9; }
      }
      if (emp.email) {
        const emails = emp.email.split(';').map(e => e.trim()).filter(Boolean);
        for (const e of emails) { doc.text(e, lx, y, { width: leftW - 40 }); y += 9; }
      }

      const boxY = rMargin;
      const boxH = 48;
      doc.roundedRect(rightX, boxY, rightW, boxH, 4).strokeColor(C.black).lineWidth(0.8).stroke();
      doc.font(F.r).fontSize(7).fillColor(C.dark).text(`N° ${data.receiptNumber}`, rightX, boxY + 6, { width: rightW, align: 'center' });
      doc.font(F.b).fontSize(11).fillColor(C.black).text('RECIBO', rightX, boxY + 17, { width: rightW, align: 'center' });
      doc.font(F.r).fontSize(7.5).fillColor(C.dark).text(fmtDate(data.fecha), rightX, boxY + 33, { width: rightW, align: 'center' });

      y = Math.max(y, boxY + boxH + 6);
      y += 4;

      doc.font(F.r).fontSize(6.5).fillColor(C.medium);
      const fiscalParts = [];
      if (emp.cuit) fiscalParts.push(`CUIT: ${emp.cuit}`);
      if (emp.ingBrutos) fiscalParts.push(`ING. BRUTOS: ${emp.ingBrutos}`);
      if (emp.fechaInicioAct) fiscalParts.push(`Inicio Act.: ${emp.fechaInicioAct}`);
      if (fiscalParts.length > 0) { doc.text(fiscalParts.join('    '), rMargin + 4, y, { width: rContent }); y += 10; }

      if (emp.ivaCondicion) {
        y += 2;
        doc.strokeColor(C.black).lineWidth(0.5).moveTo(rMargin, y).lineTo(rMargin + rContent, y).stroke();
        y += 5;
        doc.font(F.b).fontSize(8).fillColor(C.black).text(emp.ivaCondicion, rMargin, y, { width: rContent, align: 'center' });
        y += 12;
        doc.strokeColor(C.black).lineWidth(0.5).moveTo(rMargin, y).lineTo(rMargin + rContent, y).stroke();
        y += 8;
      }

      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text('Señor/es:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.inquilino.nombre}${data.inquilino.dni ? ` - DNI: ${data.inquilino.dni}` : ''}`); y += 13;
      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text('Domicilio:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.propiedad.direccion}`); y += 13;
      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text('Período:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.periodo.label}`); y += 13;
      if (data.propietario?.nombre) {
        doc.font(F.r).fontSize(8).fillColor(C.dark);
        doc.text('Por cuenta y orden de:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.propietario.nombre}${data.propietario.dni ? ` - DNI: ${data.propietario.dni}` : ''}`); y += 13;
      }
      y += 3;

      const tblX = rMargin + 4;
      const tblW = rContent - 8;
      const col1W = tblW * 0.65;
      const col2W = tblW * 0.35;

      doc.strokeColor(C.black).lineWidth(0.5).moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
      y += 4;
      doc.font(F.b).fontSize(7.5).fillColor(C.black);
      doc.text('Concepto', tblX + 4, y, { width: col1W });
      doc.text('Importe', tblX + col1W, y, { width: col2W, align: 'right' });
      y += 11;
      doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
      y += 5;

      for (const c of data.conceptos) {
        doc.font(F.r).fontSize(8).fillColor(C.dark);
        doc.text(c.concepto, tblX + 4, y, { width: col1W });
        doc.text(fmt(c.importe, data.currency), tblX + col1W, y, { width: col2W, align: 'right' });
        y += 13;
      }

      doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
      y += 5;
      doc.font(F.b).fontSize(9).fillColor(C.black);
      doc.text('TOTAL', tblX + 4, y, { width: col1W });
      doc.text(fmt(data.total, data.currency), tblX + col1W, y, { width: col2W, align: 'right' });
      y += 13;
      doc.moveTo(tblX, y).lineTo(tblX + tblW, y).stroke();
      y += 10;

      doc.font(F.r).fontSize(7.5).fillColor(C.dark).text(`Son: ${data.totalEnLetras}`, rMargin + 4, y, { width: rContent });
      y += 14;

      // Outer border (wraps content tightly)
      const borderBottom = y + 4;
      doc.roundedRect(rMargin - 4, rMargin - 4, rContent + 8, borderBottom - rMargin + 8, 6)
        .strokeColor(C.black).lineWidth(1.2).stroke();
    });

    doc.end();
  });
};

const generateImpuestosPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);
    y = drawTitle(doc, y, 'Detalle de Impuestos y Servicios',
      `${data.periodo.label}${data.periodo.labelVencido ? ' · Mes vencido: ' + data.periodo.labelVencido : ''}`);

    // Metric card with grand total
    y = drawMetrics(doc, y, [
      { label: 'Total Impuestos y Servicios', value: fmt(data.grandTotal, data.currency) },
      { label: 'Propiedades', value: String(data.impuestos.length) },
    ]);

    // ── Detail by property ──
    const checkNewPage = (need) => {
      if (y + need > PAGE.height - 80) {
        doc.addPage();
        y = PAGE.margin;
        return true;
      }
      return false;
    };

    for (const item of data.impuestos) {
      checkNewPage(70);

      // Property card - thin border, no color accent
      const itemRows = item.impuestos.length;
      const cardH = itemRows * 20 + 34;
      fillR(doc, PAGE.margin, y, W, cardH, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, cardH, C.line, 0.5, 0);

      // Property - Tenant title
      doc.font(F.b).fontSize(9).fillColor(C.black)
        .text(`${item.propiedad}`, PAGE.margin + 12, y + 8, { width: W * 0.6 });
      doc.font(F.r).fontSize(8).fillColor(C.medium)
        .text(item.inquilino, PAGE.margin + 12, y + 20, { width: W * 0.6 });

      // Subtotal on right side of header
      const subtotal = item.impuestos.reduce((s, i) => s + (i.monto || 0), 0);
      doc.font(F.b).fontSize(10).fillColor(C.black)
        .text(fmt(subtotal, data.currency), PAGE.margin + 12, y + 8, { width: W - 24, align: 'right' });

      let iy = y + 36;

      // Tax items
      for (const imp of item.impuestos) {
        doc.font(F.r).fontSize(8).fillColor(C.medium)
          .text(imp.concepto, PAGE.margin + 24, iy, { width: W * 0.55 });
        doc.font(F.r).fontSize(8).fillColor(C.dark)
          .text(fmt(imp.monto, data.currency), PAGE.margin + 24, iy, { width: W - 48, align: 'right' });
        iy += 20;
      }

      y += cardH + 10;
    }

    // ── Total ──
    checkNewPage(60);
    y += 4;
    const totalH = 34;
    fillR(doc, PAGE.margin, y, W, totalH, C.black, 0);

    doc.font(F.b).fontSize(11).fillColor(C.white)
      .text('TOTAL', PAGE.margin + 14, y + 10);
    doc.text(fmt(data.grandTotal, data.currency), PAGE.margin + 14, y + 10, { width: W - 28, align: 'right' });
    y += totalH + 10;

    // Amount in words
    if (data.grandTotalEnLetras) {
      doc.font(F.r).fontSize(8).fillColor(C.dark)
        .text(`Son: ${data.grandTotalEnLetras}`, PAGE.margin + 4, y, { width: W - 8 });
      y += 20;
    }

    // ── Bank details section - grouped by unique owner ──
    const ownerBanks = new Map();
    for (const item of data.impuestos) {
      if (item.banco && item.banco.nombre) {
        const key = item.banco.cbu || item.banco.nombre + item.banco.titular;
        if (!ownerBanks.has(key)) {
          ownerBanks.set(key, { propietario: item.propietario, banco: item.banco });
        }
      }
    }

    if (ownerBanks.size > 0) {
      checkNewPage(100);
      y += 6;
      y = drawSection(doc, y, 'Datos Bancarios para Transferencia');

      for (const { propietario, banco } of ownerBanks.values()) {
        checkNewPage(100);

        const bankFields = [
          banco.nombre ? ['Banco', banco.nombre] : null,
          banco.titular ? ['Titular', banco.titular] : null,
          banco.cuit ? ['CUIT', banco.cuit] : null,
          banco.tipoCuenta ? ['Tipo Cuenta', banco.tipoCuenta] : null,
          banco.numeroCuenta ? ['N° Cuenta', banco.numeroCuenta] : null,
          banco.cbu ? ['CBU', banco.cbu] : null,
          banco.alias ? ['Alias', banco.alias] : null,
        ].filter(Boolean);

        // Owner name badge
        const pillW = doc.font(F.b).fontSize(7).widthOfString(propietario) + 16;
        fillR(doc, PAGE.margin, y, pillW, 17, C.cloud, 8);
        doc.font(F.b).fontSize(7).fillColor(C.dark)
          .text(propietario, PAGE.margin + 8, y + 4);
        y += 24;

        // Bank info card
        const bankH = bankFields.length * 16 + 12;
        fillR(doc, PAGE.margin, y, W, bankH, C.snow);
        strokeR(doc, PAGE.margin, y, W, bankH, C.line, 0.5);

        let by = y + 8;
        for (const [k, v] of bankFields) {
          doc.font(F.r).fontSize(7.5).fillColor(C.muted).text(k, PAGE.margin + 14, by, { width: 80 });
          doc.font(F.b).fontSize(8).fillColor(C.dark).text(v, PAGE.margin + 94, by, { width: W - 110 });
          by += 16;
        }

        y += bankH + 12;
      }
    }

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

const generateVencimientosPDF = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    let y = drawHeader(doc, data.empresa);
    y = drawTitle(doc, y, 'Contratos por Vencer', `Generado: ${fmtDateLong(data.fecha)}`);

    if (data.vencimientos.length === 0) {
      y += 16;
      fillR(doc, PAGE.margin, y, W, 44, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, 44, C.line, 0.5, 0);
      doc.font(F.r).fontSize(10).fillColor(C.dark)
        .text('No hay contratos por vencer en los próximos 2 meses.', PAGE.margin, y + 15, { width: W, align: 'center' });
    } else {
      y = drawMetrics(doc, y, [
        { label: 'Contratos por Vencer', value: String(data.vencimientos.length) },
      ]);

      const rows = data.vencimientos.map(v => [v.inquilino, v.propiedad, fmtDate(v.inicio), fmtDate(v.vencimiento), fmt(v.alquiler, data.currency)]);
      y = drawTable(doc, y, ['Inquilino', 'Propiedad', 'Inicio', 'Vencimiento', 'Alquiler'], rows, {
        colWidths: [W * .22, W * .28, W * .15, W * .17, W * .18], fontSize: 7.5, headerFontSize: 7,
      });
    }

    drawFooter(doc, data.empresa, 1);
    doc.end();
  });
};

// ============================================
// LIQUIDACION ALL - Multi-contract consolidated
// ============================================

const generateLiquidacionAllPDF = (dataArray) => {
  const { numeroATexto } = require('../utils/helpers');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    if (dataArray.length === 0) { doc.end(); return; }

    const emp = dataArray[0].empresa;
    const currency = dataArray[0].currency;
    const periodo = dataArray[0].periodo;

    let y = drawHeader(doc, emp);
    y = drawTitle(doc, y, 'Liquidación General',
      `${periodo.label}${periodo.labelVencido ? ' · Mes vencido: ' + periodo.labelVencido : ''}`);

    // Grand total pre-calc
    let grandTotal = 0;
    for (const d of dataArray) grandTotal += d.total;

    // Metric cards
    y = drawMetrics(doc, y, [
      { label: 'Propiedades', value: String(dataArray.length) },
      { label: 'Total Liquidación', value: fmt(grandTotal, currency) },
    ]);

    const checkNewPage = (need) => {
      if (y + need > PAGE.height - 80) {
        doc.addPage();
        y = PAGE.margin;
      }
    };

    // ── SECTION: Detail per property ──
    y = drawSection(doc, y, 'Detalle por Propiedad');

    for (const data of dataArray) {
      const conceptosFiltered = data.conceptos.filter(c => {
        if (c.concepto.includes('Punitorios') && c.importe === 0) return false;
        return true;
      });

      const cardRows = conceptosFiltered.length;
      const cardH = cardRows * 18 + 46;
      checkNewPage(cardH + 10);

      // Property card - thin border, no color accent
      fillR(doc, PAGE.margin, y, W, cardH, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, cardH, C.line, 0.5, 0);

      // Property address + tenant
      const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');
      doc.font(F.b).fontSize(9).fillColor(C.black)
        .text(addr, PAGE.margin + 12, y + 8, { width: W * 0.6 });
      doc.font(F.r).fontSize(8).fillColor(C.medium)
        .text(`${data.inquilino.nombre}${data.inquilino.dni ? ` - DNI: ${data.inquilino.dni}` : ''}`, PAGE.margin + 12, y + 20, { width: W * 0.6 });

      // Subtotal on right
      doc.font(F.b).fontSize(10).fillColor(C.black)
        .text(fmt(data.total, currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });

      let iy = y + 38;

      // Conceptos
      for (const c of conceptosFiltered) {
        const label = c.concepto.includes('Punitorios (0') ? 'Punitorios' : c.concepto;
        doc.font(F.r).fontSize(8).fillColor(C.medium)
          .text(label, PAGE.margin + 24, iy, { width: W * 0.55 });
        doc.font(F.r).fontSize(8).fillColor(C.dark)
          .text(fmt(c.importe, currency), PAGE.margin + 24, iy, { width: W - 48, align: 'right' });
        iy += 18;
      }

      y += cardH + 10;
    }

    // ── TOTAL ──
    checkNewPage(60);
    y += 4;
    const totalH = 34;
    fillR(doc, PAGE.margin, y, W, totalH, C.black, 0);

    doc.font(F.b).fontSize(11).fillColor(C.white)
      .text('TOTAL', PAGE.margin + 14, y + 10);
    doc.text(fmt(grandTotal, currency), PAGE.margin + 14, y + 10, { width: W - 28, align: 'right' });
    y += totalH + 10;

    // Amount in words
    const totalLetras = numeroATexto(grandTotal);
    doc.font(F.r).fontSize(8).fillColor(C.dark)
      .text(`Son: ${totalLetras}`, PAGE.margin + 4, y, { width: W - 8 });
    y += 24;

    // ── Honorarios (if any contract has them) ──
    const firstHon = dataArray.find(d => d.honorarios);
    if (firstHon) {
      checkNewPage(70);
      const totalHon = dataArray.reduce((s, d) => s + (d.honorarios?.monto || 0), 0);
      const totalNeto = dataArray.reduce((s, d) => s + (d.honorarios?.netoTransferir || d.total), 0);

      const honH = 50;
      fillR(doc, PAGE.margin, y, W, honH, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, honH, C.line, 0.5, 0);

      doc.font(F.r).fontSize(9).fillColor(C.dark)
        .text(`Honorarios (${firstHon.honorarios.porcentaje}%):`, PAGE.margin + 12, y + 10);
      doc.font(F.b).fillColor(C.black)
        .text(fmt(totalHon, currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });

      doc.font(F.b).fontSize(10).fillColor(C.black)
        .text('Neto a transferir:', PAGE.margin + 12, y + 30);
      doc.text(fmt(totalNeto, currency), PAGE.margin + 12, y + 30, { width: W - 24, align: 'right' });

      y += honH + 10;
    }

    // ── SECTION: Payments ──
    const allTransactions = [];
    for (const data of dataArray) {
      for (const t of (data.transacciones || [])) {
        allTransactions.push(t);
      }
    }

    if (allTransactions.length > 0) {
      checkNewPage(80);
      y = drawSection(doc, y, 'Pagos Registrados');

      // Sort by date
      allTransactions.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

      const payRows = allTransactions.map(t => {
        const metodo = t.metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo';
        return [fmtDate(t.fecha), t.inquilino || '-', metodo, fmt(t.monto, currency)];
      });

      y = drawTable(doc, y, ['Fecha', 'Inquilino', 'Medio', 'Monto'], payRows, {
        colWidths: [W * 0.18, W * 0.34, W * 0.2, W * 0.28],
        fontSize: 8,
        headerFontSize: 7,
        colAligns: ['left', 'left', 'left', 'right'],
      });

      // Payment summary card
      const totalPagado = allTransactions.reduce((s, t) => s + t.monto, 0);
      const saldo = grandTotal - totalPagado;

      y += 12;
      const summaryH = Math.abs(saldo) > 0.01 ? 50 : 34;
      fillR(doc, PAGE.margin, y, W, summaryH, C.snow, 0);
      strokeR(doc, PAGE.margin, y, W, summaryH, C.line, 0.5, 0);

      doc.font(F.b).fontSize(9).fillColor(C.black)
        .text('Total Pagado:', PAGE.margin + 12, y + 10);
      doc.text(fmt(totalPagado, currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });

      if (Math.abs(saldo) > 0.01) {
        const balLabel = saldo > 0 ? 'Saldo Pendiente:' : 'Saldo a Favor:';

        doc.fillColor(C.dark)
          .text(balLabel, PAGE.margin + 12, y + 28);
        doc.font(F.b).fillColor(C.black)
          .text(fmt(Math.abs(saldo), currency), PAGE.margin + 12, y + 28, { width: W - 24, align: 'right' });
      }

      y += summaryH + 10;
    }

    drawFooter(doc, emp, 1);
    doc.end();
  });
};

module.exports = {
  generateLiquidacionPDF, generateLiquidacionAllPDF, generateEstadoCuentasPDF, generateResumenEjecutivoPDF,
  generateCartaDocumentoPDF, generatePagoEfectivoPDF, generateMultiPagoEfectivoPDF,
  generateImpuestosPDF, generateVencimientosPDF, formatCurrency: fmt, formatDate: fmtDate, COLORS: C,
};
