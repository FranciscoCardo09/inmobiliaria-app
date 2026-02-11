// Reports Routes - Phase 6
const express = require('express');
const router = express.Router({ mergeParams: true });
const reportsController = require('../controllers/reportsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

// ============================================
// Preview JSON (read-only)
// ============================================
router.get(
  '/liquidacion',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getLiquidacion
);

router.get(
  '/estado-cuentas',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getEstadoCuentas
);

router.get(
  '/resumen-ejecutivo',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getResumenEjecutivo
);

router.get(
  '/evolucion-ingresos',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getEvolucionIngresos
);

// ============================================
// PDF Downloads
// ============================================
router.get(
  '/liquidacion/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadLiquidacionPDF
);

router.get(
  '/estado-cuentas/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadEstadoCuentasPDF
);

router.get(
  '/resumen-ejecutivo/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadResumenPDF
);

router.post(
  '/carta-documento/pdf',
  requireGroupAccess(['ADMIN']),
  reportsController.downloadCartaDocumentoPDF
);

// ============================================
// Excel Downloads
// ============================================
router.get(
  '/liquidacion/excel',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadLiquidacionExcel
);

router.get(
  '/estado-cuentas/excel',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadEstadoCuentasExcel
);

// ============================================
// Email
// ============================================
router.post(
  '/send-email',
  requireGroupAccess(['ADMIN']),
  reportsController.sendReportEmail
);

module.exports = router;
