// Payment Transactions Controller - Phase 5
const ApiResponse = require('../utils/apiResponse');
const {
  registerPayment,
  calculatePunitoryPreview,
  getPaymentHistory,
  getTransactionById,
  deleteTransaction,
} = require('../services/paymentTransactionService');

// POST /api/groups/:groupId/payment-transactions
const createTransaction = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      monthlyRecordId,
      paymentDate,
      amount,
      paymentMethod,
      forgivePunitorios,
      generateReceipt,
      observations,
    } = req.body;

    if (!monthlyRecordId || !paymentDate || !amount) {
      return ApiResponse.badRequest(
        res,
        'monthlyRecordId, paymentDate y amount son requeridos'
      );
    }

    if (parseFloat(amount) <= 0) {
      return ApiResponse.badRequest(res, 'El monto debe ser mayor a 0');
    }

    const result = await registerPayment(groupId, monthlyRecordId, {
      paymentDate,
      amount,
      paymentMethod,
      forgivePunitorios,
      generateReceipt,
      observations,
    });

    return ApiResponse.created(res, result, 'Pago registrado exitosamente');
  } catch (error) {
    if (error.message === 'Registro mensual no encontrado') {
      return ApiResponse.notFound(res, error.message);
    }
    next(error);
  }
};

// GET /api/groups/:groupId/payment-transactions/calculate-punitorios
const getPunitoryPreview = async (req, res, next) => {
  try {
    const { monthlyRecordId, paymentDate } = req.query;

    if (!monthlyRecordId || !paymentDate) {
      return ApiResponse.badRequest(
        res,
        'monthlyRecordId y paymentDate son requeridos'
      );
    }

    const result = await calculatePunitoryPreview(monthlyRecordId, paymentDate);

    return ApiResponse.success(res, {
      amount: result.amount,
      days: result.days,
      graceDate: result.graceDate.toISOString(),
      fromDate: result.fromDate ? result.fromDate.toISOString() : null,
      toDate: result.toDate ? result.toDate.toISOString() : null,
      baseRent: result.baseRent,
      unpaidRent: result.unpaidRent,
      punitoryPercent: result.punitoryPercent,
      punitoryStartDay: result.punitoryStartDay,
      punitoryGraceDay: result.punitoryGraceDay,
      lastPaymentDate: result.lastPaymentDate,
      lastPaymentAmount: result.lastPaymentAmount,
      amountPaid: result.amountPaid,
      recordStatus: result.status,
    });
  } catch (error) {
    if (error.message === 'Registro no encontrado') {
      return ApiResponse.notFound(res, error.message);
    }
    next(error);
  }
};

// GET /api/groups/:groupId/payment-transactions
const getTransactions = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId, month, year, paymentMethod, tenantId, categoryId, search, limit, offset } = req.query;

    const result = await getPaymentHistory(groupId, {
      contractId,
      month,
      year,
      paymentMethod,
      tenantId,
      categoryId,
      search,
      limit,
      offset,
    });

    return ApiResponse.success(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/payment-transactions/:id
const getTransaction = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const transaction = await getTransactionById(groupId, id);

    if (!transaction) {
      return ApiResponse.notFound(res, 'Transacción no encontrada');
    }

    return ApiResponse.success(res, transaction);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/payment-transactions/:id
const removeTransaction = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const transaction = await deleteTransaction(groupId, id);

    if (!transaction) {
      return ApiResponse.notFound(res, 'Transacción no encontrada');
    }

    return ApiResponse.success(res, null, 'Transacción eliminada');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTransaction,
  getPunitoryPreview,
  getTransactions,
  getTransaction,
  removeTransaction,
};
