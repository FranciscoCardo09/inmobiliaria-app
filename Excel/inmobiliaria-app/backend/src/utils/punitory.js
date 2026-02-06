// Punitory (late fee) calculation utilities

/**
 * Calculate days late for a payment
 * @param {Date} paymentDate - Actual payment date
 * @param {number} punitoryStartDay - Day of month from which punitorios count
 * @returns {number} Days late (0 if on time)
 */
function calculatePunitoryDays(paymentDate, punitoryStartDay) {
  const payDay = paymentDate.getDate();
  const payMonth = paymentDate.getMonth();
  const payYear = paymentDate.getFullYear();

  // The limit date is punitoryStartDay of the same month
  const limitDate = new Date(payYear, payMonth, punitoryStartDay);

  if (paymentDate <= limitDate) {
    return 0;
  }

  // Days late = difference in calendar days
  const diffMs = paymentDate.getTime() - limitDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate punitory amount
 * @param {number} baseRent - Base rent amount
 * @param {number} daysLate - Number of days late
 * @param {number} punitoryPercent - Daily percentage (e.g., 0.006 = 0.6%)
 * @returns {number} Punitory amount
 */
function calculatePunitoryAmount(baseRent, daysLate, punitoryPercent) {
  if (daysLate <= 0) return 0;
  return baseRent * punitoryPercent * daysLate;
}

module.exports = {
  calculatePunitoryDays,
  calculatePunitoryAmount,
};
