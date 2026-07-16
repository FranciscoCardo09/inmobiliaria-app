// ============================================
// ARCHIVO: ReporteImpuestos.gs
// Sistema de reportes de impuestos
// ============================================

/**
 * Muestra el formulario para generar reportes de impuestos
 */
function mostrarFormularioImpuestos() {
  var html = HtmlService.createHtmlOutputFromFile("formularioImpuestos")
    .setWidth(600)
    .setHeight(550);

  SpreadsheetApp.getUi().showModalDialog(html, "Generar Reporte de Impuestos");
}

/**
 * Obtiene lista de propiedades con sus impuestos
 * Retorna: [id, nombre, muni, rentas, agua, esLocal]
 *
 * IMPORTANTE: Incluye TODAS las propiedades, incluso las que ya cancelaron,
 * porque los impuestos deben pagarse independientemente del estado del alquiler
 */
function getListaPropiedadesConImpuestos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojas = ["VARIOS Control Mensual", "Matienzo", "Local"];
  var lista = [];

  Logger.log("=== INICIANDO BÚSQUEDA DE PROPIEDADES CON IMPUESTOS ===");

  hojas.forEach(function(nombreHoja) {
    Logger.log("\n--- Procesando hoja: " + nombreHoja + " ---");

    var hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) {
      Logger.log("  ✗ Hoja NO encontrada: " + nombreHoja);
      return;
    }

    Logger.log("  ✓ Hoja encontrada");

    var datos = hoja.getDataRange().getValues();
    var COL = obtenerColumnasHoja(nombreHoja);
    var esLocal = (nombreHoja === "Local");

    Logger.log("  Total filas en hoja: " + datos.length);
    Logger.log("  Columna MUNI: " + COL.COL_MUNI);
    Logger.log("  Columna RENTAS: " + COL.COL_RENTAS);
    Logger.log("  Columna AGUA: " + COL.COL_AGUA);

    var propiedadesEncontradas = 0;

    for (var i = 1; i < datos.length; i++) {
      var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
      if (nombre === "") continue;

      var inquilino = datos[i][2] || "";

      // Función auxiliar para convertir valores a números
      function toNumber(valor) {
        if (typeof valor === 'number') return valor;
        if (valor === null || valor === undefined || valor === '') return 0;
        if (typeof valor === 'string') {
          var valorLimpio = valor.trim().toLowerCase();
          if (valorLimpio === '' || valorLimpio === 'comp' || valorLimpio === 'efectivo') return 0;
          valorLimpio = valorLimpio.replace(/[^\d.,\-]/g, '');
          if (valorLimpio === '') return 0;
          var num = parseFloat(valorLimpio);
          return isNaN(num) ? 0 : num;
        }
        return 0;
      }

      var muni = toNumber(datos[i][COL.COL_MUNI - 1]);
      var rentas = toNumber(datos[i][COL.COL_RENTAS - 1]);
      var agua = toNumber(datos[i][COL.COL_AGUA - 1]);

      // CORRECCIÓN: NO filtrar por estado de cancelación
      // Incluir TODAS las propiedades que tengan al menos un impuesto
      // Los impuestos se pagan independientemente del estado del alquiler
      if (muni > 0 || rentas > 0 || agua > 0) {
        var id = nombreHoja + "|" + (i + 1);

        // Verificar estado de cancelación solo para el log
        var cancelo = (datos[i][COL.COL_CANCELO - 1] === "SI");
        var estadoLog = cancelo ? " [CANCELADO]" : "";

        lista.push([
          id,
          nombre + " - " + inquilino,
          muni,
          rentas,
          agua,
          esLocal
        ]);

        propiedadesEncontradas++;

        // Log detallado de las primeras 3 propiedades
        if (propiedadesEncontradas <= 3) {
          Logger.log("  Propiedad " + propiedadesEncontradas + estadoLog + ":");
          Logger.log("    Nombre: " + nombre);
          Logger.log("    Inquilino: " + inquilino);
          Logger.log("    Muni: " + muni);
          Logger.log("    Rentas: " + rentas);
          Logger.log("    Agua: " + agua);
        }
      }
    }

    Logger.log("  ✓ Propiedades encontradas en " + nombreHoja + ": " + propiedadesEncontradas);
  });

  Logger.log("\n=== RESUMEN FINAL ===");
  Logger.log("Total propiedades con impuestos: " + lista.length);

  // Mostrar primeras 5 propiedades
  Logger.log("\nPrimeras 5 propiedades:");
  for (var j = 0; j < Math.min(5, lista.length); j++) {
    Logger.log((j + 1) + ". " + lista[j][1] + " (Muni: $" + lista[j][2] + ", Rentas: $" + lista[j][3] + ", Agua: $" + lista[j][4] + ")");
  }

  return lista;
}

/**
 * Genera el reporte de impuestos INDIVIDUAL
 * IMPORTANTE: Los impuestos son a mes vencido
 * Si generas en Febrero 2026, pagas el período 01-2026 (Enero)
 */
function generarReporteImpuestos(formulario) {
  var partes = formulario.propiedad.split("|");
  var nombreHoja = partes[0];
  var fila = parseInt(partes[1]);
  var mes = formulario.mes;
  var anio = parseInt(formulario.anio);
  var esProvidusManual = (formulario.esProvidus === 'true' || formulario.esProvidus === true);

  // ===== CÁLCULO DE MES VENCIDO =====
  var mesesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  var mesActualIndex = mesesNombres.indexOf(mes);

  // Calcular mes anterior
  var mesAnteriorIndex = mesActualIndex - 1;
  var anioAnterior = anio;

  if (mesAnteriorIndex < 0) {
    mesAnteriorIndex = 11;
    anioAnterior = anio - 1;
  }

  var mesAnterior = mesesNombres[mesAnteriorIndex];

  // Formato del período: MM-AAAA (mes anterior)
  var periodoNumero = (mesAnteriorIndex + 1).toString().padStart(2, '0');
  var periodo = periodoNumero + '-' + anioAnterior;

  Logger.log("=== CÁLCULO DE PERÍODO ===");
  Logger.log("Mes de generación: " + mes + " " + anio);
  Logger.log("Mes a pagar (vencido): " + mesAnterior + " " + anioAnterior);
  Logger.log("Período: " + periodo);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local");

  // Leer datos de la propiedad
  var columna1 = hoja.getRange(fila, 1).getValue() || "";
  var columna2 = hoja.getRange(fila, 2).getValue() || "";
  var inquilino = hoja.getRange(fila, 3).getValue() || "";
  var propiedad = (columna1 + " " + columna2).trim();

  // Leer impuestos
  var muni = hoja.getRange(fila, COL.COL_MUNI).getValue() || 0;
  var rentas = hoja.getRange(fila, COL.COL_RENTAS).getValue() || 0;
  var agua = hoja.getRange(fila, COL.COL_AGUA).getValue() || 0;

  Logger.log("=== GENERANDO REPORTE DE IMPUESTOS ===");
  Logger.log("Propiedad: " + propiedad);
  Logger.log("Muni: " + muni);
  Logger.log("Rentas: " + rentas);
  Logger.log("Agua: " + agua);

  // Construir detalle de impuestos (SOLO los que tienen valor)
  var detalleImpuestos = "";
  var total = 0;

  if (muni > 0) {
    detalleImpuestos += "Impuesto Municipal (periodo " + periodo + ")                    $ " +
                        formatearNumero(muni) + ".-\n";
    total += muni;
  }

  if (rentas > 0) {
    detalleImpuestos += "Impuesto Provincial (periodo " + periodo + ")                    $ " +
                        formatearNumero(rentas) + ".-\n";
    total += rentas;
  }

  if (agua > 0) {
    detalleImpuestos += "Aguas Cordobesas (periodo " + periodo + ")                          $ " +
                        formatearNumero(agua) + ".-\n";
    total += agua;
  }

  // ===== USAR SELECCIÓN MANUAL DE PROVIDUS =====
  Logger.log("¿Es PROVIDUS (manual)?: " + esProvidusManual);

  // Datos bancarios según selección manual
  var datosBancarios = "";
  if (esProvidusManual) {
    datosBancarios = "BANCO COLUMBIA\n" +
                     "1. Titular: Providus S.A.\n" +
                     "2. CUIT: 30-67880531-5\n" +
                     "3. Tipo de cuenta: Cuenta corriente\n" +
                     "4. N° de Cuenta: 5202334361\n" +
                     "5. CBU: 3890004230005202334361";
  } else {
    datosBancarios = "BANCO GALICIA\n" +
                     "1. Titular: Maria Lorena Boxer\n" +
                     "2. CUIT: 27-25429274-0\n" +
                     "3. Tipo de cuenta: Caja de ahorros\n" +
                     "4. N° de Cuenta: 404616110765\n" +
                     "5. CBU: 0070076430004046161155";
  }

  // Crear documento desde plantilla
  var urlDocumento = crearDocumentoReporteImpuestos({
    propiedad: propiedad,
    mes: mes,
    anio: anio,
    periodo: periodo + ' (' + mesAnterior + ' ' + anioAnterior + ')',
    detalleImpuestos: detalleImpuestos,
    total: total,
    datosBancarios: datosBancarios,
    esProvidus: esProvidusManual
  });

  return urlDocumento;
}

/**
 * Crea el documento de reporte de impuestos INDIVIDUAL desde la plantilla
 */
function crearDocumentoReporteImpuestos(datos) {
  // Buscar plantilla
  var plantillas = DriveApp.getFilesByName("Plantilla_Impuestos");
  if (!plantillas.hasNext()) {
    throw new Error("No se encontró la plantilla 'Plantilla_Impuestos' en Drive");
  }
  var plantilla = plantillas.next();

  // Crear nombre del reporte
  var nombreReporte = "Impuestos " + datos.mes + " " + datos.anio + " - " + datos.propiedad;

  // Crear copia
  var copia = plantilla.makeCopy(nombreReporte);
  var doc = DocumentApp.openById(copia.getId());
  var body = doc.getBody();

  // Reemplazar placeholders
  body.replaceText("\\{\\{MES\\}\\}", datos.mes);
  body.replaceText("\\{\\{ANIO\\}\\}", datos.anio);
  body.replaceText("\\{\\{PERIODO\\}\\}", datos.periodo);
  body.replaceText("\\{\\{DETALLE_PROPIEDADES\\}\\}", datos.propiedad);
  body.replaceText("\\{\\{DETALLE_IMPUESTOS\\}\\}", datos.detalleImpuestos);
  body.replaceText("\\{\\{TOTAL\\}\\}", "$ " + formatearNumero(datos.total) + ".-");
  body.replaceText("\\{\\{TOTAL_TEXTO\\}\\}", "SON PESOS " + numeroATexto(datos.total));
  body.replaceText("\\{\\{DATOS_BANCARIOS\\}\\}", datos.datosBancarios);

  doc.saveAndClose();

  // Mover a carpeta de la propiedad dentro de Impuestos
  var carpetaPropiedad = obtenerOCrearCarpetaPropiedadImpuestos(datos.propiedad);
  copia.moveTo(carpetaPropiedad);

  Logger.log("✓ Reporte de impuestos generado: " + doc.getUrl());

  return doc.getUrl();
}

/**
 * Genera UN SOLO reporte de impuestos con múltiples propiedades
 * VERSIÓN MEJORADA: Muestra detalle individual de cada propiedad SIN resumen intermedio
 */
function generarReporteImpuestosMultiples(formulario) {
  try {
    var propiedadesIds = formulario.propiedades;
    var mes = formulario.mes;
    var anio = parseInt(formulario.anio);
    var esProvidusManual = (formulario.esProvidus === 'true' || formulario.esProvidus === true);

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    Logger.log("=== GENERANDO REPORTE MÚLTIPLE DE IMPUESTOS ===");
    Logger.log("Total propiedades: " + propiedadesIds.length);
    Logger.log("Mes: " + mes + " " + anio);
    Logger.log("Providus: " + esProvidusManual);

    // Calcular mes vencido
    var mesesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    var mesActualIndex = mesesNombres.indexOf(mes);
    var mesAnteriorIndex = mesActualIndex - 1;
    var anioAnterior = anio;

    if (mesAnteriorIndex < 0) {
      mesAnteriorIndex = 11;
      anioAnterior = anio - 1;
    }

    var mesAnterior = mesesNombres[mesAnteriorIndex];
    var periodoNumero = (mesAnteriorIndex + 1).toString().padStart(2, '0');
    var periodo = periodoNumero + '-' + anioAnterior + ' (' + mesAnterior + ' ' + anioAnterior + ')';

    Logger.log("Período calculado: " + periodo);

    // Acumuladores de totales (solo para el total final)
    var totalMuni = 0;
    var totalRentas = 0;
    var totalAgua = 0;
    var detallePropiedades = "";

    // Procesar cada propiedad CON SU DETALLE INDIVIDUAL
    propiedadesIds.forEach(function(idPropiedad, index) {
      Logger.log("Procesando propiedad " + (index + 1) + "...");

      var partes = idPropiedad.split("|");
      var nombreHoja = partes[0];
      var fila = parseInt(partes[1]);

      var hoja = ss.getSheetByName(nombreHoja);
      var COL = obtenerColumnasHoja(nombreHoja);

      // Leer datos de la propiedad
      var columna1 = hoja.getRange(fila, 1).getValue() || "";
      var columna2 = hoja.getRange(fila, 2).getValue() || "";
      var inquilino = hoja.getRange(fila, 3).getValue() || "";
      var propiedad = (columna1 + " " + columna2).trim();

      // Leer impuestos
      var muni = parseFloat(hoja.getRange(fila, COL.COL_MUNI).getValue()) || 0;
      var rentas = parseFloat(hoja.getRange(fila, COL.COL_RENTAS).getValue()) || 0;
      var agua = parseFloat(hoja.getRange(fila, COL.COL_AGUA).getValue()) || 0;

      // CONSTRUIR DETALLE INDIVIDUAL DE ESTA PROPIEDAD
      detallePropiedades += propiedad + " - " + inquilino + "\n";

      // Agregar impuestos solo si tienen valor
      if (muni > 0) {
        detallePropiedades += "  Impuesto Municipal (periodo " + periodoNumero + "-" + anioAnterior +
                              ")     $ " + formatearNumero(muni) + ".-\n";
        totalMuni += muni;
      }

      if (rentas > 0) {
        detallePropiedades += "  Impuesto Provincial (periodo " + periodoNumero + "-" + anioAnterior +
                              ")    $ " + formatearNumero(rentas) + ".-\n";
        totalRentas += rentas;
      }

      if (agua > 0) {
        detallePropiedades += "  Aguas Cordobesas (periodo " + periodoNumero + "-" + anioAnterior +
                              ")       $ " + formatearNumero(agua) + ".-\n";
        totalAgua += agua;
      }

      // Salto de línea entre propiedades
      detallePropiedades += "\n";

      Logger.log("✓ Procesada: " + propiedad + " (Muni: " + muni + ", Rentas: " + rentas + ", Agua: " + agua + ")");
    });

    Logger.log("Totales acumulados - Muni: " + totalMuni + ", Rentas: " + totalRentas + ", Agua: " + totalAgua);

    // CAMBIO: NO construir resumen intermedio de totales
    // Solo calcular el total general
    var totalGeneral = totalMuni + totalRentas + totalAgua;

    Logger.log("Total general: " + totalGeneral);

    // Datos bancarios según selección
    var datosBancarios = "";
    if (esProvidusManual) {
      datosBancarios = "BANCO COLUMBIA\n" +
                       "1. Titular: Providus S.A.\n" +
                       "2. CUIT: 30-67880531-5\n" +
                       "3. Tipo de cuenta: Cuenta corriente\n" +
                       "4. N° de Cuenta: 5202334361\n" +
                       "5. CBU: 3890004230005202334361";
    } else {
      datosBancarios = "BANCO GALICIA\n" +
                       "1. Titular: Maria Lorena Boxer\n" +
                       "2. CUIT: 27-25429274-0\n" +
                       "3. Tipo de cuenta: Caja de ahorros\n" +
                       "4. N° de Cuenta: 404616110765\n" +
                       "5. CBU: 0070076430004046161155";
    }

    Logger.log("Creando documento...");

    // Crear documento desde plantilla
    var urlDocumento = crearDocumentoReporteImpuestosMultiples({
      mes: mes,
      anio: anio,
      periodo: periodo,
      detallePropiedades: detallePropiedades,
      detalleImpuestos: "", // ← VACÍO: No mostrar resumen intermedio
      total: totalGeneral,
      datosBancarios: datosBancarios,
      cantidadPropiedades: propiedadesIds.length
    });

    Logger.log("=== COMPLETADO ===");
    Logger.log("URL: " + urlDocumento);

    return urlDocumento;

  } catch (error) {
    Logger.log("❌ ERROR en generarReporteImpuestosMultiples: " + error.toString());
    Logger.log("Stack: " + error.stack);
    throw error;
  }
}

/**
 * Crea el documento de reporte de impuestos múltiples desde la plantilla
 */
function crearDocumentoReporteImpuestosMultiples(datos) {
  // Buscar plantilla
  var plantillas = DriveApp.getFilesByName("Plantilla_Impuestos_Multiples");
  if (!plantillas.hasNext()) {
    throw new Error("No se encontró la plantilla 'Plantilla_Impuestos_Multiples' en Drive");
  }
  var plantilla = plantillas.next();

  // Crear nombre del reporte
  var nombreReporte = "Impuestos " + datos.mes + " " + datos.anio + " - " +
                      datos.cantidadPropiedades + " Propiedades";

  // Crear copia
  var copia = plantilla.makeCopy(nombreReporte);
  var doc = DocumentApp.openById(copia.getId());
  var body = doc.getBody();

  // Reemplazar placeholders
  body.replaceText("\\{\\{MES\\}\\}", datos.mes);
  body.replaceText("\\{\\{ANIO\\}\\}", datos.anio);
  body.replaceText("\\{\\{PERIODO\\}\\}", datos.periodo);
  body.replaceText("\\{\\{DETALLE_PROPIEDADES\\}\\}", datos.detallePropiedades);
  body.replaceText("\\{\\{DETALLE_IMPUESTOS\\}\\}", datos.detalleImpuestos);
  body.replaceText("\\{\\{TOTAL\\}\\}", "$ " + formatearNumero(datos.total) + ".-");
  body.replaceText("\\{\\{TOTAL_TEXTO\\}\\}", "SON PESOS " + numeroATexto(datos.total));
  body.replaceText("\\{\\{DATOS_BANCARIOS\\}\\}", datos.datosBancarios);

  doc.saveAndClose();

  // Mover a carpeta de impuestos (principal, sin subcarpeta)
  var carpetaImpuestos = obtenerOCrearCarpetaImpuestosPrincipal();
  copia.moveTo(carpetaImpuestos);

  Logger.log("✓ Reporte múltiple generado: " + doc.getUrl());

  return doc.getUrl();
}

/**
 * Obtiene o crea la carpeta "Impuestos" al mismo nivel que la planilla
 * NO dentro de "Reportes"
 */
function obtenerOCrearCarpetaImpuestosPrincipal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var archivo = DriveApp.getFileById(ss.getId());
  var carpetaPadre = archivo.getParents().hasNext() ? archivo.getParents().next() : DriveApp.getRootFolder();

  // Buscar o crear carpeta "Impuestos" directamente en la carpeta padre
  var carpetasImpuestos = carpetaPadre.getFoldersByName("Impuestos");

  if (carpetasImpuestos.hasNext()) {
    return carpetasImpuestos.next();
  } else {
    return carpetaPadre.createFolder("Impuestos");
  }
}

/**
 * Obtiene o crea la subcarpeta de una propiedad dentro de "Impuestos"
 */
function obtenerOCrearCarpetaPropiedadImpuestos(nombrePropiedad) {
  var carpetaImpuestos = obtenerOCrearCarpetaImpuestosPrincipal();

  var carpetasPropiedad = carpetaImpuestos.getFoldersByName(nombrePropiedad);
  if (carpetasPropiedad.hasNext()) {
    return carpetasPropiedad.next();
  } else {
    return carpetaImpuestos.createFolder(nombrePropiedad);
  }
}
