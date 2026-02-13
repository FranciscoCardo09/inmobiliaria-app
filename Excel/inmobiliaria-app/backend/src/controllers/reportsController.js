// Reports Controller - Phase 6: Professional Reports
const ApiResponse = require('../utils/apiResponse');
const {
  getLiquidacionData,
  getLiquidacionesAllContracts,
  getEstadoCuentasData,
  getResumenEjecutivoData,
  getCartaDocumentoData,
  getEvolucionIngresosData,
  getPagoEfectivoFromRecord,
  getAjustesMesData,
  getControlMensualData,
  getImpuestosData,
  getVencimientosData,
  MONTH_NAMES,
} = require('../services/reportDataService');
const {
  generateLiquidacionPDF,
  generateLiquidacionAllPDF,
  generateEstadoCuentasPDF,
  generateResumenEjecutivoPDF,
  generateCartaDocumentoPDF,
  generatePagoEfectivoPDF,
  generateMultiPagoEfectivoPDF,
  generateImpuestosPDF,
  generateVencimientosPDF,
} = require('../services/pdfTemplates');
const {
  generateLiquidacionExcel,
  generateEstadoCuentasExcel,
  generateEvolucionIngresosExcel,
  generateAjustesMesExcel,
  generateControlMensualExcel,
} = require('../services/excelTemplates');
const {
  generateLiquidacionDOCX,
  generateLiquidacionAllDOCX,
} = require('../services/docxTemplates');
const {
  generateLiquidacionHTML,
  generateLiquidacionAllHTML,
} = require('../services/htmlTemplates');
const emailService = require('../services/emailService');

// ============================================
// PREVIEW JSON ENDPOINTS
// ============================================

const getLiquidacion = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year, contractId } = req.query;

    if (!month || !year || !contractId) {
      return ApiResponse.badRequest(res, 'Se requiere month, year y contractId');
    }

    const data = await getLiquidacionData(groupId, contractId, parseInt(month), parseInt(year));

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró registro mensual para ese período');
    }

    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getLiquidacionAll = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getLiquidacionesAllContracts(groupId, parseInt(month), parseInt(year));
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getEstadoCuentas = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId } = req.query;

    if (!contractId) {
      return ApiResponse.badRequest(res, 'Se requiere contractId');
    }

    const data = await getEstadoCuentasData(groupId, contractId);

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró el contrato');
    }

    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getResumenEjecutivo = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getResumenEjecutivoData(groupId, parseInt(month), parseInt(year));
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getEvolucionIngresos = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { year } = req.query;

    if (!year) {
      return ApiResponse.badRequest(res, 'Se requiere year');
    }

    const data = await getEvolucionIngresosData(groupId, parseInt(year));
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getAjustesMes = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getAjustesMesData(groupId, parseInt(month), parseInt(year));
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getControlMensual = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getControlMensualData(groupId, parseInt(month), parseInt(year));
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getImpuestos = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getImpuestosData(groupId, parseInt(month), parseInt(year));
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

const getVencimientos = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const data = await getVencimientosData(groupId);
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

// ============================================
// PDF DOWNLOAD ENDPOINTS
// ============================================

const downloadLiquidacionPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year, contractId } = req.query;

    if (!month || !year || !contractId) {
      return ApiResponse.badRequest(res, 'Se requiere month, year y contractId');
    }

    const data = await getLiquidacionData(groupId, contractId, parseInt(month), parseInt(year));

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró registro mensual para ese período');
    }

    const pdfBuffer = await generateLiquidacionPDF(data);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidacion-${monthName}-${year}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadLiquidacionAllPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const dataArray = await getLiquidacionesAllContracts(groupId, parseInt(month), parseInt(year));

    if (dataArray.length === 0) {
      return ApiResponse.notFound(res, 'No se encontraron liquidaciones para ese período');
    }

    const pdfBuffer = await generateLiquidacionAllPDF(dataArray);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidacion-${monthName}-${year}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadEstadoCuentasPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId } = req.query;

    if (!contractId) {
      return ApiResponse.badRequest(res, 'Se requiere contractId');
    }

    const data = await getEstadoCuentasData(groupId, contractId);

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró el contrato');
    }

    const pdfBuffer = await generateEstadoCuentasPDF(data);
    const filename = `estado-cuentas-${data.inquilino.nombre.replace(/\s+/g, '-').toLowerCase()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadResumenPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getResumenEjecutivoData(groupId, parseInt(month), parseInt(year));
    const pdfBuffer = await generateResumenEjecutivoPDF(data);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `resumen-ejecutivo-${monthName}-${year}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadCartaDocumentoPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId, message } = req.body;

    if (!contractId) {
      return ApiResponse.badRequest(res, 'Se requiere contractId');
    }

    const data = await getCartaDocumentoData(groupId, contractId);

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró el contrato');
    }

    const pdfBuffer = await generateCartaDocumentoPDF(data, message || null);
    const filename = `carta-documento-${data.deudor.nombre.replace(/\s+/g, '-').toLowerCase()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadPagoEfectivoPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { monthlyRecordId } = req.query;

    if (!monthlyRecordId) {
      return ApiResponse.badRequest(res, 'Se requiere monthlyRecordId');
    }

    const data = await getPagoEfectivoFromRecord(groupId, monthlyRecordId);

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró el registro mensual');
    }

    const pdfBuffer = await generatePagoEfectivoPDF(data);
    const filename = `recibo-pago-${data.receiptNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadMultiPagoEfectivoPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { monthlyRecordIds } = req.body;

    if (!monthlyRecordIds || !Array.isArray(monthlyRecordIds) || monthlyRecordIds.length === 0) {
      return ApiResponse.badRequest(res, 'Se requiere monthlyRecordIds (array)');
    }

    const dataArray = [];
    for (const recordId of monthlyRecordIds) {
      const data = await getPagoEfectivoFromRecord(groupId, recordId);
      if (data) dataArray.push(data);
    }

    if (dataArray.length === 0) {
      return ApiResponse.notFound(res, 'No se encontraron registros mensuales');
    }

    const pdfBuffer = await generateMultiPagoEfectivoPDF(dataArray);
    const filename = `recibos-pago-consolidado.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadImpuestosPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getImpuestosData(groupId, parseInt(month), parseInt(year));
    const pdfBuffer = await generateImpuestosPDF(data);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `impuestos-${monthName}-${year}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadVencimientosPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const data = await getVencimientosData(groupId);
    const pdfBuffer = await generateVencimientosPDF(data);

    const filename = `vencimientos-contratos.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

// ============================================
// EXCEL DOWNLOAD ENDPOINTS
// ============================================

const downloadLiquidacionExcel = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const dataArray = await getLiquidacionesAllContracts(groupId, parseInt(month), parseInt(year));

    if (dataArray.length === 0) {
      return ApiResponse.notFound(res, 'No se encontraron liquidaciones para ese período');
    }

    const excelBuffer = await generateLiquidacionExcel(dataArray);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidaciones-${monthName}-${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadEstadoCuentasExcel = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId } = req.query;

    if (!contractId) {
      return ApiResponse.badRequest(res, 'Se requiere contractId');
    }

    const data = await getEstadoCuentasData(groupId, contractId);

    if (!data) {
      return ApiResponse.notFound(res, 'No se encontró el contrato');
    }

    const excelBuffer = await generateEstadoCuentasExcel(data);
    const filename = `estado-cuentas-${data.inquilino.nombre.replace(/\s+/g, '-').toLowerCase()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadAjustesMesExcel = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getAjustesMesData(groupId, parseInt(month), parseInt(year));
    const excelBuffer = await generateAjustesMesExcel(data);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `ajustes-${monthName}-${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadControlMensualExcel = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const data = await getControlMensualData(groupId, parseInt(month), parseInt(year));
    const excelBuffer = await generateControlMensualExcel(data);

    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `control-mensual-${monthName}-${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    next(error);
  }
};

// ============================================
// EMAIL ENDPOINT
// ============================================

const sendReportEmail = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { type, contractId, month, year, to } = req.body;

    if (!type || !to) {
      return ApiResponse.badRequest(res, 'Se requiere type y to (email destinatario)');
    }

    let pdfBuffer;
    let filename;
    let subject;

    switch (type) {
      case 'liquidacion': {
        if (!month || !year || !contractId) {
          return ApiResponse.badRequest(res, 'Se requiere month, year y contractId para liquidación');
        }
        const data = await getLiquidacionData(groupId, contractId, parseInt(month), parseInt(year));
        if (!data) return ApiResponse.notFound(res, 'No se encontró la liquidación');
        pdfBuffer = await generateLiquidacionPDF(data);
        const monthName = MONTH_NAMES[parseInt(month)] || month;
        filename = `liquidacion-${monthName.toLowerCase()}-${year}.pdf`;
        subject = `Liquidación ${monthName} ${year} - ${data.inquilino.nombre}`;
        break;
      }
      case 'estado-cuentas': {
        if (!contractId) {
          return ApiResponse.badRequest(res, 'Se requiere contractId para estado de cuentas');
        }
        const data = await getEstadoCuentasData(groupId, contractId);
        if (!data) return ApiResponse.notFound(res, 'No se encontró el contrato');
        pdfBuffer = await generateEstadoCuentasPDF(data);
        filename = `estado-cuentas-${data.inquilino.nombre.replace(/\s+/g, '-').toLowerCase()}.pdf`;
        subject = `Estado de Cuentas - ${data.inquilino.nombre}`;
        break;
      }
      case 'resumen-ejecutivo': {
        if (!month || !year) {
          return ApiResponse.badRequest(res, 'Se requiere month y year para resumen ejecutivo');
        }
        const data = await getResumenEjecutivoData(groupId, parseInt(month), parseInt(year));
        pdfBuffer = await generateResumenEjecutivoPDF(data);
        const monthName = MONTH_NAMES[parseInt(month)] || month;
        filename = `resumen-ejecutivo-${monthName.toLowerCase()}-${year}.pdf`;
        subject = `Resumen Ejecutivo ${monthName} ${year}`;
        break;
      }
      default:
        return ApiResponse.badRequest(res, `Tipo de reporte no válido: ${type}`);
    }

    const result = await emailService.sendReportEmail({
      to,
      subject,
      pdfBuffer,
      filename,
    });

    if (result.success) {
      return ApiResponse.success(res, { messageId: result.messageId }, 'Reporte enviado por email');
    } else {
      return ApiResponse.error(res, `Error al enviar email: ${result.error}`);
    }
  } catch (error) {
    next(error);
  }
};

// ============================================
// DOCX DOWNLOAD ENDPOINTS
// ============================================

const downloadLiquidacionDOCX = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year, contractId } = req.query;

    if (!month || !year || !contractId) {
      return ApiResponse.badRequest(res, 'Se requiere month, year y contractId');
    }

    const data = await getLiquidacionData(groupId, contractId, parseInt(month), parseInt(year));
    if (!data) return ApiResponse.notFound(res, 'No se encontró registro mensual para ese período');

    const docxBuffer = await generateLiquidacionDOCX(data);
    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidacion-${monthName}-${year}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', docxBuffer.length);
    res.send(docxBuffer);
  } catch (error) {
    next(error);
  }
};

const downloadLiquidacionAllDOCX = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const dataArray = await getLiquidacionesAllContracts(groupId, parseInt(month), parseInt(year));
    if (dataArray.length === 0) return ApiResponse.notFound(res, 'No se encontraron liquidaciones');

    const docxBuffer = await generateLiquidacionAllDOCX(dataArray);
    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidacion-${monthName}-${year}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', docxBuffer.length);
    res.send(docxBuffer);
  } catch (error) {
    next(error);
  }
};

// ============================================
// HTML DOWNLOAD ENDPOINTS
// ============================================

const downloadLiquidacionHTMLEndpoint = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year, contractId } = req.query;

    if (!month || !year || !contractId) {
      return ApiResponse.badRequest(res, 'Se requiere month, year y contractId');
    }

    const data = await getLiquidacionData(groupId, contractId, parseInt(month), parseInt(year));
    if (!data) return ApiResponse.notFound(res, 'No se encontró registro mensual para ese período');

    const html = generateLiquidacionHTML(data);
    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidacion-${monthName}-${year}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (error) {
    next(error);
  }
};

const downloadLiquidacionAllHTMLEndpoint = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'Se requiere month y year');
    }

    const dataArray = await getLiquidacionesAllContracts(groupId, parseInt(month), parseInt(year));
    if (dataArray.length === 0) return ApiResponse.notFound(res, 'No se encontraron liquidaciones');

    const html = generateLiquidacionAllHTML(dataArray);
    const monthName = MONTH_NAMES[parseInt(month)]?.toLowerCase() || month;
    const filename = `liquidacion-${monthName}-${year}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLiquidacion,
  getLiquidacionAll,
  getEstadoCuentas,
  getResumenEjecutivo,
  getEvolucionIngresos,
  getAjustesMes,
  getControlMensual,
  getImpuestos,
  getVencimientos,
  downloadLiquidacionPDF,
  downloadLiquidacionAllPDF,
  downloadEstadoCuentasPDF,
  downloadResumenPDF,
  downloadCartaDocumentoPDF,
  downloadPagoEfectivoPDF,
  downloadMultiPagoEfectivoPDF,
  downloadImpuestosPDF,
  downloadVencimientosPDF,
  downloadLiquidacionExcel,
  downloadEstadoCuentasExcel,
  downloadAjustesMesExcel,
  downloadControlMensualExcel,
  downloadLiquidacionDOCX,
  downloadLiquidacionAllDOCX,
  downloadLiquidacionHTMLEndpoint,
  downloadLiquidacionAllHTMLEndpoint,
  sendReportEmail,
};
