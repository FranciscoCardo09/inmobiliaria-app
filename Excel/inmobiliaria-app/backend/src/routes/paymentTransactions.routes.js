// Payment Transactions Routes - Phase 5
const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/paymentTransactionsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

// Punitory preview (must be before /:id to avoid conflict)
router.get(
  '/calculate-punitorios',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.getPunitoryPreview
);

// CRUD
router.get(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getTransactions
);

router.get(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getTransaction
);

router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.createTransaction
);

router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  controller.removeTransaction
);

module.exports = router;
