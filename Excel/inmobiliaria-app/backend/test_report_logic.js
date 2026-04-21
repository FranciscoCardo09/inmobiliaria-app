const { buildLiquidacionFromRecord, computeGrandTotals } = require('./src/services/reportDataService');

// Mock data
const empresa = {
  nombre: 'Mi Inmobiliaria',
  currency: 'ARS',
};

const contractMock = {
  id: 1,
  contractType: 'INQUILINO',
  property: { address: 'Calle Falsa 123', floor: null, apartment: null, owner: { name: 'Juan Propietario', dni: '12345678' } },
  tenant: { name: 'Maria Inquilina', dni: '87654321', email: 'maria@test.com', phone: '1234' },
  tenants: [],
  rentHistory: []
};

const svcExpensas = {
  id: 's1', amount: 20000,
  conceptType: { category: 'SERVICIO', label: 'Expensas', name: 'expensas' }
};

const svcImpuesto = {
  id: 's2', amount: 5000,
  conceptType: { category: 'IMPUESTO', label: 'ABL', name: 'abl' }
};

// ─── Case 1: Fully Paid (rent 150k + services 25k + punitorios 10k = 185k, pays 185k) ───
const recordFullyPaid = {
  id: 101, monthNumber: 1,
  rentAmount: 150000, punitoryAmount: 10000, punitoryDays: 5, punitoryForgiven: false,
  isCancelled: true, amountPaid: 185000, previousBalance: 0, balance: 0,
  status: 'COMPLETE', isPaid: true, fullPaymentDate: new Date(),
  includeIva: false, ivaAmount: 0,
  services: [svcExpensas, svcImpuesto],
  transactions: [{ paymentDate: new Date(), amount: 185000, paymentMethod: 'EFECTIVO', concepts: [] }],
  contract: contractMock
};

// ─── Case 2: Partial – only covers services (pays 20k of 185k total) ───
const recordPartialServicesOnly = {
  id: 102, monthNumber: 2,
  rentAmount: 150000, punitoryAmount: 10000, punitoryDays: 5, punitoryForgiven: false,
  isCancelled: false, amountPaid: 20000, previousBalance: 0, balance: -165000,
  status: 'PARTIAL', isPaid: false, fullPaymentDate: null,
  includeIva: false, ivaAmount: 0,
  services: [svcExpensas, svcImpuesto],
  transactions: [{ paymentDate: new Date(), amount: 20000, paymentMethod: 'EFECTIVO', concepts: [] }],
  contract: contractMock
};

// ─── Case 3: Partial – covers services + punitorios but NOT rent (pays 35k) ───
const recordPartialNeverReachesRent = {
  id: 103, monthNumber: 3,
  rentAmount: 150000, punitoryAmount: 10000, punitoryDays: 5, punitoryForgiven: false,
  isCancelled: false, amountPaid: 35000, previousBalance: 0, balance: -150000,
  status: 'PARTIAL', isPaid: false, fullPaymentDate: null,
  includeIva: false, ivaAmount: 0,
  services: [svcExpensas, svcImpuesto],
  transactions: [{ paymentDate: new Date(), amount: 35000, paymentMethod: 'EFECTIVO', concepts: [] }],
  contract: contractMock
};

// ─── Case 4: Unpaid ───
const recordUnpaid = {
  id: 104, monthNumber: 4,
  rentAmount: 150000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
  isCancelled: false, amountPaid: 0, previousBalance: 0, balance: -150000,
  status: 'PENDING', isPaid: false, fullPaymentDate: null,
  includeIva: false, ivaAmount: 0,
  services: [svcExpensas],
  transactions: [],
  contract: contractMock
};

// ─── Case 5: Overpayment / Saldo a favor (total 170k, pays 200k) ───
const recordOverpaid = {
  id: 105, monthNumber: 5,
  rentAmount: 150000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
  isCancelled: true, amountPaid: 200000, previousBalance: 0, balance: 30000,
  status: 'COMPLETE', isPaid: true, fullPaymentDate: new Date(),
  includeIva: false, ivaAmount: 0,
  services: [svcExpensas],
  transactions: [{ paymentDate: new Date(), amount: 200000, paymentMethod: 'TRANSFERENCIA', concepts: [] }],
  contract: contractMock
};

function runTest() {
  console.log('=== TEST: Sequential Payment Allocation ===\n');

  const options = { honorariosPercent: 10 };

  const d1 = buildLiquidacionFromRecord(recordFullyPaid, empresa, 1, 2024, options);
  const d2 = buildLiquidacionFromRecord(recordPartialServicesOnly, empresa, 2, 2024, options);
  const d3 = buildLiquidacionFromRecord(recordPartialNeverReachesRent, empresa, 3, 2024, options);
  const d4 = buildLiquidacionFromRecord(recordUnpaid, empresa, 4, 2024, options);
  const d5 = buildLiquidacionFromRecord(recordOverpaid, empresa, 5, 2024, options);

  const print = (label, d) => {
    console.log(`--- ${label} ---`);
    console.log(`  Estado: ${d.paymentStatus}`);
    console.log(`  Total: ${d.total}`);
    console.log(`  Pagado: ${d.amountPaid}`);
    console.log(`  Pendiente: ${d.pendingAmount}`);
    console.log(`  → Servicios pagados: ${d.paidServicios}`);
    console.log(`  → Punitorios pagados: ${d.paidPunitorios}`);
    console.log(`  → Alquiler pagado: ${d.paidAlquiler}`);
    console.log(`  → Saldo a favor: ${d.saldoAFavor}`);
    console.log(`  Honorarios cobrados: ${d.honorariosCobrado}`);
    console.log('');
  };

  print('Case 1: FULLY PAID (185k total, 185k paid)', d1);
  print('Case 2: PARTIAL - Only services covered (185k total, 20k paid)', d2);
  print('Case 3: PARTIAL - Services+Punitorios but NO rent (185k total, 35k paid)', d3);
  print('Case 4: UNPAID (170k total, 0 paid)', d4);
  print('Case 5: OVERPAID - Saldo a favor (170k total, 200k paid)', d5);

  // Verify allocation correctness
  let passed = 0;
  let failed = 0;
  const assert = (label, actual, expected) => {
    if (actual === expected) {
      passed++;
    } else {
      failed++;
      console.log(`  ✗ FAIL: ${label} → expected ${expected}, got ${actual}`);
    }
  };

  console.log('=== ASSERTIONS ===');

  // Case 1: Fully paid
  assert('C1 status', d1.paymentStatus, 'PAGADO');
  assert('C1 paidServicios', d1.paidServicios, 25000);  // 20k + 5k
  assert('C1 paidPunitorios', d1.paidPunitorios, 10000);
  assert('C1 paidAlquiler', d1.paidAlquiler, 150000);
  assert('C1 saldoAFavor', d1.saldoAFavor, 0);
  assert('C1 pendingAmount', d1.pendingAmount, 0);

  // Case 2: Partial - only services (20k paid, services = 25k so only 20k goes to services)
  assert('C2 status', d2.paymentStatus, 'PAGO PARCIAL');
  assert('C2 paidServicios', d2.paidServicios, 20000);
  assert('C2 paidPunitorios', d2.paidPunitorios, 0);
  assert('C2 paidAlquiler', d2.paidAlquiler, 0);
  assert('C2 saldoAFavor', d2.saldoAFavor, 0);
  assert('C2 pendingAmount', d2.pendingAmount, 165000);

  // Case 3: Partial - covers services (25k) + punitorios (10k), nothing for rent
  assert('C3 status', d3.paymentStatus, 'PAGO PARCIAL');
  assert('C3 paidServicios', d3.paidServicios, 25000);
  assert('C3 paidPunitorios', d3.paidPunitorios, 10000);
  assert('C3 paidAlquiler', d3.paidAlquiler, 0);
  assert('C3 saldoAFavor', d3.saldoAFavor, 0);
  assert('C3 pendingAmount', d3.pendingAmount, 150000);

  // Case 4: Unpaid
  assert('C4 status', d4.paymentStatus, 'NO COBRADO');
  assert('C4 paidServicios', d4.paidServicios, 0);
  assert('C4 paidPunitorios', d4.paidPunitorios, 0);
  assert('C4 paidAlquiler', d4.paidAlquiler, 0);
  assert('C4 pendingAmount', d4.pendingAmount, 170000);

  // Case 5: Overpaid
  assert('C5 status', d5.paymentStatus, 'SALDO A FAVOR');
  assert('C5 paidServicios', d5.paidServicios, 20000);
  assert('C5 paidPunitorios', d5.paidPunitorios, 0);
  assert('C5 paidAlquiler', d5.paidAlquiler, 150000);
  assert('C5 saldoAFavor', d5.saldoAFavor, 30000);
  assert('C5 pendingAmount', d5.pendingAmount, 0);

  console.log(`\n✔ Passed: ${passed}`);
  if (failed > 0) console.log(`✗ Failed: ${failed}`);

  // Grand Totals
  console.log('\n=== GRAND TOTALS (all 5 cases) ===');
  const totals = computeGrandTotals([d1, d2, d3, d4, d5]);
  console.log(`  Total Cobrado:        ${totals.grandTotal}`);
  console.log(`  Total Pendiente:      ${totals.grandPending}`);
  console.log(`  Servicios Cobrado:    ${totals.grandServiciosCobrado}`);
  console.log(`  Punitorios Cobrado:   ${totals.grandPunitoriosCobrado}`);
  console.log(`  Alquiler Cobrado:     ${totals.grandAlquilerCobrado}`);
  console.log(`  Saldo a Favor:        ${totals.grandSaldoAFavor}`);
  console.log(`  Honorarios:           ${totals.grandHonorarios}`);
  console.log(`  Paid / Saldo / Partial / Unpaid: ${totals.paidCount} / ${totals.saldoCount} / ${totals.partialCount} / ${totals.unpaidCount}`);

  console.log('\n✓ Test Completo.');
}

runTest();
