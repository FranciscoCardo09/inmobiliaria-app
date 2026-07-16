// ============================================
// ARCHIVO: ConfirmarAjustes.gs
// Funciones para confirmar ajustes de alquiler
// ============================================

function confirmarAjustes(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHojaPrincipal);

  if (!hoja) {
    SpreadsheetApp.getUi().alert("Error", "No se encontró la hoja: " + nombreHojaPrincipal, SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  var datos = hoja.getDataRange().getValues();
  var COL = obtenerColumnasHoja(nombreHojaPrincipal);

  const COL_COLUMNA1 = 0;
  const COL_COLUMNA2 = 1;
  const COL_INQUILINOS = 2;
  const COL_MES = 6;
  const COL_PERIODICIDAD = 8;
  const COL_INDICE = 9;

  var ajustesRealizados = 0;
  var propiedadesAjustadas = [];
  var datosParaPDF = [];

  for (var i = 1; i < datos.length; i++) {
    var alquilerAjuste = datos[i][COL.COL_ALQUILER_AJUSTE];

    if (alquilerAjuste && alquilerAjuste !== "" && alquilerAjuste !== 0 && !isNaN(alquilerAjuste)) {
      var fila = i + 1;
      var col1 = datos[i][COL_COLUMNA1] || "";
      var col2 = datos[i][COL_COLUMNA2] || "";
      var inquilinos = datos[i][COL_INQUILINOS] || "";
      var mes = datos[i][COL_MES] || "";
      var alquilerAnterior = datos[i][COL.COL_ALQUILER_BASE] || 0;
      var periodicidad = datos[i][COL_PERIODICIDAD] || "";
      var indice = datos[i][COL_INDICE] || "";

      var porcentaje = ((alquilerAjuste - alquilerAnterior) / alquilerAnterior * 100).toFixed(2);

      datosParaPDF.push({
        columna1: col1,
        columna2: col2,
        inquilinos: inquilinos,
        mes: mes,
        ajustes: periodicidad,
        indice: indice,
        alquilerBase: alquilerAnterior,
        alquilerConAjuste: alquilerAjuste,
        porcentaje: porcentaje
      });

      hoja.getRange(fila, COL.COL_ALQUILER_BASE + 1).setValue(alquilerAjuste);
      hoja.getRange(fila, COL.COL_ALQUILER_AJUSTE + 1).clearContent();

      ajustesRealizados++;
      propiedadesAjustadas.push(
        col1 + " " + col2 + ": $" + alquilerAnterior.toLocaleString('es-AR') +
        " → $" + alquilerAjuste.toLocaleString('es-AR') +
        " (+" + porcentaje + "% " + indice + " " + periodicidad + ")"
      );
    }
  }

  var ui = SpreadsheetApp.getUi();
  if (ajustesRealizados > 0) {
    var urlPDF = generarPDFAjustes(datosParaPDF);

    ui.alert(
      "Ajustes Confirmados - " + nombreHojaPrincipal,
      "Se confirmaron " + ajustesRealizados + " ajuste(s) de alquiler:\n\n" +
      propiedadesAjustadas.join("\n") + "\n\n" +
      "✅ Alquiler Base actualizado\n" +
      "✅ Columna de ajuste limpiada\n" +
      "✅ Documento de ajustes generado\n\n" +
      "Abre el documento aquí:\n" + urlPDF,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      "Sin Ajustes - " + nombreHojaPrincipal,
      "No hay ajustes pendientes para confirmar.\n\n" +
      "Los ajustes aparecen automáticamente en la columna L cuando:\n" +
      "• Han pasado los meses según la periodicidad\n" +
      "• La fórmula calcula el nuevo valor",
      ui.ButtonSet.OK
    );
  }
}

function generarPDFAjustes(datosAjustes) {
  var fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  var nombreDoc = "Ajustes de Alquiler - " + fechaHoy;
  var doc = DocumentApp.create(nombreDoc);
  var body = doc.getBody();

  body.setPageWidth(792);
  body.setPageHeight(612);
  body.setMarginTop(30);
  body.setMarginBottom(30);
  body.setMarginLeft(30);
  body.setMarginRight(30);

  var titulo = body.appendParagraph("AJUSTES DE ALQUILER");
  titulo.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  titulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  titulo.editAsText().setFontSize(24).setBold(true).setFontFamily('Arial');

  var fecha = body.appendParagraph("Fecha: " + fechaHoy);
  fecha.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  fecha.editAsText().setFontSize(12).setFontFamily('Arial');

  body.appendParagraph("");

  var datos = [
    ["Propiedad", "Ubicación", "Inquilino", "Mes", "Period.", "Índice", "Alquiler Anterior", "Alquiler Nuevo", "Aumento"]
  ];

  datosAjustes.forEach(function(prop) {
    datos.push([
      prop.columna1,
      prop.columna2,
      prop.inquilinos,
      prop.mes,
      prop.ajustes,
      prop.indice,
      "$" + prop.alquilerBase.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
      "$" + prop.alquilerConAjuste.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
      "+" + prop.porcentaje + "%"
    ]);
  });

  var tabla = body.appendTable(datos);

  tabla.setColumnWidth(0, 65);
  tabla.setColumnWidth(1, 75);
  tabla.setColumnWidth(2, 70);
  tabla.setColumnWidth(3, 80);
  tabla.setColumnWidth(4, 55);
  tabla.setColumnWidth(5, 45);
  tabla.setColumnWidth(6, 90);
  tabla.setColumnWidth(7, 90);
  tabla.setColumnWidth(8, 60);

  var encabezados = tabla.getRow(0);
  for (var i = 0; i < encabezados.getNumCells(); i++) {
    var celda = encabezados.getCell(i);
    celda.setBackgroundColor("#4285f4");
    var texto = celda.editAsText();
    texto.setForegroundColor("#ffffff");
    texto.setBold(true);
    texto.setFontSize(9);
    texto.setFontFamily('Arial');
    celda.setPaddingTop(6);
    celda.setPaddingBottom(6);
    celda.setPaddingLeft(4);
    celda.setPaddingRight(4);
    celda.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  }

  for (var i = 1; i < tabla.getNumRows(); i++) {
    var fila = tabla.getRow(i);
    var colorFondo = (i % 2 === 0) ? "#f8f9fa" : "#ffffff";

    for (var j = 0; j < fila.getNumCells(); j++) {
      var celda = fila.getCell(j);
      celda.setBackgroundColor(colorFondo);
      var texto = celda.editAsText();
      texto.setFontSize(8);
      texto.setFontFamily('Arial');
      celda.setPaddingTop(4);
      celda.setPaddingBottom(4);
      celda.setPaddingLeft(4);
      celda.setPaddingRight(4);
      celda.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);

      if (j >= 6) {
        celda.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }

    var celdaAumento = fila.getCell(8);
    celdaAumento.editAsText().setBold(true).setForegroundColor("#0f9d58");
  }

  tabla.setBorderWidth(1);
  tabla.setBorderColor("#dee2e6");

  body.appendParagraph("");
  var resumen = body.appendParagraph("Total de propiedades ajustadas: " + datosAjustes.length);
  resumen.setBold(true);
  resumen.editAsText().setFontSize(12).setFontFamily('Arial');
  resumen.setSpacingBefore(15);

  var totalAnterior = 0;
  var totalNuevo = 0;
  datosAjustes.forEach(function(prop) {
    totalAnterior += prop.alquilerBase;
    totalNuevo += prop.alquilerConAjuste;
  });

  var aumentoTotal = totalNuevo - totalAnterior;
  var porcentajeTotal = ((aumentoTotal / totalAnterior) * 100).toFixed(2);

  var totales = body.appendParagraph(
    "Alquileres anteriores: $" + totalAnterior.toLocaleString('es-AR', {minimumFractionDigits: 2}) + "\n" +
    "Alquileres nuevos: $" + totalNuevo.toLocaleString('es-AR', {minimumFractionDigits: 2}) + "\n" +
    "Aumento total: $" + aumentoTotal.toLocaleString('es-AR', {minimumFractionDigits: 2}) + " (+" + porcentajeTotal + "%)"
  );
  totales.editAsText().setFontSize(11).setFontFamily('Arial');
  totales.setSpacingBefore(10);

  doc.saveAndClose();

  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs('application/pdf');
  var carpetaPDF = DriveApp.getRootFolder();
  var pdfFile = carpetaPDF.createFile(pdfBlob);
  pdfFile.setName(nombreDoc + ".pdf");

  return doc.getUrl();
}
