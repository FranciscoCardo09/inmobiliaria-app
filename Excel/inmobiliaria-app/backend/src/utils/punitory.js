// Punitory (late fee) calculation utilities - V2
// Supports business day calculation with holidays

const prisma = require('../lib/prisma');

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a holiday
 * @param {Date} date
 * @param {Date[]} holidays - Array of holiday dates
 */
function isHoliday(date, holidays) {
  const dateStr = date.toISOString().split('T')[0];
  return holidays.some((h) => h.toISOString().split('T')[0] === dateStr);
}

/**
 * Check if a date is a business day (not weekend, not holiday)
 */
function isBusinessDay(date, holidays) {
  return !isWeekend(date) && !isHoliday(date, holidays);
}

/**
 * Get the next business day from a given date
 */
function getNextBusinessDay(date, holidays) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (!isBusinessDay(next, holidays)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Get the effective grace date for a month.
 * The grace day (e.g., day 10) is adjusted if it falls on a non-business day.
 * If day 10 = Saturday → Monday 12
 * If day 10 = Sunday → Monday 11
 * If day 10 = Holiday → next business day
 */
function getEffectiveGraceDate(year, month, graceDayTarget, holidays) {
  // month is 1-12, JS Date month is 0-11
  const graceDate = new Date(year, month - 1, graceDayTarget);

  if (isBusinessDay(graceDate, holidays)) {
    return graceDate;
  }

  // Move to next business day
  return getNextBusinessDay(graceDate, holidays);
}

/**
 * Parse a date value into a local-midnight Date, handling timezone-safe parsing.
 * Strings like "2026-02-09" are parsed as LOCAL date, not UTC.
 */
function toLocalDate(d) {
  if (typeof d === 'string') {
    const parts = d.replace(/T.*/, '').split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  if (d instanceof Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return new Date(d);
}

/**
 * Calculate difference in calendar days between two dates
 */
function diffCalendarDays(dateA, dateB) {
  const a = toLocalDate(dateA);
  const b = toLocalDate(dateB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate punitorios with V2 rules:
 * - If there's a lastPaymentDate (partial payment was made):
 *   Punitorios count from lastPaymentDate to paymentDate (both inclusive)
 * - For PAST months (period month is before payment date month):
 *   Count from day 1 of the period month to the payment date (inclusive)
 * - For CURRENT month:
 *   Pay by business grace day → $0
 *   Pay after business grace day → count from startDay to payment date
 * - punitorios = baseRent * punitoryPercent * days
 *
 * @param {Date} paymentDate - Actual payment date (or today for preview)
 * @param {number} periodMonth - Period month (1-12)
 * @param {number} periodYear - Period year
 * @param {number} baseRent - Amount on which punitorios are calculated (can be unpaid rent)
 * @param {number} punitoryStartDay - Day from which punitorios count (default: 4)
 * @param {number} punitoryGraceDay - Business day limit without punitorios (default: 10)
 * @param {number} punitoryPercent - Daily percentage (default: 0.02 = 2%)
 * @param {Date[]} holidays - Array of holiday dates for the period
 * @param {Date|null} lastPaymentDate - Date of the last partial payment (if any)
 * @returns {{ amount: number, days: number, graceDate: Date, fromDate: Date|null, toDate: Date|null }}
 */
function calculatePunitoryV2(
  paymentDate,
  periodMonth,
  periodYear,
  baseRent,
  punitoryStartDay = 4,
  punitoryGraceDay = 10,
  punitoryPercent = 0.02,
  holidays = [],
  lastPaymentDate = null
) {
  // Normalize payment date to local midnight (timezone-safe)
  const payDateNorm = toLocalDate(paymentDate);
  const graceDate = getEffectiveGraceDate(
    periodYear,
    periodMonth,
    punitoryGraceDay,
    holidays
  );
  const graceDateNorm = toLocalDate(graceDate);

  // If baseRent is 0 or negative, no punitorios
  if (baseRent <= 0) {
    return { amount: 0, days: 0, graceDate, fromDate: null, toDate: null };
  }

  // Check if the period month is in the past relative to the payment date
  const payMonth = payDateNorm.getMonth() + 1;
  const payYear = payDateNorm.getFullYear();
  const isPastPeriod = periodYear < payYear || (periodYear === payYear && periodMonth < payMonth);

  // GRACE PERIOD CHECK FIRST: if paying within the current month's grace period, never punitorios
  if (!isPastPeriod && payDateNorm <= graceDateNorm) {
    return { amount: 0, days: 0, graceDate, fromDate: null, toDate: null };
  }

  // If there was a previous partial payment, punitorios count from that date
  if (lastPaymentDate) {
    const lastPayNorm = toLocalDate(lastPaymentDate);
    // If new payment is on the same day or before the last payment, no additional punitorios
    if (payDateNorm <= lastPayNorm) {
      return { amount: 0, days: 0, graceDate, fromDate: null, toDate: null };
    }
    // Count days from lastPaymentDate to paymentDate (both endpoints inclusive)
    const diasPunitorios = diffCalendarDays(payDateNorm, lastPayNorm) + 1;
    const dailyRate = baseRent * punitoryPercent;
    const amount = Math.round(dailyRate * diasPunitorios * 100) / 100;
    return { amount, days: diasPunitorios, graceDate, fromDate: lastPayNorm, toDate: payDateNorm };
  }

  if (isPastPeriod) {
    // Past month: count from day 1 of the period month to payment date (inclusive of day 1)
    const firstOfPeriod = new Date(periodYear, periodMonth - 1, 1);
    const days = diffCalendarDays(payDateNorm, firstOfPeriod);
    const totalDays = days + 1; // Include day 1 itself
    const dailyRate = baseRent * punitoryPercent;
    const amount = Math.round(dailyRate * totalDays * 100) / 100;
    return { amount, days: totalDays, graceDate, fromDate: firstOfPeriod, toDate: payDateNorm };
  }

  // Current month, after grace, no previous payment: count from punitoryStartDay to paymentDate (inclusive)
  const fromDate = new Date(periodYear, periodMonth - 1, punitoryStartDay);
  const diasPunitorios = diffCalendarDays(payDateNorm, fromDate) + 1;
  const dailyRate = baseRent * punitoryPercent;
  const amount = Math.round(dailyRate * diasPunitorios * 100) / 100;

  return { amount, days: diasPunitorios, graceDate, fromDate, toDate: payDateNorm };
}

/**
 * Get holidays from database for a specific year
 */
async function getHolidaysForYear(year) {
  const holidays = await prisma.holiday.findMany({
    where: { year },
    select: { date: true },
  });
  return holidays.map((h) => new Date(h.date));
}

// Keep legacy functions for backward compatibility
function calculatePunitoryDays(paymentDate, punitoryStartDay) {
  const payDay = paymentDate.getDate();
  const payMonth = paymentDate.getMonth();
  const payYear = paymentDate.getFullYear();
  const limitDate = new Date(payYear, payMonth, punitoryStartDay);
  if (paymentDate <= limitDate) return 0;
  const diffMs = paymentDate.getTime() - limitDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function calculatePunitoryAmount(baseRent, daysLate, punitoryPercent) {
  if (daysLate <= 0) return 0;
  return baseRent * punitoryPercent * daysLate;
}

module.exports = {
  calculatePunitoryDays,
  calculatePunitoryAmount,
  calculatePunitoryV2,
  getEffectiveGraceDate,
  getHolidaysForYear,
  isBusinessDay,
  isWeekend,
  isHoliday,
  diffCalendarDays,
  toLocalDate,
};
