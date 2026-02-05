// Properties Routes
const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access :groupId
const propertiesController = require('../controllers/propertiesController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

// All routes require authentication and group membership
router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

// GET /api/groups/:groupId/properties
router.get('/', propertiesController.getProperties);

// GET /api/groups/:groupId/properties/:id
router.get('/:id', propertiesController.getPropertyById);

// POST /api/groups/:groupId/properties (ADMIN, OPERATOR)
router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  propertiesController.createProperty
);

// PUT /api/groups/:groupId/properties/:id (ADMIN, OPERATOR)
router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  propertiesController.updateProperty
);

// DELETE /api/groups/:groupId/properties/:id (ADMIN only)
router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  propertiesController.deleteProperty
);

module.exports = router;
