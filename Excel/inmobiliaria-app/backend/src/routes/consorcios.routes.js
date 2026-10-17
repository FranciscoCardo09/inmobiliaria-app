// /api/groups/:groupId/consorcios — rendición mensual de consorcios.
// Lectura: cualquier miembro. Escritura: ADMIN/OPERATOR. Borrar y reabrir: ADMIN.
const express = require('express');
const router = express.Router({ mergeParams: true });
const c = require('../controllers/consorcioController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

const READ = requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']);
const WRITE = requireGroupAccess(['ADMIN', 'OPERATOR']);
const ADMIN = requireGroupAccess(['ADMIN']);

router.use(authenticate);

// Rendiciones (antes que '/:id' para que no las capture)
router.get('/rendiciones/:rid', READ, c.getRendicion);
router.patch('/rendiciones/:rid/movimientos', WRITE, c.classify);
router.post('/rendiciones/:rid/reaplicar-reglas', WRITE, c.reapply);
router.post('/rendiciones/:rid/ajustes', WRITE, c.createAjuste);
router.put('/rendiciones/:rid/ajustes/:ajusteId', WRITE, c.updateAjuste);
router.delete('/rendiciones/:rid/ajustes/:ajusteId', WRITE, c.removeAjuste);
router.put('/rendiciones/:rid/reserva', WRITE, c.setReserve);
router.put('/rendiciones/:rid/orden', WRITE, c.setLineOrder);
router.post('/rendiciones/:rid/cerrar', WRITE, c.close);
router.post('/rendiciones/:rid/reabrir', ADMIN, c.reopen);
router.delete('/rendiciones/:rid', ADMIN, c.removeRendicion);
router.get('/rendiciones/:rid/descargar/:format', READ, c.download);

// Consorcios, rubros y reglas
router.get('/', READ, c.list);
router.post('/', WRITE, c.create);
router.get('/:id', READ, c.get);
router.put('/:id', WRITE, c.update);
router.delete('/:id', ADMIN, c.remove);
router.post('/:id/rubros', WRITE, c.createRubro);
router.put('/:id/rubros/:rubroId', WRITE, c.updateRubro);
router.delete('/:id/rubros/:rubroId', ADMIN, c.removeRubro);
router.post('/:id/reglas', WRITE, c.createRegla);
router.put('/:id/reglas/:reglaId', WRITE, c.updateRegla);
router.delete('/:id/reglas/:reglaId', WRITE, c.removeRegla);
router.get('/:id/rendiciones', READ, c.listRendiciones);
router.post('/:id/rendiciones', WRITE, c.upload);

module.exports = router;
