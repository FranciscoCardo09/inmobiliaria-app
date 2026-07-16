// ============================================
// ARCHIVO: PrepararNuevoMes.gs
// Funciones para preparar la planilla para un nuevo mes
// ============================================

function prepararNuevoMes(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHojaPrincipal);
  var ui = SpreadsheetApp.getUi();

  if (!hoja) {
    ui.alert("Error", "No se encontró la hoja: " + nombreHojaPrincipal, ui.ButtonSet.OK);
    return;
  }

  var respuesta = ui.alert(
    "Preparar Nuevo Mes - " + nombreHojaPrincipal,
    "¿Estás seguro de que quieres preparar la planilla para el nuevo mes?\n\n" +
    "Esto hará:\n" +
    "• Crear hoja de Deudas con pagos pendientes\n" +
    "• Traspasar saldos a favor al mes nuevo\n" +
    "• Limpiar todos los registros de pagos del mes actual\n\n" +
    "Esta acción NO se puede deshacer.",
    ui.ButtonSet.YES_NO
  );

  if (respuesta !== ui.Button.YES) {
    return;
  }

  var COL = obtenerColumnasHoja(nombreHojaPrincipal);
  var esLocal = (nombreHojaPrincipal === "Local");

  // PASO 0: CREAR COPIA DE LA PLANILLA DEL MES ACTUAL
  var fechaActual = new Date();
  var nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var mesActual = nombresMeses[fechaActual.getMonth()];
  var anioActual = fechaActual.getFullYear();
  var nombreArchivoHistorico = "Planilla " + nombreHojaPrincipal + " " + mesActual + " " + anioActual;

  var archivoActual = DriveApp.getFileById(ss.getId());
  var copiaArchivo = archivoActual.makeCopy(nombreArchivoHistorico);

  var carpetaHistorico = obtenerOCrearCarpetaHistorico();
  copiaArchivo.moveTo(carpetaHistorico);

  // PASO 1: CREAR HOJA DE DEUDAS
  var mesAnterior = new Date(fechaActual.getFullYear(), fechaActual.getMonth() - 1, 1);
  var prefijo = "";
  if (nombreHojaPrincipal === "VARIOS Control Mensual") {
    prefijo = "Deudas ";
  } else if (nombreHojaPrincipal === "Matienzo") {
    prefijo = "Matienzo Deudas ";
  } else if (nombreHojaPrincipal === "Local") {
    prefijo = "Local Deudas ";
  }

  var nombreHojaDeudas = prefijo + nombresMeses[mesAnterior.getMonth()] + " " + mesAnterior.getFullYear();

  var hojaDeudaExistente = ss.getSheetByName(nombreHojaDeudas);
  if (hojaDeudaExistente) {
    ss.deleteSheet(hojaDeudaExistente);
  }

  var datos = hoja.getDataRange().getValues();

  var filasConDeuda = [];
  for (var i = 1; i < datos.length; i++) {
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    if (nombre === "") continue;

    var pagoRegistrado = datos[i][COL.COL_PAGO_REGISTRADO - 1] === true;
    var cancelo = datos[i][COL.COL_CANCELO - 1] === "SI";

    if (!pagoRegistrado || (pagoRegistrado && !cancelo)) {
      filasConDeuda.push(i + 1);
    }
  }

  if (filasConDeuda.length > 0) {
    var hojaDeudas = hoja.copyTo(ss);
    hojaDeudas.setName(nombreHojaDeudas);

    var todasLasFilas = hojaDeudas.getLastRow();
    for (var i = todasLasFilas; i >= 2; i--) {
      if (filasConDeuda.indexOf(i) === -1) {
        hojaDeudas.deleteRow(i);
      }
    }

    var filasDeudas = hojaDeudas.getLastRow();
    for (var i = 2; i <= filasDeudas; i++) {
      var celdaPunitorios = hojaDeudas.getRange(i, COL.COL_PUNITORIOS + 1);

      var diasDelMesAnterior = new Date(mesAnterior.getFullYear(), mesAnterior.getMonth() + 1, 0).getDate();

      var letraCancelo = String.fromCharCode(65 + COL.COL_CANCELO);
      var letraAlquiler = String.fromCharCode(65 + COL.COL_ALQUILER_BASE);

      var formulaPunitorios = '=IF(' + letraCancelo + i + '="SI","",IF(ISNUMBER(' + letraAlquiler + i + '),' +
        letraAlquiler + i + ',0)*(' + diasDelMesAnterior + '+DAY(TODAY()))*0.006)';
      celdaPunitorios.setFormula(formulaPunitorios);
    }

    ss.moveActiveSheet(ss.getNumSheets());
  }

  // PASO 2: MARCAR EN ROJO LAS FILAS CON DEUDA
  for (var i = 0; i < filasConDeuda.length; i++) {
    var fila = filasConDeuda[i];
    var rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
    rangoFila.setBackground("#f8d7da");
  }

  // PASO 3: PREPARAR NUEVO MES
  var propiedadesProcesadas = 0;

  for (var i = 1; i < datos.length; i++) {
    var fila = i + 1;
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    if (nombre === "") continue;

    var sobraMesNuevo = datos[i][COL.COL_SOBRA - 1] || 0;
    var celdaAFavor = hoja.getRange(fila, COL.COL_A_FAVOR + 1);
    if (sobraMesNuevo > 0) {
      celdaAFavor.setValue(sobraMesNuevo);
    } else {
      celdaAFavor.clearContent();
    }

    var rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
    if (filasConDeuda.indexOf(fila) === -1) {
      rangoFila.setBackground(null);
    }

    // Limpiar columnas específicas según tipo de hoja
    hoja.getRange(fila, COL.COL_IVA + 1).clearContent();
    if (!esLocal) {
      hoja.getRange(fila, COL.COL_IMPUESTOS + 1).clearContent();
      hoja.getRange(fila, COL.COL_GASTOS_COMUNES + 1).clearContent();
    }
    hoja.getRange(fila, COL.COL_RENTAS + 1).clearContent();
    hoja.getRange(fila, COL.COL_MUNI + 1).clearContent();
    hoja.getRange(fila, COL.COL_DESCUENTOS + 1).clearContent();
    hoja.getRange(fila, COL.COL_EXPENSAS + 1).clearContent();
    if (esLocal) {
      hoja.getRange(fila, COL.COL_SEGURO + 1).clearContent();
    }
    hoja.getRange(fila, COL.COL_AGUA + 1).clearContent();
    hoja.getRange(fila, COL.COL_FECHA_PAGO + 1).clearContent();
    hoja.getRange(fila, COL.COL_ABONO + 1).clearContent();
    hoja.getRange(fila, COL.COL_CANCELO + 1).clearContent();
    hoja.getRange(fila, COL.COL_PAGO_REGISTRADO + 1).setValue(false);

    // Restablecer fórmula de punitorios
    var letraCancelo = String.fromCharCode(65 + COL.COL_CANCELO);
    var letraFechaPago = String.fromCharCode(65 + COL.COL_FECHA_PAGO);
    var letraAlquiler = String.fromCharCode(65 + COL.COL_ALQUILER_BASE);
    var letraFechaVenc = "H"; // Columna de fecha de vencimiento

    var formulaPunitorios = '=IF(' + letraCancelo + fila + '="SI","",IF(DAY(IF(ISNUMBER(' + letraFechaPago + fila + '),' +
      letraFechaPago + fila + ',TODAY()))>=IF(ISNUMBER(' + letraFechaVenc + fila + '),' + letraFechaVenc + fila +
      ',10),IF(ISNUMBER(' + letraAlquiler + fila + '),' + letraAlquiler + fila + ',0)*(DAY(IF(ISNUMBER(' +
      letraFechaPago + fila + '),' + letraFechaPago + fila + ',TODAY()))-IF(ISNUMBER(' + letraFechaVenc + fila + '),' +
      letraFechaVenc + fila + ',10)+1)*0.006,""))';
    hoja.getRange(fila, COL.COL_PUNITORIOS + 1).setFormula(formulaPunitorios);

    propiedadesProcesadas++;
  }

  var mensaje = "Se procesaron " + propiedadesProcesadas + " propiedades.\n\n";

  mensaje += "• Copia guardada: " + nombreArchivoHistorico + "\n";
  mensaje += "  (en carpeta 'Histórico Planillas')\n\n";

  if (filasConDeuda.length > 0) {
    mensaje += "• Hoja de deudas creada: " + nombreHojaDeudas + "\n";
    mensaje += "• " + filasConDeuda.length + " propiedades con deuda marcadas en ROJO\n";
  }

  mensaje += "• Saldos a favor traspasados\n" +
    "• Registros de pago limpiados\n" +
    "• Fórmulas de punitorios restablecidas\n";

  mensaje += "\nLa planilla está lista para el nuevo mes.\n" +
    "Recuerda actualizar manualmente la columna MES si es necesario.";

  ui.alert("Nuevo Mes Preparado", mensaje, ui.ButtonSet.OK);
}
