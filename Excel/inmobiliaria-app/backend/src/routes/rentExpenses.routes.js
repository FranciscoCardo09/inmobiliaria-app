// Rent Expenses Routes (Gastos Alquiler)
const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/rentExpensesController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

// Catálogo de conceptos — declarado antes de '/:id' para no ser capturado por él
router.get(
  '/concepts',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getConcepts
);

router.delete(
  '/concepts/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.deleteConcept
);

router.get(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.listReceipts
);

router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.createReceipt
);

router.get(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getReceipt
);

router.get(
  '/:id/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.downloadReceiptPDF
);

router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  controller.deleteReceipt
);

module.exports = router;
