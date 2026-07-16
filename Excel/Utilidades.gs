// ============================================
// ARCHIVO: Utilidades.gs
// Funciones auxiliares y de utilidad
// ============================================

// ============================================
// FUNCIÓN AUXILIAR: Determinar Hoja Principal
// ============================================
function determinarHojaPrincipal(nombreHoja) {
  // Si contiene "Matienzo" en el nombre
  if (nombreHoja.indexOf("Matienzo") !== -1) {
    return "Matienzo";
  }
  // Si contiene "Local" en el nombre
  if (nombreHoja.indexOf("Local") !== -1 || nombreHoja === "Local") {
    return "Local";
  }
  // Por defecto, asumir VARIOS
  return "VARIOS Control Mensual";
}

// ============================================
// FUNCIÓN AUXILIAR: Obtener columnas según hoja
// CORREGIDO: Columnas actualizadas según planilla real
// ============================================
function obtenerColumnasHoja(nombreHoja) {
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

  if (esLocal) {
    // Columnas para Local
    // Rentas: O (15), Muni: P (16), Agua: T (20)
    return {
      COL_ALQUILER_BASE: 10,
      COL_ALQUILER_AJUSTE: 11,
      COL_IVA: 13,
      COL_RENTAS: 15,        // Columna O
      COL_MUNI: 16,          // Columna P
      COL_DESCUENTOS: 17,
      COL_EXPENSAS: 18,
      COL_SEGURO: 19,
      COL_AGUA: 20,          // Columna T
      COL_A_FAVOR: 21,
      COL_PUNITORIOS: 22,
      COL_TOTAL: 23,
      COL_FECHA_PAGO: 24,
      COL_ABONO: 25,
      COL_SOBRA: 26,
      COL_DEUDA: 27,
      COL_CANCELO: 28,
      COL_PAGO_REGISTRADO: 29
    };
  } else {
    // Columnas para VARIOS y Matienzo
    // Rentas: Q (17), Muni: R (18), Agua: U (21)
    return {
      COL_ALQUILER_BASE: 10,
      COL_ALQUILER_AJUSTE: 11,
      COL_IVA: 13,
      COL_IMPUESTOS: 14,
      COL_GASTOS_COMUNES: 15,
      COL_RENTAS: 17,        // Columna Q
      COL_MUNI: 18,          // Columna R
      COL_DESCUENTOS: 19,
      COL_EXPENSAS: 20,
      COL_AGUA: 21,          // Columna U
      COL_A_FAVOR: 22,
      COL_PUNITORIOS: 23,
      COL_TOTAL: 24,
      COL_FECHA_PAGO: 25,
      COL_ABONO: 26,
      COL_SOBRA: 27,
      COL_DEUDA: 28,
      COL_CANCELO: 29,
      COL_PAGO_REGISTRADO: 30
    };
  }
}

// ============================================
// FUNCIÓN: Formatear número a formato argentino
// ============================================
function formatearNumero(valor) {
  if (!valor || valor == 0) return "0,00";
  var num = parseFloat(valor).toFixed(2);
  var partes = num.split('.');
  var entero = partes[0];
  var decimal = partes[1];
  entero = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return entero + ',' + decimal;
}

// ============================================
// FUNCIÓN: Convertir número a texto
// ============================================
function numeroATexto(numero) {
  var num = Math.floor(numero);
  var centavos = Math.round((numero - num) * 100);

  if (num === 0) return "CERO PESOS";

  var unidades = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  var decenas = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  var especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  var centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

  function convertirGrupo(n) {
    if (n === 0) return "";
    if (n === 100) return "CIEN";

    var texto = "";
    var c = Math.floor(n / 100);
    var d = Math.floor((n % 100) / 10);
    var u = n % 10;

    if (c > 0) texto += centenas[c] + " ";

    if (d === 1 && u > 0) {
      texto += especiales[u];
    } else {
      if (d > 0) texto += decenas[d];
      if (d > 2 && u > 0) texto += " Y ";
      if (u > 0 && d !== 1) texto += unidades[u];
    }

    return texto.trim();
  }

  var millones = Math.floor(num / 1000000);
  var miles = Math.floor((num % 1000000) / 1000);
  var resto = num % 1000;

  var texto = "";

  if (millones > 0) {
    if (millones === 1) {
      texto += "UN MILLÓN ";
    } else {
      texto += convertirGrupo(millones) + " MILLONES ";
    }
  }

  if (miles > 0) {
    if (miles === 1) {
      texto += "MIL ";
    } else {
      texto += convertirGrupo(miles) + " MIL ";
    }
  }

  if (resto > 0) {
    texto += convertirGrupo(resto);
  }

  texto = "SON PESOS " + texto.trim();

  if (centavos > 0) {
    texto += " CON " + convertirGrupo(centavos) + " CENTAVOS";
  } else {
    texto += " CON CERO CENTAVOS";
  }

  return texto;
}

// ============================================
// FUNCIÓN: Obtener o crear carpeta de propiedad
// ============================================
function obtenerOCrearCarpetaPropiedad(nombrePropiedad) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var archivo = DriveApp.getFileById(ss.getId());
  var carpetaPadre = archivo.getParents().hasNext() ? archivo.getParents().next() : DriveApp.getRootFolder();

  var carpetasReportes = carpetaPadre.getFoldersByName("Reportes");
  var carpetaReportes;
  if (carpetasReportes.hasNext()) {
    carpetaReportes = carpetasReportes.next();
  } else {
    carpetaReportes = carpetaPadre.createFolder("Reportes");
  }

  var carpetasPropiedad = carpetaReportes.getFoldersByName(nombrePropiedad);
  if (carpetasPropiedad.hasNext()) {
    return carpetasPropiedad.next();
  } else {
    return carpetaReportes.createFolder(nombrePropiedad);
  }
}

// ============================================
// FUNCIÓN: Obtener o crear carpeta histórico
// ============================================
function obtenerOCrearCarpetaHistorico() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var archivo = DriveApp.getFileById(ss.getId());
  var carpetaPadre = archivo.getParents().hasNext() ? archivo.getParents().next() : DriveApp.getRootFolder();

  var carpetas = carpetaPadre.getFoldersByName("Histórico Planillas");
  if (carpetas.hasNext()) {
    return carpetas.next();
  } else {
    return carpetaPadre.createFolder("Histórico Planillas");
  }
}
