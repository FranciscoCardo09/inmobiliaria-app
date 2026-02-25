const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/propertyGroupController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

router.get('/', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), controller.list);
router.post('/', requireGroupAccess(['ADMIN', 'OPERATOR']), controller.create);
router.put('/:id', requireGroupAccess(['ADMIN', 'OPERATOR']), controller.update);
router.delete('/:id', requireGroupAccess(['ADMIN']), controller.remove);

module.exports = router;
