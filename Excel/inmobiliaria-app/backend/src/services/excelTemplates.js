// Excel Templates - ExcelJS generators for reports
const ExcelJS = require('exceljs');
const { MONTH_NAMES } = require('./reportDataService');

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF003087' },
};

const HEADER_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
};

const TOTAL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF003087' },
};

const TOTAL_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};

const ALT_ROW_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0F0F0' },
};

const BORDER_STYLE = {
  top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
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
  workbook.creator = 'H&H Inmobiliaria';
  workbook.created = new Date();

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Resumen');

  // Title
  summarySheet.mergeCells('A1:F1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = `LIQUIDACIONES - ${dataArray[0]?.periodo?.label || ''}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF003087' } };
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
    sheet.getCell('A1').value = 'H&H INMOBILIARIA';
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF003087' } };

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
    const conceptHeaderRow = sheet.addRow([]);
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
  workbook.creator = 'H&H Inmobiliaria';

  const sheet = workbook.addWorksheet('Estado de Cuentas');

  // Title
  sheet.mergeCells('A1:G1');
  sheet.getCell('A1').value = 'ESTADO DE CUENTAS';
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF003087' } };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  // Info
  sheet.getCell('A3').value = 'Inquilino:';
  sheet.getCell('A3').font = { bold: true };
  sheet.getCell('B3').value = data.inquilino.nombre;
  sheet.getCell('D3').value = 'DNI:';
  sheet.getCell('D3').font = { bold: true };
  sheet.getCell('E3').value = data.inquilino.dni;

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
  workbook.creator = 'H&H Inmobiliaria';

  const sheet = workbook.addWorksheet('Evolución Ingresos');

  // Title
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = `EVOLUCIÓN DE INGRESOS - ${data.anio}`;
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF003087' } };
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

module.exports = {
  generateLiquidacionExcel,
  generateEstadoCuentasExcel,
  generateEvolucionIngresosExcel,
};
