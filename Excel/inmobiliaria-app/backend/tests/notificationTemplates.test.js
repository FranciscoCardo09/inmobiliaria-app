const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  debtTotalTemplate,
  debtPartialTemplate,
  latePaymentTemplate,
  formatCurrency,
} = require('../src/services/notificationTemplates');

// ============================================================
// A-05 (AUDITORIA_FUNCIONAL_2026-07-10.md): la tasa real de punitorios
// es 0.6% diario / día 10 (contractsController.js hardcodea 0.006 / 10 al
// crear contratos). Los templates de notificación tenían fallbacks
// `|| 0.02` y `|| 4` (2% / día 4) para cuando punitoryPercent/punitoryStartDay
// no vienen seteados — esos fallbacks NUNCA deben mostrar una tasa 3.3x
// mayor a la real. Este test fija que los fallbacks son 0.006 / 10.
// ============================================================

test('A-05: debtTotalTemplate — fallback de punitoryPercent es 0.006, no 0.02', (t) => {
  const tenant = { name: 'Juan Pérez' };
  const debt = {
    periodLabel: 'Julio 2026',
    unpaidRentAmount: 100000,
    punitoryPercent: undefined, // simula deuda sin tasa persistida
    punitoryStartDate: null,
  };

  const { whatsappText } = debtTotalTemplate(tenant, debt, 'Grupo Test');

  assert.ok(whatsappText.includes(formatCurrency(600)), 'debe mostrar 100000*0.006=600/día');
  assert.ok(!whatsappText.includes(formatCurrency(2000)), 'no debe mostrar 100000*0.02=2000/día');
});

test('A-05: debtPartialTemplate — fallback de punitoryPercent es 0.006, no 0.02', (t) => {
  const tenant = { name: 'Ana Gómez' };
  const debt = {
    periodLabel: 'Julio 2026',
    unpaidRentAmount: 100000,
    amountPaid: 50000,
    punitoryPercent: undefined,
  };

  const { whatsappText } = debtPartialTemplate(tenant, debt, 'Grupo Test');

  // remaining = 50000; 0.006 -> 300/día; 0.02 -> 1000/día
  assert.ok(whatsappText.includes(formatCurrency(300)), 'debe mostrar 50000*0.006=300/día');
  assert.ok(!whatsappText.includes(formatCurrency(1000)), 'no debe mostrar 50000*0.02=1000/día');
});

test('A-05: latePaymentTemplate — fallback de punitoryPercent (0.006) y punitoryStartDay (10)', (t) => {
  const tenant = { name: 'Carlos Ruiz' };
  const record = { periodMonth: 7, periodYear: 2026, rentAmount: 100000 };
  const contract = { punitoryPercent: undefined, punitoryStartDay: undefined };

  const { whatsappText } = latePaymentTemplate(tenant, record, contract, 'Grupo Test');

  assert.ok(whatsappText.includes('DESDE día 10'), 'debe caer al día 10, no al día 4');
  assert.ok(whatsappText.includes(formatCurrency(600)), 'debe mostrar 100000*0.006=600/día');
  assert.ok(!whatsappText.includes('DESDE día 4'), 'no debe caer al viejo fallback de día 4');
});

test('A-05: schema.prisma — defaults de punitorios alineados a la tasa real (0.006 / día 10)', (t) => {
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  assert.match(
    schema,
    /punitoryPercent\s+Float\s+@default\(0\.006\)/,
    'Contract.punitoryPercent debe defaultear a 0.006 (0.6%), no 0.02'
  );
  assert.match(
    schema,
    /punitoryStartDay\s+Int\s+@default\(10\)/,
    'Contract.punitoryStartDay debe defaultear a 10, no 4'
  );
});
