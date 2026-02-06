// Tenants Routes
const express = require('express');
const router = express.Router({ mergeParams: true });
const tenantsController = require('../controllers/tenantsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

// All routes require authentication and group membership
router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

// GET /api/groups/:groupId/tenants
router.get('/', tenantsController.getTenants);

// GET /api/groups/:groupId/tenants/:id
router.get('/:id', tenantsController.getTenantById);

// GET /api/groups/:groupId/tenants/:id/history
router.get('/:id/history', tenantsController.getTenantHistory);

// POST /api/groups/:groupId/tenants (ADMIN, OPERATOR)
router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  tenantsController.createTenant
);

// PUT /api/groups/:groupId/tenants/:id (ADMIN, OPERATOR)
router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  tenantsController.updateTenant
);

// DELETE /api/groups/:groupId/tenants/:id (ADMIN only)
router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  tenantsController.deleteTenant
);

module.exports = router;
