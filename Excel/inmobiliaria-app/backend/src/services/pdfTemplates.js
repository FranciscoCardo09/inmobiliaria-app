// PDF Templates - Modern minimal design
const PDFDocument = require('pdfkit');
const { MONTH_NAMES } = require('./reportDataService');

// ============================================
// DESIGN TOKENS - Modern minimal palette
// ============================================

const C = {
  // Primary
  brand: '#2563EB',
  brandDark: '#1D4ED8',
  brandLight: '#EFF6FF',

  // Gradients (used as solid fallbacks)
  gradStart: '#2563EB',
  gradEnd: '#7C3AED',

  // Text
  black: '#0F172A',
  dark: '#1E293B',
  medium: '#475569',
  muted: '#94A3B8',
  light: '#CBD5E1',

  // Backgrounds
  white: '#FFFFFF',
  snow: '#F8FAFC',
  cloud: '#F1F5F9',
  line: '#E2E8F0',

  // Status
  green: '#10B981',
  greenBg: '#F0FDF4',
  amber: '#F59E0B',
  amberBg: '#FFFBEB',
  red: '#EF4444',
  redBg: '#FEF2F2',
  purple: '#8B5CF6',
};

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
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
// HEADER - Clean modern with left accent
// ============================================

const drawHeader = (doc, emp) => {
  // Thin top gradient line
  doc.rect(0, 0, PAGE.width, 3).fill(C.brand);

  // White header area with bottom border
  doc.rect(0, 3, PAGE.width, 64).fill(C.white);
  doc.strokeColor(C.line).lineWidth(0.5).moveTo(0, 67).lineTo(PAGE.width, 67).stroke();

  // Logo
  let tx = PAGE.margin;
  if (emp.logo && emp.logo.startsWith('data:image')) {
    try {
      const buf = Buffer.from(emp.logo.split(',')[1], 'base64');
      doc.image(buf, PAGE.margin, 10, { height: 48 });
      tx = PAGE.margin + 58;
    } catch (e) { /* skip */ }
  }

  // Company name - clean and bold
  doc.font(F.b).fontSize(16).fillColor(C.black)
    .text(emp.nombre || 'Inmobiliaria', tx, 14, { width: 260 });

  // Subtitle line
  const sub = [emp.direccion, emp.ciudad].filter(Boolean).join(' · ');
  if (sub) {
    doc.font(F.r).fontSize(7.5).fillColor(C.muted).text(sub, tx, 34, { width: 260 });
  }

  // Right side details
  const rx = PAGE.width - PAGE.margin - 160;
  let ry = 12;
  doc.font(F.r).fontSize(7.5).fillColor(C.medium);
  if (emp.cuit) { doc.text(`CUIT ${emp.cuit}`, rx, ry, { width: 160, align: 'right' }); ry += 12; }
  if (emp.telefono) { doc.text(emp.telefono, rx, ry, { width: 160, align: 'right' }); ry += 12; }
  if (emp.email) { doc.text(emp.email, rx, ry, { width: 160, align: 'right' }); ry += 12; }

  doc.fillColor(C.dark);
  return 84;
};

// ============================================
// FOOTER
// ============================================

const drawFooter = (doc, emp, pg) => {
  const fy = PAGE.height - 30;
  doc.strokeColor(C.line).lineWidth(0.3).moveTo(PAGE.margin, fy - 6).lineTo(PAGE.width - PAGE.margin, fy - 6).stroke();

  const parts = [emp.nombre || 'Inmobiliaria'];
  if (emp.cuit) parts.push(`CUIT ${emp.cuit}`);

  doc.font(F.r).fontSize(6).fillColor(C.muted)
    .text(parts.join('  ·  '), PAGE.margin, fy, { width: W - 40 });
  if (pg) doc.text(`${pg}`, PAGE.width - PAGE.margin - 30, fy, { width: 30, align: 'right' });
  doc.fillColor(C.dark);
};

// ============================================
// TITLE - Minimal centered
// ============================================

const drawTitle = (doc, y, title, sub) => {
  doc.font(F.b).fontSize(13).fillColor(C.black)
    .text(title.toUpperCase(), PAGE.margin, y, { width: W, align: 'center', characterSpacing: 2 });
  y += 20;

  if (sub) {
    doc.font(F.r).fontSize(9).fillColor(C.muted)
      .text(sub, PAGE.margin, y, { width: W, align: 'center' });
    y += 14;
  }

  // Thin accent line
  const lw = 40;
  doc.strokeColor(C.brand).lineWidth(1.5)
    .moveTo((PAGE.width - lw) / 2, y).lineTo((PAGE.width + lw) / 2, y).stroke();

  return y + 20;
};

// ============================================
// INFO CARD - Minimal with left accent
// ============================================

const drawInfo = (doc, y, left, right) => {
  const rows = Math.max(left.length, (right || []).length);
  const h = rows * 16 + 16;

  // Card background
  fillR(doc, PAGE.margin, y, W, h, C.snow);
  // Left accent bar
  doc.save(); doc.rect(PAGE.margin, y + 4, 3, h - 8).fill(C.brand); doc.restore();

  const lx = PAGE.margin + 16;
  const mx = PAGE.margin + W / 2 + 8;
  let ly = y + 10;

  for (const [k, v] of left) {
    doc.font(F.r).fontSize(7.5).fillColor(C.muted).text(k, lx, ly);
    doc.font(F.b).fontSize(8.5).fillColor(C.dark).text(v || '-', lx + 65, ly, { width: W / 2 - 90 });
    ly += 16;
  }

  if (right) {
    let ry2 = y + 10;
    for (const [k, v] of right) {
      doc.font(F.r).fontSize(7.5).fillColor(C.muted).text(k, mx, ry2);
      doc.font(F.b).fontSize(8.5).fillColor(C.dark).text(v || '-', mx + 65, ry2, { width: W / 2 - 90 });
      ry2 += 16;
    }
  }

  doc.fillColor(C.dark);
  return y + h + 12;
};

// ============================================
// METRIC CARDS - Clean with accent stripe
// ============================================

const drawMetrics = (doc, y, items) => {
  const gap = 10;
  const n = items.length;
  const bw = (W - gap * (n - 1)) / n;
  const bh = 54;

  items.forEach((it, i) => {
    const bx = PAGE.margin + i * (bw + gap);

    fillR(doc, bx, y, bw, bh, C.white);
    strokeR(doc, bx, y, bw, bh, C.line, 0.5);

    // Top accent stripe
    doc.save();
    doc.rect(bx + 8, y, bw - 16, 2.5).fill(it.accent || C.brand);
    doc.restore();

    // Label
    doc.font(F.r).fontSize(6.5).fillColor(C.muted)
      .text(it.label.toUpperCase(), bx + 10, y + 12, { width: bw - 20, characterSpacing: 0.8 });

    // Value
    doc.font(F.b).fontSize(15).fillColor(it.color || C.black)
      .text(it.value, bx + 10, y + 28, { width: bw - 20 });
  });

  doc.fillColor(C.dark);
  return y + bh + 14;
};

// ============================================
// TABLE - Modern minimal (no heavy backgrounds)
// ============================================

const drawTable = (doc, startY, headers, rows, opts = {}) => {
  const {
    colWidths = null, totalRow = null,
    fontSize = 8, headerFontSize = 7,
    rowHeight = 22, headerHeight = 28,
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

  // Header - light background, no heavy color
  newPage(headerHeight);
  fillR(doc, PAGE.margin, y, W, headerHeight, C.cloud, 4);

  let x = PAGE.margin;
  doc.font(F.b).fontSize(headerFontSize).fillColor(C.medium);
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), x + 10, y + (headerHeight - headerFontSize) / 2, {
      width: widths[i] - 20, align: aligns[i], characterSpacing: 0.6,
    });
    x += widths[i];
  });
  y += headerHeight;

  // Rows - clean with just bottom borders
  rows.forEach((row) => {
    newPage(rowHeight);

    // Bottom border only
    doc.strokeColor(C.line).lineWidth(0.3)
      .moveTo(PAGE.margin + 8, y + rowHeight - 0.5)
      .lineTo(PAGE.width - PAGE.margin - 8, y + rowHeight - 0.5).stroke();

    x = PAGE.margin;
    doc.font(F.r).fontSize(fontSize).fillColor(C.dark);

    row.forEach((cell, i) => {
      const str = String(cell ?? '-');
      // First column slightly bolder
      if (i === 0) doc.font(F.r).fillColor(C.dark);
      else doc.font(F.r).fillColor(C.medium);

      doc.text(str, x + 10, y + (rowHeight - fontSize) / 2, {
        width: widths[i] - 20, align: aligns[i],
      });
      x += widths[i];
    });

    y += rowHeight;
  });

  // Total row - accent background
  if (totalRow) {
    newPage(headerHeight + 4);
    y += 4;

    fillR(doc, PAGE.margin, y, W, headerHeight, C.brand, 4);

    x = PAGE.margin;
    doc.font(F.b).fontSize(9.5).fillColor(C.white);
    totalRow.forEach((cell, i) => {
      doc.text(String(cell ?? ''), x + 10, y + (headerHeight - 9.5) / 2, {
        width: widths[i] - 20, align: aligns[i],
      });
      x += widths[i];
    });
    y += headerHeight;
  }

  doc.fillColor(C.dark);
  return y;
};

// ============================================
// SECTION TITLE
// ============================================

const drawSection = (doc, y, title) => {
  doc.font(F.b).fontSize(10).fillColor(C.brand).text(title, PAGE.margin, y);
  y += 14;
  doc.strokeColor(C.line).lineWidth(0.3).moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).stroke();
  y += 10;
  doc.fillColor(C.dark);
  return y;
};

// ============================================
// STATUS PILL
// ============================================

const drawPill = (doc, x, y, label, color, bg) => {
  doc.font(F.b).fontSize(7);
  const pw = doc.widthOfString(label) + 14;
  fillR(doc, x, y, pw, 15, bg, 7);
  doc.fillColor(color).text(label, x + 7, y + 3.5);
  doc.fillColor(C.dark);
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
      ['Inquilino', data.inquilino.nombre],
      ['Propietario', data.propietario.nombre],
    ]);

    // Detail table
    const rows = data.conceptos.map(c => [c.concepto, fmt(c.importe, data.currency)]);
    y = drawTable(doc, y, ['Concepto', 'Importe'], rows, {
      colWidths: [W * 0.7, W * 0.3],
      fontSize: 8.5,
      headerFontSize: 8,
      colAligns: ['left', 'right']
    });

    // Total
    y += 8;
    const totalH = 36;
    fillR(doc, PAGE.margin, y, W, totalH, C.brandLight);
    strokeR(doc, PAGE.margin, y, W, totalH, C.brand, 1);
    
    doc.font(F.b).fontSize(11).fillColor(C.brandDark)
      .text('TOTAL', PAGE.margin + 16, y + 11);
    doc.text(fmt(data.total, data.currency), PAGE.margin + 16, y + 11, { width: W - 32, align: 'right' });
    y += totalH + 10;

    // Amount in words
    if (data.totalEnLetras) {
      doc.font(F.r).fontSize(7.5).fillColor(C.medium)
        .text(`Son: ${data.totalEnLetras}`, PAGE.margin + 4, y, { width: W - 8 });
      y += 18;
    }

    // Payments section
    if (data.transacciones && data.transacciones.length > 0) {
      y += 12;
      
      // Section title
      doc.font(F.b).fontSize(9.5).fillColor(C.black).text('Pagos Registrados', PAGE.margin, y);
      y += 12;
      const lw = 100;
      doc.strokeColor(C.green).lineWidth(1.2)
        .moveTo(PAGE.margin, y).lineTo(PAGE.margin + lw, y).stroke();
      y += 14;

      // Payments table
      const payRows = data.transacciones.map(t => {
        const metodo = t.metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo';
        return [fmtDate(t.fecha), metodo, fmt(t.monto, data.currency)];
      });
      
      y = drawTable(doc, y, ['Fecha', 'Método', 'Monto'], payRows, {
        colWidths: [W * 0.3, W * 0.35, W * 0.35],
        fontSize: 8,
        headerFontSize: 7.5,
        colAligns: ['left', 'left', 'right']
      });

      // Payment summary
      y += 12;
      fillR(doc, PAGE.margin, y, W, 56, C.snow);
      
      doc.font(F.b).fontSize(8.5).fillColor(C.dark)
        .text('Total Pagado:', PAGE.margin + 12, y + 10);
      doc.fillColor(C.green)
        .text(fmt(data.amountPaid, data.currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });
      
      if (data.balance !== 0) {
        const balLabel = data.balance > 0 ? 'Saldo a Favor:' : 'Saldo Pendiente:';
        const balColor = data.balance > 0 ? C.green : C.red;
        
        doc.fillColor(C.dark)
          .text(balLabel, PAGE.margin + 12, y + 28);
        doc.fillColor(balColor)
          .text(fmt(Math.abs(data.balance), data.currency), PAGE.margin + 12, y + 28, { width: W - 24, align: 'right' });
      }
      
      y += 56 + 10;
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
      { label: 'Total Pagado', value: fmt(data.resumen.totalPagado, data.currency), color: C.green, accent: C.green },
      { label: 'Total Adeudado', value: fmt(data.resumen.totalAdeudado, data.currency), color: C.red, accent: C.red },
      { label: 'Balance', value: fmt(data.resumen.balance, data.currency), color: data.resumen.balance >= 0 ? C.green : C.red, accent: C.brand },
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
      { label: 'Ingresos', value: fmt(data.kpis.ingresosMes, data.currency), color: C.green, accent: C.green },
      { label: 'Facturado', value: fmt(data.kpis.totalDueMes, data.currency), color: C.brand, accent: C.brand },
      { label: 'Cobranza', value: `${data.kpis.cobranza}%`, color: C.black, accent: C.brand },
    ]);
    y = drawMetrics(doc, y, [
      { label: 'Deuda Total', value: fmt(data.kpis.totalDeuda, data.currency), color: C.red, accent: C.red },
      { label: 'Punitorios', value: fmt(data.kpis.punitoryMes, data.currency), color: C.amber, accent: C.amber },
      { label: 'Ocupación', value: `${data.kpis.ocupacion}%`, color: C.black, accent: C.purple },
    ]);

    if (data.kpis.variacionIngresos !== null) {
      const v = parseFloat(data.kpis.variacionIngresos);
      const vc = v >= 0 ? C.green : C.red;
      doc.font(F.r).fontSize(8.5).fillColor(C.muted).text('Variación vs. mes anterior: ', PAGE.margin, y, { continued: true });
      doc.font(F.b).fillColor(vc).text(`${v >= 0 ? '+' : ''}${data.kpis.variacionIngresos}%`);
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
    // Compact receipt - half A4 height
    const rW = 420; // receipt width
    const rH = 420; // half A4 height
    const rMargin = 20;
    const rContent = rW - rMargin * 2;
    const doc = new PDFDocument({ size: [rW, rH], margin: rMargin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    const emp = data.empresa;
    let y = rMargin;

    // ── Outer border ──
    doc.roundedRect(rMargin - 4, rMargin - 4, rContent + 8, rH - rMargin * 2 + 8, 6)
      .strokeColor(C.black).lineWidth(1.2).stroke();

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
    if (emp.telefono) { doc.text(emp.telefono, lx, y, { width: leftW - 40 }); y += 9; }
    if (emp.email) { doc.text(emp.email, lx, y, { width: leftW - 40 }); y += 9; }

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
    doc.font(F.b).text(` ${data.inquilino.nombre}`);
    y += 13;
    doc.font(F.r).fontSize(8).fillColor(C.dark);
    doc.text('Domicilio:', rMargin + 4, y, { continued: true });
    doc.font(F.b).text(` ${data.propiedad.direccion}`);
    y += 13;
    doc.font(F.r).fontSize(8).fillColor(C.dark);
    doc.text('Período:', rMargin + 4, y, { continued: true });
    doc.font(F.b).text(` ${data.periodo.label}`);
    y += 16;

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

    doc.end();
  });
};

const generateMultiPagoEfectivoPDF = (dataArray) => {
  // For multi receipts, we generate individual receipt buffers and combine them
  // But since PDFKit can't easily merge, we'll put them on separate pages with same format
  return new Promise((resolve, reject) => {
    const rW = 420;
    const rH = 420;
    const rMargin = 20;
    const rContent = rW - rMargin * 2;
    const doc = new PDFDocument({ size: [rW, rH], margin: rMargin });
    const buf = [];
    doc.on('data', (c) => buf.push(c));
    doc.on('end', () => resolve(Buffer.concat(buf)));
    doc.on('error', reject);

    dataArray.forEach((data, idx) => {
      if (idx > 0) doc.addPage();

      const emp = data.empresa;
      let y = rMargin;

      // Outer border
      doc.roundedRect(rMargin - 4, rMargin - 4, rContent + 8, rH - rMargin * 2 + 8, 6)
        .strokeColor(C.black).lineWidth(1.2).stroke();

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
      if (emp.telefono) { doc.text(emp.telefono, lx, y, { width: leftW - 40 }); y += 9; }
      if (emp.email) { doc.text(emp.email, lx, y, { width: leftW - 40 }); y += 9; }

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
      doc.text('Señor/es:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.inquilino.nombre}`); y += 13;
      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text('Domicilio:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.propiedad.direccion}`); y += 13;
      doc.font(F.r).fontSize(8).fillColor(C.dark);
      doc.text('Período:', rMargin + 4, y, { continued: true }); doc.font(F.b).text(` ${data.periodo.label}`); y += 16;

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
      { label: 'Total Impuestos', value: fmt(data.grandTotal, data.currency), color: C.brand, accent: C.brand },
      { label: 'Propiedades', value: String(data.impuestos.length), color: C.dark, accent: C.purple },
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

      // Property card header with left accent
      const itemRows = item.impuestos.length;
      const cardH = itemRows * 20 + 34;
      fillR(doc, PAGE.margin, y, W, cardH, C.snow);
      doc.save(); doc.rect(PAGE.margin, y + 4, 3, cardH - 8).fill(C.brand); doc.restore();

      // Property - Tenant title
      doc.font(F.b).fontSize(9).fillColor(C.dark)
        .text(`${item.propiedad}`, PAGE.margin + 16, y + 8, { width: W * 0.6 });
      doc.font(F.r).fontSize(8).fillColor(C.muted)
        .text(item.inquilino, PAGE.margin + 16, y + 20, { width: W * 0.6 });

      // Subtotal on right side of header
      const subtotal = item.impuestos.reduce((s, i) => s + (i.monto || 0), 0);
      doc.font(F.b).fontSize(10).fillColor(C.brand)
        .text(fmt(subtotal, data.currency), PAGE.margin + 16, y + 8, { width: W - 32, align: 'right' });

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
    const totalH = 36;
    fillR(doc, PAGE.margin, y, W, totalH, C.brandLight);
    strokeR(doc, PAGE.margin, y, W, totalH, C.brand, 1);

    doc.font(F.b).fontSize(11).fillColor(C.brandDark)
      .text('TOTAL', PAGE.margin + 16, y + 11);
    doc.text(fmt(data.grandTotal, data.currency), PAGE.margin + 16, y + 11, { width: W - 32, align: 'right' });
    y += totalH + 10;

    // Amount in words
    if (data.grandTotalEnLetras) {
      doc.font(F.r).fontSize(7.5).fillColor(C.medium)
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
      fillR(doc, PAGE.margin, y, W, 44, C.greenBg);
      doc.font(F.r).fontSize(10).fillColor(C.green)
        .text('No hay contratos por vencer en los próximos 2 meses.', PAGE.margin, y + 15, { width: W, align: 'center' });
    } else {
      y = drawMetrics(doc, y, [
        { label: 'Contratos por Vencer', value: String(data.vencimientos.length), color: C.amber, accent: C.amber },
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
      { label: 'Propiedades', value: String(dataArray.length), color: C.dark, accent: C.purple },
      { label: 'Total Liquidación', value: fmt(grandTotal, currency), color: C.brand, accent: C.brand },
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

      // Property card with left accent
      fillR(doc, PAGE.margin, y, W, cardH, C.snow);
      doc.save(); doc.rect(PAGE.margin, y + 4, 3, cardH - 8).fill(C.brand); doc.restore();

      // Property address + tenant
      const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');
      doc.font(F.b).fontSize(9).fillColor(C.dark)
        .text(addr, PAGE.margin + 16, y + 8, { width: W * 0.6 });
      doc.font(F.r).fontSize(8).fillColor(C.muted)
        .text(data.inquilino.nombre, PAGE.margin + 16, y + 20, { width: W * 0.6 });

      // Subtotal on right
      doc.font(F.b).fontSize(10).fillColor(C.brand)
        .text(fmt(data.total, currency), PAGE.margin + 16, y + 10, { width: W - 32, align: 'right' });

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
    const totalH = 36;
    fillR(doc, PAGE.margin, y, W, totalH, C.brandLight);
    strokeR(doc, PAGE.margin, y, W, totalH, C.brand, 1);

    doc.font(F.b).fontSize(11).fillColor(C.brandDark)
      .text('TOTAL', PAGE.margin + 16, y + 11);
    doc.text(fmt(grandTotal, currency), PAGE.margin + 16, y + 11, { width: W - 32, align: 'right' });
    y += totalH + 10;

    // Amount in words
    const totalLetras = numeroATexto(grandTotal);
    doc.font(F.r).fontSize(7.5).fillColor(C.medium)
      .text(`Son: ${totalLetras}`, PAGE.margin + 4, y, { width: W - 8 });
    y += 24;

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
      const summaryH = Math.abs(saldo) > 0.01 ? 56 : 38;
      fillR(doc, PAGE.margin, y, W, summaryH, C.snow);

      doc.font(F.b).fontSize(8.5).fillColor(C.dark)
        .text('Total Pagado:', PAGE.margin + 12, y + 10);
      doc.fillColor(C.green)
        .text(fmt(totalPagado, currency), PAGE.margin + 12, y + 10, { width: W - 24, align: 'right' });

      if (Math.abs(saldo) > 0.01) {
        const balLabel = saldo > 0 ? 'Saldo Pendiente:' : 'Saldo a Favor:';
        const balColor = saldo > 0 ? C.red : C.green;

        doc.fillColor(C.dark)
          .text(balLabel, PAGE.margin + 12, y + 28);
        doc.fillColor(balColor)
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
