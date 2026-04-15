const test = require('node:test');
const assert = require('node:assert');
const { enrichContract } = require('../src/services/contractService');

test('contractService - enrichContract parses default ACTIVE fields', (t) => {
  const now = new Date();
  const c1Start = new Date(now);
  c1Start.setMonth(now.getMonth() - 5);

  const mockContract = {
    id: 'c1',
    startDate: c1Start.toISOString(),
    startMonth: 1,
    durationMonths: 24,
    baseRent: 100000,
    active: true,
  };

  const enriched = enrichContract(mockContract);
  
  assert.strictEqual(enriched.id, 'c1');
  assert.strictEqual(enriched.contractType, 'INQUILINO');
  assert.strictEqual(enriched.status, 'ACTIVE');
  assert.strictEqual(enriched.currentMonth, 6);
});

test('contractService - enrichContract detects RESCINDED via date', (t) => {
  const mockContract = {
    id: 'c2',
    startDate: new Date().toISOString(),
    startMonth: 1,
    durationMonths: 24,
    baseRent: 150000,
    active: true,
    rescindedAt: new Date().toISOString() // Rescue field is populated
  };

  const enriched = enrichContract(mockContract);
  
  assert.strictEqual(enriched.status, 'RESCINDED', 'A contract structurally active but rescinded should be marked RESCINDED');
});

test('contractService - enrichContract detects EXPIRED correctly', (t) => {
  const now = new Date();
  const c2Start = new Date(now);
  c2Start.setFullYear(now.getFullYear() - 3);

  const mockContract = {
    id: 'c3',
    startDate: c2Start.toISOString(),
    startMonth: 1,
    durationMonths: 24,
    baseRent: 100,
    active: true,
  };
  const enriched = enrichContract(mockContract);
  assert.strictEqual(enriched.status, 'EXPIRED');
});

test('contractService - enrichContract handles undefined/null edges gracefully', (t) => {
  // Pass an absolutely minimal object - should survive safely with fallbacks
  const now = new Date();
  const mockContract = {
    id: 'empty_c',
    startDate: now.toISOString(),
    durationMonths: 12,
    active: true,
    // Note missing startMonth, baseRent, contractType
  };

  const enriched = enrichContract(mockContract);
  
  assert.strictEqual(enriched.status, 'ACTIVE', 'Survives despite missing non-critical parameters');
  assert.strictEqual(enriched.startMonth, undefined); // raw preserved
  assert.strictEqual(enriched.contractType, 'INQUILINO', 'Default resolution worked');
  assert.strictEqual(enriched.currentMonth, 1, 'Assumed startMonth 1 worked internally');
  assert.strictEqual(enriched.baseRent, undefined); // It maps what is there
});

test('contractService - enrichContract identifies Future contracts correctly', (t) => {
  const futureStart = new Date();
  futureStart.setFullYear(futureStart.getFullYear() + 2); // Starts 2 years from now

  const mockContract = {
    id: 'future',
    startDate: futureStart.toISOString(),
    startMonth: 1,
    durationMonths: 12,
    active: true,
  };

  const enriched = enrichContract(mockContract);
  
  assert.strictEqual(enriched.status, 'ACTIVE', 'Technically considered active if boolean is true');
  // Since monthDiff is negative, calculated current month should be capped at 1!
  assert.strictEqual(enriched.currentMonth, 1, 'A contract in the future cannot go below month 1');
  assert.strictEqual(enriched.remainingMonths, 11, '11 months remaining after month 1');
});
