// Debts Routes
const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');
const {
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
} = require('../controllers/debtsController');

router.use(authenticate);

// Deudas
router.get('/debts', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), getAllDebts);
router.get('/debts/open', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), getOpen);
router.get('/debts/summary', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), getSummary);
router.get('/debts/:id', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), getDebtById);
router.get('/debts/:id/punitory-preview', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), getDebtPunitoryPreview);
router.post('/debts/:id/pay', requireGroupAccess(['ADMIN', 'OPERATOR']), payDebtHandler);
router.delete('/debts/:debtId/payments/:paymentId', requireGroupAccess(['ADMIN']), cancelDebtPaymentHandler);

// Verificar si puede pagar mes actual
router.get('/contracts/:contractId/can-pay-current-month', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), checkCanPayCurrentMonth);

// Cierre mensual
router.post('/close-month/preview', requireGroupAccess(['ADMIN', 'OPERATOR']), closeMonthPreview);
router.post('/close-month', requireGroupAccess(['ADMIN']), closeMonthExecute);

module.exports = router;
