/**
 * dateUtils - Centralized date operations and calculations
 */
const { MONTH_NAMES } = require('./constants');

/**
 * Parse a local date string (YYYY-MM-DD) as noon UTC
 * to avoid any timezone-related day shift.
 */
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).replace(/T.*/, '').split('-');
  return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0));
};

/**
 * Timezone del negocio (Argentina), única fuente de verdad para "hoy" en
 * cálculos financieros en vivo (A-25, AUDITORIA_FUNCIONAL_2026-07-10.md).
 * El servidor (Render) corre sin TZ configurada (= UTC): entre las 21:00 y
 * las 23:59 ART, `new Date()` ya cae en el día UTC siguiente. Este helper
 * es la corrección MÍNIMA acordada: NO fija TZ global del proceso, NO migra
 * datos históricos, NO cambia las convenciones de escritura de fechas de
 * pago — solo da el día calendario correcto en ART para "hoy".
 */
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Argentina/Buenos_Aires';

/**
 * "Hoy" del negocio como string YYYY-MM-DD en la TZ de la app.
 * `calculatePunitoryV2`/`toLocalDate` (utils/punitory.js) tienen una rama
 * de parseo de STRING que es inmune a la TZ del proceso; pasar el string
 * (no un Date) es lo que elimina el corrimiento de A-25.
 * `now` es inyectable para tests.
 */
const getTodayLocalString = (now = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(now);
};

/**
 * Mismo día que getTodayLocalString, como Date a medianoche LOCAL DEL
 * PROCESO (no de ART) — para los pocos sitios que necesitan un objeto
 * Date en vez de un string. El día calendario ya viene corregido a ART;
 * la hora resultante no importa para esos usos (fallback de "hasta hoy"
 * cuando se usa como límite superior de un rango de fechas).
 */
const getTodayLocalDate = (now = new Date()) => {
  const [y, m, d] = getTodayLocalString(now).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Compute period labed based on startDate, current contract month, and contract start month
 */
const getPeriodLabel = (startDate, currentMonth, startMonth = 1) => {
  const start = new Date(startDate);
  const date = new Date(start);
  date.setMonth(date.getMonth() + currentMonth - startMonth);
  // Re-use MONTH_NAMES (0 index is empty in constants, so we do getMonth() + 1)
  return `${MONTH_NAMES[date.getMonth() + 1]} ${date.getFullYear()}`;
};

/**
 * Calculate the difference in months between two dates.
 */
const calculateMonthsDiff = (startDate, endDate) => {
  return (endDate.getFullYear() - startDate.getFullYear()) * 12 +
         (endDate.getMonth() - startDate.getMonth());
};

/**
 * Calculate dynamically the current month of a contract
 * based on its start date, start month, duration, and the current date.
 */
const calculateCurrentContractMonth = (startDate, startMonth, durationMonths, relativeDate = new Date()) => {
  const start = new Date(startDate);
  const monthsDiff = calculateMonthsDiff(start, relativeDate);
  const sm = startMonth || 1;
  const endMonth = sm + durationMonths - 1;
  
  // Constrain between start month and duration end
  let computedCurrentMonth = Math.max(sm, Math.min(sm + monthsDiff, endMonth));
  
  // Fallback safety cap
  return Math.min(computedCurrentMonth, durationMonths);
};

module.exports = {
  parseLocalDate,
  getPeriodLabel,
  calculateMonthsDiff,
  calculateCurrentContractMonth,
  getTodayLocalString,
  getTodayLocalDate
};
