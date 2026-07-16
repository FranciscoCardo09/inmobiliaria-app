// ============================================
// ARCHIVO: RegistrarPago.gs
// Funciones para registrar pagos
// ============================================

function registrarPago(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";

  var html = HtmlService.createTemplateFromFile("formulario");
  html.hojaPrincipal = nombreHojaPrincipal;
  var evaluatedHtml = html.evaluate().setWidth(600).setHeight(500);

  SpreadsheetApp.getUi().showModalDialog(evaluatedHtml, "Registrar Pago - " + nombreHojaPrincipal);
}

function calcularFechaMesCorresponde(FECHA_INICIO, MES_TEXTO) {
  if (!FECHA_INICIO || !MES_TEXTO) return null;

  var match = MES_TEXTO.match(/Mes (\d+)/i);
  if (!match) return null;

  var numeroMes = parseInt(match[1]);
  var fechaInicio = new Date(FECHA_INICIO);

  var anioCorresponde = fechaInicio.getFullYear();
  var mesCorresponde = fechaInicio.getMonth() + (numeroMes - 1);

  while (mesCorresponde >= 12) {
    mesCorresponde -= 12;
    anioCorresponde++;
  }

  var fecha = new Date(anioCorresponde, mesCorresponde, 1);
  var mes = (mesCorresponde + 1).toString();
  var anio = anioCorresponde.toString();

  return mes + "/1/" + anio;
}

function guardarPago(formulario) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var partes = formulario.propiedad.split("|");
  var nombreHoja = partes[0];
  var fila = parseInt(partes[1]);

  var fecha = formulario.fecha;
  var monto = parseFloat(formulario.monto);

  var hoja = ss.getSheetByName(nombreHoja);
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

  var abonoAnterior = hoja.getRange(fila, COL.COL_ABONO).getValue() || 0;
  var abonoTotal = abonoAnterior + monto;

  var totalCeldaAntes = hoja.getRange(fila, COL.COL_TOTAL).getValue();
  var punitoriosCeldaAntes = hoja.getRange(fila, COL.COL_PUNITORIOS).getValue();
  var aFavorAntes = hoja.getRange(fila, COL.COL_A_FAVOR).getValue();

  var totalAntes = (typeof totalCeldaAntes === 'number') ? totalCeldaAntes : 0;
  var punitoriosAntes = (typeof punitoriosCeldaAntes === 'number') ? punitoriosCeldaAntes : 0;
  var aFavorOriginal = (typeof aFavorAntes === 'number') ? aFavorAntes : 0;

  hoja.getRange(fila, COL.COL_ABONO).setValue(abonoTotal);
  SpreadsheetApp.flush();

  var totalCelda = hoja.getRange(fila, COL.COL_TOTAL).getValue();
  var sobraCelda = hoja.getRange(fila, COL.COL_SOBRA).getValue();
  var deudaCelda = hoja.getRange(fila, COL.COL_DEUDA).getValue();

  var total = (typeof totalCelda === 'number') ? totalCelda : 0;
  var sobra = (typeof sobraCelda === 'number') ? sobraCelda : 0;
  var deuda = (typeof deudaCelda === 'number') ? deudaCelda : 0;

  if (total === 0 || (sobra === 0 && deuda === 0 && abonoTotal > 0)) {
    total = totalAntes;
    if (abonoTotal >= total) {
      sobra = abonoTotal - total;
      deuda = 0;
    } else {
      sobra = 0;
      deuda = total - abonoTotal;
    }
  }

  var diferencia = total - abonoTotal;
  var cancelo = (diferencia <= 0.01 && total > 0);

  var punitoriosParaHistorial = punitoriosAntes;

  if (cancelo) {
    var punitoriosCelda = hoja.getRange(fila, COL.COL_PUNITORIOS).getValue();
    if (typeof punitoriosCelda === 'number' && punitoriosCelda > 0) {
      punitoriosParaHistorial = punitoriosCelda;
    }
  }

  hoja.getRange(fila, COL.COL_CANCELO).setValue(cancelo ? "SI" : "NO");

  if (cancelo) {
    hoja.getRange(fila, COL.COL_FECHA_PAGO).setValue(fecha);
    if (punitoriosParaHistorial !== 0) {
      hoja.getRange(fila, COL.COL_PUNITORIOS).setValue(punitoriosParaHistorial);
    }
  }

  hoja.getRange(fila, COL.COL_PAGO_REGISTRADO).setValue(true);

  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 || nombreHoja.indexOf("Matienzo Deudas ") === 0 || nombreHoja.indexOf("Local Deudas ") === 0);
  var nombreHojaPrincipal = determinarHojaPrincipal(nombreHoja);

  if (esHojaDeudas && cancelo) {
    var datosBasicosDeuda = hoja.getRange(fila, 1, 1, 3).getValues()[0];
    var propiedadDeuda = ((datosBasicosDeuda[0] || "") + " " + (datosBasicosDeuda[1] || "")).trim();
    var inquilinoDeuda = datosBasicosDeuda[2] || "";

    hoja.deleteRow(fila);

    var hojaVarios = ss.getSheetByName(nombreHojaPrincipal);
    if (hojaVarios) {
      var datosVarios = hojaVarios.getDataRange().getValues();
      var COL_PRINCIPAL = obtenerColumnasHoja(nombreHojaPrincipal);

      for (var i = 1; i < datosVarios.length; i++) {
        var propiedadVarios = ((datosVarios[i][0] || "") + " " + (datosVarios[i][1] || "")).trim();
        var inquilinoVarios = datosVarios[i][2] || "";

        if (propiedadVarios === propiedadDeuda && inquilinoVarios === inquilinoDeuda) {
          var rangoFilaVarios = hojaVarios.getRange(i + 1, 1, 1, hojaVarios.getLastColumn());
          var canceloVarios = datosVarios[i][COL_PRINCIPAL.COL_CANCELO - 1] === "SI";
          var pagoVarios = datosVarios[i][COL_PRINCIPAL.COL_PAGO_REGISTRADO - 1] === true;

          if (canceloVarios) {
            rangoFilaVarios.setBackground("#d4edda");
          } else if (pagoVarios && !canceloVarios) {
            rangoFilaVarios.setBackground("#fff3cd");
          } else {
            rangoFilaVarios.setBackground(null);
          }
          break;
        }
      }
    }
  }

  if (!esHojaDeudas) {
    var rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
    var colorActual = rangoFila.getBackground();
    var tieneDeudaPendiente = (colorActual === "#f8d7da");

    if (tieneDeudaPendiente) {
      rangoFila.setBackground("#f8d7da");
    } else {
      if (cancelo) {
        rangoFila.setBackground("#d4edda");
      } else if (deuda > 0) {
        rangoFila.setBackground("#fff3cd");
      }
    }
  }

  var historial = ss.getSheetByName("Historial de Pagos");
  var datosBasicos = hoja.getRange(fila, 1, 1, 7).getValues()[0];

  const PROP_CONCAT = ((datosBasicos[0] || "") + " " + (datosBasicos[1] || "")).trim();
  const INQUILINO = datosBasicos[2] || "";
  const FECHA_INICIO = datosBasicos[3] || null;
  const MES_TEXTO = datosBasicos[6] || "";

  var fechaMesCorresponde = calcularFechaMesCorresponde(FECHA_INICIO, MES_TEXTO);
  const MES_ANIO = fechaMesCorresponde || MES_TEXTO;

  const ALQUILER_BASE = hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue() || 0;
  const IVA = hoja.getRange(fila, COL.COL_IVA).getValue() || 0;
  const IMPUESTOS = esLocal ? 0 : (hoja.getRange(fila, COL.COL_IMPUESTOS).getValue() || 0);
  const GASTOS_COMUNES = esLocal ? 0 : (hoja.getRange(fila, COL.COL_GASTOS_COMUNES).getValue() || 0);
  const RENTAS = hoja.getRange(fila, COL.COL_RENTAS).getValue() || 0;
  const MUNI = hoja.getRange(fila, COL.COL_MUNI).getValue() || 0;
  const DESCUENTOS = hoja.getRange(fila, COL.COL_DESCUENTOS).getValue() || 0;
  const EXPENSAS = hoja.getRange(fila, COL.COL_EXPENSAS).getValue() || 0;
  const AGUA = hoja.getRange(fila, COL.COL_AGUA).getValue() || 0;
  const A_FAVOR = aFavorOriginal;
  const PUNITORIOS = punitoriosAntes;
  const TOTAL_A_PAGAR = totalAntes;
  const FECHA_REGISTRO = new Date();

  var observaciones = "";
  if (esHojaDeudas) {
    var mesDeuda = nombreHoja.replace("Deudas ", "").replace("Matienzo Deudas ", "").replace("Local Deudas ", "");
    observaciones = "Pago deuda " + mesDeuda;
  } else {
    if (MES_TEXTO) {
      var matchMes = MES_TEXTO.match(/^([^\-]+)/);
      if (matchMes) {
        var nombreMes = matchMes[1].trim();
        nombreMes = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
        observaciones = "Pago mes " + nombreMes;
      }
    }
    if (!observaciones) {
      observaciones = "Pago mes actual";
    }
  }

  historial.appendRow([
    FECHA_REGISTRO, PROP_CONCAT, INQUILINO, MES_ANIO, ALQUILER_BASE, IVA, IMPUESTOS,
    GASTOS_COMUNES, RENTAS, MUNI, DESCUENTOS, EXPENSAS, AGUA, PUNITORIOS, A_FAVOR,
    0, TOTAL_A_PAGAR, fecha, monto, sobra, deuda, cancelo ? "SI" : "NO", observaciones
  ]);

  if (cancelo) {
    return "¡Pago registrado! Alquiler del mes cancelado completamente.";
  } else if (deuda > 0) {
    return "Pago parcial registrado. Deuda restante: $" + deuda.toFixed(2);
  } else {
    return "¡Pago registrado con éxito!";
  }
}
