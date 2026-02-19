// Holidays Routes
const express = require('express');
const router = express.Router();
const controller = require('../controllers/holidaysController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', controller.getHolidays);
router.post('/', controller.createHoliday);
router.post('/seed', controller.seedHolidays);
router.delete('/:id', controller.deleteHoliday);

module.exports = router;
