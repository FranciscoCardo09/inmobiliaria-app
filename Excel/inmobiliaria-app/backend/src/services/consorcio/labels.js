// Variables de los textos del informe. Los textos se guardan con variables
// para que la misma regla sirva todos los meses:
//   "Honorarios Administración ({mesAnterior})" → "Honorarios Administración (Junio - 26)"
const { ConsorcioError } = require('./errors');

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const VARIABLES = {
  mes: 'Mes de la rendición, ej. "Julio - 26"',
  mesAnterior: 'Mes anterior, ej. "Junio - 26"',
  periodo: 'Mes de la rendición, ej. "07/2026"',
  periodoAnterior: 'Mes anterior, ej. "06/2026"',
};

function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function monthName(month) {
  return MONTHS[month - 1];
}

function values(year, month) {
  const prev = previousMonth(year, month);
  const short = (y) => String(y).slice(-2);
  const mm = (m) => String(m).padStart(2, '0');
  return {
    mes: `${monthName(month)} - ${short(year)}`,
    mesAnterior: `${monthName(prev.month)} - ${short(prev.year)}`,
    periodo: `${mm(month)}/${year}`,
    periodoAnterior: `${mm(prev.month)}/${prev.year}`,
  };
}

function renderLabel(template, year, month) {
  const vals = values(year, month);
  return String(template).replace(/\{(\w+)\}/g, (all, name) => {
    if (!(name in vals)) {
      throw new ConsorcioError('BAD_LABEL_VARIABLE',
        `El texto "${template}" usa {${name}}, que no existe. Variables válidas: ${Object.keys(VARIABLES).map((v) => `{${v}}`).join(', ')}.`);
    }
    return vals[name];
  });
}

// Clave para agrupar líneas: mismo texto ignorando mayúsculas y espacios.
function labelKey(label) {
  return String(label).trim().replace(/\s+/g, ' ').toLowerCase();
}

module.exports = { MONTHS, VARIABLES, previousMonth, monthName, renderLabel, labelKey };
