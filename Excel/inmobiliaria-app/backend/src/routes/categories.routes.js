// Categories Routes
const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access :groupId
const categoriesController = require('../controllers/categoriesController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

// All routes require authentication and group membership
router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

// GET /api/groups/:groupId/categories
router.get('/', categoriesController.getCategories);

// POST /api/groups/:groupId/categories (ADMIN, OPERATOR)
router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  categoriesController.createCategory
);

// PUT /api/groups/:groupId/categories/:id (ADMIN, OPERATOR)
router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  categoriesController.updateCategory
);

// DELETE /api/groups/:groupId/categories/:id (ADMIN only)
router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  categoriesController.deleteCategory
);

module.exports = router;
