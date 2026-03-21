// Notification Routes - All require ADMIN role
const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');
const ctrl = require('../controllers/notificationsController');

router.use(authenticate, requireGroupAccess(['ADMIN']));

router.post('/next-month', ctrl.sendNextMonth);
router.post('/debtors', ctrl.sendDebtors);
router.post('/late-payments', ctrl.sendLatePayments);
router.post('/adjustments', ctrl.sendAdjustments);
router.post('/contract-expiring', ctrl.sendContractExpiring);
router.post('/cash-receipt', ctrl.sendCashReceipt);
router.post('/report-owner', ctrl.sendOwnerReport);
router.get('/log', ctrl.getLog);
router.get('/stats', ctrl.getStats);

module.exports = router;
