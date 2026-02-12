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
  '/liquidacion-all',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getLiquidacionAll
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

router.get(
  '/ajustes-mes',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getAjustesMes
);

router.get(
  '/control-mensual',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getControlMensual
);

router.get(
  '/impuestos',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getImpuestos
);

router.get(
  '/vencimientos',
  requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']),
  reportsController.getVencimientos
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
  '/liquidacion-all/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadLiquidacionAllPDF
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

router.get(
  '/pago-efectivo/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadPagoEfectivoPDF
);

router.post(
  '/pago-efectivo/pdf/multi',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadMultiPagoEfectivoPDF
);

router.get(
  '/impuestos/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadImpuestosPDF
);

router.get(
  '/vencimientos/pdf',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadVencimientosPDF
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

router.get(
  '/ajustes-mes/excel',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadAjustesMesExcel
);

router.get(
  '/control-mensual/excel',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  reportsController.downloadControlMensualExcel
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
