// Debts Controller - Gestión de deudas y punitorios
const ApiResponse = require('../utils/apiResponse');
const {
  getOpenDebts,
  getDebts,
  getDebtsSummary,
  payDebt,
  payDebtsBulk,
  previewBulkDebtPayment,
  cancelDebtPayment,
  forgiveDebt,
  canPayCurrentMonth,
  calculateDebtPunitory,
} = require('../services/debtService');
const { previewCloseMonth, closeMonth } = require('../services/monthlyCloseService');
// A-25: si el operador no elige fecha de pago, usar el día ART correcto
// (string, TZ-inmune), no `new Date().toISOString()` crudo del proceso
// (que en horario vespertino ya cae en el día UTC siguiente).
const { getTodayLocalString } = require('../utils/dateUtils');

const prisma = require('../lib/prisma');

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
            property: { select: { id: true, address: true } },
          },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!debt || debt.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Deuda no encontrada');
    }

    // Enriquecer con punitorios actuales.
    // Bug reportado (2026-07-12): esta ruta calculaba `remainingDebt` a mano
    // (`unpaidRentAmount - amountPaid`), ignorando `unpaidServicesAmount` Y
    // `appliedCredit` (saldo a favor del mes anterior) — mostraba de más
    // exactamente el monto del crédito no descontado. `getOpenDebts`/`getDebts`
    // (debtService.js) ya calculaban esto bien vía `calculateDebtPunitory`;
    // se reutiliza esa misma fórmula acá en vez de duplicarla mal.
    if (debt.status !== 'PAID') {
      const { amount, days, remainingDebt, unpaidAccumulatedPunitory, startDate, endDate, remainingServices, remainingRent, iva } =
        await calculateDebtPunitory(debt, getTodayLocalString());
      debt.liveAccumulatedPunitory = amount;
      debt.livePunitoryDays = days;
      debt.liveCurrentTotal = remainingDebt + (unpaidAccumulatedPunitory || 0) + amount;
      debt.remainingDebt = remainingDebt;
      debt.unpaidAccumulatedPunitory = unpaidAccumulatedPunitory || 0;
      debt.punitoryFromDate = startDate;
      debt.punitoryToDate = endDate;
      // remainingServices ya viene NETO de IVA e `iva` como línea separada — el
      // modal de pago (DebtPaymentModal) usa esto como fallback mientras carga el
      // preview, para no mostrar el IVA mezclado con "Servicios impagos".
      debt.remainingServices = remainingServices || 0;
      debt.remainingRent = remainingRent || 0;
      debt.iva = iva || 0;
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
    const { amount, paymentDate, paymentMethod, observations, forgivePunitorios } = req.body;

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
      paymentDate || getTodayLocalString(),
      paymentMethod || 'EFECTIVO',
      observations,
      forgivePunitorios || false
    );

    return ApiResponse.success(res, result, 'Pago de deuda registrado');
  } catch (error) {
    if (error.message === 'Esta deuda ya está pagada' || error.code === 'ORDER_BLOCK') {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

// POST /api/groups/:groupId/debts/pay-bulk/preview
const bulkDebtPreviewHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { debtIds, paymentDate, currentRecordId } = req.body;

    if (!Array.isArray(debtIds) || debtIds.length === 0) {
      return ApiResponse.badRequest(res, 'Debe seleccionar al menos una deuda');
    }

    const preview = await previewBulkDebtPayment(groupId, debtIds, paymentDate, currentRecordId || null);
    return ApiResponse.success(res, preview);
  } catch (error) {
    if (error.code === 'ORDER_BLOCK' || error.code === 'DEBT_BLOCK' || error.message?.includes('deuda') || error.message?.includes('mes actual')) {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

// POST /api/groups/:groupId/debts/pay-bulk
const payDebtsBulkHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { debtIds, amount, paymentDate, paymentMethod, observations, currentRecordId, forgivePunitorios } = req.body;

    if (!Array.isArray(debtIds) || debtIds.length === 0) {
      return ApiResponse.badRequest(res, 'Debe seleccionar al menos una deuda');
    }
    if (!amount || parseFloat(amount) <= 0) {
      return ApiResponse.badRequest(res, 'Monto inválido');
    }

    const result = await payDebtsBulk(
      groupId,
      debtIds,
      parseFloat(amount),
      paymentDate || getTodayLocalString(),
      paymentMethod || 'EFECTIVO',
      observations,
      currentRecordId || null,
      !!forgivePunitorios
    );

    return ApiResponse.success(res, result, 'Pago múltiple registrado');
  } catch (error) {
    if (error.code === 'ORDER_BLOCK' || error.code === 'DEBT_BLOCK' || error.message?.includes('deuda') || error.message?.includes('contrato') || error.message?.includes('Monto') || error.message?.includes('mes actual')) {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

// GET /api/groups/:groupId/contracts/:contractId/can-pay-current-month?periodMonth=&periodYear=
const checkCanPayCurrentMonth = async (req, res, next) => {
  try {
    const { groupId, contractId } = req.params;
    const { periodMonth, periodYear } = req.query;

    const targetPeriod = (periodMonth && periodYear)
      ? { periodMonth: parseInt(periodMonth, 10), periodYear: parseInt(periodYear, 10) }
      : null;

    const result = await canPayCurrentMonth(groupId, contractId, targetPeriod);
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
      return ApiResponse.success(res, { days: 0, amount: 0, remainingDebt: 0, remainingServices: 0, remainingRent: 0, iva: 0, totalToPay: 0 });
    }

    const { amount, days, remainingDebt, remainingServices, remainingRent, iva, startDate, endDate, accumulatedPunitory, newPunitoryAmount, unpaidAccumulatedPunitory } = await calculateDebtPunitory(debt, new Date(paymentDate + 'T12:00:00'));
    // Punitorios TOTALES impagos = acumulado impago (congelado de pagos previos) + nuevo en vivo.
    // BUG previo: se omitía unpaidAccumulatedPunitory, por lo que el modal mostraba menos plata
    // que el Control Mensual (que sí suma el acumulado en liveCurrentTotal).
    const r2 = (n) => Math.round((n || 0) * 100) / 100;
    const unpaidAccum = r2(unpaidAccumulatedPunitory);
    const totalPunitoryOwed = r2(unpaidAccum + amount);
    return ApiResponse.success(res, {
      days,
      amount: totalPunitoryOwed,            // punitorios totales impagos (acumulado + nuevo)
      newPunitoryAmount,                    // solo el nuevo en vivo (para desglose)
      unpaidAccumulatedPunitory: unpaidAccum, // acumulado impago de pagos anteriores
      accumulatedPunitory,
      remainingDebt,
      // remainingServices ya viene NETO de IVA (calculateDebtPunitory lo desglosa);
      // `iva` es la línea separada para que el modal no lo muestre mezclado con
      // "Servicios impagos" (pedido del usuario, 2026-07-16).
      remainingServices: remainingServices || 0,
      remainingRent: remainingRent || 0,
      iva: iva || 0,
      totalToPay: r2(remainingDebt + totalPunitoryOwed),
      fromDate: startDate,
      toDate: endDate,
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

// POST /api/groups/:groupId/debts/:id/forgive
const forgiveDebtHandler = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { observations } = req.body;

    const debt = await prisma.debt.findUnique({ where: { id } });
    if (!debt || debt.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Deuda no encontrada');
    }

    const result = await forgiveDebt(id, observations);
    return ApiResponse.success(res, result, 'Deuda condonada');
  } catch (error) {
    if (error.message === 'Esta deuda ya está pagada') {
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
  bulkDebtPreviewHandler,
  payDebtsBulkHandler,
  cancelDebtPaymentHandler,
  forgiveDebtHandler,
  checkCanPayCurrentMonth,
  closeMonthPreview,
  closeMonthExecute,
};
