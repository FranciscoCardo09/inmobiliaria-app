// Monthly Records Routes - Phase 5
const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/monthlyRecordsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

// Monthly Records
router.get(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getMonthlyRecords
);

router.get(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getMonthlyRecordDetail
);

router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.updateMonthlyRecord
);

router.post(
  '/generate',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.forceGenerate
);

// Batch services
router.post(
  '/batch-services',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.batchAddServices
);

// Bulk load: same service+amount to multiple properties x multiple months
router.post(
  '/bulk-load-services',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.bulkLoadServices
);

// IVA toggle
router.patch(
  '/:recordId/iva',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.toggleIva
);

// Forgive balance
router.patch(
  '/:recordId/forgive-balance',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.forgiveBalance
);

// Monthly Services (nested under records)
router.get(
  '/:recordId/services',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getRecordServices
);

router.post(
  '/:recordId/services',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.addRecordService
);

router.put(
  '/:recordId/services/:serviceId',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.updateRecordService
);

router.delete(
  '/:recordId/services/:serviceId',
  requireGroupAccess(['ADMIN']),
  controller.deleteRecordService
);

module.exports = router;
