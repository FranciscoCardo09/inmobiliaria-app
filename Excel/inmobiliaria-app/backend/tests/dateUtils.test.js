const test = require('node:test');
const assert = require('node:assert');
const { parseLocalDate, getPeriodLabel, calculateMonthsDiff, calculateCurrentContractMonth } = require('../src/utils/dateUtils');

// ================= DATE PARSER =================

test('dateUtils - parseLocalDate creates Noon UTC dates correctly', (t) => {
  const result = parseLocalDate('2024-03-15T00:00:00Z');
  assert.strictEqual(result.getUTCFullYear(), 2024);
  assert.strictEqual(result.getUTCMonth(), 2);
  assert.strictEqual(result.getUTCDate(), 15);
});

test('dateUtils - parseLocalDate handles edge cases and nulls', (t) => {
  assert.strictEqual(parseLocalDate(null), null, 'Should return null for null input');
  assert.strictEqual(parseLocalDate(undefined), null, 'Should return null for undefined');
  assert.strictEqual(parseLocalDate(''), null, 'Should return null for empty string');

  // Ill-formed string (no hyphens) might yield NaN dates. The system assumes YYYY-MM-DD
  const badDate = parseLocalDate('invalid-string');
  assert.ok(Number.isNaN(badDate.getTime()), 'Should return Invalid Date object for arbitrary text');
});

// ================= MONTH DIFF =================

test('dateUtils - calculateMonthsDiff calculates diff properly', (t) => {
  const start = new Date(Date.UTC(2024, 0, 15, 12)); // Jan
  const end = new Date(Date.UTC(2024, 5, 15, 12)); // June
  assert.strictEqual(calculateMonthsDiff(start, end), 5);
});

test('dateUtils - calculateMonthsDiff handles negative diff (inverted dates)', (t) => {
  const start = new Date(Date.UTC(2024, 5, 15, 12)); // June
  const end = new Date(Date.UTC(2024, 0, 15, 12)); // Jan
  assert.strictEqual(calculateMonthsDiff(start, end), -5, 'Should return negative months if end is before start');
});

test('dateUtils - calculateMonthsDiff handles exact same month and cross-years', (t) => {
  const start = new Date(Date.UTC(2024, 11, 15, 12)); // Dec 2024
  const end1 = new Date(Date.UTC(2024, 11, 20, 12)); // Dec 2024
  assert.strictEqual(calculateMonthsDiff(start, end1), 0, 'Same month -> 0 diff');

  const end2 = new Date(Date.UTC(2025, 0, 1, 12)); // Jan 2025
  assert.strictEqual(calculateMonthsDiff(start, end2), 1, 'Dec to Jan -> 1 month diff');
});

// ================= PERIOD LABEL =================

test('dateUtils - getPeriodLabel formats correctly', (t) => {
  const start = new Date(Date.UTC(2024, 0, 15, 12)); // Jan
  assert.strictEqual(getPeriodLabel(start, 3, 1), 'Marzo 2024');
  assert.strictEqual(getPeriodLabel(start, 14, 1), 'Febrero 2025');
});

test('dateUtils - getPeriodLabel edges', (t) => {
  const start = new Date(Date.UTC(2024, 0, 15, 12)); // Jan
  // Fallback to undefined/default behavior if we request month 0 (would shift back to Dec '23)
  assert.strictEqual(getPeriodLabel(start, 0, 1), 'Diciembre 2023');
  
  // If startMonth missing, defaults to 1 (defined in signature fallback)
  assert.strictEqual(getPeriodLabel(start, 3), 'Marzo 2024');
});

// ================= CONTRACT MONTH =================

test('dateUtils - calculateCurrentContractMonth dynamic logic', (t) => {
  const start = new Date(Date.UTC(2024, 0, 1)); // Jan 2024
  const relativeDate = new Date(Date.UTC(2024, 2, 1)); 
  assert.strictEqual(calculateCurrentContractMonth(start, 1, 24, relativeDate), 3);
});

test('dateUtils - calculateCurrentContractMonth bounds checks', (t) => {
  const start = new Date(Date.UTC(2024, 5, 1)); // June 2024
  
  // 1. Relative date BEFORE start date -> should cap at startMonth (e.g. 1)
  const pastDate = new Date(Date.UTC(2023, 0, 1));
  assert.strictEqual(calculateCurrentContractMonth(start, 1, 24, pastDate), 1, 'Cannot drop below startMonth');

  // 2. Relative date way AFTER duration ends -> should cap at durationMonths
  const futureDate = new Date(Date.UTC(2030, 0, 1));
  assert.strictEqual(calculateCurrentContractMonth(start, 1, 24, futureDate), 24, 'Cannot exceed durationMonths');

  // 3. Fallback to startMonth=1 if startMonth isn't provided
  const normalDate = new Date(Date.UTC(2024, 6, 1)); // 1 month diff
  assert.strictEqual(calculateCurrentContractMonth(start, undefined, 24, normalDate), 2, 'Should assume startMonth 1 => 1+1=2');
  
  // 4. Broken/zero duration
  assert.strictEqual(calculateCurrentContractMonth(start, 1, 0, normalDate), 0, 'Zero duration caps exactly at zero');
});
