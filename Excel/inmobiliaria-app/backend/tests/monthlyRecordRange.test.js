const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const fakePrisma = makeFakePrisma();
const {
  isContractInRangeForMonth,
  canCreateRecordForContract,
} = proxyquire('../src/services/monthlyRecordService', {
  '../lib/prisma': fakePrisma,
  './debtService': { calculateDebtPunitory: async () => ({ amount: 0, days: 0, remainingDebt: 0 }), preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }) },
});

test('isContractInRangeForMonth - true when monthNumber inside [startMonth..endMonth]', () => {
  const contract = { startMonth: 1, durationMonths: 24, active: true };
  assert.strictEqual(isContractInRangeForMonth(contract, 1), true);
  assert.strictEqual(isContractInRangeForMonth(contract, 12), true);
  assert.strictEqual(isContractInRangeForMonth(contract, 24), true);
});

test('isContractInRangeForMonth - false when outside range', () => {
  const contract = { startMonth: 1, durationMonths: 24, active: true };
  assert.strictEqual(isContractInRangeForMonth(contract, 0), false);
  assert.strictEqual(isContractInRangeForMonth(contract, 25), false);
  assert.strictEqual(isContractInRangeForMonth(contract, -5), false);
});

test('isContractInRangeForMonth - no longer gates on active=false (renewed contracts pass)', () => {
  // This is the central fix: a renewed (inactive) contract still owns its
  // historical periods. The range check is now ONLY about the month number.
  const contract = { startMonth: 1, durationMonths: 24, active: false, renewedAt: new Date() };
  assert.strictEqual(isContractInRangeForMonth(contract, 5), true);
});

test('isContractInRangeForMonth - rescinded contract caps at rescission month', () => {
  // Local-tz dates so getMonth()/getFullYear() align with the period numbers we expect.
  const contract = {
    startMonth: 1,
    durationMonths: 24,
    active: true,
    startDate: new Date(2024, 0, 1), // Jan 1, 2024 local
    rescindedAt: new Date(2024, 5, 15), // June 15, 2024 local (month 6 of contract)
  };
  assert.strictEqual(isContractInRangeForMonth(contract, 6), true);
  assert.strictEqual(isContractInRangeForMonth(contract, 7), false, 'past rescission month');
});

test('canCreateRecordForContract - only true for active contracts', () => {
  assert.strictEqual(canCreateRecordForContract({ active: true }), true);
  assert.strictEqual(canCreateRecordForContract({ active: false, renewedAt: new Date() }), false);
  assert.strictEqual(canCreateRecordForContract({ active: false, renewedAt: null }), false);
});
