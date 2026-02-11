// Payment Routes - Phase 4 v2
const express = require('express');
const router = express.Router({ mergeParams: true });
const paymentsController = require('../controllers/paymentsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

// === CONCEPT TYPES ===
router.get(
  '/concept-types',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  paymentsController.getConceptTypes
);

router.post(
  '/concept-types',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  paymentsController.createConceptType
);

router.post(
  '/concept-types/seed-defaults',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  paymentsController.seedDefaultConceptTypes
);

router.put(
  '/concept-types/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  paymentsController.updateConceptType
);

router.delete(
  '/concept-types/:id',
  requireGroupAccess(['ADMIN']),
  paymentsController.deleteConceptType
);

// === PAYMENTS ===
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
