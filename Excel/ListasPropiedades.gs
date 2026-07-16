// ============================================
// ARCHIVO: ListasPropiedades.gs
// Funciones para obtener listas de propiedades y hojas de deudas
// ============================================

function getHojasDeudas(nombreHojaPrincipal) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojas = ss.getSheets();
  var hojasDeudas = [];

  var prefijo = "";
  if (nombreHojaPrincipal === "VARIOS Control Mensual") {
    prefijo = "Deudas ";
  } else if (nombreHojaPrincipal === "Matienzo") {
    prefijo = "Matienzo Deudas ";
  } else if (nombreHojaPrincipal === "Local") {
    prefijo = "Local Deudas ";
  }

  for (var i = 0; i < hojas.length; i++) {
    var nombre = hojas[i].getName();
    if (nombre.indexOf(prefijo) === 0) {
      hojasDeudas.push(nombre);
    }
  }

  return hojasDeudas;
}

function getListaPropiedades(nombreHoja) {
  if (!nombreHoja) {
    nombreHoja = "VARIOS Control Mensual";
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) {
    Logger.log("No se encontró la hoja: " + nombreHoja);
    return [];
  }

  var datos = hoja.getDataRange().getValues();
  var lista = [];
  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 || nombreHoja.indexOf("Matienzo Deudas ") === 0 || nombreHoja.indexOf("Local Deudas ") === 0);
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

  Logger.log("Procesando hoja: " + nombreHoja + ", Total filas: " + datos.length);

  for (var i = 1; i < datos.length; i++) {
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    var inquilino = datos[i][2] || "";

    if (nombre !== "") {
      var mesActual = datos[i][6] || "";
      var total = datos[i][COL.COL_TOTAL - 1] || 0;
      var abono = datos[i][COL.COL_ABONO - 1] || 0;
      var pagoRegistrado = datos[i][COL.COL_PAGO_REGISTRADO - 1] === true;
      var cancelo = (datos[i][COL.COL_CANCELO - 1] === "SI");

      // Excluir propiedades canceladas del mes actual (ya pagaron)
      // NO excluir de hojas de deudas (para poder registrar el pago)
      if (!esHojaDeudas && cancelo) {
        continue;
      }

      var totalAPagar = (abono > 0 && total > abono) ? (total - abono) : total;

      var listaItem = [
        nombreHoja + "|" + (i + 1),
        (nombre + " - " + inquilino).trim(),
        totalAPagar,
        datos[i][COL.COL_ALQUILER_BASE - 1] || 0,
        datos[i][COL.COL_IVA - 1] || 0
      ];

      if (esLocal) {
        listaItem.push(0); // IMPUESTOS
        listaItem.push(0); // GASTOS_COMUNES
        listaItem.push(datos[i][COL.COL_RENTAS - 1] || 0);
        listaItem.push(datos[i][COL.COL_MUNI - 1] || 0);
        listaItem.push(datos[i][COL.COL_DESCUENTOS - 1] || 0);
        listaItem.push(datos[i][COL.COL_EXPENSAS - 1] || 0);
        listaItem.push(datos[i][COL.COL_SEGURO - 1] || 0); // SEGURO para Local
        listaItem.push(datos[i][COL.COL_AGUA - 1] || 0);
        listaItem.push(datos[i][COL.COL_A_FAVOR - 1] || 0);
        listaItem.push(datos[i][COL.COL_PUNITORIOS - 1] || 0);
      } else {
        listaItem.push(datos[i][COL.COL_IMPUESTOS - 1] || 0);
        listaItem.push(datos[i][COL.COL_GASTOS_COMUNES - 1] || 0);
        listaItem.push(datos[i][COL.COL_RENTAS - 1] || 0);
        listaItem.push(datos[i][COL.COL_MUNI - 1] || 0);
        listaItem.push(datos[i][COL.COL_DESCUENTOS - 1] || 0);
        listaItem.push(datos[i][COL.COL_EXPENSAS - 1] || 0);
        listaItem.push(datos[i][COL.COL_AGUA - 1] || 0);
        listaItem.push(datos[i][COL.COL_A_FAVOR - 1] || 0);
        listaItem.push(datos[i][COL.COL_PUNITORIOS - 1] || 0);
      }

      listaItem.push(pagoRegistrado);
      listaItem.push(abono);
      listaItem.push(pagoRegistrado && !cancelo);
      listaItem.push(esHojaDeudas);
      listaItem.push(esLocal);

      lista.push(listaItem);
    }
  }

  Logger.log("Total propiedades encontradas: " + lista.length);
  return lista;
}
