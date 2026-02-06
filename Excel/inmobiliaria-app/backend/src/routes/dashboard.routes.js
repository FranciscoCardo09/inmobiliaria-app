// Dashboard Routes - Phase 3.5
const express = require('express');
const router = express.Router({ mergeParams: true });
const dashboardController = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);
router.use(requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']));

router.get('/summary', dashboardController.getSummary);

module.exports = router;
