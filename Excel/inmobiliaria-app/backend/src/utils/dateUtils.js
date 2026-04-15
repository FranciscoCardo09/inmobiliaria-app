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
  calculateCurrentContractMonth
};
