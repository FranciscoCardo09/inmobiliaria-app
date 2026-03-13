// Excel Templates - ExcelJS generators for reports
const ExcelJS = require('exceljs');
const { MONTH_NAMES } = require('./reportDataService');

const formatDocumento = (value) => {
  if (!value) return { label: 'DNI', formatted: '' };
  const digits = value.toString().replace(/\D/g, '');
  if (digits.length >= 11) {
    return { label: 'CUIL', formatted: `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` };
  }
  return { label: 'DNI', formatted: Number(digits).toLocaleString('es-AR') };
};

// Professional minimalist palette (black/gray)
const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF333333' },
};

const HEADER_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
  name: 'Arial',
};

const TOTAL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF000000' },
};

const TOTAL_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
  name: 'Arial',
};

const ALT_ROW_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF5F5F5' },
};

const BORDER_STYLE = {
  top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
};

const DATA_FONT = {
  size: 11,
  name: 'Arial',
};

const TITLE_FONT = {
  bold: true,
  size: 14,
  color: { argb: 'FF000000' },
  name: 'Arial',
};

const CURRENCY_FORMAT = '#,##0.00';

const applyHeaderStyle = (row) => {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER_STYLE;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  row.height = 25;
};

const applyDataRowStyle = (row, rowIndex) => {
  row.eachCell((cell) => {
    cell.border = BORDER_STYLE;
    cell.alignment = { vertical: 'middle' };
    cell.font = DATA_FONT;
    if (rowIndex % 2 === 0) {
      cell.fill = ALT_ROW_FILL;
    }
  });
};

const applyTotalRowStyle = (row) => {
  row.eachCell((cell) => {
    cell.fill = TOTAL_FILL;
    cell.font = TOTAL_FONT;
    cell.border = BORDER_STYLE;
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 28;
};

// ============================================
// LIQUIDACION EXCEL (all contracts in one workbook)
// ============================================

const generateLiquidacionExcel = async (dataArray) => {
  const workbook = new ExcelJS.Workbook();
  const empresaNombre = dataArray[0]?.empresa?.nombre || 'Inmobiliaria';
  workbook.creator = empresaNombre;
  workbook.created = new Date();

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Resumen');

  // Title
  summarySheet.mergeCells('A1:F1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = `LIQUIDACIONES - ${dataArray[0]?.periodo?.label || ''}`;
  titleCell.font = TITLE_FONT;
  titleCell.alignment = { horizontal: 'center' };

  // Headers
  const headerRow = summarySheet.addRow(['Inquilino', 'Propiedad', 'Alquiler', 'Servicios', 'Total', 'Estado']);
  applyHeaderStyle(headerRow);

  summarySheet.columns = [
    { width: 25 },
    { width: 30 },
    { width: 15 },
    { width: 15 },
    { width: 18 },
    { width: 12 },
  ];

  let grandTotal = 0;

  dataArray.forEach((data, i) => {
    const serviciosTotal = data.conceptos
      .filter((c) => c.concepto !== 'Alquiler')
      .reduce((sum, c) => sum + c.importe, 0);

    const row = summarySheet.addRow([
      data.inquilino.nombre,
      data.propiedad.direccion,
      data.conceptos.find((c) => c.concepto === 'Alquiler')?.importe || 0,
      serviciosTotal,
      data.total,
      data.isPaid ? 'Pagado' : data.estado === 'PARTIAL' ? 'Parcial' : 'Pendiente',
    ]);

    applyDataRowStyle(row, i);

    // Currency format for numeric columns
    row.getCell(3).numFmt = CURRENCY_FORMAT;
    row.getCell(4).numFmt = CURRENCY_FORMAT;
    row.getCell(5).numFmt = CURRENCY_FORMAT;

    grandTotal += data.total;
  });

  // Total row
  const totalRow = summarySheet.addRow(['', 'TOTAL GENERAL', '', '', grandTotal, '']);
  applyTotalRowStyle(totalRow);
  totalRow.getCell(5).numFmt = CURRENCY_FORMAT;

  // Individual sheets per tenant
  dataArray.forEach((data) => {
    const sheetName = data.inquilino.nombre.substring(0, 30).replace(/[*?/\\[\]]/g, '');
    const sheet = workbook.addWorksheet(sheetName);

    // Header info
    sheet.mergeCells('A1:C1');
    sheet.getCell('A1').value = empresaNombre.toUpperCase();
    sheet.getCell('A1').font = TITLE_FONT;

    sheet.getCell('A3').value = 'Inquilino:';
    sheet.getCell('A3').font = { bold: true };
    sheet.getCell('B3').value = data.inquilino.nombre;

    sheet.getCell('A4').value = 'Propiedad:';
    sheet.getCell('A4').font = { bold: true };
    sheet.getCell('B4').value = data.propiedad.direccion;

    sheet.getCell('A5').value = 'Período:';
    sheet.getCell('A5').font = { bold: true };
    sheet.getCell('B5').value = data.periodo.label;

    // Concepts table
    sheet.addRow([]);
    sheet.addRow([]);
    const cHeaders = sheet.addRow(['Concepto', 'Base', 'Importe']);
    applyHeaderStyle(cHeaders);

    sheet.columns = [
      { width: 30 },
      { width: 18 },
      { width: 18 },
    ];

    data.conceptos.forEach((c, i) => {
      const row = sheet.addRow([
        c.concepto,
        c.base ?? '-',
        c.importe,
      ]);
      applyDataRowStyle(row, i);
      if (typeof c.base === 'number') row.getCell(2).numFmt = CURRENCY_FORMAT;
      row.getCell(3).numFmt = CURRENCY_FORMAT;
    });

    const tRow = sheet.addRow(['TOTAL A PAGAR', '', data.total]);
    applyTotalRowStyle(tRow);
    tRow.getCell(3).numFmt = CURRENCY_FORMAT;

    // Status
    sheet.addRow([]);
    sheet.addRow([
      `Estado: ${data.isPaid ? 'PAGADO' : data.estado}`,
      data.fechaPago ? `Fecha pago: ${new Date(data.fechaPago).toLocaleDateString('es-AR')}` : '',
    ]);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

// ============================================
// ESTADO DE CUENTAS EXCEL
// ============================================

const generateEstadoCuentasExcel = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.empresa?.nombre || 'Inmobiliaria';

  const sheet = workbook.addWorksheet('Estado de Cuentas');

  // Title
  sheet.mergeCells('A1:G1');
  sheet.getCell('A1').value = 'ESTADO DE CUENTAS';
  sheet.getCell('A1').font = TITLE_FONT;
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  // Info
  sheet.getCell('A3').value = 'Inquilino:';
  sheet.getCell('A3').font = { bold: true };
  sheet.getCell('B3').value = data.inquilino.nombre;
  sheet.getCell('D3').value = `${formatDocumento(data.inquilino.dni).label}:`;
  sheet.getCell('D3').font = { bold: true };
  sheet.getCell('E3').value = formatDocumento(data.inquilino.dni).formatted;

  sheet.getCell('A4').value = 'Propiedad:';
  sheet.getCell('A4').font = { bold: true };
  sheet.getCell('B4').value = data.propiedad.direccion;

  // Summary
  sheet.getCell('A6').value = 'Total Pagado:';
  sheet.getCell('A6').font = { bold: true };
  sheet.getCell('B6').value = data.resumen.totalPagado;
  sheet.getCell('B6').numFmt = CURRENCY_FORMAT;

  sheet.getCell('C6').value = 'Total Adeudado:';
  sheet.getCell('C6').font = { bold: true };
  sheet.getCell('D6').value = data.resumen.totalAdeudado;
  sheet.getCell('D6').numFmt = CURRENCY_FORMAT;

  sheet.getCell('E6').value = 'Balance:';
  sheet.getCell('E6').font = { bold: true };
  sheet.getCell('F6').value = data.resumen.balance;
  sheet.getCell('F6').numFmt = CURRENCY_FORMAT;

  // History table
  sheet.addRow([]);
  const headerRow = sheet.addRow(['Período', 'Alquiler', 'Servicios', 'Punitorios', 'Total', 'Pagado', 'Saldo', 'Estado']);
  applyHeaderStyle(headerRow);

  sheet.columns = [
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
  ];

  data.historial.forEach((h, i) => {
    const row = sheet.addRow([
      h.periodo,
      h.alquiler,
      h.servicios,
      h.punitorios,
      h.totalDue,
      h.amountPaid,
      h.balance,
      h.isPaid ? 'Pagado' : h.status === 'PARTIAL' ? 'Parcial' : 'Pendiente',
    ]);
    applyDataRowStyle(row, i);
    for (let c = 2; c <= 7; c++) {
      row.getCell(c).numFmt = CURRENCY_FORMAT;
    }
  });

  // Debts section if any
  if (data.deudas.length > 0) {
    sheet.addRow([]);
    sheet.addRow([]);
    const debtTitle = sheet.addRow(['DEUDAS ABIERTAS']);
    debtTitle.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFDC2626' } };

    const debtHeaders = sheet.addRow(['Período', 'Original', 'Pagado', 'Punitorios', 'Pendiente', 'Estado']);
    applyHeaderStyle(debtHeaders);

    data.deudas.forEach((d, i) => {
      const row = sheet.addRow([d.periodo, d.original, d.pagado, d.punitorios, d.pendiente, d.status]);
      applyDataRowStyle(row, i);
      for (let c = 2; c <= 5; c++) {
        row.getCell(c).numFmt = CURRENCY_FORMAT;
      }
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

// ============================================
// EVOLUCION DE INGRESOS EXCEL
// ============================================

const generateEvolucionIngresosExcel = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.empresa?.nombre || 'Inmobiliaria';

  const sheet = workbook.addWorksheet('Evolución Ingresos');

  // Title
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = `EVOLUCIÓN DE INGRESOS - ${data.anio}`;
  sheet.getCell('A1').font = TITLE_FONT;
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.addRow([]);

  // Headers
  const headerRow = sheet.addRow(['Mes', 'Facturado', 'Cobrado', '% Cobranza', 'Contratos', 'Pagados']);
  applyHeaderStyle(headerRow);

  sheet.columns = [
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
  ];

  data.meses.forEach((m, i) => {
    const pctCobranza = m.totalDue > 0 ? ((m.amountPaid / m.totalDue) * 100).toFixed(1) + '%' : '-';
    const row = sheet.addRow([
      m.label,
      m.totalDue,
      m.amountPaid,
      pctCobranza,
      m.contratos,
      m.pagados,
    ]);
    applyDataRowStyle(row, i);
    row.getCell(2).numFmt = CURRENCY_FORMAT;
    row.getCell(3).numFmt = CURRENCY_FORMAT;
  });

  // Total row
  const totalRow = sheet.addRow([
    'TOTAL ANUAL',
    data.meses.reduce((s, m) => s + m.totalDue, 0),
    data.totalAnual,
    '',
    '',
    '',
  ]);
  applyTotalRowStyle(totalRow);
  totalRow.getCell(2).numFmt = CURRENCY_FORMAT;
  totalRow.getCell(3).numFmt = CURRENCY_FORMAT;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

// ============================================
// AJUSTES MES EXCEL
// ============================================

const generateAjustesMesExcel = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.empresa?.nombre || 'Inmobiliaria';

  const sheet = workbook.addWorksheet('Ajustes del Mes');

  // Title
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = `AJUSTES DEL MES - ${data.periodo.label}`;
  sheet.getCell('A1').font = TITLE_FONT;
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.addRow([]);

  // Headers
  const headerRow = sheet.addRow(['Inquilino', 'Propiedad', 'Alquiler Anterior', 'Índice', '% Ajuste', 'Alquiler Nuevo', 'Estado']);
  applyHeaderStyle(headerRow);

  sheet.columns = [
    { width: 25 },
    { width: 30 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 18 },
    { width: 12 },
  ];

  data.ajustes.forEach((a, i) => {
    const row = sheet.addRow([
      a.inquilino,
      a.propiedad,
      a.alquilerAnterior,
      a.indice,
      `${a.porcentajeAjuste}%`,
      a.alquilerNuevo,
      a.aplicado ? 'Aplicado' : 'Pendiente',
    ]);
    applyDataRowStyle(row, i);
    row.getCell(3).numFmt = CURRENCY_FORMAT;
    row.getCell(6).numFmt = CURRENCY_FORMAT;
  });

  if (data.ajustes.length === 0) {
    sheet.addRow(['No hay ajustes programados para este período']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

// ============================================
// CONTROL MENSUAL EXCEL
// ============================================

// ─── Control Mensual colour palette ──────────────────────────────────────────
const CM = {
  navyFill:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C3557' } },
  subHeaderFill:{ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4E6E' } },
  paidFill:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
  partialFill:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } },
  cancelledFill:{ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } },
  pendingFill:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
  altFill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } },
  totalFill:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C3557' } },
};

const CM_ROW_FILL = (r, i) => {
  if (r.cancelo)              return CM.cancelledFill;
  if (r.isPaid)               return CM.paidFill;
  if (r.estado === 'PARTIAL') return CM.partialFill;
  return i % 2 === 0 ? CM.pendingFill : CM.altFill;
};

// Number formats
const FMT_CURR   = '#,##0.00;[Red]-#,##0.00;"-"';   // positive / red-negative / dash-zero
const FMT_CURR_B = '#,##0.00;"-";"-"';               // only positive meaningful (A Favor)
const FMT_INT    = '0;"-";"-"';                      // integer, dash for zero

// Format a number as ARS string (for rich-text cells where numFmt can't apply)
const toARS = (v) =>
  v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const generateControlMensualExcel = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.empresa?.nombre || 'Inmobiliaria';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Control Mensual');
  const hasIva = data.registros.some((r) => r.iva > 0);

  // ── Column definitions ────────────────────────────────────────────────────
  // numFmt: applied to data + totals  |  special: handled cell-by-cell
  const columns = [
    { header: 'Propiedad',         key: 'propiedad',        width: 30 },
    { header: 'Dueño',             key: 'dueno',            width: 22 },
    { header: 'Inquilino',         key: 'inquilino',        width: 24 },
    { header: 'Mes\n#',            key: 'mesContrato',      width: 6,  numFmt: FMT_INT,    align: 'center' },
    { header: 'Alquiler',          key: 'alquiler',         width: 14, numFmt: FMT_CURR,   align: 'right'  },
    { header: 'Servicios\n(total)',key: 'servicios',        width: 14, numFmt: FMT_CURR,   align: 'right'  },
    { header: 'Detalle\nServicios',key: 'serviciosDetalle', width: 34, wrap: true },
  ];
  if (hasIva) columns.push({ header: 'IVA\n(21%)', key: 'iva', width: 12, numFmt: FMT_CURR, align: 'right' });
  columns.push(
    { header: 'A Favor\nAnt.',    key: 'aFavorAnt',   width: 13, numFmt: FMT_CURR_B, align: 'right' },
    { header: 'Punitorios',       key: 'punitorios',  width: 18, special: 'punitorios' },
    { header: 'TOTAL',            key: 'total',       width: 15, numFmt: FMT_CURR,   align: 'right', bold: true },
    { header: 'Fecha(s)\nPago',   key: 'fechasPago',  width: 22, align: 'center' },
    { header: 'Abonado',          key: 'pagado',      width: 14, numFmt: FMT_CURR,   align: 'right' },
    { header: 'A Favor\nSig.',    key: 'aFavorSig',   width: 13, numFmt: FMT_CURR_B, align: 'right' },
    { header: 'Debe\nSig.',       key: 'debeSig',     width: 13, numFmt: FMT_CURR_B, align: 'right' },
    { header: 'Saldo',            key: 'saldo',       width: 14, numFmt: FMT_CURR,   align: 'right', special: 'saldo' },
    { header: 'Estado',           key: 'estadoLabel', width: 11, align: 'center',    special: 'estado' },
    { header: 'Canceló',          key: 'canceloLabel',width: 9,  align: 'center' },
    { header: 'Observaciones',    key: 'observaciones',width: 40, wrap: true },
  );

  const totalCols = columns.length;
  // Column letter helper (supports up to Z = 26 columns)
  const colLtr = (n) => String.fromCharCode(64 + n);
  const lastCol = colLtr(totalCols);

  // ── Title block (rows 1–3) ────────────────────────────────────────────────
  const titleStyle = (cell, text, size) => {
    cell.value = text;
    cell.font = { bold: true, size, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.fill = CM.navyFill;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  };

  sheet.mergeCells(`A1:${lastCol}1`);
  titleStyle(sheet.getCell('A1'), (data.empresa?.nombre || 'INMOBILIARIA').toUpperCase(), 11);
  sheet.getRow(1).height = 20;

  sheet.mergeCells(`A2:${lastCol}2`);
  titleStyle(sheet.getCell('A2'), `CONTROL MENSUAL — ${data.periodo.label.toUpperCase()}`, 14);
  sheet.getRow(2).height = 30;

  // thin accent line between title and headers
  sheet.mergeCells(`A3:${lastCol}3`);
  sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2980B9' } };
  sheet.getRow(3).height = 4;

  // ── Header row (row 4) ────────────────────────────────────────────────────
  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.fill = CM.subHeaderFill;
    cell.border = BORDER_STYLE;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  headerRow.height = 34;

  sheet.columns = columns.map((c) => ({ width: c.width }));

  // Freeze first 4 rows, enable auto-filter on header row
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, activeCell: 'A5' }];
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: totalCols } };

  // ── Data rows ─────────────────────────────────────────────────────────────
  data.registros.forEach((r, i) => {
    const fill = CM_ROW_FILL(r, i);
    const estadoLabel = r.isPaid ? 'Pagado' : r.estado === 'PARTIAL' ? 'Parcial' : 'Pendiente';
    const canceloLabel = r.cancelo ? 'Sí' : '—';
    const enriched = { ...r, estadoLabel, canceloLabel };

    // Build initial row values (special columns get a placeholder)
    const rowValues = columns.map((c) => {
      if (c.special) return null;
      const v = enriched[c.key];
      return v !== null && v !== undefined ? v : '';
    });

    const row = sheet.addRow(rowValues);
    row.height = 22;

    // Base style: fill + border + font
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = fill;
      cell.border = BORDER_STYLE;
      cell.font = { ...DATA_FONT };
      cell.alignment = { vertical: 'middle' };
    });

    // Apply column-level numFmt and alignment
    columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      if (c.numFmt && !c.special) cell.numFmt = c.numFmt;
      if (c.align)                cell.alignment = { vertical: 'middle', horizontal: c.align };
      if (c.bold)                 cell.font = { ...DATA_FONT, bold: true };
      if (c.wrap && enriched[c.key]) cell.alignment = { vertical: 'middle', wrapText: true };
    });

    // ── Punitorios (special: rich text with days) ──────────────────────────
    const puntIdx = columns.findIndex((c) => c.key === 'punitorios');
    if (puntIdx >= 0) {
      const cell = row.getCell(puntIdx + 1);
      if (r.punitoryForgiven) {
        cell.value = 'Condonado';
        cell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF1D6A3A' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (r.punitorios > 0) {
        const d = r.punitoryDays || 0;
        cell.value = {
          richText: [
            { text: `$ ${toARS(r.punitorios)}`,
              font: { name: 'Arial', size: 10, bold: false } },
            { text: `\n${d} día${d !== 1 ? 's' : ''}`,
              font: { name: 'Arial', size: 9, color: { argb: 'FF666666' } } },
          ],
        };
        cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
        if (row.height < 32) row.height = 32;
      } else {
        cell.value = '—';
        cell.font = { ...DATA_FONT, color: { argb: 'FFAAAAAA' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }

    // ── Saldo (special: colour-coded font) ────────────────────────────────
    const saldoIdx = columns.findIndex((c) => c.key === 'saldo');
    if (saldoIdx >= 0) {
      const cell = row.getCell(saldoIdx + 1);
      cell.numFmt = FMT_CURR;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      if (r.saldo > 0)      cell.font = { ...DATA_FONT, color: { argb: 'FF1D6A3A' } };
      else if (r.saldo < 0) cell.font = { ...DATA_FONT, color: { argb: 'FFC0392B' } };
      else                   cell.font = { ...DATA_FONT, color: { argb: 'FFAAAAAA' } };
    }

    // ── A Favor Sig: green when > 0 ───────────────────────────────────────
    const afIdx = columns.findIndex((c) => c.key === 'aFavorSig');
    if (afIdx >= 0 && r.aFavorSig > 0)
      row.getCell(afIdx + 1).font = { ...DATA_FONT, color: { argb: 'FF1D6A3A' } };

    // ── Debe Sig: red when > 0 ────────────────────────────────────────────
    const dbIdx = columns.findIndex((c) => c.key === 'debeSig');
    if (dbIdx >= 0 && r.debeSig > 0)
      row.getCell(dbIdx + 1).font = { ...DATA_FONT, color: { argb: 'FFC0392B' } };

    // ── Estado (special: bold colour text) ────────────────────────────────
    const estIdx = columns.findIndex((c) => c.key === 'estadoLabel');
    if (estIdx >= 0) {
      const cell = row.getCell(estIdx + 1);
      cell.value = estadoLabel;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (r.isPaid)
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1D6A3A' } };
      else if (r.estado === 'PARTIAL')
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF7D4807' } };
      else
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF666666' } };
    }

    // ── Adjust row height for multi-line service detail ───────────────────
    const detIdx = columns.findIndex((c) => c.key === 'serviciosDetalle');
    if (detIdx >= 0 && r.serviciosDetalle) {
      const lines = (r.serviciosDetalle.match(/\n/g) || []).length + 1;
      const needed = Math.max(22, lines * 16);
      if (needed > row.height) row.height = needed;
    }
  });

  // ── Totals row ────────────────────────────────────────────────────────────
  const totalsValues = columns.map((c) => {
    if (c.key === 'propiedad')  return 'TOTALES';
    if (c.key === 'punitorios') return data.totales.punitorios; // numeric sum
    if (c.special === 'saldo')  return data.totales.saldo;
    if (c.special === 'estado') return '';
    if (data.totales[c.key] !== undefined) return data.totales[c.key];
    return '';
  });
  const totalRow = sheet.addRow(totalsValues);
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = CM.totalFill;
    cell.font = { bold: true, size: 10, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.border = BORDER_STYLE;
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
  });
  totalRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  totalRow.height = 26;

  columns.forEach((c, ci) => {
    if (c.numFmt) totalRow.getCell(ci + 1).numFmt = c.numFmt;
    else if (c.key === 'punitorios') totalRow.getCell(ci + 1).numFmt = FMT_CURR;
    else if (c.key === 'saldo')      totalRow.getCell(ci + 1).numFmt = FMT_CURR;
  });

  // ── Legend ────────────────────────────────────────────────────────────────
  sheet.addRow([]); // spacer

  const legendRow = sheet.addRow([
    'Leyenda:', ' Pagado ', ' Parcial ', ' Pendiente ', ' Canceló ',
  ]);
  legendRow.getCell(1).font = { bold: true, size: 9, name: 'Arial' };
  [
    { col: 2, argb: 'FFC6EFCE' },
    { col: 3, argb: 'FFFFEB9C' },
    { col: 4, argb: 'FFF2F2F2' },
    { col: 5, argb: 'FFBFBFBF' },
  ].forEach(({ col, argb }) => {
    const cell = legendRow.getCell(col);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.border = BORDER_STYLE;
    cell.font = { size: 9, name: 'Arial' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  legendRow.height = 18;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

module.exports = {
  generateLiquidacionExcel,
  generateEstadoCuentasExcel,
  generateEvolucionIngresosExcel,
  generateAjustesMesExcel,
  generateControlMensualExcel,
};
