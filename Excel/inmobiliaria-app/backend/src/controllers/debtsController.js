// Debts Controller - Gestión de deudas y punitorios
const ApiResponse = require('../utils/apiResponse');
const {
  getOpenDebts,
  getDebts,
  getDebtsSummary,
  payDebt,
  cancelDebtPayment,
  canPayCurrentMonth,
  calculateDebtPunitory,
} = require('../services/debtService');
const { previewCloseMonth, closeMonth } = require('../services/monthlyCloseService');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/debts
const getAllDebts = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { status, contractId } = req.query;

    const debts = await getDebts(groupId, { status, contractId });
    return ApiResponse.success(res, debts);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/debts/open
const getOpen = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId } = req.query;

    const debts = await getOpenDebts(groupId, contractId);
    return ApiResponse.success(res, debts);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/debts/summary
const getSummary = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const summary = await getDebtsSummary(groupId);
    return ApiResponse.success(res, summary);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/debts/:id
const getDebtById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const debt = await prisma.debt.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: { select: { id: true, name: true, dni: true } },
            property: { select: { id: true, address: true, code: true } },
          },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!debt || debt.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Deuda no encontrada');
    }

    // Enriquecer con punitorios actuales
    if (debt.status !== 'PAID') {
      const { amount, days, startDate, endDate } = await calculateDebtPunitory(debt);
      const remainingDebt = debt.unpaidRentAmount - debt.amountPaid;
      debt.liveAccumulatedPunitory = amount;
      debt.livePunitoryDays = days;
      debt.liveCurrentTotal = remainingDebt + amount;
      debt.remainingDebt = remainingDebt;
      debt.punitoryFromDate = startDate;
      debt.punitoryToDate = endDate;
    }

    return ApiResponse.success(res, debt);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/debts/:id/pay
const payDebtHandler = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { amount, paymentDate, paymentMethod, observations } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return ApiResponse.badRequest(res, 'Monto inválido');
    }

    // Verificar que la deuda pertenece al grupo
    const debt = await prisma.debt.findUnique({ where: { id } });
    if (!debt || debt.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Deuda no encontrada');
    }

    const result = await payDebt(
      id,
      parseFloat(amount),
      paymentDate || new Date().toISOString(),
      paymentMethod || 'EFECTIVO',
      observations
    );

    return ApiResponse.success(res, result, 'Pago de deuda registrado');
  } catch (error) {
    if (error.message === 'Esta deuda ya está pagada') {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

// GET /api/groups/:groupId/contracts/:contractId/can-pay-current-month
const checkCanPayCurrentMonth = async (req, res, next) => {
  try {
    const { groupId, contractId } = req.params;

    const result = await canPayCurrentMonth(groupId, contractId);
    return ApiResponse.success(res, result);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/close-month/preview
const closeMonthPreview = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.body;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'month y year son requeridos');
    }

    const preview = await previewCloseMonth(groupId, month, year);
    return ApiResponse.success(res, preview);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/close-month
const closeMonthExecute = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.body;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'month y year son requeridos');
    }

    const result = await closeMonth(groupId, month, year);
    return ApiResponse.success(res, result, `Mes cerrado: ${result.debtsCreated} deudas generadas`);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/debts/:id/punitory-preview?paymentDate=2026-02-14
const getDebtPunitoryPreview = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { paymentDate } = req.query;

    if (!paymentDate) {
      return ApiResponse.badRequest(res, 'paymentDate es requerido');
    }

    const debt = await prisma.debt.findUnique({
      where: { id },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });

    if (!debt || debt.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Deuda no encontrada');
    }

    if (debt.status === 'PAID') {
      return ApiResponse.success(res, { days: 0, amount: 0, remainingDebt: 0, totalToPay: 0 });
    }

    const { amount, days, remainingDebt, startDate, endDate, accumulatedPunitory, newPunitoryAmount } = await calculateDebtPunitory(debt, new Date(paymentDate + 'T12:00:00'));
    return ApiResponse.success(res, {
      days: remainingDebt > 0 ? days : 0, // Solo mostrar días si hay deuda base
      amount,
      accumulatedPunitory,
      newPunitoryAmount,
      remainingDebt,
      totalToPay: remainingDebt + amount,
      fromDate: remainingDebt > 0 ? startDate : null,
      toDate: remainingDebt > 0 ? endDate : null,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/debts/:debtId/payments/:paymentId
const cancelDebtPaymentHandler = async (req, res, next) => {
  try {
    const { groupId, debtId, paymentId } = req.params;

    // Verificar que la deuda pertenece al grupo
    const debt = await prisma.debt.findUnique({ where: { id: debtId } });
    if (!debt || debt.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Deuda no encontrada');
    }

    const result = await cancelDebtPayment(debtId, paymentId);
    return ApiResponse.success(res, result.debt, result.message);
  } catch (error) {
    if (
      error.message.includes('Pago no encontrado') ||
      error.message.includes('Deuda no encontrada') ||
      error.message.includes('último pago')
    ) {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

module.exports = {
  getAllDebts,
  getOpen,
  getSummary,
  getDebtById,
  getDebtPunitoryPreview,
  payDebtHandler,
  cancelDebtPaymentHandler,
  checkCanPayCurrentMonth,
  closeMonthPreview,
  closeMonthExecute,
};
