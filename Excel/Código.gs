// ============================================
// ARCHIVO: Codigo.gs COMPLETO CON PUNITORIOS MEJORADOS
// Sistema de Pagos para VARIOS, Matienzo y Local
// VERSIÓN CON CÁLCULO INTELIGENTE DE PUNITORIOS
// ============================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  
  // Crear menú para VARIOS Control Mensual
  ui.createMenu("Pagos VARIOS")
    .addItem("Registrar Pago", "registrarPagoVARIOS")
    .addSeparator()
    .addItem("Generar Reporte", "mostrarFormularioReporteVARIOS")
    .addSeparator()
    .addItem("Confirmar Ajustes", "confirmarAjustesVARIOS")
    .addItem("Generar Reporte de Ajustes", "generarReporteAjustesVARIOS")
    .addSeparator()
    .addItem("Preparar Nuevo Mes", "prepararNuevoMesVARIOS")
    .addSeparator()
    .addItem("⚠️ Ver Contratos Próximos a Vencer", "mostrarAlertasContratos")
    .addToUi();
  
  // Crear menú para Matienzo
  ui.createMenu("Pagos MATIENZO")
    .addItem("Registrar Pago", "registrarPagoMATIENZO")
    .addSeparator()
    .addItem("Generar Reporte", "mostrarFormularioReporteMATIENZO")
    .addSeparator()
    .addItem("Confirmar Ajustes", "confirmarAjustesMATIENZO")
    .addItem("Generar Reporte de Ajustes", "generarReporteAjustesMATIENZO")
    .addSeparator()
    .addItem("Preparar Nuevo Mes", "prepararNuevoMesMATIENZO")
    .addSeparator()
    .addItem("⚠️ Ver Contratos Próximos a Vencer", "mostrarAlertasContratos")
    .addToUi();
  
  // Crear menú para Local
  ui.createMenu("Pagos LOCAL")
    .addItem("Registrar Pago", "registrarPagoLOCAL")
    .addSeparator()
    .addItem("Generar Reporte", "mostrarFormularioReporteLOCAL")
    .addSeparator()
    .addItem("Confirmar Ajustes", "confirmarAjustesLOCAL")
    .addItem("Generar Reporte de Ajustes", "generarReporteAjustesLOCAL")
    .addSeparator()
    .addItem("Preparar Nuevo Mes", "prepararNuevoMesLOCAL")
    .addSeparator()
    .addItem("⚠️ Ver Contratos Próximos a Vencer", "mostrarAlertasContratos")
    .addToUi();
  
  // Verificar contratos al abrir la planilla
  verificarYMostrarAlertas();

  ui.createMenu("📊 Reportes")
    .addItem("Generar Reporte de Impuestos", "mostrarFormularioImpuestos")
    .addToUi();
}

// ============================================
// FUNCIONES WRAPPER PARA VARIOS
// ============================================
function registrarPagoVARIOS() {
  registrarPago("VARIOS Control Mensual");
}

function mostrarFormularioReporteVARIOS() {
  mostrarFormularioReporte("VARIOS Control Mensual");
}

function confirmarAjustesVARIOS() {
  confirmarAjustes("VARIOS Control Mensual");
}

function generarReporteAjustesVARIOS() {
  generarReporteAjustes("VARIOS Control Mensual");
}

function prepararNuevoMesVARIOS() {
  prepararNuevoMes("VARIOS Control Mensual");
}

// ============================================
// FUNCIONES WRAPPER PARA MATIENZO
// ============================================
function registrarPagoMATIENZO() {
  registrarPago("Matienzo");
}

function mostrarFormularioReporteMATIENZO() {
  mostrarFormularioReporte("Matienzo");
}

function confirmarAjustesMATIENZO() {
  confirmarAjustes("Matienzo");
}

function generarReporteAjustesMATIENZO() {
  generarReporteAjustes("Matienzo");
}

function prepararNuevoMesMATIENZO() {
  prepararNuevoMes("Matienzo");
}

// ============================================
// FUNCIONES WRAPPER PARA LOCAL
// ============================================
function registrarPagoLOCAL() {
  registrarPago("Local");
}

function mostrarFormularioReporteLOCAL() {
  mostrarFormularioReporte("Local");
}

function confirmarAjustesLOCAL() {
  confirmarAjustes("Local");
}

function generarReporteAjustesLOCAL() {
  generarReporteAjustes("Local");
}

function prepararNuevoMesLOCAL() {
  prepararNuevoMes("Local");
}

// ============================================
// WRAPPERS PARA COMPATIBILIDAD CON FORMULARIO
// ============================================

function generarReporteConFecha(formulario) {
  return generarReporteConFechaMejorado(formulario);
}

function generarReporteGrupo(formulario) {
  return generarReporteGrupoMejorado(formulario);
}

// ============================================
// FUNCIONES AUXILIARES DE FORMATEO
// ============================================

/**
 * Formatea un número con separadores de miles y 2 decimales
 * Ejemplo: 1234567.89 → "1,234,567.89"
 */
function formatearNumero(numero) {
  if (numero === null || numero === undefined || numero === "") {
    return "0.00";
  }
  
  var num = parseFloat(numero);
  if (isNaN(num)) {
    return "0.00";
  }
  
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Convierte un número a texto en español
 * Ejemplo: 1234.50 → "MIL DOSCIENTOS TREINTA Y CUATRO CON 50/100"
 */
function numeroATexto(numero) {
  if (numero === null || numero === undefined || numero === "" || isNaN(numero)) {
    return "CERO PESOS";
  }
  
  var num = parseFloat(numero);
  var entero = Math.floor(num);
  var decimales = Math.round((num - entero) * 100);
  
  var unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  var decenas = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  var especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  var centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  
  function convertirGrupo(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    
    var texto = '';
    var c = Math.floor(n / 100);
    var d = Math.floor((n % 100) / 10);
    var u = n % 10;
    
    if (c > 0) {
      texto += centenas[c];
      if (d > 0 || u > 0) texto += ' ';
    }
    
    if (d === 1) {
      texto += especiales[u];
    } else {
      if (d > 1) {
        texto += decenas[d];
        if (u > 0) texto += ' Y ';
      }
      if (u > 0 && d !== 1) {
        texto += unidades[u];
      }
    }
    
    return texto;
  }
  
  if (entero === 0) {
    return 'CERO CON ' + decimales.toString().padStart(2, '0') + '/100';
  }
  
  var texto = '';
  
  // Millones
  var millones = Math.floor(entero / 1000000);
  if (millones > 0) {
    if (millones === 1) {
      texto += 'UN MILLÓN ';
    } else {
      texto += convertirGrupo(millones) + ' MILLONES ';
    }
  }
  
  // Miles
  var miles = Math.floor((entero % 1000000) / 1000);
  if (miles > 0) {
    if (miles === 1) {
      texto += 'MIL ';
    } else {
      texto += convertirGrupo(miles) + ' MIL ';
    }
  }
  
  // Unidades
  var unidadesFinal = entero % 1000;
  if (unidadesFinal > 0) {
    texto += convertirGrupo(unidadesFinal);
  }
  
  texto = texto.trim();
  texto += ' CON ' + decimales.toString().padStart(2, '0') + '/100';
  
  return texto;
}

/**
 * Obtiene o crea la carpeta de una propiedad dentro de "Reportes"
 */
function obtenerOCrearCarpetaPropiedad(nombrePropiedad) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var archivo = DriveApp.getFileById(ss.getId());
  var carpetaPadre = archivo.getParents().hasNext() ? archivo.getParents().next() : DriveApp.getRootFolder();

  // Buscar o crear carpeta "Reportes"
  var carpetasReportes = carpetaPadre.getFoldersByName("Reportes");
  var carpetaReportes;
  
  if (carpetasReportes.hasNext()) {
    carpetaReportes = carpetasReportes.next();
  } else {
    carpetaReportes = carpetaPadre.createFolder("Reportes");
  }

  // Buscar o crear carpeta de la propiedad
  var carpetasPropiedad = carpetaReportes.getFoldersByName(nombrePropiedad);
  
  if (carpetasPropiedad.hasNext()) {
    return carpetasPropiedad.next();
  } else {
    return carpetaReportes.createFolder(nombrePropiedad);
  }
}

// ============================================
// FUNCIÓN AUXILIAR: Convertir número de columna a letra Excel
// ============================================
function columnToLetter(column) {
  var temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

// ============================================
// FUNCIÓN AUXILIAR: Parsear fecha desde string YYYY-MM-DD
// ============================================
function parsearFechaLocal(fechaString) {
  if (!fechaString) return new Date();

  // Si ya es un objeto Date, retornarlo
  if (fechaString instanceof Date) return fechaString;

  // Si es string en formato YYYY-MM-DD o MM/DD/YYYY, parsearlo manualmente
  if (typeof fechaString === 'string') {
    // Formato YYYY-MM-DD (del formulario HTML)
    if (fechaString.indexOf('-') !== -1) {
      var partes = fechaString.split('-');
      if (partes.length === 3) {
        var anio = parseInt(partes[0]);
        var mes = parseInt(partes[1]) - 1;
        var dia = parseInt(partes[2]);
        // Crear fecha a las 12:00 para evitar problemas de zona horaria
        // y forzar que se interprete en hora local
        var fecha = new Date(anio, mes, dia, 12, 0, 0, 0);
        return fecha;
      }
    }
    
    // Formato MM/DD/YYYY
    if (fechaString.indexOf('/') !== -1) {
      var partes = fechaString.split('/');
      if (partes.length === 3) {
        var mes = parseInt(partes[0]) - 1;
        var dia = parseInt(partes[1]);
        var anio = parseInt(partes[2]);
        var fecha = new Date(anio, mes, dia, 12, 0, 0, 0);
        return fecha;
      }
    }
  }

  // Si es un número (serial de fecha), convertirlo
  if (typeof fechaString === 'number') {
    return new Date(fechaString);
  }

  // Si no se puede parsear, intentar con new Date como último recurso
  return new Date(fechaString);
}

// ============================================
// FUNCIÓN AUXILIAR: Determinar Hoja Principal
// ============================================
function determinarHojaPrincipal(nombreHoja) {
  if (nombreHoja.indexOf("Matienzo") !== -1) {
    return "Matienzo";
  }
  if (nombreHoja.indexOf("Local") !== -1 || nombreHoja === "Local") {
    return "Local";
  }
  return "VARIOS Control Mensual";
}

// ============================================
// FUNCIÓN AUXILIAR: Obtener columnas según hoja
// ============================================
function obtenerColumnasHoja(nombreHoja) {
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);
  
  if (esLocal) {
    return {
      COL_ALQUILER_BASE: 11,      // Columna K
      COL_ALQUILER_AJUSTE: 12,    // Columna L
      COL_IVA: 14,                // Columna N
      COL_RENTAS: 15,             // Columna O
      COL_MUNI: 16,               // Columna P
      COL_DESCUENTOS: 17,         // Columna Q
      COL_EXPENSAS: 18,           // Columna R
      COL_SEGURO: 19,             // Columna S
      COL_AGUA: 20,               // Columna T
      COL_A_FAVOR: 21,            // Columna U
      COL_PUNITORIOS: 22,         // Columna V
      COL_TOTAL: 23,              // Columna W
      COL_FECHA_PAGO: 24,         // Columna X
      COL_ABONO: 25,              // Columna Y
      COL_SOBRA: 26,              // Columna Z
      COL_DEUDA: 27,              // Columna AA
      COL_CANCELO: 28,            // Columna AB
      COL_PAGO_REGISTRADO: 29,    // Columna AC
      COL_FECHA_PAGO_ALQUILER: 8  // Columna H
    };
  } else {
    return {
      COL_ALQUILER_BASE: 11,      // Columna K
      COL_ALQUILER_AJUSTE: 12,    // Columna L
      COL_IVA: 14,                // Columna N
      COL_IMPUESTOS: 15,          // Columna O
      COL_GASTOS_COMUNES: 16,     // Columna P
      COL_RENTAS: 17,             // Columna Q
      COL_MUNI: 18,               // Columna R
      COL_DESCUENTOS: 19,         // Columna S
      COL_EXPENSAS: 20,           // Columna T
      COL_AGUA: 21,               // Columna U
      COL_A_FAVOR: 22,            // Columna V
      COL_PUNITORIOS: 23,         // Columna W
      COL_TOTAL: 24,              // Columna X
      COL_FECHA_PAGO: 25,         // Columna Y
      COL_ABONO: 26,              // Columna Z
      COL_SOBRA: 27,              // Columna AA
      COL_DEUDA: 28,              // Columna AB
      COL_CANCELO: 29,            // Columna AC
      COL_PAGO_REGISTRADO: 30,    // Columna AD
      COL_FECHA_PAGO_ALQUILER: 8  // Columna H
    };
  }
}

// ============================================
// SISTEMA DE FERIADOS ARGENTINOS
// ============================================

// Cache de feriados para evitar múltiples llamadas a la API
var FERIADOS_CACHE = {};

/**
 * Obtiene los feriados de Argentina desde la API
 */
function obtenerFeriadosArgentina(anio) {
  // Verificar si ya está en cache
  if (FERIADOS_CACHE[anio]) {
    return FERIADOS_CACHE[anio];
  }
  
  try {
    var url = 'https://api.argentinadatos.com/v1/feriados/' + anio;
    var response = UrlFetchApp.fetch(url);
    var feriados = JSON.parse(response.getContentText());
    
    // Convertir a formato simple de fechas
    var fechasFeriados = feriados.map(function(f) {
      return f.fecha; // formato "YYYY-MM-DD"
    });
    
    FERIADOS_CACHE[anio] = fechasFeriados;
    return fechasFeriados;
  } catch (error) {
    Logger.log('Error obteniendo feriados: ' + error);
    return [];
  }
}

/**
 * Verifica si una fecha es feriado
 */
function esFeriado(fecha) {
  var anio = fecha.getFullYear();
  var feriados = obtenerFeriadosArgentina(anio);
  
  var fechaStr = Utilities.formatDate(fecha, 'GMT-3', 'yyyy-MM-dd');
  return feriados.indexOf(fechaStr) !== -1;
}

/**
 * Verifica si una fecha es fin de semana (sábado o domingo)
 */
function esFinDeSemana(fecha) {
  var dia = fecha.getDay();
  return dia === 0 || dia === 6; // 0 = domingo, 6 = sábado
}

/**
 * Calcula el siguiente día hábil desde una fecha
 */
function siguienteDiaHabil(fecha) {
  var nuevaFecha = new Date(fecha);
  
  do {
    nuevaFecha.setDate(nuevaFecha.getDate() + 1);
  } while (esFinDeSemana(nuevaFecha) || esFeriado(nuevaFecha));
  
  return nuevaFecha;
}

/**
 * Calcula el último día hábil para pago sin punitorios
 * Si el día 10 (o el día especificado) cae en fin de semana o feriado,
 * se extiende al siguiente día hábil
 */
function calcularUltimoDiaHabilPago(mes, anio, diaLimite) {
  if (!diaLimite) diaLimite = 10;
  
  var fecha = new Date(anio, mes, diaLimite);
  
  // Si es fin de semana o feriado, buscar el siguiente día hábil
  while (esFinDeSemana(fecha) || esFeriado(fecha)) {
    fecha = siguienteDiaHabil(fecha);
  }
  
  return fecha.getDate();
}

// ============================================
// SISTEMA DE CÁLCULO DE PUNITORIOS
// ============================================

/**
 * Obtiene información del último pago desde el Historial de Pagos
 */
function obtenerUltimoPago(propiedad, inquilino) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaHistorial = ss.getSheetByName("Historial de Pagos");
  
  if (!hojaHistorial) {
    return null;
  }
  
  var datos = hojaHistorial.getDataRange().getValues();
  
  // Buscar de abajo hacia arriba (más reciente primero)
  for (var i = datos.length - 1; i >= 1; i--) {
    var propiedadHistorial = datos[i][1]; // Columna B: Propiedad
    var inquilinoHistorial = datos[i][2]; // Columna C: Inquilino
    
    if (propiedadHistorial === propiedad || inquilinoHistorial === inquilino) {
      return {
        fechaRegistro: datos[i][0],  // Columna A: Fecha Registro
        propiedad: datos[i][1],      // Columna B: Propiedad
        inquilino: datos[i][2],      // Columna C: Inquilino
        mesAnio: datos[i][3],        // Columna D: Mes/Año
        alquilerBase: datos[i][4],   // Columna E: Alquiler Base
        totalAPagar: datos[i][17],   // Columna R: Total a Pagar
        fechaPago: datos[i][18],     // Columna S: Fecha Pago
        abono: datos[i][19],         // Columna T: Abono
        debe: datos[i][21],          // Columna V: Debe
        cancelo: datos[i][22]        // Columna W: Canceló
      };
    }
  }
  
  return null;
}

/**
 * Calcula los punitorios SIEMPRE desde FECHA_PAGO_ALQUILER hasta la fecha indicada
 * IGNORANDO si hay deudas anteriores o pagos parciales
 * 
 * CASO 1: Pago del 1 al día 10 (ajustado por días hábiles) = 0 punitorios
 * CASO 2: Después del día 10 = punitorios desde día FECHA_PAGO_ALQUILER hasta la fecha
 */
function calcularPunitorios(hoja, fila, fechaCalculo, perdonarPunitorios) {
  if (perdonarPunitorios) {
    return 0;
  }
  
  var COL = obtenerColumnasHoja(hoja.getName());
  
  // Obtener datos necesarios - SIEMPRE USAR ALQUILER BASE
  var alquilerBase = hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue() || 0;
  
  // Si el alquiler es 0, no hay punitorios
  if (alquilerBase <= 0) {
    return 0;
  }
  
  var diaLimitePago = hoja.getRange(fila, COL.COL_FECHA_PAGO_ALQUILER).getValue() || 10;
  
  // Si no hay fecha de cálculo, usar hoy
  if (!fechaCalculo) {
    fechaCalculo = new Date();
  } else if (typeof fechaCalculo === 'string') {
    fechaCalculo = new Date(fechaCalculo);
  } else if (fechaCalculo instanceof Date) {
    // Ya es una fecha, validar que sea razonable
    var anioFecha = fechaCalculo.getFullYear();
    if (anioFecha < 2000 || anioFecha > 2100) {
      fechaCalculo = new Date();
    }
  } else {
    // Si es un número (serial de Excel), convertirlo
    fechaCalculo = new Date(fechaCalculo);
    var anioFecha = fechaCalculo.getFullYear();
    if (anioFecha < 2000 || anioFecha > 2100) {
      fechaCalculo = new Date();
    }
  }
  
  var mesActual = fechaCalculo.getMonth();
  var anioActual = fechaCalculo.getFullYear();
  var diaActual = fechaCalculo.getDate();
  
  // REGLA: Del 1 al 10 NUNCA hay punitorios (ajustado por días hábiles)
  var ultimoDiaHabilSinPunitorios = calcularUltimoDiaHabilPago(mesActual, anioActual, 10);
  
  // CASO 1: Pago del 1 al 10 (o día hábil siguiente) = SIN punitorios
  if (diaActual <= ultimoDiaHabilSinPunitorios) {
    Logger.log("PUNITORIOS = 0 (pago antes del día 10)");
    return 0;
  }
  
  // CASO 2: Después del día 10 = calcular desde FECHA_PAGO_ALQUILER hasta la fecha
  // Ejemplo: FECHA_PAGO_ALQUILER=6, paga el 30 → del 6 al 30 = 24 días
  var diasAtraso = diaActual - diaLimitePago + 1;
  if (diasAtraso < 0) diasAtraso = 0;
  
  var punitorios = alquilerBase * diasAtraso * 0.006;
  
  // Log para debug
  var propiedad = ((hoja.getRange(fila, 1).getValue() || "") + " " + 
                   (hoja.getRange(fila, 2).getValue() || "")).trim();
  Logger.log("CALCULAR PUNITORIOS - " + propiedad);
  Logger.log("  Alquiler BASE: " + alquilerBase);
  Logger.log("  Día límite pago (FECHA_PAGO_ALQUILER): " + diaLimitePago);
  Logger.log("  Día actual/pago: " + diaActual);
  Logger.log("  Días de atraso (del " + diaLimitePago + " al " + diaActual + "): " + diasAtraso);
  Logger.log("  Punitorios: " + punitorios);
  
  return punitorios;
}

/**
 * Función para ser usada en la hoja de cálculo (para hojas principales)
 * =CALCULAR_PUNITORIOS_SHEET(ROW(), fecha_celda)
 * 
 * Esta función calcula punitorios desde FECHA_PAGO_ALQUILER hasta:
 * - La fecha de pago registrada (si existe)
 * - La fecha actual (si no hay pago registrado)
 */
function CALCULAR_PUNITORIOS_SHEET(fila, fechaCalculo, perdonar) {
  try {
    Logger.log("\n=== CALCULAR_PUNITORIOS_SHEET LLAMADA ===");
    Logger.log("Fila: " + fila);
    Logger.log("fechaCalculo recibida: " + fechaCalculo);
    Logger.log("perdonar: " + perdonar);
    
    var hoja = SpreadsheetApp.getActiveSheet();
    var nombreHoja = hoja.getName();
    Logger.log("Hoja activa: " + nombreHoja);
    
    var COL = obtenerColumnasHoja(nombreHoja);
    var perdonarPunitorios = perdonar === true || perdonar === "SI";
    
    // Si no se proporciona fecha de cálculo, tomar de la celda de FECHA_PAGO
    if (!fechaCalculo) {
      Logger.log("No hay fechaCalculo, buscando en COL_FECHA_PAGO (col " + COL.COL_FECHA_PAGO + ")");
      var fechaPago = hoja.getRange(fila, COL.COL_FECHA_PAGO).getValue();
      Logger.log("Fecha de pago encontrada: " + fechaPago);
      
      // Si hay fecha de pago registrada, usarla
      if (fechaPago) {
        fechaCalculo = fechaPago instanceof Date ? fechaPago : parsearFechaLocal(fechaPago);
        Logger.log("Usando fecha de pago: " + fechaCalculo);
      } else {
        // Si no hay fecha de pago, usar la fecha actual
        fechaCalculo = new Date();
        Logger.log("No hay fecha de pago, usando fecha actual: " + fechaCalculo);
      }
    } else {
      Logger.log("fechaCalculo ya proporcionada: " + fechaCalculo);
    }
    
    var resultado = calcularPunitorios(hoja, fila, fechaCalculo, perdonarPunitorios);
    Logger.log("Resultado calculado: " + resultado);
    return resultado;
  } catch (error) {
    Logger.log("ERROR en CALCULAR_PUNITORIOS_SHEET fila " + fila + ": " + error);
    return 0;
  }
}

// ============================================================
// FUNCIÓN 1 (NUEVA): calcularAlquilerPendiente
// Pegarla justo ANTES de CALCULAR_PUNITORIOS_DEUDA
// ============================================================

function calcularAlquilerPendiente(hoja, fila, abono) {
  var nombreHoja = hoja.getName();
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

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

  var alquilerBase    = toNumber(hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue());
  var iva             = toNumber(hoja.getRange(fila, COL.COL_IVA).getValue());
  var rentas          = toNumber(hoja.getRange(fila, COL.COL_RENTAS).getValue());
  var muni            = toNumber(hoja.getRange(fila, COL.COL_MUNI).getValue());
  var descuentos      = toNumber(hoja.getRange(fila, COL.COL_DESCUENTOS).getValue());
  var expensas        = toNumber(hoja.getRange(fila, COL.COL_EXPENSAS).getValue());
  var agua            = toNumber(hoja.getRange(fila, COL.COL_AGUA).getValue());
  var afavor          = toNumber(hoja.getRange(fila, COL.COL_A_FAVOR).getValue());

  var impuestos       = 0;
  var gastosComunes   = 0;
  var seguro          = 0;

  if (esLocal) {
    seguro = toNumber(hoja.getRange(fila, COL.COL_SEGURO).getValue());
  } else {
    impuestos     = toNumber(hoja.getRange(fila, COL.COL_IMPUESTOS).getValue());
    gastosComunes = toNumber(hoja.getRange(fila, COL.COL_GASTOS_COMUNES).getValue());
  }

  // Todos los servicios EXCEPTO el alquiler base
  var totalServicios  = iva + impuestos + gastosComunes + rentas + muni + expensas + seguro + agua;
  var descuentosNetos = descuentos + afavor;
  var serviciosNetos  = totalServicios - descuentosNetos;
  if (serviciosNetos < 0) serviciosNetos = 0;

  // Cuánto del abono queda después de pagar los servicios
  var restaContraAlquiler = abono - serviciosNetos;

  var alquilerPendiente;
  if (restaContraAlquiler <= 0) {
    // El abono no alcanzó a cubrir los servicios → el alquiler queda completo
    alquilerPendiente = alquilerBase;
  } else if (restaContraAlquiler >= alquilerBase) {
    // El abono cubrió todo el alquiler
    alquilerPendiente = 0;
  } else {
    // El abono cubrió servicios y parte del alquiler
    alquilerPendiente = alquilerBase - restaContraAlquiler;
  }

  Logger.log("  [calcularAlquilerPendiente]");
  Logger.log("    Alquiler base: " + alquilerBase);
  Logger.log("    Total servicios: " + totalServicios);
  Logger.log("    Descuentos netos: " + descuentosNetos);
  Logger.log("    Servicios netos: " + serviciosNetos);
  Logger.log("    Abono: " + abono);
  Logger.log("    Resta contra alquiler: " + restaContraAlquiler);
  Logger.log("    Alquiler pendiente (BASE de punitorios): " + alquilerPendiente);

  return alquilerPendiente;
}


// ============================================================
// FUNCIÓN 2 (REEMPLAZO): CALCULAR_PUNITORIOS_DEUDA
// Reemplaza toda la función existente con esta
// ============================================================

/**
 * Función para hojas de deudas - MANEJA DOS CASOS:
 * 
 * CASO 3: No pagó nada → Punitorios = días del mes de deuda + días transcurridos del mes actual
 * CASO 4: Pagó algo    → Punitorios sobre el ALQUILER PENDIENTE (no el base completo)
 */
function CALCULAR_PUNITORIOS_DEUDA(fila, fechaCalculo) {
  try {
    var hoja = SpreadsheetApp.getActiveSheet();
    var nombreHoja = hoja.getName();
    var COL = obtenerColumnasHoja(nombreHoja);
    
    Logger.log("\n===== CALCULAR_PUNITORIOS_DEUDA LLAMADA =====");
    Logger.log("Hoja: " + nombreHoja);
    Logger.log("Fila: " + fila);
    Logger.log("fechaCalculo recibida: " + fechaCalculo);
    
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
    
    var alquilerBase = toNumber(hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue());
    var abono = toNumber(hoja.getRange(fila, COL.COL_ABONO).getValue());
    var debe = toNumber(hoja.getRange(fila, COL.COL_DEUDA).getValue());
    var fechaPago = hoja.getRange(fila, COL.COL_FECHA_PAGO).getValue();
    var pagoRegistrado = hoja.getRange(fila, COL.COL_PAGO_REGISTRADO).getValue() === true;
    
    Logger.log("Alquiler Base: " + alquilerBase);
    Logger.log("Abono: " + abono);
    Logger.log("Debe: " + debe);
    Logger.log("Fecha Pago: " + fechaPago);
    Logger.log("Pago Registrado: " + pagoRegistrado);
    
    if (alquilerBase <= 0) {
      Logger.log("Alquiler base es 0, retornando 0");
      return 0;
    }
    
    // Obtener fecha actual en zona horaria Argentina (GMT-3)
    if (!fechaCalculo) {
      var hoy = new Date();
      var fechaArStr = Utilities.formatDate(hoy, "GMT-3", "yyyy-MM-dd");
      fechaCalculo = parsearFechaLocal(fechaArStr);
      Logger.log("Fecha actual en AR (GMT-3): " + fechaArStr + " → parseada: " + fechaCalculo);
    } else if (typeof fechaCalculo === 'string') {
      fechaCalculo = parsearFechaLocal(fechaCalculo);
    } else if (!(fechaCalculo instanceof Date)) {
      fechaCalculo = new Date(fechaCalculo);
    }
    
    Logger.log("Fecha de cálculo final: " + fechaCalculo);
    Logger.log("  getDate(): " + fechaCalculo.getDate());
    Logger.log("  getMonth()+1: " + (fechaCalculo.getMonth() + 1));
    Logger.log("  getFullYear(): " + fechaCalculo.getFullYear());
    
    // Extraer mes y año de la deuda del nombre de la hoja
    var nombreHojaLower = nombreHoja.toLowerCase();
    var mesDeuda, anioDeuda;
    
    var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", 
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    
    for (var i = 0; i < meses.length; i++) {
      if (nombreHojaLower.indexOf(meses[i]) !== -1) {
        mesDeuda = i;
        Logger.log("Mes encontrado: " + meses[i] + " (índice " + i + ")");
        break;
      }
    }
    
    var matchAnio = nombreHoja.match(/20\d{2}/);
    if (matchAnio) {
      anioDeuda = parseInt(matchAnio[0]);
      Logger.log("Año encontrado: " + anioDeuda);
    } else {
      anioDeuda = fechaCalculo.getFullYear() - 1;
      Logger.log("Año no encontrado, usando: " + anioDeuda);
    }
    
    if (mesDeuda === undefined) {
      Logger.log("ERROR: No se pudo determinar el mes de la deuda desde el nombre: " + nombreHoja);
      return 0;
    }
    
    var propiedad = ((hoja.getRange(fila, 1).getValue() || "") + " " + 
                     (hoja.getRange(fila, 2).getValue() || "") + " " +
                     (hoja.getRange(fila, 3).getValue() || "")).trim();
    Logger.log("Propiedad: " + propiedad);
    
    // Determinar CASO 3 o CASO 4
    var fechaUltimoPago = null;
    var esCaso4 = false;
    
    if (fechaPago && fechaPago !== "") {
      fechaUltimoPago = fechaPago instanceof Date ? fechaPago : parsearFechaLocal(fechaPago);
      esCaso4 = true;
      Logger.log("CASO 4 determinado: hay fecha en celda → " + fechaUltimoPago);
    } else if (pagoRegistrado && abono > 0) {
      esCaso4 = true;
      Logger.log("CASO 4 determinado: pagoRegistrado=true y abono>0, buscando fecha en historial...");
      
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var hojaHistorial = ss.getSheetByName("Historial de Pagos");
      
      if (hojaHistorial) {
        var datosHistorial = hojaHistorial.getDataRange().getValues();
        var propiedad1Limpia = propiedad.replace(/\s+/g, ' ').trim().toLowerCase();
        var clave1 = propiedad1Limpia.split('-')[0].trim().substring(0, 20);
        
        for (var i = datosHistorial.length - 1; i >= 1; i--) {
          var propiedadHistorial = (datosHistorial[i][1] + "").trim();
          var fechaPagoHistorial = datosHistorial[i][18];
          
          var propiedad2Limpia = propiedadHistorial.replace(/\s+/g, ' ').trim().toLowerCase();
          var clave2 = propiedad2Limpia.split('-')[0].trim().substring(0, 20);
          
          if (clave1.indexOf(clave2) !== -1 || clave2.indexOf(clave1) !== -1 || 
              propiedad1Limpia.indexOf(clave2) !== -1 || propiedad2Limpia.indexOf(clave1) !== -1) {
            if (fechaPagoHistorial) {
              fechaUltimoPago = fechaPagoHistorial instanceof Date ? fechaPagoHistorial : parsearFechaLocal(fechaPagoHistorial);
              Logger.log("  ✓ Fecha encontrada en historial: " + fechaUltimoPago);
              break;
            }
          }
        }
      }
      
      if (!fechaUltimoPago) {
        Logger.log("  ⚠️ No se encontró fecha en historial pero hay pago registrado.");
        Logger.log("     Usando 1er día del mes de deuda como fallback (conservador).");
        fechaUltimoPago = new Date(anioDeuda, mesDeuda, 1, 12, 0, 0);
      }
    }
    
    // ============================================================
    // EJECUTAR EL CASO CORRESPONDIENTE
    // ============================================================
    
    if (esCaso4 && fechaUltimoPago) {
      // ---- CASO 4: Deuda con pago parcial ----
      // BASE DE PUNITORIOS = alquiler pendiente (no el alquiler base completo)
      Logger.log("\n→ CASO 4 - DEUDA CON PAGO PARCIAL:");
      
      var basePunitorios = calcularAlquilerPendiente(hoja, fila, abono);
      
      Logger.log("  Base de punitorios (alquiler pendiente): " + basePunitorios);
      Logger.log("  Último pago: " + fechaUltimoPago);
      Logger.log("  Fecha cálculo: " + fechaCalculo);
      
      // Si el alquiler está completamente pagado, no hay punitorios
      if (basePunitorios <= 0) {
        Logger.log("  Alquiler pendiente es 0, no hay punitorios");
        return 0;
      }
      
      var diffTime = fechaCalculo.getTime() - fechaUltimoPago.getTime();
      var diffDias = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      
      if (diffDias <= 0) {
        Logger.log("  Días negativos o 0, retornando 0");
        return 0;
      }
      
      var punitorios = basePunitorios * diffDias * 0.006;
      
      Logger.log("  Días desde último pago (inclusivo): " + diffDias);
      Logger.log("  Punitorios: " + punitorios);
      
      return punitorios;
      
    } else {
      // ---- CASO 3: Sin pagos al todo ----
      // BASE = alquiler base completo (no pagó nada)
      Logger.log("\n→ CASO 3 - DEUDA SIN PAGOS:");
      
      var diasMesDeuda = new Date(anioDeuda, mesDeuda + 1, 0).getDate();
      var diasMesActual = fechaCalculo.getDate();
      
      var totalDias = diasMesDeuda + diasMesActual;
      var punitorios = alquilerBase * totalDias * 0.006;
      
      Logger.log("  Mes de deuda: " + meses[mesDeuda] + " " + anioDeuda);
      Logger.log("  Días del mes de deuda: " + diasMesDeuda);
      Logger.log("  Días del mes actual (getDate en AR): " + diasMesActual);
      Logger.log("  Total días: " + totalDias);
      Logger.log("  Base de punitorios (alquiler base completo): " + alquilerBase);
      Logger.log("  Punitorios: " + punitorios);
      
      return punitorios;
    }
    
  } catch (error) {
    Logger.log("ERROR en CALCULAR_PUNITORIOS_DEUDA: " + error);
    Logger.log("Stack: " + error.stack);
    return 0;
  }
}

// ============================================
// REGISTRAR PAGO
// ============================================
function registrarPago(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";
  
  var html = HtmlService.createTemplateFromFile("formulario");
  html.hojaPrincipal = nombreHojaPrincipal;
  var evaluatedHtml = html.evaluate().setWidth(600).setHeight(550);
  
  SpreadsheetApp.getUi().showModalDialog(evaluatedHtml, "Registrar Pago - " + nombreHojaPrincipal);
}

/**
 * Calcula punitorios para una fecha específica (llamado desde el formulario)
 * Detecta automáticamente si es una hoja de deudas o una hoja principal
 * y aplica la lógica correspondiente
 */
function calcularPunitoriosParaFecha(nombreHoja, fila, fecha, perdonar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) {
    return 0;
  }

  if (perdonar === true) {
    return 0;
  }

  var fechaCalculo = fecha ? parsearFechaLocal(fecha) : new Date();
  
  // Detectar si es una hoja de deudas
  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 || 
                      nombreHoja.indexOf("Matienzo Deudas ") === 0 || 
                      nombreHoja.indexOf("Local Deudas ") === 0);
  
  if (esHojaDeudas) {
    // Para hojas de DEUDAS, usar la lógica especial de CALCULAR_PUNITORIOS_DEUDA
    Logger.log("Calculando punitorios de DEUDA para fecha: " + fechaCalculo);
    
    var COL = obtenerColumnasHoja(nombreHoja);
    var alquilerBase = hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue() || 0;
    var abono = hoja.getRange(fila, COL.COL_ABONO).getValue() || 0;
    var debe = hoja.getRange(fila, COL.COL_DEUDA).getValue() || 0;
    var fechaPago = hoja.getRange(fila, COL.COL_FECHA_PAGO).getValue();
    
    if (alquilerBase <= 0) return 0;
    
    // Extraer mes y año de la deuda del nombre de la hoja
    var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", 
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    var mesDeuda, anioDeuda;
    
    for (var i = 0; i < meses.length; i++) {
      if (nombreHoja.toLowerCase().indexOf(meses[i]) !== -1) {
        mesDeuda = i;
        break;
      }
    }
    
    var matchAnio = nombreHoja.match(/20\d{2}/);
    if (matchAnio) {
      anioDeuda = parseInt(matchAnio[0]);
    } else {
      anioDeuda = fechaCalculo.getFullYear() - 1;
    }
    
    if (mesDeuda === undefined) {
      Logger.log("No se pudo determinar mes de deuda, retornando 0");
      return 0;
    }
    
    Logger.log("Mes de deuda: " + meses[mesDeuda] + " " + anioDeuda);
    
    // CASO 4: Si hay pago parcial
    // Verificar: (1) hay abono, O (2) hay fecha de pago
    var tienePagoParcial = (abono > 0) || (fechaPago && fechaPago !== "");
    
    if (tienePagoParcial) {
      Logger.log("→ CASO 4: Deuda con pago parcial");
      
      // Si no hay fecha en la celda, buscarla en el historial
      var fechaUltimoPago = null;
      
      if (fechaPago && fechaPago !== "") {
        fechaUltimoPago = fechaPago instanceof Date ? fechaPago : parsearFechaLocal(fechaPago);
        Logger.log("Fecha encontrada en celda: " + fechaUltimoPago);
      } else if (abono > 0) {
        // Buscar en el historial la última fecha de pago de esta propiedad
        Logger.log("No hay fecha en celda, buscando última fecha de pago en historial...");
        
        var propiedad = ((hoja.getRange(fila, 1).getValue() || "") + " " + 
                        (hoja.getRange(fila, 2).getValue() || "")).trim();
        
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var historial = ss.getSheetByName("Historial de Pagos");
        
        if (historial) {
          var datosHistorial = historial.getDataRange().getValues();
          
          // Buscar desde el final (más reciente)
          for (var i = datosHistorial.length - 1; i >= Math.max(1, datosHistorial.length - 50); i--) {
            var propHist = (datosHistorial[i][1] + "").trim();
            var fechaHist = datosHistorial[i][18];
            
            // Comparación simple
            var prop1 = propiedad.replace(/\s+/g, ' ').toLowerCase();
            var prop2 = propHist.replace(/\s+/g, ' ').toLowerCase();
            var clave1 = prop1.substring(0, 20);
            var clave2 = prop2.substring(0, 20);
            
            if (clave1.indexOf(clave2) !== -1 || clave2.indexOf(clave1) !== -1) {
              if (fechaHist) {
                fechaUltimoPago = fechaHist instanceof Date ? fechaHist : parsearFechaLocal(fechaHist);
                Logger.log("Fecha encontrada en historial: " + fechaUltimoPago);
                break;
              }
            }
          }
        }
      }
      
      if (!fechaUltimoPago) {
        Logger.log("⚠️ No se encontró fecha de último pago, usando fecha de cálculo como referencia");
        // Si no encontramos fecha, asumir que pagó hace poco tiempo
        fechaUltimoPago = fechaCalculo;
      }
      
      Logger.log("Fecha último pago (final): " + fechaUltimoPago);
      Logger.log("Fecha cálculo: " + fechaCalculo);
      
      // Calcular días desde el último pago hasta hoy (INCLUSIVO)
      var diffTime = fechaCalculo.getTime() - fechaUltimoPago.getTime();
      var diffDias = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      
      Logger.log("Días desde último pago (inclusivo): " + diffDias);
      
      if (diffDias <= 0) {
        Logger.log("Días negativos o 0, retornando 0");
        return 0;
      }
      
      // IMPORTANTE: SIEMPRE usar alquiler base, NO la deuda pendiente
      var basePunitorios = calcularAlquilerPendiente(hoja, fila, abono);
      
      if (basePunitorios <= 0) {
        Logger.log("Alquiler pendiente es 0, no hay punitorios");
        return 0;
      }
      
      var punitorios = basePunitorios * diffDias * 0.006;
      
      Logger.log("Base de punitorios (alquiler pendiente): " + basePunitorios);
      Logger.log("Punitorios calculados: " + punitorios);
      
      return punitorios;
    }
    
    // CASO 3: No pagó nada
    else {
      Logger.log("→ CASO 3: Deuda sin pagos");
      
      var diasMesDeuda = new Date(anioDeuda, mesDeuda + 1, 0).getDate();
      var diasMesActual = fechaCalculo.getDate();
      var totalDias = diasMesDeuda + diasMesActual;
      
      var punitorios = alquilerBase * totalDias * 0.006;
      
      Logger.log("Días del mes de deuda: " + diasMesDeuda);
      Logger.log("Días del mes actual: " + diasMesActual);
      Logger.log("Total días: " + totalDias);
      Logger.log("Punitorios calculados: " + punitorios);
      
      return punitorios;
    }
  } else {
    // Para hojas PRINCIPALES, usar la lógica normal desde FECHA_PAGO_ALQUILER
    return calcularPunitorios(hoja, fila, fechaCalculo, false);
  }
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

// ============================================
// CORRECCIÓN: guardarPago para HOJAS DE DEUDAS
// ============================================

// REEMPLAZAR DESDE LA LÍNEA ~1091 hasta ~1200 aproximadamente
// (toda la sección de cálculo de nuevoAbono, sobra, debe, cancelo)
function guardarPago(formulario) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var partes = formulario.propiedad.split("|");
  var nombreHoja = partes[0];
  var fila = parseInt(partes[1]);

  var hoja = ss.getSheetByName(nombreHoja);
  var COL = obtenerColumnasHoja(nombreHoja);
  
  // VERIFICAR SI YA ESTÁ CANCELADO
  var canceloActual = hoja.getRange(fila, COL.COL_CANCELO).getValue();
  if (canceloActual === "SI") {
    return "⚠️ Esta propiedad ya tiene el pago cancelado.\n\n" +
           "No se puede registrar un nuevo pago sobre una deuda ya cancelada.\n\n" +
           "Si necesitas hacer un ajuste, primero debes revertir el pago anterior.";
  }
  
  var fecha = formulario.fecha;
  var monto = parseFloat(formulario.monto);
  var perdonarPunitorios = formulario.perdonarPunitorios === true || formulario.perdonarPunitorios === 'true';
  var pagoEfectivo = formulario.pagoEfectivo === true || formulario.pagoEfectivo === 'true'; // ← AÑADIR ESTO

  Logger.log("===== DEBUG MONTO =====");
  Logger.log("formulario.monto (RAW): '" + formulario.monto + "'");
  Logger.log("Tipo: " + typeof formulario.monto);
  Logger.log("monto parseado: " + monto);
  Logger.log("Pago en efectivo: " + pagoEfectivo);

  Logger.log("===== GUARDAR PAGO =====");
  Logger.log("Fecha recibida (string): " + fecha);
  Logger.log("Tipo: " + typeof fecha);
  Logger.log("Perdonar punitorios: " + perdonarPunitorios);
  
  var fechaParseada = parsearFechaLocal(fecha);
  Logger.log("Fecha parseada: " + fechaParseada);
  Logger.log("Fecha ISO: " + fechaParseada.toISOString());
  Logger.log("Día: " + fechaParseada.getDate());
  Logger.log("Mes: " + (fechaParseada.getMonth() + 1));
  Logger.log("Año: " + fechaParseada.getFullYear());

  var hoja = ss.getSheetByName(nombreHoja);
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

  // ========== CAMBIO CRÍTICO ==========
  // Detectar si es hoja de deudas
  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 || 
                      nombreHoja.indexOf("Matienzo Deudas ") === 0 || 
                      nombreHoja.indexOf("Local Deudas ") === 0);
  
  Logger.log("¿Es hoja de DEUDAS? " + esHojaDeudas);
  // ====================================

  // Leer valores actuales
  var abonoAnterior = hoja.getRange(fila, COL.COL_ABONO).getValue() || 0;
  var punitoriosActuales = hoja.getRange(fila, COL.COL_PUNITORIOS).getValue() || 0;
  var totalCelda = hoja.getRange(fila, COL.COL_TOTAL).getValue() || 0;
  
  Logger.log("===== VALORES INICIALES =====");
  Logger.log("Abono anterior: " + abonoAnterior);
  Logger.log("Punitorios actuales: " + punitoriosActuales);
  Logger.log("Total en celda: " + totalCelda);
  Logger.log("Monto a pagar ahora: " + monto);
  
  var habiaPagosPrevios = abonoAnterior > 0;
  
  // PASO 1: Si se perdonan punitorios, PRIMERO congelar en 0
  if (perdonarPunitorios) {
    hoja.getRange(fila, COL.COL_PUNITORIOS).setValue(0);
    punitoriosActuales = 0;
    
    Logger.log("PUNITORIOS PERDONADOS:");
    Logger.log("  Total original: " + totalCelda);
    Logger.log("  Punitorios eliminados");
  }
  
  // PASO 1.5: RECALCULAR el total PARA LA FECHA DEL FORMULARIO
  var punitoriosParaFecha = perdonarPunitorios ? 0 : calcularPunitoriosParaFecha(nombreHoja, fila, fecha, false);
  
  // Función auxiliar para convertir valores a números de forma segura
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
  
  var totalActual;
  
  // Calcular total desde componentes
  var alquilerBase = toNumber(hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue());
  var iva = toNumber(hoja.getRange(fila, COL.COL_IVA).getValue());
  var rentas = toNumber(hoja.getRange(fila, COL.COL_RENTAS).getValue());
  var muni = toNumber(hoja.getRange(fila, COL.COL_MUNI).getValue());
  var descuentos = toNumber(hoja.getRange(fila, COL.COL_DESCUENTOS).getValue());
  var expensas = toNumber(hoja.getRange(fila, COL.COL_EXPENSAS).getValue());
  var agua = toNumber(hoja.getRange(fila, COL.COL_AGUA).getValue());
  var afavor = toNumber(hoja.getRange(fila, COL.COL_A_FAVOR).getValue());
  
  var subtotal = alquilerBase + iva + rentas + muni + expensas + agua - descuentos - afavor;
  
  if (!esLocal) {
    var impuestos = toNumber(hoja.getRange(fila, COL.COL_IMPUESTOS).getValue());
    var gastosComunes = toNumber(hoja.getRange(fila, COL.COL_GASTOS_COMUNES).getValue());
    subtotal += impuestos + gastosComunes;
  } else {
    var seguro = toNumber(hoja.getRange(fila, COL.COL_SEGURO).getValue());
    subtotal += seguro;
  }
  
  // ========== CORRECCIÓN PRINCIPAL ==========
  // Para hojas de DEUDAS con pago parcial
  if (esHojaDeudas && abonoAnterior > 0) {
    // Total = (componentes - abono anterior) + punitorios recalculados
    totalActual = (subtotal - abonoAnterior) + punitoriosParaFecha;
    
    Logger.log("DEUDA CON PAGO PARCIAL:");
    Logger.log("  Subtotal componentes: " + subtotal);
    Logger.log("  Abono anterior (del mes original): " + abonoAnterior);
    Logger.log("  Deuda pendiente (sin punitorios): " + (subtotal - abonoAnterior));
    Logger.log("  Punitorios para fecha: " + punitoriosParaFecha);
    Logger.log("  Total a pagar AHORA: " + totalActual);
  } else {
    // Para primer pago o mes actual
    if (abonoAnterior > 0) {
      totalActual = (subtotal - abonoAnterior) + punitoriosParaFecha;
      Logger.log("HOJA PRINCIPAL CON PAGO PARCIAL:");
      Logger.log("  Subtotal componentes: " + subtotal);
      Logger.log("  Abono anterior: " + abonoAnterior);
      Logger.log("  Deuda pendiente: " + (subtotal - abonoAnterior));
      Logger.log("  Punitorios para fecha: " + punitoriosParaFecha);
      Logger.log("  Total a pagar: " + totalActual);
    } else {
      totalActual = subtotal + punitoriosParaFecha;
      Logger.log("PRIMER PAGO:");
      Logger.log("  Alquiler base: " + alquilerBase);
      Logger.log("  Componentes sumados: " + subtotal);
      Logger.log("  Punitorios para fecha: " + punitoriosParaFecha);
      Logger.log("  Total calculado: " + totalActual);
    }
  }
  // ==========================================
  
  Logger.log("Total en celda (referencia): " + totalCelda);
  
  // Validar que totalActual sea un número válido
  if (isNaN(totalActual) || totalActual === null || totalActual === undefined) {
    Logger.log("ERROR: Total calculado es inválido (NaN), usando total de celda como fallback");
    totalActual = totalCelda || 0;
  }
  
  // ========== CORRECCIÓN: CÁLCULO DE NUEVO ABONO ==========
  var nuevoAbono;
  
  if (esHojaDeudas) {
    // En hojas de DEUDAS: el nuevo abono NO se suma al anterior
    // porque el "abonoAnterior" es lo que pagó en el mes original
    // y ahora estamos pagando la DEUDA que quedó
    nuevoAbono = abonoAnterior + monto;
    
    Logger.log("CÁLCULO ABONO EN DEUDA:");
    Logger.log("  Abono del mes original: " + abonoAnterior);
    Logger.log("  Pago nuevo (contra la deuda): " + monto);
    Logger.log("  Abono total acumulado: " + nuevoAbono);
  } else {
    // En hojas PRINCIPALES: sí sumar
    nuevoAbono = abonoAnterior + monto;
    
    Logger.log("CÁLCULO ABONO EN MES ACTUAL:");
    Logger.log("  Abono anterior: " + abonoAnterior);
    Logger.log("  Pago nuevo: " + monto);
    Logger.log("  Abono total: " + nuevoAbono);
  }
  // ========================================================
  
  var sobra = 0;
  var debe = 0;
  var cancelo = "NO";
  var totalFinal = totalActual;

  Logger.log("===== VERIFICACIÓN DE CANCELACIÓN =====");
  Logger.log("Total actual calculado: " + totalActual);
  Logger.log("Nuevo abono: " + nuevoAbono);

  // Determinar qué total usar para comparar
  var totalParaComparar;
  
  if (perdonarPunitorios) {
    totalParaComparar = subtotal - abonoAnterior;
    Logger.log("✅ PUNITORIOS PERDONADOS - Usando total SIN punitorios: " + totalParaComparar);
  } else if (esHojaDeudas && abonoAnterior > 0) {
    // ========== CORRECCIÓN CRÍTICA ==========
    // Para DEUDAS con pago parcial: comparar contra el total RECALCULADO
    // que es: deuda pendiente + punitorios desde último pago
    totalParaComparar = totalActual;
    Logger.log("DEUDA CON PAGO PARCIAL - Usando TOTAL RECALCULADO: " + totalParaComparar);
  } else if (esHojaDeudas && abonoAnterior === 0) {
    totalParaComparar = totalCelda;
    Logger.log("DEUDA PRIMER PAGO - Usando TOTAL ORIGINAL: " + totalParaComparar);
  } else if (abonoAnterior > 0) {
    totalParaComparar = totalActual;
    Logger.log("MES ACTUAL CON PAGO PARCIAL - Usando TOTAL RECALCULADO: " + totalParaComparar);
  } else {
    totalParaComparar = totalActual;
    Logger.log("PRIMER PAGO MES ACTUAL - Usando TOTAL CALCULADO: " + totalParaComparar);
  }

  // ========== CORRECCIÓN: COMPARACIÓN PARA CANCELACIÓN ==========
  // En DEUDAS: comparar el MONTO ACTUAL contra el total a pagar AHORA
  var montoParaComparar;
  
  if (esHojaDeudas) {
    // Solo el monto de ESTE pago (no el acumulado)
    montoParaComparar = monto;
    Logger.log("DEUDA: Comparando SOLO el pago actual: " + montoParaComparar);
  } else {
    // En hojas principales: el abono total acumulado
    montoParaComparar = nuevoAbono;
    Logger.log("MES ACTUAL: Comparando abono acumulado: " + montoParaComparar);
  }
  
  var montoRedondeado = Math.round(montoParaComparar * 100) / 100;
  var totalParaCompararRedondeado = Math.round(totalParaComparar * 100) / 100;
  
  Logger.log("¿Cancela? " + (montoRedondeado >= totalParaCompararRedondeado));
  Logger.log("  Monto redondeado: " + montoRedondeado);
  Logger.log("  Total redondeado: " + totalParaCompararRedondeado);
  // ==============================================================

  if (montoRedondeado >= totalParaCompararRedondeado) {
    cancelo = "SI";
    sobra = montoRedondeado - totalParaCompararRedondeado;
    debe = 0;
    
    Logger.log("→ SÍ CANCELA");
    Logger.log("  Cálculo sobra: " + montoRedondeado + " - " + totalParaCompararRedondeado + " = " + sobra);
    
    if (isNaN(sobra) || sobra < 0) {
      Logger.log("  ADVERTENCIA: Sobra calculada es inválida (" + sobra + "), estableciendo a 0");
      sobra = 0;
    }
    
    // Congelar punitorios
    hoja.getRange(fila, COL.COL_PUNITORIOS).setValue(punitoriosParaFecha);
    
    // Actualizar fecha
    if (cancelo === "SI") {
      var fechaAGuardar = parsearFechaLocal(fecha);
      hoja.getRange(fila, COL.COL_FECHA_PAGO).setValue(fechaAGuardar);
      Logger.log("  Fecha guardada (CANCELÓ): " + fechaAGuardar);
    } else {
      Logger.log("  Pago parcial - fecha NO guardada en celda");
    }
        
    Logger.log("PAGO COMPLETADO:");
    Logger.log("  Total usado: " + totalParaCompararRedondeado);
    Logger.log("  Punitorios congelados: " + punitoriosParaFecha);
    Logger.log("  Abono total: " + nuevoAbono);
    Logger.log("  Sobra correcta: " + sobra);
    
  } else {
    // PAGO PARCIAL
    debe = totalParaCompararRedondeado - montoRedondeado;
    
    if (isNaN(debe) || debe < 0) {
      Logger.log("ADVERTENCIA: Debe calculado es inválido (" + debe + "), estableciendo a 0");
      debe = 0;
    }
    
    Logger.log("PAGO PARCIAL:");
    Logger.log("  Total: " + totalParaCompararRedondeado);
    Logger.log("  Monto pagado: " + montoRedondeado);
    Logger.log("  Debe: " + debe);
  }

  // PASO 4: Actualizar valores en la hoja
  var celdaAbono = hoja.getRange(fila, COL.COL_ABONO);
  celdaAbono.clearContent();
  celdaAbono.setValue(nuevoAbono);
  
  var celdaSobra = hoja.getRange(fila, COL.COL_SOBRA);
  celdaSobra.clearContent();
  celdaSobra.setValue(sobra);
  
  var celdaDeuda = hoja.getRange(fila, COL.COL_DEUDA);
  celdaDeuda.clearContent();
  
  if (cancelo === "SI") {
    celdaDeuda.setValue(0);
  } else {
    var letraTotal = columnToLetter(COL.COL_TOTAL);
    var letraAbono = columnToLetter(COL.COL_ABONO);
    var formulaDeuda = '=' + letraTotal + fila + '-' + letraAbono + fila;
    celdaDeuda.setFormula(formulaDeuda);
    Logger.log("  Fórmula de deuda insertada: " + formulaDeuda);
  }
  
  var celdaCancelo = hoja.getRange(fila, COL.COL_CANCELO);
  celdaCancelo.clearContent();
  celdaCancelo.setValue(cancelo);
  
  hoja.getRange(fila, COL.COL_PAGO_REGISTRADO).setValue(true);
  
  Logger.log("VALORES GUARDADOS:");
  Logger.log("  Abono: " + nuevoAbono);
  Logger.log("  Sobra: " + sobra);
  Logger.log("  Debe: " + debe);
  Logger.log("  Canceló: " + cancelo);

  // PASO 5: Pintar la fila
  var rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
  
  if (esHojaDeudas) {
    if (cancelo === "SI") {
      rangoFila.setBackground("#d4edda");
      Logger.log("PINTADO DEUDA: VERDE (canceló)");
    } else if (nuevoAbono > 0) {
      rangoFila.setBackground("#fff3cd");
      Logger.log("PINTADO DEUDA: AMARILLO (pago parcial, debe: " + debe + ")");
    } else {
      rangoFila.setBackground("#f8d7da");
      Logger.log("PINTADO DEUDA: ROJO (sin pagos)");
    }
  } else {
    var colorActual = rangoFila.getBackground();
    var tieneDeudaPendiente = (colorActual === "#f8d7da");
    
    if (tieneDeudaPendiente) {
      rangoFila.setBackground("#f8d7da");
      Logger.log("PINTADO: Mantiene ROJO (deuda anterior)");
    } else if (cancelo === "SI") {
      rangoFila.setBackground("#d4edda");
      Logger.log("PINTADO: VERDE (canceló)");
    } else if (debe > 0) {
      rangoFila.setBackground("#fff3cd");
      Logger.log("PINTADO: AMARILLO (debe: " + debe + ")");
    } else {
      rangoFila.setBackground(null);
      Logger.log("PINTADO: Sin color (no hay deuda)");
    }
  }

  registrarEnHistorial(hoja, fila, fecha, monto, nombreHoja);
  
  // SI ES UNA HOJA DE DEUDAS Y SE CANCELÓ COMPLETAMENTE
  var urlReporteGenerado = null;
  
  if (esHojaDeudas && cancelo === "SI") {
    Logger.log("DEUDA CANCELADA - Procesando limpieza y generación de reporte...");
    
    var columna1 = hoja.getRange(fila, 1).getValue();
    var columna2 = hoja.getRange(fila, 2).getValue();
    var inquilino = hoja.getRange(fila, 3).getValue();
    var propiedad = ((columna1 || "") + " " + (columna2 || "")).trim();
    
    try {
      var numCols = esLocal ? 29 : 30;
      var datos = hoja.getRange(fila, 1, 1, numCols).getValues()[0];
      
      var mes = datos[6] || "Mes actual";
      var mesDeuda = nombreHoja.replace("Deudas ", "").replace("Matienzo Deudas ", "").replace("Local Deudas ", "");
      
      urlReporteGenerado = crearDocumentoReportePersonalizadoMejorado({
        propiedad: propiedad,
        inquilino: inquilino,
        mes: mesDeuda,
        esDeuda: true,
        alquiler: alquilerBase,
        iva: iva,
        impuestos: esLocal ? 0 : impuestos,
        gastosComunes: esLocal ? 0 : gastosComunes,
        rentas: rentas,
        muni: muni,
        descuentos: descuentos,
        expensas: expensas,
        seguro: esLocal ? seguro : 0,
        agua: agua,
        aFavor: afavor,
        punitorios: punitoriosParaFecha,
        total: totalActual,
        fechaPago: parsearFechaLocal(fecha),
        esLocal: esLocal
      });
      
      Logger.log("  ✓ Reporte generado: " + urlReporteGenerado);
    } catch (errorReporte) {
      Logger.log("  ✗ Error generando reporte: " + errorReporte);
    }
    
    hoja.deleteRow(fila);
    Logger.log("  ✓ Fila eliminada de hoja de deudas");
    
    var nombreHojaPrincipal = determinarHojaPrincipal(nombreHoja);
    var hojaPrincipal = ss.getSheetByName(nombreHojaPrincipal);
    
    if (hojaPrincipal) {
      var datosPrincipal = hojaPrincipal.getDataRange().getValues();
      
      for (var i = 1; i < datosPrincipal.length; i++) {
        var col1 = datosPrincipal[i][0];
        var col2 = datosPrincipal[i][1];
        var inq = datosPrincipal[i][2];
        
        if (col1 === columna1 && col2 === columna2 && inq === inquilino) {
          var filaPrincipal = i + 1;
          var rangoFila = hojaPrincipal.getRange(filaPrincipal, 1, 1, hojaPrincipal.getLastColumn());
          rangoFila.setBackground(null);
          Logger.log("  ✓ Fila despintada en hoja principal (fila " + filaPrincipal + ")");
          break;
        }
      }
    }
  }
  
  if (perdonarPunitorios) {
    hoja.getRange(fila, COL.COL_PUNITORIOS).setNote("Punitorios perdonados - congelado en $0");
  } else if (cancelo === "SI") {
    hoja.getRange(fila, COL.COL_PUNITORIOS).setNote("Valor congelado al cancelar");
  }

  var urlComprobanteEfectivo = null;
  
  if (pagoEfectivo) {
    Logger.log("PAGO EN EFECTIVO - Generando comprobante...");
    
    var columna1 = hoja.getRange(fila, 1).getValue();
    var columna2 = hoja.getRange(fila, 2).getValue();
    var inquilino = hoja.getRange(fila, 3).getValue();
    var propiedad = ((columna1 || "") + " " + (columna2 || "")).trim();
    
    try {
      var numCols = esLocal ? 29 : 30;
      var datos = hoja.getRange(fila, 1, 1, numCols).getValues()[0];
      
      var mes = datos[6] || "Mes actual";
      var mesDeuda = "";
      
      if (esHojaDeudas) {
        mesDeuda = nombreHoja.replace("Deudas ", "").replace("Matienzo Deudas ", "").replace("Local Deudas ", "");
      }
      
      urlComprobanteEfectivo = crearComprobanteEfectivo({
        propiedad: propiedad,
        inquilino: inquilino,
        mes: esHojaDeudas ? mesDeuda : mes,
        esDeuda: esHojaDeudas,
        alquiler: alquilerBase,
        iva: iva,
        impuestos: esLocal ? 0 : impuestos,
        gastosComunes: esLocal ? 0 : gastosComunes,
        rentas: rentas,
        muni: muni,
        descuentos: descuentos,
        expensas: expensas,
        seguro: esLocal ? seguro : 0,
        agua: agua,
        aFavor: afavor,
        punitorios: punitoriosParaFecha,
        total: totalActual,
        montoPagado: monto, // ← IMPORTANTE: usar el monto que pagó, no el total
        fechaPago: parsearFechaLocal(fecha),
        esLocal: esLocal
      });
      
      Logger.log("  ✓ Comprobante de efectivo generado: " + urlComprobanteEfectivo);
    } catch (errorComprobante) {
      Logger.log("  ✗ Error generando comprobante de efectivo: " + errorComprobante);
    }
  }

  return "✅ Pago registrado exitosamente\n\n" +
         "💰 Monto: $" + monto.toFixed(2) + "\n" +
         "📅 Fecha: " + fecha + "\n" +
         (perdonarPunitorios ? "🎁 Punitorios perdonados\n" : "") +
         (pagoEfectivo ? "💵 Pago en efectivo\n" : "") + // ← AÑADIR ESTO
         (cancelo === "SI" ? "✓ Estado: CANCELADO\n💵 Sobra: $" + sobra.toFixed(2) : "⚠ Debe: $" + debe.toFixed(2)) +
         (urlReporteGenerado ? "\n\n📄 Reporte generado:\n" + urlReporteGenerado : "") +
         (urlComprobanteEfectivo ? "\n\n💵 Comprobante de efectivo:\n" + urlComprobanteEfectivo : ""); // ← AÑADIR ESTO
}

// ============================================
// AÑADIR ESTAS FUNCIONES AL CÓDIGO PRINCIPAL
// ============================================

/**
 * Genera un comprobante de recibo de pago en efectivo
 * Se crea a partir de una plantilla en Google Drive
 */
/**
 * Obtiene el siguiente número de comprobante en formato 0002-00005973
 * El contador se guarda en las propiedades del documento
 */
function obtenerSiguienteNumeroComprobante() {
  var propiedades = PropertiesService.getDocumentProperties();
  
  // Inicializar contador si no existe (empezar desde 5973)
  var contadorActual = propiedades.getProperty('CONTADOR_COMPROBANTES');
  
  if (!contadorActual) {
    contadorActual = 5973; // Número inicial
    propiedades.setProperty('CONTADOR_COMPROBANTES', contadorActual.toString());
  } else {
    contadorActual = parseInt(contadorActual) + 1;
    propiedades.setProperty('CONTADOR_COMPROBANTES', contadorActual.toString());
  }
  
  // Formato: 0002-00005973
  var numeroFormateado = "0002-" + contadorActual.toString().padStart(8, '0');
  
  Logger.log("Número de comprobante generado: " + numeroFormateado);
  
  return numeroFormateado;
}

/**
 * Reiniciar el contador de comprobantes (solo si es necesario)
 * Usar con precaución
 */
function reiniciarContadorComprobantes() {
  var ui = SpreadsheetApp.getUi();
  var respuesta = ui.prompt(
    "Reiniciar Contador de Comprobantes",
    "Ingresa el nuevo número inicial (ejemplo: 5973):",
    ui.ButtonSet.OK_CANCEL
  );
  
  if (respuesta.getSelectedButton() === ui.Button.OK) {
    var nuevoContador = parseInt(respuesta.getResponseText());
    
    if (isNaN(nuevoContador) || nuevoContador < 1) {
      ui.alert("Error", "Número inválido", ui.ButtonSet.OK);
      return;
    }
    
    var propiedades = PropertiesService.getDocumentProperties();
    propiedades.setProperty('CONTADOR_COMPROBANTES', nuevoContador.toString());
    
    ui.alert(
      "Contador Reiniciado",
      "El próximo comprobante será: 0002-" + nuevoContador.toString().padStart(8, '0'),
      ui.ButtonSet.OK
    );
  }
}

/**
 * Ver el número actual del contador (sin incrementar)
 */
function verContadorActual() {
  var propiedades = PropertiesService.getDocumentProperties();
  var contadorActual = propiedades.getProperty('CONTADOR_COMPROBANTES');
  
  var ui = SpreadsheetApp.getUi();
  
  if (!contadorActual) {
    ui.alert(
      "Contador de Comprobantes",
      "El contador aún no ha sido inicializado.\n\nSe inicializará en 5973 al generar el primer comprobante.",
      ui.ButtonSet.OK
    );
  } else {
    var numeroFormateado = "0002-" + contadorActual.toString().padStart(8, '0');
    ui.alert(
      "Contador de Comprobantes",
      "Último número generado: " + numeroFormateado + "\n\n" +
      "El próximo será: 0002-" + (parseInt(contadorActual) + 1).toString().padStart(8, '0'),
      ui.ButtonSet.OK
    );
  }
}

// ============================================
// COMPROBANTE DE EFECTIVO MEJORADO
// ============================================

/**
 * Genera un comprobante de recibo de pago en efectivo
 * MEJORAS:
 * - Numeración específica (0002-00005973, 0002-00005974, etc.)
 * - Detalle filtrado (solo muestra conceptos pagados > $0)
 */
function crearComprobanteEfectivo(datos) {
  // Buscar la plantilla de comprobante de efectivo
  var plantillas = DriveApp.getFilesByName("Plantilla_Comprobante_Efectivo");
  
  if (!plantillas.hasNext()) {
    Logger.log("⚠️ No se encontró la plantilla 'Plantilla_Comprobante_Efectivo'");
    Logger.log("Creando plantilla desde cero...");
    
    // Crear plantilla básica si no existe
    var doc = DocumentApp.create("Plantilla_Comprobante_Efectivo");
    var body = doc.getBody();
    
    // Configurar página
    body.setMarginTop(50);
    body.setMarginBottom(50);
    body.setMarginLeft(70);
    body.setMarginRight(70);
    
    // Título
    var titulo = body.appendParagraph("COMPROBANTE DE PAGO EN EFECTIVO");
    titulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    titulo.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    titulo.editAsText().setBold(true).setFontSize(18);
    
    body.appendParagraph(""); // Espacio
    
    // Número de comprobante
    var numeroComp = body.appendParagraph("N° {{NUMERO_COMPROBANTE}}");
    numeroComp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    numeroComp.editAsText().setBold(true).setFontSize(12);
    
    body.appendParagraph(""); // Espacio
    
    // Fecha
    var fecha = body.appendParagraph("Fecha: {{FECHA}}");
    fecha.editAsText().setBold(true);
    
    body.appendParagraph(""); // Espacio
    
    // Datos del inquilino
    body.appendParagraph("Recibí de: {{INQUILINO}}");
    body.appendParagraph("Propiedad: {{PROPIEDAD}}");
    
    body.appendParagraph(""); // Espacio
    
    // Concepto
    body.appendParagraph("En concepto de: {{CONCEPTO}}");
    
    body.appendParagraph(""); // Espacio
    
    // Monto
    var montoNum = body.appendParagraph("Monto: {{MONTO}}");
    montoNum.editAsText().setBold(true).setFontSize(14);
    
    var montoTexto = body.appendParagraph("{{MONTO_TEXTO}}");
    montoTexto.editAsText().setItalic(true);
    
    body.appendParagraph(""); // Espacio
    body.appendParagraph(""); // Espacio
    body.appendParagraph(""); // Espacio
    
    // Detalle del pago
    body.appendParagraph("DETALLE DEL PAGO:").editAsText().setBold(true).setUnderline(true);
    body.appendParagraph("{{DETALLE_PAGO}}");
    
    body.appendParagraph(""); // Espacio
    body.appendParagraph(""); // Espacio
    
    // Firma
    var lineaFirma = body.appendParagraph("_".repeat(40));
    lineaFirma.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    var firma = body.appendParagraph("Firma y aclaración");
    firma.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    firma.editAsText().setItalic(true).setFontSize(10);
    
    doc.saveAndClose();
    
    var archivoPlantilla = DriveApp.getFileById(doc.getId());
    plantillas = [archivoPlantilla];
  } else {
    plantillas = [plantillas.next()];
  }
  
  var plantilla = plantillas[0];
  
  // ===== GENERAR NÚMERO DE COMPROBANTE CON FORMATO ESPECÍFICO =====
  var numeroComprobante = obtenerSiguienteNumeroComprobante();
  
  var tipoReporte = datos.esDeuda ? "Deuda " + datos.mes : datos.mes;
  var nombreComprobante = "Comprobante Efectivo - " + datos.propiedad + " - " + tipoReporte;
  
  // Crear copia de la plantilla
  var copia = plantilla.makeCopy(nombreComprobante);
  var doc = DocumentApp.openById(copia.getId());
  var body = doc.getBody();
  
  // ===== CONSTRUIR DETALLE DEL PAGO (SOLO CONCEPTOS PAGADOS) =====
  var detallePago = "";
  
  // Función auxiliar para agregar líneas solo si el monto > 0
  function agregarLinea(concepto, monto, espacios) {
    if (monto && parseFloat(monto) !== 0) {
      var signo = monto < 0 ? "-" : "";
      var montoAbs = Math.abs(monto);
      detallePago += concepto.padEnd(espacios, " ") + "$ " + signo + formatearNumero(montoAbs) + "\n";
    }
  }
  
  // Agregar solo los conceptos que tienen valor
  agregarLinea("Alquiler mes de " + datos.mes, datos.alquiler, 60);
  agregarLinea("IVA", datos.iva, 60);
  agregarLinea("Impuestos", datos.impuestos, 60);
  agregarLinea("Gastos Comunes", datos.gastosComunes, 60);
  agregarLinea("Rentas", datos.rentas, 60);
  agregarLinea("Municipal", datos.muni, 60);
  agregarLinea("Descuentos", -Math.abs(datos.descuentos), 60);
  agregarLinea("Expensas", datos.expensas, 60);
  agregarLinea("Seguro", datos.seguro, 60);
  agregarLinea("Agua", datos.agua, 60);
  agregarLinea("A Favor Mes Anterior", -Math.abs(datos.aFavor), 60);
  agregarLinea("Punitorios", datos.punitorios, 60);
  
  var fecha = Utilities.formatDate(datos.fechaPago, "GMT-3", "dd/MM/yyyy");
  var concepto = datos.esDeuda ? 
    "Pago de deuda correspondiente a " + datos.mes : 
    "Pago de alquiler correspondiente a " + datos.mes;
  
  // Reemplazar placeholders
  body.replaceText("\\{\\{NUMERO_COMPROBANTE\\}\\}", numeroComprobante);
  body.replaceText("\\{\\{FECHA\\}\\}", fecha);
  body.replaceText("\\{\\{INQUILINO\\}\\}", datos.inquilino);
  body.replaceText("\\{\\{PROPIEDAD\\}\\}", datos.propiedad);
  body.replaceText("\\{\\{CONCEPTO\\}\\}", concepto);
  body.replaceText("\\{\\{MONTO\\}\\}", "$ " + formatearNumero(datos.montoPagado));
  body.replaceText("\\{\\{MONTO_TEXTO\\}\\}", numeroATexto(datos.montoPagado));
  body.replaceText("\\{\\{DETALLE_PAGO\\}\\}", detallePago);
  
  doc.saveAndClose();
  
  // Mover a carpeta de comprobantes
  var carpetaPropiedad = obtenerOCrearCarpetaPropiedadEnComprobantes(datos.propiedad);
  copia.moveTo(carpetaPropiedad);
  
  Logger.log("✓ Comprobante de efectivo generado: " + doc.getUrl());
  Logger.log("  Número: " + numeroComprobante);
  
  return doc.getUrl();
}

/**
 * Obtiene o crea la carpeta "Comprobantes" en el nivel raíz
 * (al mismo nivel que "Reportes" y "Histórico Planillas")
 */
function obtenerOCrearCarpetaComprobantes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var archivo = DriveApp.getFileById(ss.getId());
  var carpetaPadre = archivo.getParents().hasNext() ? archivo.getParents().next() : DriveApp.getRootFolder();

  var carpetas = carpetaPadre.getFoldersByName("Comprobantes");
  if (carpetas.hasNext()) {
    return carpetas.next();
  } else {
    return carpetaPadre.createFolder("Comprobantes");
  }
}

/**
 * Obtiene o crea la carpeta de la propiedad dentro de "Comprobantes"
 */
function obtenerOCrearCarpetaPropiedadEnComprobantes(nombrePropiedad) {
  var carpetaComprobantes = obtenerOCrearCarpetaComprobantes();
  
  var carpetasPropiedad = carpetaComprobantes.getFoldersByName(nombrePropiedad);
  if (carpetasPropiedad.hasNext()) {
    return carpetasPropiedad.next();
  } else {
    return carpetaComprobantes.createFolder(nombrePropiedad);
  }
}

function registrarEnHistorial(hoja, fila, fechaPago, monto, nombreHoja) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // USAR SIEMPRE "Historial de Pagos" para todas las hojas
  var nombreHistorial = "Historial de Pagos";
  
  var hojaHistorial = ss.getSheetByName(nombreHistorial);
  
  if (!hojaHistorial) {
    hojaHistorial = ss.insertSheet(nombreHistorial);
    hojaHistorial.getRange(1, 1, 1, 24).setValues([[
      "Fecha Registro", "Propiedad", "Inquilino", "Mes/Año", "Alquiler Base",
      "IVA", "IMPUESTOS", "GASTOS COMUNES", "Rentas", "Muni", "Descuentos",
      "Expensas", "Agua", "Seguro", "Punitorios", "A favor", "Debia",
      "Total a Pagar", "Fecha Pago", "Abono", "Sobra", "Debe", "Canceló", "Observaciones"
    ]]);
  }
  
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);
  
  var propiedad = ((hoja.getRange(fila, 1).getValue() || "") + " " + 
                   (hoja.getRange(fila, 2).getValue() || "")).trim();
  var inquilino = hoja.getRange(fila, 3).getValue();
  var fechaInicio = hoja.getRange(fila, 4).getValue();
  var mesTexto = hoja.getRange(fila, 7).getValue();
  var mesAnio = calcularFechaMesCorresponde(fechaInicio, mesTexto);
  
  var alquilerBase = hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue() || 0;
  var iva = hoja.getRange(fila, COL.COL_IVA).getValue() || 0;
  var impuestos = esLocal ? 0 : (hoja.getRange(fila, COL.COL_IMPUESTOS).getValue() || 0);
  var gastosComunes = esLocal ? 0 : (hoja.getRange(fila, COL.COL_GASTOS_COMUNES).getValue() || 0);
  var rentas = hoja.getRange(fila, COL.COL_RENTAS).getValue() || 0;
  var muni = hoja.getRange(fila, COL.COL_MUNI).getValue() || 0;
  var descuentos = hoja.getRange(fila, COL.COL_DESCUENTOS).getValue() || 0;
  var expensas = hoja.getRange(fila, COL.COL_EXPENSAS).getValue() || 0;
  var agua = hoja.getRange(fila, COL.COL_AGUA).getValue() || 0;
  var seguro = esLocal ? (hoja.getRange(fila, COL.COL_SEGURO).getValue() || 0) : 0;
  var punitorios = hoja.getRange(fila, COL.COL_PUNITORIOS).getValue() || 0;
  var afavor = hoja.getRange(fila, COL.COL_A_FAVOR).getValue() || 0;
  var total = hoja.getRange(fila, COL.COL_TOTAL).getValue() || 0;
  var abono = hoja.getRange(fila, COL.COL_ABONO).getValue() || 0;
  var sobra = hoja.getRange(fila, COL.COL_SOBRA).getValue() || 0;
  var debe = hoja.getRange(fila, COL.COL_DEUDA).getValue() || 0;
  var cancelo = hoja.getRange(fila, COL.COL_CANCELO).getValue();
  
  // Determinar observaciones según si es deuda o pago normal
  var observaciones = "Pago mes " + mesTexto;
  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 ||
                      nombreHoja.indexOf("Matienzo Deudas ") === 0 ||
                      nombreHoja.indexOf("Local Deudas ") === 0);

  if (esHojaDeudas) {
    // Extraer mes y año del nombre de la hoja
    var meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                 "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var mesDeuda = "";
    var anioDeuda = "";
    
    for (var i = 0; i < meses.length; i++) {
      if (nombreHoja.toLowerCase().indexOf(meses[i].toLowerCase()) !== -1) {
        mesDeuda = meses[i];
        break;
      }
    }
    
    var matchAnio = nombreHoja.match(/20\d{2}/);
    if (matchAnio) {
      anioDeuda = matchAnio[0];
    }
    
    if (mesDeuda && anioDeuda) {
      observaciones = "Pago de deuda - " + mesDeuda + " " + anioDeuda;
    } else {
      observaciones = "Pago de deuda";
    }
  }
  
  var nuevaFila = [
    parsearFechaLocal(fechaPago),  // Usar la fecha del pago, no la fecha actual
    propiedad,
    inquilino,
    mesAnio,
    alquilerBase,
    iva,
    impuestos,
    gastosComunes,
    rentas,
    muni,
    descuentos,
    expensas,
    agua,
    seguro,
    punitorios,
    afavor,
    0,
    total,
    parsearFechaLocal(fechaPago),
    abono,
    sobra,
    debe,
    cancelo,
    observaciones
  ];
  
  hojaHistorial.appendRow(nuevaFila);
}

// ============================================
// OBTENER LISTA DE PROPIEDADES - VERSIÓN MEJORADA
// Con soporte para PAGOS y REPORTES
// ============================================
function getListaPropiedades(nombreHoja, paraReporte) {
  // paraReporte = true  → Incluir TODAS (para generar reportes)
  // paraReporte = false o undefined → Excluir canceladas (para registrar pagos)
  
  Logger.log("=== getListaPropiedades: " + nombreHoja + " ===");
  Logger.log("Para reporte: " + (paraReporte === true));
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  
  if (!hoja) {
    Logger.log("ERROR: Hoja no encontrada: " + nombreHoja);
    return [];
  }
  
  try {
    var datos = hoja.getDataRange().getValues();
    var lista = [];
    
    Logger.log("Total filas en hoja: " + datos.length);
    
    var COL = obtenerColumnasHoja(nombreHoja);
    var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);
    var esHojaDeudas = (nombreHoja.indexOf("Deudas") !== -1);
    
    Logger.log("Es hoja de deudas: " + esHojaDeudas + " | Es Local: " + esLocal);
    
    // Función auxiliar para validar y convertir valores
    function validarNumero(valor) {
      if (typeof valor === 'number') return valor;
      if (valor instanceof Date) return 0;
      if (valor === null || valor === undefined) return 0;
      if (typeof valor === 'string') {
        valor = String(valor).trim();
        if (valor === '' || valor.toLowerCase() === 'comp' || valor.toLowerCase() === 'efectivo') return 0;
        valor = valor.replace(/[^\d.,\-]/g, '');
        if (valor === '') return 0;
        var num = parseFloat(valor);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    }
    
    for (var i = 1; i < datos.length; i++) {
      try {
        var fila = datos[i];
        var nombre = ((fila[0] || "") + " " + (fila[1] || "")).trim();
        
        if (nombre === "") continue;
        
        var pagoRegistrado = fila[COL.COL_PAGO_REGISTRADO - 1] === true;
        var cancelo = (fila[COL.COL_CANCELO - 1] === "SI");

        // LÓGICA MEJORADA: Filtrado según el propósito
        var incluirPropiedad = false;
        
        if (paraReporte === true) {
          // PARA REPORTES: Incluir TODAS las propiedades (canceladas y no canceladas)
          incluirPropiedad = true;
          Logger.log("  [REPORTE] Incluyendo: " + nombre + " (Canceló: " + cancelo + ")");
        } else {
          // PARA PAGOS: Filtrado selectivo
          if (esHojaDeudas) {
            // En hojas de DEUDAS: incluir todas (las canceladas se eliminan automáticamente)
            incluirPropiedad = true;
            Logger.log("  [PAGO-DEUDA] Incluyendo: " + nombre);
          } else {
            // En hojas PRINCIPALES: EXCLUIR las que ya cancelaron
            incluirPropiedad = !cancelo;
            if (incluirPropiedad) {
              Logger.log("  [PAGO] Incluyendo: " + nombre + " (pendiente)");
            } else {
              Logger.log("  [PAGO] Excluyendo: " + nombre + " (ya canceló)");
            }
          }
        }
        
        if (incluirPropiedad) {
          var id = nombreHoja + "|" + (i + 1);
          
          // Validar total y abono
          var totalCelda = fila[COL.COL_TOTAL - 1];
          var abonoCelda = fila[COL.COL_ABONO - 1];
          
          var total = validarNumero(totalCelda);
          var abono = validarNumero(abonoCelda);
          
          // Calcular el total a pagar correctamente
          var totalAPagar = total;
          if (abono > 0 && total > abono) {
            totalAPagar = total - abono;
          }
          
          var debe = validarNumero(fila[COL.COL_DEUDA - 1]);
          var ultimaFechaPago = null;
          
          if (esLocal) {
            lista.push([
              id,
              (nombre + " - " + fila[2]).trim(),
              totalAPagar,
              validarNumero(fila[COL.COL_ALQUILER_BASE - 1]),
              validarNumero(fila[COL.COL_IVA - 1]),
              0,
              0,
              validarNumero(fila[COL.COL_RENTAS - 1]),
              validarNumero(fila[COL.COL_MUNI - 1]),
              validarNumero(fila[COL.COL_DESCUENTOS - 1]),
              validarNumero(fila[COL.COL_EXPENSAS - 1]),
              validarNumero(fila[COL.COL_SEGURO - 1]),
              validarNumero(fila[COL.COL_AGUA - 1]),
              validarNumero(fila[COL.COL_A_FAVOR - 1]),
              validarNumero(fila[COL.COL_PUNITORIOS - 1]),
              pagoRegistrado,
              abono,
              cancelo,
              fila[2],
              true,
              debe,
              ultimaFechaPago
            ]);
          } else {
            lista.push([
              id,
              (nombre + " - " + fila[2]).trim(),
              totalAPagar,
              validarNumero(fila[COL.COL_ALQUILER_BASE - 1]),
              validarNumero(fila[COL.COL_IVA - 1]),
              validarNumero(fila[COL.COL_IMPUESTOS - 1]),
              validarNumero(fila[COL.COL_GASTOS_COMUNES - 1]),
              validarNumero(fila[COL.COL_RENTAS - 1]),
              validarNumero(fila[COL.COL_MUNI - 1]),
              validarNumero(fila[COL.COL_DESCUENTOS - 1]),
              validarNumero(fila[COL.COL_EXPENSAS - 1]),
              validarNumero(fila[COL.COL_AGUA - 1]),
              validarNumero(fila[COL.COL_A_FAVOR - 1]),
              validarNumero(fila[COL.COL_PUNITORIOS - 1]),
              pagoRegistrado,
              abono,
              cancelo,
              fila[2],
              debe,
              ultimaFechaPago
            ]);
          }
        }
      } catch (errorFila) {
        Logger.log("Error procesando fila " + i + ": " + errorFila);
        continue;
      }
    }
    
    Logger.log("Total propiedades encontradas en " + nombreHoja + ": " + lista.length);
    if (lista.length > 0) {
      Logger.log("Primera propiedad: " + lista[0][1]);
    }
    return lista;
  } catch (error) {
    Logger.log("ERROR CRÍTICO en getListaPropiedades(" + nombreHoja + "): " + error);
    return [];
  }
}

// ============================================
// FUNCIÓN WRAPPER ESPECÍFICA PARA REPORTES
// ============================================
function getListaPropiedadesParaReporte(nombreHoja) {
  return getListaPropiedades(nombreHoja, true);
}

function getHojasDeudas(nombreHojaPrincipal) {
  Logger.log("=== getHojasDeudas LLAMADA ===");
  Logger.log("Hoja principal recibida: " + nombreHojaPrincipal);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var todasLasHojas = ss.getSheets();
  var hojasDeudas = [];
  
  Logger.log("Total de hojas en el spreadsheet: " + todasLasHojas.length);
  
  // Determinar el patrón de búsqueda según la hoja principal
  var patronBusqueda = "";
  if (nombreHojaPrincipal === "VARIOS Control Mensual") {
    patronBusqueda = "Deudas ";
  } else if (nombreHojaPrincipal === "Matienzo") {
    patronBusqueda = "Matienzo Deudas ";
  } else if (nombreHojaPrincipal === "Local") {
    patronBusqueda = "Local Deudas ";
  }
  
  Logger.log("Patrón de búsqueda: '" + patronBusqueda + "'");
  
  // Buscar todas las hojas que coincidan con el patrón
  for (var i = 0; i < todasLasHojas.length; i++) {
    var nombreHoja = todasLasHojas[i].getName();
    if (nombreHoja.indexOf(patronBusqueda) === 0) {
      Logger.log("  ✓ Hoja encontrada: " + nombreHoja);
      hojasDeudas.push(nombreHoja);
    }
  }
  
  Logger.log("Total hojas de deudas encontradas: " + hojasDeudas.length);
  if (hojasDeudas.length > 0) {
    Logger.log("Hojas: " + hojasDeudas.join(", "));
  }
  
  return hojasDeudas;
}

// ============================================
// OBTENER ÚLTIMA FECHA DE PAGO DE UNA DEUDA
// ============================================
function obtenerUltimaFechaPagoDeuda(nombrePropiedad, nombreHojaDeudas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var historial = ss.getSheetByName("Historial de Pagos");
  
  if (!historial) {
    return null;
  }
  
  var datos = historial.getDataRange().getValues();
  var ultimaFecha = null;
  
  // Limpiar nombre de propiedad para comparación
  var propiedadLimpia = nombrePropiedad.replace(/\s+/g, ' ').trim().toLowerCase();
  var claveBusqueda = propiedadLimpia.split('-')[0].trim().substring(0, 20);
  
  // Buscar en el historial pagos que coincidan con la propiedad (empezar por el más reciente)
  // Optimización: solo revisar los últimos 100 registros para evitar bloqueos
  var inicioIndex = Math.max(1, datos.length - 100);
  
  for (var i = datos.length - 1; i >= inicioIndex; i--) {
    var propiedadHistorial = (datos[i][1] + "").trim(); // Columna B: Propiedad
    var fechaPago = datos[i][18]; // Columna S: Fecha de Pago
    
    // Comparación flexible (misma lógica que CALCULAR_PUNITORIOS_DEUDA)
    var propiedadHistorialLimpia = propiedadHistorial.replace(/\s+/g, ' ').trim().toLowerCase();
    var claveHistorial = propiedadHistorialLimpia.split('-')[0].trim().substring(0, 20);
    
    // Verificar coincidencia
    if (claveBusqueda.indexOf(claveHistorial) !== -1 || claveHistorial.indexOf(claveBusqueda) !== -1 || 
        propiedadLimpia.indexOf(claveHistorial) !== -1 || propiedadHistorialLimpia.indexOf(claveBusqueda) !== -1) {
      
      if (fechaPago instanceof Date) {
        ultimaFecha = fechaPago;
        break; // Encontramos el más reciente
      } else if (fechaPago) {
        ultimaFecha = parsearFechaLocal(fechaPago);
        break;
      }
    }
  }
  
  return ultimaFecha;
}

// ============================================
// VERIFICACIÓN DE CONTRATOS
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

// ============================================
// PREPARAR NUEVO MES - VERSIÓN CORREGIDA
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
    "• Limpiar todos los registros de pagos del mes actual\n" +
    "• Copiar valores de 'Proximo Mes' si existe\n\n" +
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
    var total = parseFloat(datos[i][COL.COL_TOTAL - 1]) || 0;
    
    // CONDICIONES PARA INCLUIR COMO DEUDA:
    // 1. NO pagó nada (pagoRegistrado = false)
    // 2. Pagó pero no canceló completamente (pagoRegistrado = true && cancelo != "SI")
    // 3. El total debe ser mayor a $0
    if (total > 0 && (!pagoRegistrado || (pagoRegistrado && !cancelo))) {
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
    
    // En la hoja de DEUDAS: cambiar fórmulas de punitorios
    var filasDeudas = hojaDeudas.getLastRow();
    for (var i = 2; i <= filasDeudas; i++) {
      var celdaPunitorios = hojaDeudas.getRange(i, COL.COL_PUNITORIOS);
      celdaPunitorios.clearContent();
    }
    
    SpreadsheetApp.flush();
    
    Logger.log("===== INSERTANDO FÓRMULAS DE PUNITORIOS EN DEUDAS =====");
    Logger.log("Hoja de deudas: " + nombreHojaDeudas);
    Logger.log("Total filas con deuda: " + filasDeudas);
    
    for (var i = 2; i <= filasDeudas; i++) {
      var celdaPunitorios = hojaDeudas.getRange(i, COL.COL_PUNITORIOS);
      var formulaPunitoriosDeuda = '=CALCULAR_PUNITORIOS_DEUDA(ROW())';
      Logger.log("Fila " + i + ": Insertando fórmula: " + formulaPunitoriosDeuda);
      celdaPunitorios.setFormula(formulaPunitoriosDeuda);
    }
    
    SpreadsheetApp.flush();
    Logger.log("Fórmulas insertadas y flush ejecutado");
    
    ss.moveActiveSheet(ss.getNumSheets());
  }
  
  // PASO 2: MARCAR EN ROJO LAS FILAS CON DEUDA EN LA HOJA PRINCIPAL
  for (var i = 0; i < filasConDeuda.length; i++) {
    var fila = filasConDeuda[i];
    var rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
    rangoFila.setBackground("#f8d7da");
  }
  
  // PASO 3: PREPARAR NUEVO MES EN LA HOJA PRINCIPAL
  var propiedadesProcesadas = 0;

  // PASO 3A: BUSCAR SI EXISTE LA HOJA "PROXIMO MES"
  var nombreHojaProximoMes = "Proximo Mes " + nombreHojaPrincipal.replace(" Control Mensual", "");
  var hojaProximoMes = ss.getSheetByName(nombreHojaProximoMes);
  var datosProximoMes = null;

  if (hojaProximoMes) {
    datosProximoMes = hojaProximoMes.getDataRange().getValues();
    Logger.log("✓ Hoja 'Proximo Mes' encontrada: " + nombreHojaProximoMes);
    Logger.log("  Total filas en Proximo Mes: " + datosProximoMes.length);
  } else {
    Logger.log("✗ Hoja 'Proximo Mes' no encontrada: " + nombreHojaProximoMes);
  }

  for (var i = 1; i < datos.length; i++) {
    var fila = i + 1;
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    if (nombre === "") continue;

    // Traspasar sobras a A FAVOR
    var sobraMesNuevo = datos[i][COL.COL_SOBRA - 1] || 0;
    var celdaAFavor = hoja.getRange(fila, COL.COL_A_FAVOR);
    if (sobraMesNuevo > 0) {
      celdaAFavor.setValue(sobraMesNuevo);
    } else {
      celdaAFavor.clearContent();
    }

    // Quitar fondo rojo si no tiene deuda
    var rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
    if (filasConDeuda.indexOf(fila) === -1) {
      rangoFila.setBackground(null);
    }

    // PASO 3B: PRIMERO LIMPIAR LAS COLUMNAS
    Logger.log("Procesando fila " + fila + ": " + nombre);
    
    hoja.getRange(fila, COL.COL_IVA).clearContent();
    if (!esLocal) {
      hoja.getRange(fila, COL.COL_IMPUESTOS).clearContent();
      hoja.getRange(fila, COL.COL_GASTOS_COMUNES).clearContent();
    }
    hoja.getRange(fila, COL.COL_RENTAS).clearContent();
    hoja.getRange(fila, COL.COL_MUNI).clearContent();
    hoja.getRange(fila, COL.COL_DESCUENTOS).clearContent();
    hoja.getRange(fila, COL.COL_EXPENSAS).clearContent();
    if (esLocal) {
      hoja.getRange(fila, COL.COL_SEGURO).clearContent();
    }
    hoja.getRange(fila, COL.COL_AGUA).clearContent();
    hoja.getRange(fila, COL.COL_FECHA_PAGO).clearContent();
    hoja.getRange(fila, COL.COL_ABONO).clearContent();
    hoja.getRange(fila, COL.COL_SOBRA).clearContent();
    hoja.getRange(fila, COL.COL_DEUDA).clearContent();
    hoja.getRange(fila, COL.COL_CANCELO).clearContent();
    hoja.getRange(fila, COL.COL_PAGO_REGISTRADO).setValue(false);

    // PASO 3C: DESPUÉS DE LIMPIAR, COPIAR DATOS DE PROXIMO MES SI EXISTE
  // ============================================
// CORRECCIÓN: Sección de prepararNuevoMes
// Reemplazar desde línea ~1810 hasta ~1920
// ============================================

// PASO 3C: PROCESAR AJUSTES DE ALQUILER
// PRIORIDAD 1: Si existe "Proximo Mes", copiar desde ahí
// PRIORIDAD 2: Si NO existe "Proximo Mes", copiar desde columna L de la MISMA hoja
// IMPORTANTE: NO borrar nunca la columna L (ALQUILER CON AJUSTE) - solo copiar

var alquilerAjusteEncontrado = false;

// ===== OPCIÓN 1: Buscar en hoja "Proximo Mes" =====
if (hojaProximoMes && datosProximoMes) {
  var columna1 = datos[i][0];
  var columna2 = datos[i][1];
  var inquilino = datos[i][2];

  Logger.log("  [Opción 1] Buscando en Proximo Mes: '" + columna1 + "' / '" + columna2 + "' / '" + inquilino + "'");

  // Buscar la fila correspondiente en Proximo Mes
  for (var j = 1; j < datosProximoMes.length; j++) {
    var col1ProxMes = datosProximoMes[j][0];
    var col2ProxMes = datosProximoMes[j][1];
    var inquilinoProxMes = datosProximoMes[j][2];

    // Si coinciden las 3 columnas, copiar los datos
    if (columna1 === col1ProxMes && columna2 === col2ProxMes && inquilino === inquilinoProxMes) {
      Logger.log("    ✓ COINCIDENCIA ENCONTRADA en fila " + (j + 1) + " de Proximo Mes");

      // Buscar columna "ALQUILER CON AJUSTE" en Proximo Mes
      var colAlquilerAjuste = -1;
      var encabezadosProxMes = datosProximoMes[0];
      
      for (var k = 0; k < encabezadosProxMes.length; k++) {
        var encabezado = (encabezadosProxMes[k] + "").trim().toUpperCase();
        
        if (encabezado === "ALQUILER CON AJUSTE" || 
            encabezado === "ALQUILER AJUSTE" ||
            encabezado === "ALQUILERCONAJUSTE" ||
            (encabezado.indexOf("AJUSTE") !== -1 && encabezado.indexOf("ALQUILER") !== -1)) {
          colAlquilerAjuste = k;
          break;
        }
      }
      
      if (colAlquilerAjuste !== -1) {
        var alquilerAjusteProxMes = datosProximoMes[j][colAlquilerAjuste];
        
        // Validar que el valor sea numérico y mayor a 0
        var valorNumerico = 0;
        if (typeof alquilerAjusteProxMes === 'number') {
          valorNumerico = alquilerAjusteProxMes;
        } else if (typeof alquilerAjusteProxMes === 'string') {
          var limpio = alquilerAjusteProxMes.trim().replace(/[^\d.,\-]/g, '').replace(',', '.');
          valorNumerico = parseFloat(limpio);
        }
        
        if (!isNaN(valorNumerico) && valorNumerico > 0) {
          hoja.getRange(fila, COL.COL_ALQUILER_BASE).setValue(valorNumerico);
          alquilerAjusteEncontrado = true;
          Logger.log("      ✅ [Proximo Mes] ALQUILER BASE actualizado: $" + valorNumerico.toFixed(2));
        }
      }

      // Copiar otros valores (IVA, RENTAS, etc.) desde Proximo Mes
      if (esLocal) {
        for (var k = 0; k < encabezadosProxMes.length; k++) {
          var encabezado = (encabezadosProxMes[k] + "").trim().toUpperCase();
          var valor = datosProximoMes[j][k];
          
          if (valor && valor !== "" && valor !== 0) {
            if (encabezado === "IVA") {
              hoja.getRange(fila, COL.COL_IVA).setValue(valor);
            } else if (encabezado === "RENTAS") {
              hoja.getRange(fila, COL.COL_RENTAS).setValue(valor);
            } else if (encabezado === "MUNI" || encabezado === "MUNICIPAL") {
              hoja.getRange(fila, COL.COL_MUNI).setValue(valor);
            } else if (encabezado === "DESCUENTOS") {
              hoja.getRange(fila, COL.COL_DESCUENTOS).setValue(valor);
            } else if (encabezado === "EXPENSAS") {
              hoja.getRange(fila, COL.COL_EXPENSAS).setValue(valor);
            } else if (encabezado === "SEGURO") {
              hoja.getRange(fila, COL.COL_SEGURO).setValue(valor);
            } else if (encabezado === "AGUA") {
              hoja.getRange(fila, COL.COL_AGUA).setValue(valor);
            }
          }
        }
      } else {
        for (var k = 0; k < encabezadosProxMes.length; k++) {
          var encabezado = (encabezadosProxMes[k] + "").trim().toUpperCase();
          var valor = datosProximoMes[j][k];
          
          if (valor && valor !== "" && valor !== 0) {
            if (encabezado === "IVA") {
              hoja.getRange(fila, COL.COL_IVA).setValue(valor);
            } else if (encabezado === "IMPUESTOS") {
              hoja.getRange(fila, COL.COL_IMPUESTOS).setValue(valor);
            } else if (encabezado === "GASTOS COMUNES") {
              hoja.getRange(fila, COL.COL_GASTOS_COMUNES).setValue(valor);
            } else if (encabezado === "RENTAS") {
              hoja.getRange(fila, COL.COL_RENTAS).setValue(valor);
            } else if (encabezado === "MUNI" || encabezado === "MUNICIPAL") {
              hoja.getRange(fila, COL.COL_MUNI).setValue(valor);
            } else if (encabezado === "DESCUENTOS") {
              hoja.getRange(fila, COL.COL_DESCUENTOS).setValue(valor);
            } else if (encabezado === "EXPENSAS") {
              hoja.getRange(fila, COL.COL_EXPENSAS).setValue(valor);
            } else if (encabezado === "AGUA") {
              hoja.getRange(fila, COL.COL_AGUA).setValue(valor);
            }
          }
        }
      }

      break;
    }
  }
}

// ===== OPCIÓN 2: Si NO se encontró en "Proximo Mes", copiar desde columna L de la MISMA hoja =====
if (!alquilerAjusteEncontrado) {
  Logger.log("  [Opción 2] No encontrado en Proximo Mes, revisando columna L de la hoja actual...");
  
  var alquilerConAjusteL = datos[i][COL.COL_ALQUILER_AJUSTE - 1];
  
  // Validar si hay un valor válido en la columna L (ALQUILER CON AJUSTE)
  var valorNumericoL = 0;
  if (typeof alquilerConAjusteL === 'number') {
    valorNumericoL = alquilerConAjusteL;
  } else if (typeof alquilerConAjusteL === 'string') {
    var limpioL = (alquilerConAjusteL + "").trim().replace(/[^\d.,\-]/g, '').replace(',', '.');
    valorNumericoL = parseFloat(limpioL);
  }
  
  Logger.log("    Valor en columna L: '" + alquilerConAjusteL + "' → Numérico: " + valorNumericoL);
  
  if (!isNaN(valorNumericoL) && valorNumericoL > 0) {
    hoja.getRange(fila, COL.COL_ALQUILER_BASE).setValue(valorNumericoL);
    Logger.log("    ✅ [Columna L] ALQUILER BASE actualizado: $" + valorNumericoL.toFixed(2));
  } else {
    Logger.log("    ℹ️ Sin ajuste en columna L (valor: " + alquilerConAjusteL + ")");
  }
}
   
    // PASO 3D: Restablecer fórmula de punitorios
    var letraFechaPago = columnToLetter(COL.COL_FECHA_PAGO);
    var celdaPunitorios = hoja.getRange(fila, COL.COL_PUNITORIOS);
    celdaPunitorios.clearContent();
    var formulaPunitorios = '=CALCULAR_PUNITORIOS_SHEET(ROW(),' + letraFechaPago + fila + ')';
    Logger.log("Fila " + fila + ": Insertando fórmula: " + formulaPunitorios + " en columna " + COL.COL_PUNITORIOS);
    celdaPunitorios.setFormula(formulaPunitorios);
    
    propiedadesProcesadas++;
  }
  
  Logger.log("===== INSERTANDO FÓRMULAS DE PUNITORIOS EN HOJA PRINCIPAL =====");
  Logger.log("Hoja: " + nombreHojaPrincipal);
  Logger.log("Total propiedades procesadas: " + propiedadesProcesadas);
  
  SpreadsheetApp.flush();
  Logger.log("Fórmulas insertadas y flush ejecutado en hoja principal");
  
  var mensaje = "✅ Nuevo mes preparado exitosamente\n\n";
  
  mensaje += "📋 Se procesaron " + propiedadesProcesadas + " propiedades\n\n";
  
  mensaje += "💾 Copia guardada: " + nombreArchivoHistorico + "\n";
  mensaje += "   (en carpeta 'Histórico Planillas')\n\n";
  
  if (filasConDeuda.length > 0) {
    mensaje += "📄 Hoja de deudas creada: " + nombreHojaDeudas + "\n";
    mensaje += "🔴 " + filasConDeuda.length + " propiedad(es) con deuda marcadas en ROJO\n";
    mensaje += "   (en la hoja principal)\n\n";
  }
  
  mensaje += "✓ Saldos a favor traspasados\n";
  mensaje += "✓ Registros de pago limpiados\n";
  mensaje += "✓ Fórmulas de punitorios restablecidas\n";

  if (hojaProximoMes) {
    mensaje += "✓ Datos copiados desde '" + nombreHojaProximoMes + "'\n";
  }

  mensaje += "\nLa planilla está lista para el nuevo mes.\n";
  mensaje += "Recuerda actualizar manualmente la columna MES si es necesario.";

  ui.alert("Nuevo Mes Preparado", mensaje, ui.ButtonSet.OK);
}

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

function obtenerOCrearCarpetaReportesAjustes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var archivo = DriveApp.getFileById(ss.getId());
  var carpetaPadre = archivo.getParents().hasNext() ? archivo.getParents().next() : DriveApp.getRootFolder();

  var carpetas = carpetaPadre.getFoldersByName("Reportes de Ajustes");
  if (carpetas.hasNext()) {
    return carpetas.next();
  } else {
    return carpetaPadre.createFolder("Reportes de Ajustes");
  }
}

// ============================================
// CONFIRMAR AJUSTES
// ============================================
function confirmarAjustes(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHojaPrincipal);
  var ui = SpreadsheetApp.getUi();
  
  if (!hoja) {
    ui.alert("Error", "No se encontró la hoja: " + nombreHojaPrincipal, ui.ButtonSet.OK);
    return;
  }
  
  var respuesta = ui.alert(
    "Confirmar Ajustes - " + nombreHojaPrincipal,
    "¿Estás seguro de que quieres confirmar los ajustes?\n\n" +
    "Esto copiará los valores de 'ALQUILER CON AJUSTE' a 'ALQUILER BASE'.\n\n" +
    "Esta acción NO se puede deshacer.",
    ui.ButtonSet.YES_NO
  );
  
  if (respuesta !== ui.Button.YES) {
    return;
  }
  
  var COL = obtenerColumnasHoja(nombreHojaPrincipal);
  var datos = hoja.getDataRange().getValues();
  var ajustesConfirmados = 0;
  
  for (var i = 1; i < datos.length; i++) {
    var fila = i + 1;
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    if (nombre === "") continue;
    
    var alquilerConAjuste = datos[i][COL.COL_ALQUILER_AJUSTE - 1];
    
    if (alquilerConAjuste && alquilerConAjuste !== "") {
      hoja.getRange(fila, COL.COL_ALQUILER_BASE).setValue(alquilerConAjuste);
      hoja.getRange(fila, COL.COL_ALQUILER_AJUSTE).clearContent();
      ajustesConfirmados++;
    }
  }
  
  ui.alert(
    "Ajustes Confirmados",
    "Se confirmaron " + ajustesConfirmados + " ajustes de alquiler.\n\n" +
    "Los valores se copiaron de 'ALQUILER CON AJUSTE' a 'ALQUILER BASE'.",
    ui.ButtonSet.OK
  );
}

// ============================================
// GENERAR REPORTE DE AJUSTES
// ============================================
function generarReporteAjustes(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHojaPrincipal);
  var ui = SpreadsheetApp.getUi();

  if (!hoja) {
    ui.alert("Error", "No se encontró la hoja: " + nombreHojaPrincipal, ui.ButtonSet.OK);
    return;
  }

  var COL = obtenerColumnasHoja(nombreHojaPrincipal);
  var datos = hoja.getDataRange().getValues();

  var totalInquilinos = 0;
  var conAjuste = [];
  var sinAjuste = [];
  var totalDiferenciaAjustes = 0;

  // Función auxiliar para convertir a número
  function toNumber(valor) {
    if (typeof valor === 'number') return valor;
    if (valor === null || valor === undefined || valor === '') return 0;
    var num = parseFloat(valor);
    return isNaN(num) ? 0 : num;
  }

  // Analizar cada inquilino
  for (var i = 1; i < datos.length; i++) {
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    if (nombre === "") continue;

    totalInquilinos++;

    var alquilerBase = toNumber(datos[i][COL.COL_ALQUILER_BASE - 1]);
    var alquilerConAjuste = datos[i][COL.COL_ALQUILER_AJUSTE - 1];
    var alquilerConAjusteNum = toNumber(alquilerConAjuste);

    if (alquilerConAjuste && alquilerConAjuste !== "" && alquilerConAjusteNum !== 0) {
      var diferencia = alquilerConAjusteNum - alquilerBase;
      conAjuste.push({
        nombre: nombre,
        fila: i + 1,
        alquilerBase: alquilerBase,
        alquilerConAjuste: alquilerConAjusteNum,
        diferencia: diferencia,
        porcentaje: alquilerBase !== 0 ? ((diferencia / alquilerBase) * 100).toFixed(2) : 0
      });
      totalDiferenciaAjustes += diferencia;
    } else {
      sinAjuste.push({
        nombre: nombre,
        fila: i + 1,
        alquilerBase: alquilerBase
      });
    }
  }

  // Construir el reporte
  var porcentajeConAjuste = totalInquilinos > 0 ? ((conAjuste.length / totalInquilinos) * 100).toFixed(2) : 0;
  var porcentajeSinAjuste = totalInquilinos > 0 ? ((sinAjuste.length / totalInquilinos) * 100).toFixed(2) : 0;

  var reporte = "═══════════════════════════════════════\n";
  reporte += "REPORTE DE AJUSTES - " + nombreHojaPrincipal + "\n";
  reporte += "═══════════════════════════════════════\n\n";

  reporte += "RESUMEN GENERAL:\n";
  reporte += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
  reporte += "Total de inquilinos: " + totalInquilinos + "\n";
  reporte += "Con ajustes pendientes: " + conAjuste.length + " (" + porcentajeConAjuste + "%)\n";
  reporte += "Sin ajustes: " + sinAjuste.length + " (" + porcentajeSinAjuste + "%)\n";
  reporte += "Total diferencia ajustes: $" + totalDiferenciaAjustes.toFixed(2) + "\n\n";

  if (conAjuste.length > 0) {
    reporte += "INQUILINOS CON AJUSTES PENDIENTES:\n";
    reporte += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    for (var j = 0; j < conAjuste.length; j++) {
      var item = conAjuste[j];
      reporte += (j + 1) + ". " + item.nombre + " (Fila " + item.fila + ")\n";
      reporte += "   Alquiler base: $" + item.alquilerBase.toFixed(2) + "\n";
      reporte += "   Alquiler ajustado: $" + item.alquilerConAjuste.toFixed(2) + "\n";
      reporte += "   Diferencia: $" + item.diferencia.toFixed(2) + " (" + item.porcentaje + "%)\n\n";
    }
  }

  if (sinAjuste.length > 0) {
    reporte += "\nINQUILINOS SIN AJUSTES:\n";
    reporte += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    for (var k = 0; k < sinAjuste.length; k++) {
      var item2 = sinAjuste[k];
      reporte += (k + 1) + ". " + item2.nombre + " (Fila " + item2.fila + ")\n";
      reporte += "   Alquiler base: $" + item2.alquilerBase.toFixed(2) + "\n\n";
    }
  }

  reporte += "═══════════════════════════════════════\n";
  reporte += "NOTA: Este reporte NO confirma los ajustes.\n";
  reporte += "Para confirmar, usa 'Confirmar Ajustes'.\n";
  reporte += "═══════════════════════════════════════\n";

  // Si no hay ajustes pendientes, mostrar mensaje y salir
  if (conAjuste.length === 0) {
    ui.alert(
      "Sin Ajustes Pendientes",
      "No hay inquilinos con ajustes pendientes en " + nombreHojaPrincipal + ".",
      ui.ButtonSet.OK
    );
    return;
  }

  // Obtener mes siguiente (los ajustes son para el próximo mes)
  var fechaActual = new Date();
  var nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  // Calcular mes siguiente
  var mesSiguienteNum = (fechaActual.getMonth() + 1) % 12;
  var anioSiguiente = fechaActual.getFullYear() + (fechaActual.getMonth() === 11 ? 1 : 0);
  var mesSiguiente = nombresMeses[mesSiguienteNum];

  var nombreDocumento = "Reporte de Ajustes - " + nombreHojaPrincipal + " - Para " + mesSiguiente;

  // Crear nuevo Spreadsheet
  var nuevoSpreadsheet = SpreadsheetApp.create(nombreDocumento);
  var hojaReporte = nuevoSpreadsheet.getActiveSheet();
  hojaReporte.setName("Ajustes " + mesSiguiente);

  // ENCABEZADO
  hojaReporte.getRange(1, 1).setValue("REPORTE DE AJUSTES - " + nombreHojaPrincipal.toUpperCase());
  hojaReporte.getRange(1, 1).setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center");
  hojaReporte.getRange(1, 1, 1, 6).merge();

  hojaReporte.getRange(2, 1).setValue("Para el mes de: " + mesSiguiente + " " + anioSiguiente);
  hojaReporte.getRange(2, 1).setFontWeight("bold").setHorizontalAlignment("center");
  hojaReporte.getRange(2, 1, 1, 6).merge();

  hojaReporte.getRange(3, 1).setValue("Fecha de generación: " + Utilities.formatDate(fechaActual, "GMT-3", "dd/MM/yyyy HH:mm"));
  hojaReporte.getRange(3, 1).setFontStyle("italic").setHorizontalAlignment("center");
  hojaReporte.getRange(3, 1, 1, 6).merge();

  // RESUMEN
  hojaReporte.getRange(5, 1).setValue("RESUMEN GENERAL");
  hojaReporte.getRange(5, 1).setFontWeight("bold").setFontSize(12);
  hojaReporte.getRange(5, 1, 1, 6).merge();

  hojaReporte.getRange(6, 1).setValue("Total de inquilinos:");
  hojaReporte.getRange(6, 2).setValue(totalInquilinos);
  hojaReporte.getRange(7, 1).setValue("Con ajustes pendientes:");
  hojaReporte.getRange(7, 2).setValue(conAjuste.length + " (" + porcentajeConAjuste + "%)");
  hojaReporte.getRange(8, 1).setValue("Sin ajustes:");
  hojaReporte.getRange(8, 2).setValue(sinAjuste.length + " (" + porcentajeSinAjuste + "%)");
  hojaReporte.getRange(9, 1).setValue("Total diferencia ajustes:");
  hojaReporte.getRange(9, 2).setValue("$" + totalDiferenciaAjustes.toFixed(2));

  // Aplicar formato al resumen
  hojaReporte.getRange(6, 1, 4, 1).setFontWeight("bold");
  hojaReporte.getRange(6, 2, 4, 1).setHorizontalAlignment("right");

  // TABLA DE AJUSTES
  var filaInicio = 11;
  hojaReporte.getRange(filaInicio, 1).setValue("INQUILINOS CON AJUSTES PENDIENTES");
  hojaReporte.getRange(filaInicio, 1).setFontWeight("bold").setFontSize(12);
  hojaReporte.getRange(filaInicio, 1, 1, 6).merge();

  // Encabezados de la tabla
  var filaEncabezados = filaInicio + 1;
  hojaReporte.getRange(filaEncabezados, 1, 1, 6).setValues([[
    "Propiedad", "Fila", "Alquiler Base", "Alquiler Ajustado", "Diferencia", "% Cambio"
  ]]);
  hojaReporte.getRange(filaEncabezados, 1, 1, 6)
    .setFontWeight("bold")
    .setBackground("#4CAF50")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  // Datos de la tabla
  var filaDatos = filaEncabezados + 1;
  for (var j = 0; j < conAjuste.length; j++) {
    var item = conAjuste[j];
    hojaReporte.getRange(filaDatos + j, 1, 1, 6).setValues([[
      item.nombre,
      item.fila,
      item.alquilerBase,
      item.alquilerConAjuste,
      item.diferencia,
      item.porcentaje + "%"
    ]]);
  }

  // Aplicar formato a los datos
  var rangoDatos = hojaReporte.getRange(filaDatos, 1, conAjuste.length, 6);
  rangoDatos.setBorder(true, true, true, true, true, true);

  // Formato de moneda para las columnas de alquiler y diferencia
  hojaReporte.getRange(filaDatos, 3, conAjuste.length, 1).setNumberFormat("$#,##0.00");
  hojaReporte.getRange(filaDatos, 4, conAjuste.length, 1).setNumberFormat("$#,##0.00");
  hojaReporte.getRange(filaDatos, 5, conAjuste.length, 1).setNumberFormat("$#,##0.00");

  // Centrar columnas numéricas
  hojaReporte.getRange(filaDatos, 2, conAjuste.length, 1).setHorizontalAlignment("center");
  hojaReporte.getRange(filaDatos, 6, conAjuste.length, 1).setHorizontalAlignment("center");

  // Alternar colores de filas
  for (var k = 0; k < conAjuste.length; k++) {
    if (k % 2 === 0) {
      hojaReporte.getRange(filaDatos + k, 1, 1, 6).setBackground("#f2f2f2");
    }
  }

  // NOTA FINAL
  var filaNota = filaDatos + conAjuste.length + 2;
  hojaReporte.getRange(filaNota, 1).setValue("IMPORTANTE");
  hojaReporte.getRange(filaNota, 1).setFontWeight("bold").setFontSize(11).setFontColor("#c0392b");
  hojaReporte.getRange(filaNota, 1, 1, 6).merge();

  hojaReporte.getRange(filaNota + 1, 1).setValue("Este reporte NO confirma los ajustes. Para confirmar los ajustes, utiliza la opción 'Confirmar Ajustes' del menú.");
  hojaReporte.getRange(filaNota + 1, 1).setFontStyle("italic");
  hojaReporte.getRange(filaNota + 1, 1, 1, 6).merge();

  // Ajustar ancho de columnas
  hojaReporte.setColumnWidth(1, 300); // Propiedad
  hojaReporte.setColumnWidth(2, 60);  // Fila
  hojaReporte.setColumnWidth(3, 120); // Alquiler Base
  hojaReporte.setColumnWidth(4, 140); // Alquiler Ajustado
  hojaReporte.setColumnWidth(5, 110); // Diferencia
  hojaReporte.setColumnWidth(6, 100); // % Cambio

  // Congelar primera fila de la tabla
  hojaReporte.setFrozenRows(filaEncabezados);

  // Guardar cambios (los Spreadsheets se guardan automáticamente, solo forzamos el flush)
  SpreadsheetApp.flush();

  // Mover a carpeta de reportes
  var archivo = DriveApp.getFileById(nuevoSpreadsheet.getId());
  var carpetaReportes = obtenerOCrearCarpetaReportesAjustes();
  archivo.moveTo(carpetaReportes);

  var urlDocumento = nuevoSpreadsheet.getUrl();

  // Mostrar mensaje de éxito con el link
  ui.alert(
    "Reporte Generado",
    "El reporte de ajustes se generó exitosamente.\n\n" +
    "Con ajustes pendientes: " + conAjuste.length + " inquilino(s)\n" +
    "Total diferencia ajustes: $" + totalDiferenciaAjustes.toFixed(2) + "\n\n" +
    "Archivo Excel creado:\n" + nombreDocumento + "\n\n" +
    "URL: " + urlDocumento,
    ui.ButtonSet.OK
  );

  return urlDocumento;
}

// ============================================
// DIAGNÓSTICO: Verificar celdas con errores
// ============================================
function diagnosticarCeldasConErrores() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  
  var respuesta = ui.prompt(
    "Diagnóstico de Celdas",
    "Ingresa el número de fila a diagnosticar:",
    ui.ButtonSet.OK_CANCEL
  );
  
  if (respuesta.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  
  var fila = parseInt(respuesta.getResponseText());
  if (isNaN(fila) || fila < 2) {
    ui.alert("Error", "Número de fila inválido", ui.ButtonSet.OK);
    return;
  }
  
  var COL = obtenerColumnasHoja(hoja.getName());
  
  var mensaje = "DIAGNÓSTICO DE FILA " + fila + "\n\n";
  
  // Verificar cada celda problemática
  var celdas = [
    {nombre: "ABONO", col: COL.COL_ABONO},
    {nombre: "SOBRA", col: COL.COL_SOBRA},
    {nombre: "DEBE", col: COL.COL_DEUDA},
    {nombre: "CANCELÓ", col: COL.COL_CANCELO},
    {nombre: "TOTAL", col: COL.COL_TOTAL},
    {nombre: "PUNITORIOS", col: COL.COL_PUNITORIOS}
  ];
  
  for (var i = 0; i < celdas.length; i++) {
    var celda = hoja.getRange(fila, celdas[i].col);
    var valor = celda.getValue();
    var formula = celda.getFormula();
    var tipo = typeof valor;
    
    mensaje += "━━━ " + celdas[i].nombre + " (Col " + columnToLetter(celdas[i].col) + ") ━━━\n";
    mensaje += "Valor: " + valor + "\n";
    mensaje += "Tipo: " + tipo + "\n";
    mensaje += "Fórmula: " + (formula || "(sin fórmula)") + "\n";
    mensaje += "\n";
  }
  
  ui.alert("Diagnóstico Completo", mensaje, ui.ButtonSet.OK);
}

// ============================================
// PRUEBA: Validar cálculo de punitorios de deudas
// ============================================
function probarCalculoPunitoriosDeuda() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  
  // Verificar que sea una hoja de deudas
  var nombreHoja = hoja.getName();
  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 || 
                      nombreHoja.indexOf("Matienzo Deudas ") === 0 || 
                      nombreHoja.indexOf("Local Deudas ") === 0);
  
  if (!esHojaDeudas) {
    ui.alert("Error", "Esta función solo funciona en hojas de DEUDAS", ui.ButtonSet.OK);
    return;
  }
  
  var respuesta = ui.prompt(
    "Probar Cálculo de Punitorios de Deuda",
    "Ingresa el número de fila a probar:",
    ui.ButtonSet.OK_CANCEL
  );
  
  if (respuesta.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  
  var fila = parseInt(respuesta.getResponseText());
  if (isNaN(fila) || fila < 2) {
    ui.alert("Error", "Número de fila inválido", ui.ButtonSet.OK);
    return;
  }
  
  var COL = obtenerColumnasHoja(nombreHoja);
  
  // Obtener datos
  var propiedad = ((hoja.getRange(fila, 1).getValue() || "") + " " + 
                   (hoja.getRange(fila, 2).getValue() || "")).trim();
  var alquilerBase = hoja.getRange(fila, COL.COL_ALQUILER_BASE).getValue() || 0;
  var abono = hoja.getRange(fila, COL.COL_ABONO).getValue() || 0;
  var debe = hoja.getRange(fila, COL.COL_DEUDA).getValue() || 0;
  var fechaPago = hoja.getRange(fila, COL.COL_FECHA_PAGO).getValue();
  
  // Calcular punitorios
  var punitorios = CALCULAR_PUNITORIOS_DEUDA(fila);
  
  // Determinar caso
  var caso = (abono === 0 || !fechaPago) ? "CASO 3: Sin pagos" : "CASO 4: Con pago parcial";
  
  var mensaje = "PRUEBA DE PUNITORIOS - " + propiedad + "\n\n";
  mensaje += "Hoja: " + nombreHoja + "\n";
  mensaje += "Fila: " + fila + "\n\n";
  mensaje += "━━━ DATOS ━━━\n";
  mensaje += "Alquiler base: $" + alquilerBase.toLocaleString('es-AR') + "\n";
  mensaje += "Abonó: $" + abono.toLocaleString('es-AR') + "\n";
  mensaje += "Debe: $" + debe.toLocaleString('es-AR') + "\n";
  mensaje += "Fecha pago: " + (fechaPago || "Sin pago") + "\n\n";
  mensaje += "━━━ RESULTADO ━━━\n";
  mensaje += caso + "\n";
  mensaje += "Punitorios calculados: $" + punitorios.toLocaleString('es-AR', {minimumFractionDigits: 2}) + "\n\n";
  mensaje += "Revisa el Log (Ver > Registros) para más detalles del cálculo.";
  
  ui.alert("Resultado de la Prueba", mensaje, ui.ButtonSet.OK);
}

// ============================================
// PRUEBA DIRECTA: Ejecutar desde el editor
// ============================================
function pruebaDirectaPunitoriosDeuda() {
  // Selecciona manualmente la hoja y la fila que quieres probar
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName("Deudas Diciembre 2025"); // CAMBIAR ESTE NOMBRE
  
  if (!hoja) {
    Logger.log("ERROR: No se encontró la hoja. Verifica el nombre.");
    return;
  }
  
  var fila = 2; // CAMBIAR ESTE NÚMERO DE FILA
  
  Logger.log("========================================");
  Logger.log("PRUEBA DIRECTA - PUNITORIOS DE DEUDA");
  Logger.log("========================================");
  Logger.log("Hoja: " + hoja.getName());
  Logger.log("Fila: " + fila);
  Logger.log("");
  
  // Llamar a la función
  var resultado = CALCULAR_PUNITORIOS_DEUDA(fila);
  
  Logger.log("");
  Logger.log("========================================");
  Logger.log("RESULTADO FINAL: $" + resultado.toLocaleString('es-AR', {minimumFractionDigits: 2}));
  Logger.log("========================================");
}

// ============================================
// REPARAR: Limpiar todas las fórmulas problemáticas
// ============================================
function repararFormulasProblematicas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  var respuesta = ui.alert(
    "Reparar Fórmulas",
    "¿Deseas reparar todas las celdas de ABONO, SOBRA, DEBE y CANCELÓ?\n\n" +
    "Esto convertirá todas las fórmulas en valores puros.\n\n" +
    "IMPORTANTE: Ejecuta esto en cada hoja (VARIOS, Matienzo, Local) por separado.",
    ui.ButtonSet.YES_NO
  );
  
  if (respuesta !== ui.Button.YES) {
    return;
  }
  
  var hoja = ss.getActiveSheet();
  var COL = obtenerColumnasHoja(hoja.getName());
  var datos = hoja.getDataRange().getValues();
  var reparados = 0;
  
  for (var i = 1; i < datos.length; i++) {
    var fila = i + 1;
    var nombre = ((datos[i][0] || "") + " " + (datos[i][1] || "")).trim();
    if (nombre === "") continue;
    
    // Limpiar y establecer valores puros
    var celdaAbono = hoja.getRange(fila, COL.COL_ABONO);
    var valorAbono = celdaAbono.getValue();
    if (celdaAbono.getFormula()) {
      celdaAbono.clearContent();
      celdaAbono.setValue(valorAbono || 0);
    }
    
    var celdaSobra = hoja.getRange(fila, COL.COL_SOBRA);
    var valorSobra = celdaSobra.getValue();
    if (celdaSobra.getFormula()) {
      celdaSobra.clearContent();
      celdaSobra.setValue(valorSobra || 0);
    }
    
    var celdaDeuda = hoja.getRange(fila, COL.COL_DEUDA);
    var valorDeuda = celdaDeuda.getValue();
    if (celdaDeuda.getFormula() || valorDeuda === "#¡NÚM!" || isNaN(valorDeuda)) {
      celdaDeuda.clearContent();
      celdaDeuda.setValue(0);
    }
    
    var celdaCancelo = hoja.getRange(fila, COL.COL_CANCELO);
    var valorCancelo = celdaCancelo.getValue();
    if (celdaCancelo.getFormula()) {
      celdaCancelo.clearContent();
      celdaCancelo.setValue(valorCancelo || "NO");
    }
    
    reparados++;
  }
  
  ui.alert(
    "Reparación Completa",
    "Se repararon " + reparados + " filas en la hoja: " + hoja.getName(),
    ui.ButtonSet.OK
  );
}

/**
 * Obtiene las últimas fechas de pago para MÚLTIPLES propiedades en UNA SOLA pasada
 * FILTRO: Solo trae pagos NORMALES (NO pagos de deudas)
 * Esto es MUCHO más rápido que llamar obtenerUltimaFechaPagoDeuda() 43 veces
 * 
 * @param {Array<string>} nombresDeudas - Array de nombres de propiedades
 * @return {Object} - Objeto con {nombrePropiedad: ultimaFecha}
 */
function obtenerUltimasFechasPagoEnLote(nombresDeudas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var historial = ss.getSheetByName("Historial de Pagos");
  
  if (!historial || !nombresDeudas || nombresDeudas.length === 0) {
    return {};
  }
  
  Logger.log("=== OBTENER FECHAS EN LOTE (SOLO PAGOS NO-DEUDA) ===");
  Logger.log("Total propiedades a buscar: " + nombresDeudas.length);
  
  var datos = historial.getDataRange().getValues();
  var resultado = {};
  
  // Inicializar resultado con todas las propiedades
  nombresDeudas.forEach(function(nombre) {
    resultado[nombre] = null;
  });
  
  // Preparar claves de búsqueda (optimización)
  var clavesDeudas = {};
  nombresDeudas.forEach(function(nombre) {
    var limpia = nombre.replace(/\s+/g, ' ').trim().toLowerCase();
    var clave = limpia.split('-')[0].trim().substring(0, 20);
    clavesDeudas[nombre] = {
      original: limpia,
      clave: clave
    };
  });
  
  // Una sola pasada por el historial (de más reciente a más antiguo)
  // Solo revisar últimos 200 registros para mejor rendimiento
  var inicioIndex = Math.max(1, datos.length - 200);
  
  for (var i = datos.length - 1; i >= inicioIndex; i--) {
    var propiedadHistorial = (datos[i][1] + "").trim();
    var fechaPago = datos[i][18]; // Columna S: Fecha de Pago
    var observaciones = (datos[i][23] + "").toLowerCase(); // Columna X: Observaciones
    
    if (!fechaPago) continue;
    
    // ===== FILTRO CRÍTICO =====
    // SOLO tomar pagos que NO sean de deudas
    // Las deudas tienen "Pago de deuda - " en Observaciones
    if (observaciones.indexOf("pago de deuda") !== -1) {
      continue; // ← SALTAR este registro, es pago de deuda
    }
    
    var propHistLimpia = propiedadHistorial.replace(/\s+/g, ' ').trim().toLowerCase();
    var claveHist = propHistLimpia.split('-')[0].trim().substring(0, 20);
    
    // Comparar con TODAS las deudas que aún no tienen fecha
    for (var nombreDeuda in clavesDeudas) {
      if (resultado[nombreDeuda] !== null) continue; // Ya encontramos fecha para esta
      
      var info = clavesDeudas[nombreDeuda];
      
      // Verificar coincidencia
      if (info.clave.indexOf(claveHist) !== -1 || 
          claveHist.indexOf(info.clave) !== -1 || 
          info.original.indexOf(claveHist) !== -1 || 
          propHistLimpia.indexOf(info.clave) !== -1) {
        
        // CRÍTICO: Convertir fecha a string ISO para serialización
        var fechaObj = fechaPago instanceof Date ? fechaPago : parsearFechaLocal(fechaPago);
        resultado[nombreDeuda] = fechaObj.toISOString();
        Logger.log("✓ Fecha (NO-deuda) encontrada para: " + nombreDeuda + " = " + resultado[nombreDeuda]);
      }
    }
  }
  
  Logger.log("Total fechas encontradas: " + Object.keys(resultado).filter(function(k) { return resultado[k] !== null; }).length);
  
  return resultado;
}

// ============================================
// FUNCIONES DE REPORTE
// ============================================
function mostrarFormularioReporte(nombreHojaPrincipal) {
  if (!nombreHojaPrincipal) nombreHojaPrincipal = "VARIOS Control Mensual";
  
  var html = HtmlService.createTemplateFromFile("formularioReporte");
  html.hojaPrincipal = nombreHojaPrincipal;
  var evaluatedHtml = html.evaluate().setWidth(600).setHeight(500);
  
  SpreadsheetApp.getUi().showModalDialog(evaluatedHtml, "Generar Reporte - " + nombreHojaPrincipal);
}

function generarReporteGrupo(formulario) {
  var valorPropiedad = formulario.propiedad;
  var partes = valorPropiedad.split("|");

  // Formato: "GRUPO|nombreGrupo|hoja1:fila1,hoja2:fila2,..."
  if (partes[0] !== "GRUPO") {
    throw new Error("Formato de grupo inválido");
  }

  var nombreGrupo = partes[1];
  var idsStr = partes[2];
  var ids = idsStr.split(",");

  var fechaPago = new Date(formulario.fechaPago);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Recopilar datos de todas las propiedades del grupo
  var propiedadesGrupo = [];
  var totalGeneral = 0;
  var totalHonorarios = 0;

  ids.forEach(function(id) {
    var partesId = id.split(":");
    var nombreHoja = partesId[0];
    var fila = parseInt(partesId[1]);

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

    var totalPropiedad = alquilerBase + iva + impuestos + gastosComunes + rentas + muni - descuentos + expensas + seguro + agua - aFavor + punitoriosCalculados;
    var honorarios = alquilerBase * 0.08;

    totalGeneral += totalPropiedad;
    totalHonorarios += honorarios;

    propiedadesGrupo.push({
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
      total: totalPropiedad,
      honorarios: honorarios,
      esLocal: esLocal
    });
  });

  var urlDocumento = crearDocumentoReporteGrupoMejorado({
    nombreGrupo: nombreGrupo,
    propiedades: propiedadesGrupo,
    totalGeneral: totalGeneral,
    totalHonorarios: totalHonorarios,
    fechaPago: fechaPago
  });

  return urlDocumento;
}

// ============================================
// FUNCIONES MEJORADAS DE GENERACIÓN DE REPORTES
// ============================================

/**
 * Genera reporte individual con mejoras:
 * 1. Detección automática de PROVIDUS
 * 2. % de honorarios configurable
 * 3. Historial de pagos detallado
 */
function generarReporteConFechaMejorado(formulario) {
  var partes = formulario.propiedad.split("|");
  var nombreHoja = partes[0];
  var fila = parseInt(partes[1]);
  var fechaPago = new Date(formulario.fechaPago);
  var porcentajeHonorarios = parseFloat(formulario.porcentajeHonorarios) || 8;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  var esDeuda = (nombreHoja.indexOf("Deudas ") === 0 || nombreHoja.indexOf("Matienzo Deudas ") === 0 || nombreHoja.indexOf("Local Deudas ") === 0);
  var COL = obtenerColumnasHoja(nombreHoja);
  var esLocal = (nombreHoja === "Local" || nombreHoja.indexOf("Local Deudas") === 0);

  var numCols = esLocal ? 29 : 30;
  var datos = hoja.getRange(fila, 1, 1, numCols).getValues()[0];
  
  // ===== CORRECCIÓN 1: Obtener columnas correctamente =====
  var columna1 = datos[0] || "";  // Columna A (índice 0)
  var columna2 = datos[1] || "";  // Columna B (índice 1)
  var inquilino = datos[2] || ""; // Columna C (índice 2)
  
  var propiedad = (columna1 + " " + columna2).trim();
  var mes = datos[6] || "Mes actual";
  var fechaVencimiento = datos[7] || 10;
  
  // ===== CORRECCIÓN 2: Detectar PROVIDUS en COLUMNA 1 O COLUMNA 2 =====
  var textoCompleto = (columna1 + " " + columna2 + " " + inquilino).toLowerCase();
  var esProvidus = textoCompleto.indexOf('providus') !== -1;
  
  Logger.log("=== GENERANDO REPORTE MEJORADO ===");
  Logger.log("Columna 1: " + columna1);
  Logger.log("Columna 2: " + columna2);
  Logger.log("Inquilino: " + inquilino);
  Logger.log("Texto completo: " + textoCompleto);
  Logger.log("¿Es PROVIDUS?: " + esProvidus);
  Logger.log("% Honorarios: " + porcentajeHonorarios + "%");
  
  // ===== CORRECCIÓN 3: Función auxiliar para convertir valores =====
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
  
  // ===== CORRECCIÓN 4: Leer TODOS los valores con toNumber =====
  var alquilerBase = toNumber(datos[COL.COL_ALQUILER_BASE - 1]);
  var iva = toNumber(datos[COL.COL_IVA - 1]);
  var impuestos = esLocal ? 0 : toNumber(datos[COL.COL_IMPUESTOS - 1]);
  var gastosComunes = esLocal ? 0 : toNumber(datos[COL.COL_GASTOS_COMUNES - 1]);
  var rentas = toNumber(datos[COL.COL_RENTAS - 1]);
  var muni = toNumber(datos[COL.COL_MUNI - 1]);
  var descuentos = toNumber(datos[COL.COL_DESCUENTOS - 1]);
  var expensas = toNumber(datos[COL.COL_EXPENSAS - 1]);
  var seguro = esLocal ? toNumber(datos[COL.COL_SEGURO - 1]) : 0;
  var agua = toNumber(datos[COL.COL_AGUA - 1]);
  var aFavor = toNumber(datos[COL.COL_A_FAVOR - 1]);
  
  Logger.log("Alquiler Base (leído): " + alquilerBase);
  Logger.log("IVA: " + iva);
  Logger.log("Impuestos: " + impuestos);
  Logger.log("Gastos Comunes: " + gastosComunes);
  
  // Calcular punitorios
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
  
  Logger.log("Punitorios calculados: " + punitoriosCalculados);
  
  // ===== CORRECCIÓN 5: Calcular total correctamente =====
  var total = alquilerBase + iva + impuestos + gastosComunes + rentas + muni - descuentos + expensas + seguro + agua - aFavor + punitoriosCalculados;
  
  Logger.log("Total calculado: " + total);
  Logger.log("  = " + alquilerBase + " (alquiler) + " + iva + " (iva) + " + impuestos + " (impuestos) + " + 
             gastosComunes + " (gc) + " + rentas + " (rentas) + " + muni + " (muni) - " + 
             descuentos + " (desc) + " + expensas + " (exp) + " + seguro + " (seg) + " + 
             agua + " (agua) - " + aFavor + " (afavor) + " + punitoriosCalculados + " (punit)");
  
  // ===== MEJORA 3: OBTENER HISTORIAL DE PAGOS =====
  var historialPagos = obtenerHistorialPagosPropiedad(propiedad, inquilino, nombreHoja, mes);
  
  Logger.log("Historial de pagos encontrado:");
  Logger.log(JSON.stringify(historialPagos));
  
  var urlDocumento = crearDocumentoReportePersonalizadoMejorado({
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
    esLocal: esLocal,
    esProvidus: esProvidus,
    porcentajeHonorarios: porcentajeHonorarios,
    historialPagos: historialPagos
  });
  
  return urlDocumento;
}

/**
 * Obtiene el historial de pagos de una propiedad específica
 * del "Historial de Pagos" para mostrar cada pago realizado
 * SOLO DEL MES Y AÑO CORRESPONDIENTE AL REPORTE
 * VERSIÓN MEJORADA: Muestra pagos NETOS (no acumulados)
 */
function obtenerHistorialPagosPropiedad(nombrePropiedad, inquilino, nombreHoja, mesReporte) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var historial = ss.getSheetByName("Historial de Pagos");
  
  if (!historial) {
    Logger.log("No existe hoja 'Historial de Pagos'");
    return [];
  }
  
  var datos = historial.getDataRange().getValues();
  var pagosEncontrados = [];
  
  // Determinar si es una hoja de deudas para filtrar correctamente
  var esHojaDeudas = (nombreHoja.indexOf("Deudas ") === 0 || 
                      nombreHoja.indexOf("Matienzo Deudas ") === 0 || 
                      nombreHoja.indexOf("Local Deudas ") === 0);
  
  var mesDeudaBuscado = "";
  var mesAnioFiltro = null;
  
  if (esHojaDeudas) {
    // Extraer "Enero 2024" del nombre "Deudas Enero 2024"
    mesDeudaBuscado = nombreHoja.replace("Deudas ", "")
                                 .replace("Matienzo Deudas ", "")
                                 .replace("Local Deudas ", "")
                                 .trim()
                                 .toLowerCase();
    Logger.log("Buscando pagos de deuda: " + mesDeudaBuscado);
  } else {
    // Para hojas NORMALES: extraer mes y año del reporte
    if (mesReporte) {
      var nombresMeses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", 
                          "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
      
      var mesTexto = mesReporte.toLowerCase().split('-')[0].trim();
      var mesNumero = nombresMeses.indexOf(mesTexto);
      
      if (mesNumero !== -1) {
        // Calcular el año basándose en la fecha actual
        var hoy = new Date();
        var anioActual = hoy.getFullYear();
        
        // Si el mes del reporte es mayor al mes actual, es del año pasado
        if (mesNumero > hoy.getMonth()) {
          anioActual = anioActual - 1;
        }
        
        mesAnioFiltro = {
          mes: mesNumero,
          anio: anioActual
        };
        
        Logger.log("Filtrando pagos del mes: " + mesTexto + " " + anioActual);
      }
    }
  }
  
  // Preparar claves de búsqueda
  var propiedadLimpia = nombrePropiedad.replace(/\s+/g, ' ').trim().toLowerCase();
  var claveBusqueda = propiedadLimpia.split('-')[0].trim().substring(0, 30);
  
  Logger.log("Buscando en historial:");
  Logger.log("  Propiedad clave: " + claveBusqueda);
  Logger.log("  Inquilino: " + inquilino);
  Logger.log("  Es hoja de deudas: " + esHojaDeudas);
  Logger.log("  Filtro mes/año: " + (mesAnioFiltro ? (mesAnioFiltro.mes + "/" + mesAnioFiltro.anio) : "ninguno"));
  
  // Recorrer el historial (índices de columnas según registrarEnHistorial)
  for (var i = 1; i < datos.length; i++) {
    var propiedadHist = (datos[i][1] + "").trim(); // Columna B: Propiedad
    var inquilinoHist = (datos[i][2] + "").trim(); // Columna C: Inquilino
    var fechaPago = datos[i][18];                   // Columna S: Fecha Pago
    var abono = datos[i][19] || 0;                  // Columna T: Abono
    var observaciones = (datos[i][23] + "").toLowerCase(); // Columna X: Observaciones
    
    // Comparación flexible de propiedad
    var propHistLimpia = propiedadHist.replace(/\s+/g, ' ').trim().toLowerCase();
    var claveHist = propHistLimpia.split('-')[0].trim().substring(0, 30);
    
    var coincidePropiedad = (claveBusqueda.indexOf(claveHist) !== -1 || 
                             claveHist.indexOf(claveBusqueda) !== -1 || 
                             propiedadLimpia.indexOf(claveHist) !== -1 || 
                             propHistLimpia.indexOf(claveBusqueda) !== -1);
    
    if (!coincidePropiedad) continue;
    
    // Si es hoja de DEUDAS, filtrar solo pagos de esa deuda específica
    if (esHojaDeudas) {
      if (observaciones.indexOf("pago de deuda") === -1) {
        continue; // NO es pago de deuda, saltar
      }
      
      if (observaciones.indexOf(mesDeudaBuscado) === -1) {
        continue; // Es de otra deuda, saltar
      }
      
      Logger.log("  ✓ Pago de deuda encontrado: " + fechaPago + " → $" + abono);
    } else {
      // Para hojas NORMALES, solo tomar pagos que NO sean de deudas
      if (observaciones.indexOf("pago de deuda") !== -1) {
        continue; // Es pago de deuda, saltar
      }
      
      // Filtrar por mes y año
      if (mesAnioFiltro && fechaPago) {
        var fechaPagoObj = fechaPago instanceof Date ? fechaPago : new Date(fechaPago);
        var mesPago = fechaPagoObj.getMonth();
        var anioPago = fechaPagoObj.getFullYear();
        
        // Solo incluir si coincide mes Y año
        if (mesPago !== mesAnioFiltro.mes || anioPago !== mesAnioFiltro.anio) {
          Logger.log("  ✗ Pago descartado (mes/año no coincide): " + fechaPagoObj + " → $" + abono);
          continue;
        }
      }
      
      Logger.log("  ✓ Pago normal encontrado: " + fechaPago + " → $" + abono + " (acumulado)");
    }
    
    // Agregar a la lista
    pagosEncontrados.push({
      fecha: fechaPago,
      monto: abono // Este es el monto ACUMULADO
    });
  }
  
  // Ordenar por fecha (más antiguo primero)
  pagosEncontrados.sort(function(a, b) {
    return new Date(a.fecha) - new Date(b.fecha);
  });
  
  // ===== NUEVA LÓGICA: CALCULAR PAGOS NETOS =====
  var pagosNetos = [];
  var montoAnterior = 0;
  
  for (var j = 0; j < pagosEncontrados.length; j++) {
    var pagoActual = pagosEncontrados[j];
    var montoNeto = pagoActual.monto - montoAnterior;
    
    // Solo agregar si el pago neto es mayor a 0
    if (montoNeto > 0) {
      pagosNetos.push({
        fecha: pagoActual.fecha,
        monto: montoNeto
      });
      
      Logger.log("  → Pago neto calculado: " + pagoActual.fecha + " = $" + montoNeto + 
                 " (de $" + pagoActual.monto + " - $" + montoAnterior + ")");
    }
    
    montoAnterior = pagoActual.monto;
  }
  
  Logger.log("Total pagos netos: " + pagosNetos.length);
  
  return pagosNetos;
}

/*
**¿Qué hace esta versión?**

1. **Recolecta los pagos acumulados** del historial (como antes)
2. **Calcula la diferencia** entre cada pago y el anterior
3. **Solo muestra el monto neto** de cada transacción

**Ejemplo con tus datos:**
- Primer pago: $101,429.44 (neto = $101,429.44 - $0)
- Segundo pago: $76,171.46 (neto = $177,600.90 - $101,429.44)

Ahora cuando generes el reporte, verás:

HISTORIAL DE PAGOS REALIZADOS:
  • 03/02/2026  →  $ 101,429.44
  • 11/02/2026  →  $ 76,171.46

*/

/**
 * Crea el documento de reporte con todas las mejoras
 */
/**
 * Crea el documento de reporte con todas las mejoras
 */
function crearDocumentoReportePersonalizadoMejorado(datos) {
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
  
  // Construir detalle de conceptos
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
  
  // ===== MEJORA 2: CALCULAR HONORARIOS CON % VARIABLE =====
  var honorarios = datos.alquiler * (datos.porcentajeHonorarios / 100);
  
  // ===== MEJORA 3: AGREGAR HISTORIAL DE PAGOS =====
  var historialTexto = "";
  if (datos.historialPagos && datos.historialPagos.length > 0) {
    historialTexto = "\n\nHISTORIAL DE PAGOS REALIZADOS:\n";
    datos.historialPagos.forEach(function(pago) {
      var fechaFormateada = Utilities.formatDate(new Date(pago.fecha), "GMT-3", "dd/MM/yyyy");
      historialTexto += "  • " + fechaFormateada + "  →  $ " + formatearNumero(pago.monto) + "\n";
    });
  }
  
  var fecha = Utilities.formatDate(datos.fechaPago, "GMT-3", "dd/MM");
  var totalTexto = numeroATexto(datos.total);
  var honorariosTexto = numeroATexto(honorarios);
  
  var detalleTitulo = datos.esDeuda ? "Deuda " + datos.mes : "Detalle " + datos.mes;
  
  Logger.log("=== DEBUG GENERACIÓN REPORTE ===");
  Logger.log("Total calculado: " + datos.total);
  Logger.log("Total formateado: " + formatearNumero(datos.total));
  Logger.log("Es Providus: " + datos.esProvidus);
  Logger.log("Inquilino: " + datos.inquilino);
  
  // Reemplazos básicos
  body.replaceText("\\{\\{DETALLE\\}\\}", detalleTitulo);
  body.replaceText("\\{\\{DETALLE_CONCEPTOS\\}\\}", detalleConceptos + historialTexto);
  body.replaceText("\\{\\{TOTAL\\}\\}", "$ " + formatearNumero(datos.total));
  body.replaceText("\\{\\{TOTAL_TEXTO\\}\\}", totalTexto);
  body.replaceText("\\{\\{FECHA_DEPOSITO\\}\\}", fecha);
  body.replaceText("\\{\\{HONORARIOS\\}\\}", "$ " + formatearNumero(honorarios) + " (" + datos.porcentajeHonorarios + "%)");
  body.replaceText("\\{\\{HONORARIOS_TEXTO\\}\\}", honorariosTexto);
  body.replaceText("\\{\\{TITULAR\\}\\}", datos.inquilino);
  
  // ===== MEJORA 1: REEMPLAZAR DATOS BANCARIOS SI ES PROVIDUS =====
  if (datos.esProvidus) {
    Logger.log("→ Aplicando cambios para PROVIDUS");
    
    // ESTRATEGIA: Buscar y reemplazar TODO el bloque de datos bancarios
    var textoCompleto = body.getText();
    
    // Buscar "BANCO GALICIA" y reemplazar todo el bloque hasta el final
    var parrafos = body.getParagraphs();
    var dentroBloqueBancario = false;
    
    for (var i = 0; i < parrafos.length; i++) {
      var textoParrafo = parrafos[i].getText();
      
      // Detectar inicio del bloque bancario
      if (textoParrafo.indexOf("BANCO GALICIA") !== -1) {
        parrafos[i].replaceText("BANCO GALICIA", "BANCO COLUMBIA");
        dentroBloqueBancario = true;
        Logger.log("  ✓ Reemplazado BANCO GALICIA → BANCO COLUMBIA");
        continue;
      }
      
      // Si estamos dentro del bloque bancario, hacer los reemplazos
      if (dentroBloqueBancario) {
        // Titular
        if (textoParrafo.indexOf("Maria Lorena Boxer") !== -1 || textoParrafo.indexOf("Titular:") !== -1) {
          parrafos[i].replaceText("Maria Lorena Boxer", "Providus S.A.");
          parrafos[i].replaceText("Titular:.*", "Titular: Providus S.A.");
          Logger.log("  ✓ Reemplazado titular");
        }
        
        // CUIT
        if (textoParrafo.indexOf("27-25429274-0") !== -1 || textoParrafo.indexOf("CUIT:") !== -1) {
          parrafos[i].replaceText("27-25429274-0", "30-67880531-5");
          parrafos[i].replaceText("CUIT:.*", "CUIT: 30-67880531-5");
          Logger.log("  ✓ Reemplazado CUIT");
        }
        
        // Tipo de cuenta
        if (textoParrafo.indexOf("Caja de ahorros") !== -1 || 
            textoParrafo.indexOf("Tipo de cuenta:") !== -1) {
          parrafos[i].replaceText("Caja de ahorros", "Cuenta corriente");
          parrafos[i].replaceText("Tipo de cuenta:.*", "Tipo de cuenta: Cuenta corriente");
          Logger.log("  ✓ Reemplazado tipo de cuenta");
        }
        
        // Número de cuenta
        if (textoParrafo.indexOf("404616110765") !== -1 || 
            textoParrafo.indexOf("N° de Cuenta:") !== -1 ||
            textoParrafo.indexOf("Nº de Cuenta:") !== -1) {
          parrafos[i].replaceText("404616110765", "5202334361");
          parrafos[i].replaceText("N° de Cuenta:.*", "N° de Cuenta: 5202334361");
          parrafos[i].replaceText("Nº de Cuenta:.*", "N° de Cuenta: 5202334361");
          Logger.log("  ✓ Reemplazado N° de cuenta");
        }
        
        // CBU
        if (textoParrafo.indexOf("0070076430004046161155") !== -1 || 
            textoParrafo.indexOf("CBU:") !== -1) {
          parrafos[i].replaceText("0070076430004046161155", "3890004230005202334361");
          parrafos[i].replaceText("CBU:.*", "CBU: 3890004230005202334361");
          Logger.log("  ✓ Reemplazado CBU");
        }
        
        // Si llegamos a la dirección, salir del bloque
        if (textoParrafo.indexOf("9 DE JULIO") !== -1 || 
            textoParrafo.indexOf("CÓRDOBA") !== -1) {
          dentroBloqueBancario = false;
          Logger.log("  → Fin del bloque bancario");
          break;
        }
      }
      
      // También buscar "Importe depositado" y cambiarlo
      if (textoParrafo.indexOf("Importe depositado") !== -1) {
        parrafos[i].replaceText("Importe depositado", "Importe a pagar por transferencia bancaria");
        Logger.log("  ✓ Reemplazado 'Importe depositado'");
      }
    }
  }
  
  doc.saveAndClose();
  
  var carpetaPropiedad = obtenerOCrearCarpetaPropiedad(datos.propiedad);
  copia.moveTo(carpetaPropiedad);
  
  Logger.log("✓ Reporte generado: " + doc.getUrl());
  Logger.log("  Con % honorarios: " + datos.porcentajeHonorarios + "%");
  Logger.log("  PROVIDUS: " + datos.esProvidus);
  Logger.log("  Pagos en historial: " + (datos.historialPagos ? datos.historialPagos.length : 0));
  
  return doc.getUrl();
}

/**
 * Genera reporte de grupo con mejoras
 * (honorarios variables, sin detección de Providus ya que es grupo)
 */
function generarReporteGrupoMejorado(formulario) {
  var valorPropiedad = formulario.propiedad;
  var partes = valorPropiedad.split("|");
  var porcentajeHonorarios = parseFloat(formulario.porcentajeHonorarios) || 8;

  if (partes[0] !== "GRUPO") {
    throw new Error("Formato de grupo inválido");
  }

  var nombreGrupo = partes[1];
  var idsStr = partes[2];
  var ids = idsStr.split(",");

  var fechaPago = new Date(formulario.fechaPago);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var propiedadesGrupo = [];
  var totalGeneral = 0;
  var totalHonorarios = 0;

  ids.forEach(function(id) {
    var partesId = id.split(":");
    var nombreHoja = partesId[0];
    var fila = parseInt(partesId[1]);

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

    var totalPropiedad = alquilerBase + iva + impuestos + gastosComunes + rentas + muni - descuentos + expensas + seguro + agua - aFavor + punitoriosCalculados;
    
    // ===== MEJORA 2: HONORARIOS CON % VARIABLE =====
    var honorarios = alquilerBase * (porcentajeHonorarios / 100);

    totalGeneral += totalPropiedad;
    totalHonorarios += honorarios;

    propiedadesGrupo.push({
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
      total: totalPropiedad,
      honorarios: honorarios,
      esLocal: esLocal
    });
  });

  var urlDocumento = crearDocumentoReporteGrupoMejorado({
    nombreGrupo: nombreGrupo,
    propiedades: propiedadesGrupo,
    totalGeneral: totalGeneral,
    totalHonorarios: totalHonorarios,
    fechaPago: fechaPago,
    porcentajeHonorarios: porcentajeHonorarios
  });

  return urlDocumento;
}

/**
 * Crea documento de reporte de grupo con honorarios variables
 */
function crearDocumentoReporteGrupoMejorado(datos) {
  var plantillas = DriveApp.getFilesByName("Plantilla_VariasPropiedades");
  if (!plantillas.hasNext()) {
    throw new Error("No se encontró la plantilla 'Plantilla_VariasPropiedades' en Drive");
  }
  var plantilla = plantillas.next();

  var tipoReporte = "Reporte Grupo " + datos.nombreGrupo;
  var nombreReporte = datos.nombreGrupo + " Reporte Grupo " + Utilities.formatDate(datos.fechaPago, "GMT-3", "dd-MM-yyyy");

  var copia = plantilla.makeCopy(nombreReporte);
  var doc = DocumentApp.openById(copia.getId());
  var body = doc.getBody();

  var mesReporte = datos.propiedades.length > 0 ? datos.propiedades[0].mes : "Mes actual";
  var listaPropiedades = datos.propiedades.map(function(prop) {
    return prop.propiedad;
  }).join(", ");

  var detalleConceptos = "";

  datos.propiedades.forEach(function(prop) {
    detalleConceptos += prop.propiedad + " - " + prop.inquilino + "\n";
    detalleConceptos += "Alquiler mes de " + prop.mes + "                                                 $ " + formatearNumero(prop.alquiler) + "\n";

    if (prop.iva && prop.iva != 0) {
      detalleConceptos += "IVA                                                                                          $ " + formatearNumero(prop.iva) + "\n";
    }
    if (prop.impuestos && prop.impuestos != 0) {
      detalleConceptos += "Impuestos                                                                              $ " + formatearNumero(prop.impuestos) + "\n";
    }
    if (prop.gastosComunes && prop.gastosComunes != 0) {
      detalleConceptos += "Gastos Comunes                                                                    $ " + formatearNumero(prop.gastosComunes) + "\n";
    }
    if (prop.rentas && prop.rentas != 0) {
      detalleConceptos += "Rentas                                                                                    $ " + formatearNumero(prop.rentas) + "\n";
    }
    if (prop.muni && prop.muni != 0) {
      detalleConceptos += "Municipal                                                                                $ " + formatearNumero(prop.muni) + "\n";
    }
    if (prop.descuentos && prop.descuentos != 0) {
      detalleConceptos += "Descuentos                                                                            $ -" + formatearNumero(prop.descuentos) + "\n";
    }
    if (prop.expensas && prop.expensas != 0) {
      detalleConceptos += "Expensas                                                                               $ " + formatearNumero(prop.expensas) + "\n";
    }
    if (prop.seguro && prop.seguro != 0) {
      detalleConceptos += "Seguro                                                                                    $ " + formatearNumero(prop.seguro) + "\n";
    }
    if (prop.agua && prop.agua != 0) {
      detalleConceptos += "Agua                                                                                        $ " + formatearNumero(prop.agua) + "\n";
    }
    if (prop.aFavor && prop.aFavor != 0) {
      detalleConceptos += "A Favor Mes Anterior                                                              $ -" + formatearNumero(prop.aFavor) + "\n";
    }
    if (prop.punitorios && prop.punitorios != 0) {
      detalleConceptos += "Punitorios                                                                               $ " + formatearNumero(prop.punitorios) + "\n";
    }
    detalleConceptos += "Subtotal                                                                                  $ " + formatearNumero(prop.total) + "\n\n";
  });

  var totalNeto = datos.totalGeneral - datos.totalHonorarios;

  var fecha = Utilities.formatDate(datos.fechaPago, "GMT-3", "dd/MM");
  var totalGeneralTexto = numeroATexto(datos.totalGeneral);
  var totalGastosTexto = numeroATexto(datos.totalHonorarios);
  var totalNetoTexto = numeroATexto(totalNeto);

  body.replaceText("\\{\\{FECHA\\}\\}", fecha);
  body.replaceText("\\{\\{MES\\}\\}", mesReporte);
  body.replaceText("\\{\\{PROPIEDADES\\}\\}", listaPropiedades);
  body.replaceText("\\{\\{DETALLE_PROPIEDADES\\}\\}", detalleConceptos);
  body.replaceText("\\{\\{TOTAL_GENERAL\\}\\}", "$ " + formatearNumero(datos.totalGeneral));
  body.replaceText("\\{\\{TOTAL_GASTOS\\}\\}", "$ " + formatearNumero(datos.totalHonorarios) + " (" + datos.porcentajeHonorarios + "%)");
  body.replaceText("\\{\\{TOTAL_NETO\\}\\}", "$ " + formatearNumero(totalNeto));
  body.replaceText("\\{\\{TOTAL_NETO_TEXTO\\}\\}", totalNetoTexto);

  doc.saveAndClose();

  var carpetaPropiedad = obtenerOCrearCarpetaPropiedad(datos.nombreGrupo);
  copia.moveTo(carpetaPropiedad);

  Logger.log("✓ Reporte de grupo generado: " + doc.getUrl());
  Logger.log("  Con % honorarios: " + datos.porcentajeHonorarios + "%");

  return doc.getUrl();
}

// ============================================
// SISTEMA DE REPORTES DE IMPUESTOS - CORREGIDO
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
  
  // CORRECCIÓN 2: Mover a carpeta de la propiedad dentro de Impuestos
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
 * CORRECCIÓN 1: Obtiene o crea la carpeta "Impuestos" al mismo nivel que la planilla
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
 * CORRECCIÓN 2: Obtiene o crea la carpeta de la propiedad DENTRO de "Impuestos"
 */
function obtenerOCrearCarpetaPropiedadImpuestos(nombrePropiedad) {
  var carpetaImpuestos = obtenerOCrearCarpetaImpuestosPrincipal();
  
  // Buscar o crear carpeta de la propiedad
  var carpetasPropiedad = carpetaImpuestos.getFoldersByName(nombrePropiedad);
  
  if (carpetasPropiedad.hasNext()) {
    return carpetasPropiedad.next();
  } else {
    return carpetaImpuestos.createFolder(nombrePropiedad);
  }
}