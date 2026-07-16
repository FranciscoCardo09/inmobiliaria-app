// ============================================
// ARCHIVO: GenerarReportes.gs
// Funciones para generar reportes de pago
// ============================================

function mostrarFormularioReporte(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";

  var html = HtmlService.createTemplateFromFile("formularioReporte");
  html.hojaPrincipal = nombreHojaPrincipal;
  var evaluatedHtml = html.evaluate().setWidth(600).setHeight(500);

  SpreadsheetApp.getUi().showModalDialog(evaluatedHtml, "Generar Reporte - " + nombreHojaPrincipal);
}

function generarReporteConFecha(formulario) {
  var partes = formulario.propiedad.split("|");
  var nombreHoja = partes[0];
  var fila = parseInt(partes[1]);
  var fechaPago = new Date(formulario.fechaPago);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  var esDeuda = (nombreHoja.indexOf("Deudas ") === 0 || nombreHoja.indexOf("Matienzo Deudas ") === 0 || nombreHoja.indexOf("Local Deudas ") === 0);
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

  var numCols = esLocal ? 29 : 30;
  var datos = hoja.getRange(fila, 1, 1, numCols).getValues()[0];

  var propiedad = ((datos[0] || "") + " " + (datos[1] || "")).trim();
  var inquilino = datos[2] || "";
  var mes = datos[6] || "Mes actual";
  var fechaVencimiento = datos[7] || 10;
  var alquilerBase = datos[COL.COL_ALQUILER_BASE - 1] || 0;

  var punitoriosCalculados = 0;
  if (esDeuda) {
    var mesDeuda = nombreHoja.replace("Deudas ", "").replace("Matienzo Deudas ", "").replace("Local Deudas ", "");
    var nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var match = mesDeuda.match(/(\w+)\s+(\d+)/);
    if (match) {
      var nombreMes = match[1];
      var anio = parseInt(match[2]);
      var numeroMes = nombresMeses.indexOf(nombreMes);

      if (numeroMes >= 0) {
        var fechaInicio = new Date(anio, numeroMes, 1);
        var diasTranscurridos = Math.floor((fechaPago - fechaInicio) / (1000 * 60 * 60 * 24)) + 1;
        punitoriosCalculados = alquilerBase * diasTranscurridos * 0.006;
      }
    }
  } else {
    if (fechaPago.getDate() >= fechaVencimiento) {
      var diasAtraso = fechaPago.getDate() - fechaVencimiento + 1;
      punitoriosCalculados = alquilerBase * diasAtraso * 0.006;
    }
  }

  var iva = datos[COL.COL_IVA - 1] || 0;
  var impuestos = esLocal ? 0 : (datos[COL.COL_IMPUESTOS - 1] || 0);
  var gastosComunes = esLocal ? 0 : (datos[COL.COL_GASTOS_COMUNES - 1] || 0);
  var rentas = datos[COL.COL_RENTAS - 1] || 0;
  var muni = datos[COL.COL_MUNI - 1] || 0;
  var descuentos = datos[COL.COL_DESCUENTOS - 1] || 0;
  var expensas = datos[COL.COL_EXPENSAS - 1] || 0;
  var seguro = esLocal ? (datos[COL.COL_SEGURO - 1] || 0) : 0;
  var agua = datos[COL.COL_AGUA - 1] || 0;
  var aFavor = datos[COL.COL_A_FAVOR - 1] || 0;

  var total = alquilerBase + iva + impuestos + gastosComunes + rentas + muni - descuentos + expensas + seguro + agua - aFavor + punitoriosCalculados;

  var urlDocumento = crearDocumentoReportePersonalizado({
    propiedad: propiedad,
    inquilino: inquilino,
    mes: mes,
    esDeuda: esDeuda,
    alquiler: alquilerBase,
    iva: iva,
    impuestos: impuestos,
    gastosComunes: gastosComunes,
    rentas: rentas,
    muni: muni,
    descuentos: descuentos,
    expensas: expensas,
    seguro: seguro,
    agua: agua,
    aFavor: aFavor,
    punitorios: punitoriosCalculados,
    total: total,
    fechaPago: fechaPago,
    esLocal: esLocal
  });

  return urlDocumento;
}

function crearDocumentoReportePersonalizado(datos) {
  var plantillas = DriveApp.getFilesByName("Plantilla_1Propiedad");
  if (!plantillas.hasNext()) {
    throw new Error("No se encontró la plantilla 'Plantilla_1Propiedad' en Drive");
  }
  var plantilla = plantillas.next();

  var tipoReporte = datos.esDeuda ? "Deuda " + datos.mes : datos.mes;
  var nombreReporte = datos.propiedad + " Reporte " + tipoReporte;

  var copia = plantilla.makeCopy(nombreReporte);
  var doc = DocumentApp.openById(copia.getId());
  var body = doc.getBody();

  var detalleConceptos = "Alquiler mes de " + datos.mes + "                                                 $ " + formatearNumero(datos.alquiler) + "\n";

  if (datos.iva && datos.iva != 0) {
    detalleConceptos += "IVA                                                                                          $ " + formatearNumero(datos.iva) + "\n";
  }
  if (datos.impuestos && datos.impuestos != 0) {
    detalleConceptos += "Impuestos                                                                              $ " + formatearNumero(datos.impuestos) + "\n";
  }
  if (datos.gastosComunes && datos.gastosComunes != 0) {
    detalleConceptos += "Gastos Comunes                                                                    $ " + formatearNumero(datos.gastosComunes) + "\n";
  }
  if (datos.rentas && datos.rentas != 0) {
    detalleConceptos += "Rentas                                                                                    $ " + formatearNumero(datos.rentas) + "\n";
  }
  if (datos.muni && datos.muni != 0) {
    detalleConceptos += "Municipal                                                                                $ " + formatearNumero(datos.muni) + "\n";
  }
  if (datos.descuentos && datos.descuentos != 0) {
    detalleConceptos += "Descuentos                                                                            $ -" + formatearNumero(datos.descuentos) + "\n";
  }
  if (datos.expensas && datos.expensas != 0) {
    detalleConceptos += "Expensas                                                                               $ " + formatearNumero(datos.expensas) + "\n";
  }
  if (datos.seguro && datos.seguro != 0) {
    detalleConceptos += "Seguro                                                                                    $ " + formatearNumero(datos.seguro) + "\n";
  }
  if (datos.agua && datos.agua != 0) {
    detalleConceptos += "Agua                                                                                        $ " + formatearNumero(datos.agua) + "\n";
  }
  if (datos.aFavor && datos.aFavor != 0) {
    detalleConceptos += "A Favor Mes Anterior                                                              $ -" + formatearNumero(datos.aFavor) + "\n";
  }
  if (datos.punitorios && datos.punitorios != 0) {
    detalleConceptos += "Punitorios                                                                               $ " + formatearNumero(datos.punitorios) + "\n";
  }

  var honorarios = datos.alquiler * 0.08;
  var fecha = Utilities.formatDate(datos.fechaPago, "GMT-3", "dd/MM");
  var totalTexto = numeroATexto(datos.total);
  var honorariosTexto = numeroATexto(honorarios);

  var detalleTitulo = datos.esDeuda ? "Deuda " + datos.mes : "Detalle " + datos.mes;
  body.replaceText("{{DETALLE}}", detalleTitulo);
  body.replaceText("{{DETALLE_CONCEPTOS}}", detalleConceptos);
  body.replaceText("{{TOTAL}}", "$ " + formatearNumero(datos.total));
  body.replaceText("{{TOTAL_TEXTO}}", totalTexto);
  body.replaceText("{{FECHA_DEPOSITO}}", fecha);
  body.replaceText("{{HONORARIOS}}", "$ " + formatearNumero(honorarios));
  body.replaceText("{{HONORARIOS_TEXTO}}", honorariosTexto);
  body.replaceText("{{TITULAR}}", datos.inquilino);

  doc.saveAndClose();

  var carpetaPropiedad = obtenerOCrearCarpetaPropiedad(datos.propiedad);
  copia.moveTo(carpetaPropiedad);

  return doc.getUrl();
}
