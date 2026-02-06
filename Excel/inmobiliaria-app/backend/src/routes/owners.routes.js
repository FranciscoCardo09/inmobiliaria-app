// Owners Routes
const express = require('express');
const router = express.Router({ mergeParams: true });
const ownersController = require('../controllers/ownersController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

router.get('/', ownersController.getOwners);
router.get('/:id', ownersController.getOwnerById);

router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  ownersController.createOwner
);

router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  ownersController.updateOwner
);

router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  ownersController.deleteOwner
);

module.exports = router;
