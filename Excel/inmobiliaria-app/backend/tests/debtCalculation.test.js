const { describe, test } = require('node:test');
const assert = require('node:assert');
// const { round2 } = require('../src/utils/punitory');
function round2(num) {
  return Math.round(num * 100) / 100;
}

// Mock helper simulating the calculation inside monthlyRecordService.js
function simulateMonthlyRecordStatus(rent, services, punitory, iva, prevBalance, amountPaid) {
  const newTotalDue = round2(rent + services + punitory + iva - prevBalance);
  const newBalance = round2(amountPaid - Math.max(newTotalDue, 0));
  
  let isPaid = false;
  let status = 'PENDING';
  let isCancelled = false; // Is this being set correctly?
  
  if (newBalance >= -0.01) {
    isPaid = true;
    status = 'COMPLETE';
    isCancelled = true;
  } else if (amountPaid > 0) {
    isPaid = false;
    status = 'PARTIAL';
  } else {
    isPaid = false;
    status = 'PENDING';
  }

  // Check the "live balances" calculated before returning in getOrCreateMonthlyRecords
  // line 763: const liveComplete = record.amountPaid > 0 && realBalance >= -1;
  const liveBalance = Math.round((amountPaid - newTotalDue) * 100) / 100;
  const liveComplete = amountPaid > 0 && liveBalance >= -1;
  if(liveComplete) {
    isCancelled = true;
    isPaid = true;
    status = 'COMPLETE';
  }

  return { newTotalDue, newBalance, status, isPaid, isCancelled, liveComplete, liveBalance };
}

function calculateImputation(monthlyRecord) {
  const rentAmount = monthlyRecord.rentAmount || 0;
  const servicesTotal = monthlyRecord.servicesTotal || 0;
  const punitoryAmount = monthlyRecord.punitoryAmount || 0;
  const ivaAmount = monthlyRecord.ivaAmount || 0;
  const amountPaid = monthlyRecord.amountPaid || 0;
  const previousBalance = monthlyRecord.previousBalance || 0;
  
  let remaining = amountPaid + previousBalance;
  
  const servicesCovered = Math.min(remaining, servicesTotal);
  remaining -= servicesCovered;
  
  const ivaCovered = Math.min(remaining, ivaAmount);
  remaining -= ivaCovered;
  
  const rentCovered = Math.min(remaining, rentAmount);
  remaining -= rentCovered;
  
  const punitoryCovered = Math.min(remaining, punitoryAmount);
  
  const unpaidRent = round2(rentAmount - rentCovered);
  const unpaidIva = round2(ivaAmount - ivaCovered);
  const unpaidPunitory = round2(punitoryAmount - punitoryCovered);
  const unpaidServices = round2((servicesTotal - servicesCovered) + unpaidIva);
  
  return {
    unpaidRent,
    unpaidIva,
    unpaidServices,
    unpaidPunitory,
    totalOriginal: round2(rentAmount + servicesTotal + punitoryAmount + ivaAmount),
    totalUnpaid: round2(unpaidRent + unpaidPunitory + unpaidServices),
  };
}

describe('Debt Calculation logic', () => {

  test('Case 1: Av figueroa Alcorta 482 Dto5', () => {
    const rent = 590000;
    const services = 35145;
    const punitory = 8857;
    const amountPaid = 590000;
    
    // Total should be 634002
    // Balance should be -44002
    const res = simulateMonthlyRecordStatus(rent, services, punitory, 0, 0, amountPaid);
    
    assert.strictEqual(res.newTotalDue, 634002);
    assert.strictEqual(res.newBalance, -44002);
    assert.strictEqual(res.status, 'PARTIAL');
    assert.strictEqual(res.isCancelled, false); // Should NOT be cancelled since it has debt
    
    // Check imputation
    const imp = calculateImputation({ rentAmount: rent, servicesTotal: services, punitoryAmount: punitory, amountPaid });
    assert.strictEqual(imp.totalUnpaid, 44002); // 634002 - 590000
  });

  test('Case 2: Los Pinos 4081 Torre 3 PB A', () => {
    const rent = 522435;
    const services = 56267;
    const punitory = 81480;
    const amountPaid = 578722;
    // Total: 660182
    const res = simulateMonthlyRecordStatus(rent, services, punitory, 0, 0, amountPaid);
    
    assert.strictEqual(res.newTotalDue, 660182);
    assert.strictEqual(res.newBalance, -81460);
    assert.strictEqual(res.status, 'PARTIAL');
    assert.strictEqual(res.isCancelled, false);
    
    const imp = calculateImputation({ rentAmount: rent, servicesTotal: services, punitoryAmount: punitory, amountPaid });
    assert.strictEqual(imp.totalUnpaid, 81460);
  });

  test('Case 3: Av Colon 375', () => {
    const rent = 171430;
    const services = 0;
    const punitory = 4801;
    const amountPaid = 172800;
    // Total: 176231
    const res = simulateMonthlyRecordStatus(rent, services, punitory, 0, 0, amountPaid);
    
    assert.strictEqual(res.newTotalDue, 176231);
    assert.strictEqual(res.newBalance, -3431); // 172800 - 176231
    assert.strictEqual(res.status, 'PARTIAL');
    assert.strictEqual(res.isCancelled, false);
    
    const imp = calculateImputation({ rentAmount: rent, servicesTotal: services, punitoryAmount: punitory, amountPaid });
    assert.strictEqual(imp.totalUnpaid, 3431);
  });

});
