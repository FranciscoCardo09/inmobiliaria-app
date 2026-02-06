// Payment Routes - Phase 4
const express = require('express');
const router = express.Router({ mergeParams: true });
const paymentsController = require('../controllers/paymentsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

// View routes (VIEWER+)
router.get(
  '/current-month',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  paymentsController.getCurrentMonth
);

router.get(
  '/next-month',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  paymentsController.getNextMonth
);

router.get(
  '/calculate',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  paymentsController.calculatePayment
);

router.get(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  paymentsController.getPayments
);

router.get(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  paymentsController.getPaymentById
);

// Write routes (OPERATOR+)
router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  paymentsController.createPayment
);

router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  paymentsController.updatePayment
);

// Delete (ADMIN only)
router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  paymentsController.deletePayment
);

module.exports = router;
