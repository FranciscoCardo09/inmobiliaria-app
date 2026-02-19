// Settings Routes - Group company configuration
const express = require('express');
const router = express.Router({ mergeParams: true });
const settingsController = require('../controllers/settingsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

router.get(
  '/',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  settingsController.getSettings
);

router.put(
  '/',
  requireGroupAccess(['ADMIN']),
  settingsController.updateSettings
);

module.exports = router;
