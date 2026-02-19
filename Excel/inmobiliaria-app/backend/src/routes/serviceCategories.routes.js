// Service Categories Routes
const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/serviceCategoriesController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

router.get(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  controller.getServiceCategories
);

router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.createServiceCategory
);

router.post(
  '/seed-defaults',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.seedDefaultServiceCategories
);

router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.updateServiceCategory
);

router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  controller.deleteServiceCategory
);

module.exports = router;
