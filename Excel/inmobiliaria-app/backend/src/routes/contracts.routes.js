// Contracts Routes
const express = require('express');
const router = express.Router({ mergeParams: true });
const contractsController = require('../controllers/contractsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

// Static routes before :id
router.get('/expiring', contractsController.getExpiringContracts);
router.get('/adjustments', contractsController.getContractAdjustments);

router.get('/', contractsController.getContracts);
router.get('/:id', contractsController.getContractById);
router.get('/:id/rent-history', contractsController.getContractRentHistory);

router.post(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  contractsController.createContract
);

router.put(
  '/:id',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  contractsController.updateContract
);

router.delete(
  '/:id',
  requireGroupAccess(['ADMIN']),
  contractsController.deleteContract
);

module.exports = router;
