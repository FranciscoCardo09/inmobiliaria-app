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

// Status-based row fills for control mensual
const STATUS_FILLS = {
  paid:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } }, // light green
  partial:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }, // light amber
  cancelled:{ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E3E5' } }, // light gray
  pending:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }, // white
  altPending:{ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }, // very light gray
};

const getStatusFill = (r, rowIndex) => {
  if (r.cancelo)             return STATUS_FILLS.cancelled;
  if (r.isPaid)              return STATUS_FILLS.paid;
  if (r.estado === 'PARTIAL') return STATUS_FILLS.partial;
  return rowIndex % 2 === 0 ? STATUS_FILLS.altPending : STATUS_FILLS.pending;
};

const generateControlMensualExcel = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.empresa?.nombre || 'Inmobiliaria';

  const sheet = workbook.addWorksheet('Control Mensual');

  const hasIva = data.registros.some((r) => r.iva > 0);

  // Column definitions
  const columns = [
    { header: 'Propiedad',          key: 'propiedad',        width: 28 },
    { header: 'Dueño',              key: 'dueno',            width: 20 },
    { header: 'Inquilino',          key: 'inquilino',        width: 22 },
    { header: 'Mes#',               key: 'mesContrato',      width: 7  },
    { header: 'Alquiler',           key: 'alquiler',         width: 14, currency: true },
    { header: 'Servicios',          key: 'servicios',        width: 14, currency: true },
    { header: 'Detalle Servicios',  key: 'serviciosDetalle', width: 40 },
  ];
  if (hasIva) columns.push({ header: 'IVA (21%)', key: 'iva', width: 13, currency: true });
  columns.push(
    { header: 'A Favor Ant.', key: 'aFavorAnt',   width: 14, currency: true },
    { header: 'Punitorios',   key: 'punitorios',  width: 14, currency: true },
    { header: 'Total',        key: 'total',       width: 14, currency: true },
    { header: 'Fecha(s) Pago',key: 'fechasPago',  width: 26 },
    { header: 'Abonado',      key: 'pagado',      width: 14, currency: true },
    { header: 'A Favor Sig.', key: 'aFavorSig',   width: 14, currency: true },
    { header: 'Debe Sig.',    key: 'debeSig',     width: 14, currency: true },
    { header: 'Saldo',        key: 'saldo',       width: 14, currency: true },
    { header: 'Estado',       key: 'estadoLabel', width: 12 },
    { header: 'Canceló',      key: 'canceloLabel',width: 9  },
    { header: 'Observaciones',key: 'observaciones',width: 45 },
  );

  const totalCols = columns.length;
  const lastColLetter = String.fromCharCode(64 + totalCols);

  // Title
  sheet.mergeCells(`A1:${lastColLetter}1`);
  sheet.getCell('A1').value = `CONTROL MENSUAL - ${data.periodo.label}`;
  sheet.getCell('A1').font = TITLE_FONT;
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.addRow([]);

  // Headers
  const headerRow = sheet.addRow(columns.map((c) => c.header));
  applyHeaderStyle(headerRow);

  sheet.columns = columns.map((c) => ({ width: c.width }));

  // Data rows
  data.registros.forEach((r, i) => {
    const estadoLabel = r.isPaid ? 'Pagado' : r.estado === 'PARTIAL' ? 'Parcial' : 'Pendiente';
    const canceloLabel = r.cancelo ? 'Sí' : 'No';
    const enriched = { ...r, estadoLabel, canceloLabel };

    const rowValues = columns.map((c) => {
      const v = enriched[c.key];
      return v !== null && v !== undefined ? v : '';
    });

    const row = sheet.addRow(rowValues);
    const fill = getStatusFill(r, i);

    row.eachCell((cell) => {
      cell.border = BORDER_STYLE;
      cell.font = DATA_FONT;
      cell.fill = fill;
      cell.alignment = { vertical: 'middle' };
    });

    columns.forEach((c, ci) => {
      if (c.currency) {
        row.getCell(ci + 1).numFmt = CURRENCY_FORMAT;
        row.getCell(ci + 1).alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });

    // Wrap text columns
    ['serviciosDetalle', 'observaciones'].forEach((key) => {
      const idx = columns.findIndex((c) => c.key === key);
      if (idx !== -1 && enriched[key]) {
        row.getCell(idx + 1).alignment = { vertical: 'middle', wrapText: true };
      }
    });
  });

  // Totals row
  const totalesRow = columns.map((c) => {
    if (c.key === 'propiedad') return 'TOTALES';
    if (data.totales[c.key] !== undefined) return data.totales[c.key];
    return '';
  });
  const totalRow = sheet.addRow(totalesRow);
  applyTotalRowStyle(totalRow);
  columns.forEach((c, ci) => {
    if (c.currency) {
      totalRow.getCell(ci + 1).numFmt = CURRENCY_FORMAT;
      totalRow.getCell(ci + 1).alignment = { vertical: 'middle', horizontal: 'right' };
    }
  });

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
