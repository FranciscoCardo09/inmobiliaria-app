// ============================================
// ARCHIVO: Menu.gs
// Menú principal y función onOpen
// ============================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  // Crear menú para VARIOS Control Mensual
  ui.createMenu("Pagos VARIOS")
    .addItem("Registrar Pago", "registrarPagoVARIOS")
    .addItem("Generar Reporte", "mostrarFormularioReporteVARIOS")
    .addItem("Confirmar Ajustes", "confirmarAjustesVARIOS")
    .addItem("Preparar Nuevo Mes", "prepararNuevoMesVARIOS")
    .addSeparator()
    .addItem("⚠️ Ver Contratos Próximos a Vencer", "mostrarAlertasContratos")
    .addToUi();

  // Crear menú para Matienzo
  ui.createMenu("Pagos MATIENZO")
    .addItem("Registrar Pago", "registrarPagoMATIENZO")
    .addItem("Generar Reporte", "mostrarFormularioReporteMATIENZO")
    .addItem("Confirmar Ajustes", "confirmarAjustesMATIENZO")
    .addItem("Preparar Nuevo Mes", "prepararNuevoMesMATIENZO")
    .addSeparator()
    .addItem("⚠️ Ver Contratos Próximos a Vencer", "mostrarAlertasContratos")
    .addToUi();

  // Crear menú para Local
  ui.createMenu("Pagos LOCAL")
    .addItem("Registrar Pago", "registrarPagoLOCAL")
    .addItem("Generar Reporte", "mostrarFormularioReporteLOCAL")
    .addItem("Confirmar Ajustes", "confirmarAjustesLOCAL")
    .addItem("Preparar Nuevo Mes", "prepararNuevoMesLOCAL")
    .addSeparator()
    .addItem("⚠️ Ver Contratos Próximos a Vencer", "mostrarAlertasContratos")
    .addToUi();

  // Crear menú de Impuestos
  ui.createMenu("Impuestos")
    .addItem("Generar Reporte de Impuestos", "mostrarFormularioImpuestos")
    .addToUi();

  // Verificar contratos al abrir la planilla
  verificarYMostrarAlertas();
}
