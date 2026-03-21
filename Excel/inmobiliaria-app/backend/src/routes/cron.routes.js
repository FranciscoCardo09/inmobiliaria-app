// Cron Routes - External cron job endpoints
const express = require('express');
const router = express.Router();
const { cronAuth } = require('../middleware/cronAuth');
const ctrl = require('../controllers/notificationsController');

router.post('/late-payments', cronAuth, ctrl.cronLatePayments);

module.exports = router;
