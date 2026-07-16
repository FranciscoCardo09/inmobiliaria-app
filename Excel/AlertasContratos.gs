// ============================================
// ARCHIVO: AlertasContratos.gs
// Funciones para verificar y mostrar alertas de contratos
// ============================================

function verificarContratosProximosAVencer() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojas = ["VARIOS Control Mensual", "Matienzo", "Local"];
  var mensajesAlerta = [];

  hojas.forEach(function(nombreHoja) {
    var hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) return;

    var datos = hoja.getDataRange().getValues();

    for (var i = 1; i < datos.length; i++) {
      var propiedad = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
      var inquilino = datos[i][2] || "";
      var termino = datos[i][5];
      var mesTexto = datos[i][6] || "";

      if (propiedad === "" || !mesTexto || !termino) continue;

      var match = mesTexto.match(/Mes (\d+)/i);
      if (!match) continue;

      var mesActual = parseInt(match[1]);
      var mesesRestantes = termino - mesActual;

      if (mesesRestantes <= 2 && mesesRestantes >= 0) {
        mensajesAlerta.push({
          hoja: nombreHoja,
          propiedad: propiedad,
          inquilino: inquilino,
          mesActual: mesActual,
          termino: termino,
          mesesRestantes: mesesRestantes
        });
      }
    }
  });

  return mensajesAlerta;
}

function verificarYMostrarAlertas() {
  var alertas = verificarContratosProximosAVencer();

  if (alertas.length > 0) {
    var mensaje = "⚠️ " + alertas.length + " contrato(s) próximo(s) a vencer. " +
                  "Ve al menú Pagos > Ver Contratos Próximos a Vencer";
    SpreadsheetApp.getActiveSpreadsheet().toast(mensaje, "⚠️ Alerta de Contratos", 15);
  }
}

function mostrarAlertasContratos() {
  var alertas = verificarContratosProximosAVencer();
  var ui = SpreadsheetApp.getUi();

  if (alertas.length === 0) {
    ui.alert(
      "✅ Contratos al Día",
      "No hay contratos próximos a vencer en los próximos 2 meses.",
      ui.ButtonSet.OK
    );
    return;
  }

  var mensaje = "Los siguientes contratos están próximos a vencer:\n\n";

  var porHoja = {
    "VARIOS Control Mensual": [],
    "Matienzo": [],
    "Local": []
  };

  alertas.forEach(function(alerta) {
    if (porHoja[alerta.hoja]) {
      porHoja[alerta.hoja].push(alerta);
    }
  });

  Object.keys(porHoja).forEach(function(nombreHoja) {
    if (porHoja[nombreHoja].length > 0) {
      mensaje += "━━━ " + nombreHoja.toUpperCase() + " ━━━\n\n";

      porHoja[nombreHoja].forEach(function(alerta) {
        var estado = alerta.mesesRestantes === 0 ? "⛔ VENCE ESTE MES" :
                     alerta.mesesRestantes === 1 ? "⚠️ Vence el próximo mes" :
                     "⚠️ Vencen en " + alerta.mesesRestantes + " meses";

        mensaje += "• " + alerta.propiedad + "\n";
        mensaje += "  Inquilino: " + alerta.inquilino + "\n";
        mensaje += "  Progreso: Mes " + alerta.mesActual + "/" + alerta.termino + "\n";
        mensaje += "  Estado: " + estado + "\n\n";
      });
    }
  });

  ui.alert("⚠️ Contratos Próximos a Vencer (" + alertas.length + ")", mensaje, ui.ButtonSet.OK);
}
