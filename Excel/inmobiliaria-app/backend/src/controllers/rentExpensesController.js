// Controller para Gastos Alquiler (recibo de gastos de ingreso: informes,
// apto eléctrico, honorarios, etc. con descuento de reserva).
const ApiResponse = require('../utils/apiResponse');
const rentExpenseService = require('../services/rentExpenseService');
const { generateGastosAlquilerPDF } = require('../services/pdfTemplates');
const { getEmpresaData } = require('../services/reportDataService');
const { createReceiptSchema } = require('../validators/rentExpenseValidators');

// GET /api/groups/:groupId/rent-expenses/concepts
const getConcepts = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const concepts = await rentExpenseService.listConcepts(groupId);
    return ApiResponse.success(res, concepts);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/rent-expenses/concepts/:id
const deleteConcept = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const ok = await rentExpenseService.deactivateConcept(groupId, id);
    if (!ok) return ApiResponse.notFound(res, 'Concepto no encontrado');
    return ApiResponse.success(res, null, 'Concepto eliminado');
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/rent-expenses
const listReceipts = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { from, to, search } = req.query;
    const receipts = await rentExpenseService.listReceipts(groupId, { from, to, search });
    return ApiResponse.success(res, receipts);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/rent-expenses/:id
const getReceipt = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const receipt = await rentExpenseService.getReceipt(groupId, id);
    if (!receipt) return ApiResponse.notFound(res, 'Recibo no encontrado');
    return ApiResponse.success(res, receipt);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/rent-expenses
const createReceipt = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const parsed = createReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join('; ');
      return ApiResponse.badRequest(res, message);
    }

    const receipt = await rentExpenseService.createReceipt(groupId, parsed.data);
    return ApiResponse.created(res, receipt, 'Recibo de gastos creado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/rent-expenses/:id
const deleteReceipt = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const ok = await rentExpenseService.deleteReceipt(groupId, id);
    if (!ok) return ApiResponse.notFound(res, 'Recibo no encontrado');
    return ApiResponse.success(res, null, 'Recibo eliminado');
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/rent-expenses/:id/pdf
const downloadReceiptPDF = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const receipt = await rentExpenseService.getReceipt(groupId, id);
    if (!receipt) return ApiResponse.notFound(res, 'Recibo no encontrado');

    const empresa = await getEmpresaData(groupId);

    const data = {
      empresa,
      receiptNumber: receipt.receiptNumber,
      fecha: receipt.fecha,
      ivaCondicion: receipt.ivaCondicion || 'consumidor final',
      tenantName: receipt.tenantName,
      address: receipt.address,
      porCuentaYOrdenDe: receipt.porCuentaYOrdenDe || '',
      conceptos: receipt.items.map((item) => ({
        concepto: item.concepto,
        importe: item.importe,
        cuotaNumber: item.cuotaNumber,
        cuotaTotal: item.cuotaTotal,
      })),
      total: receipt.total,
      reserva: receipt.reserva,
      saldo: receipt.saldo,
      payment: receipt.paymentDate
        ? {
            fecha: receipt.paymentDate,
            monto: receipt.paymentAmount,
            metodo: receipt.paymentMethod,
            estado: receipt.paymentStatus,
          }
        : null,
    };

    const pdfBuffer = await generateGastosAlquilerPDF(data);
    const filename = `recibo-gastos-${receipt.receiptNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConcepts,
  deleteConcept,
  listReceipts,
  getReceipt,
  createReceipt,
  deleteReceipt,
  downloadReceiptPDF,
};
