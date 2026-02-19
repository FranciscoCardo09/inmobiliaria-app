// AdjustmentIndices Routes
const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/adjustmentIndicesController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

router.get('/', controller.getIndices);
router.get('/:id', controller.getIndexById);

router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.createIndex
);

router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.updateIndex
);

router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  controller.deleteIndex
);

// Apply adjustment to contracts
router.post(
  '/:id/apply',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.applyAdjustment
);

// Apply adjustment to specific month
router.post(
  '/:id/apply-to-month',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.applyAdjustmentToMonth
);

// Apply adjustment to specific calendar month/year
router.post(
  '/:id/apply-to-calendar',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.applyAdjustmentToCalendar
);

// Undo adjustment for specific month
router.post(
  '/:id/undo-month',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.undoAdjustmentForMonth
);

// Undo adjustment for specific calendar month/year
router.post(
  '/:id/undo-calendar',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.undoAdjustmentForCalendar
);

module.exports = router;
