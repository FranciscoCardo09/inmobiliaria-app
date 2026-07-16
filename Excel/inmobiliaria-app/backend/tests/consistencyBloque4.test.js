const { test, describe } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire');

const punitoryModule = proxyquire('../src/utils/punitory', {
  '../lib/prisma': {},
  '../utils/dateUtils': {
    getTodayLocalString: () => '2026-07-13',
    getTodayLocalDate: () => new Date('2026-07-13T00:00:00.000Z'),
  },
});
const { computeLiveRecordPunitory } = punitoryModule;

const debtServiceModule = proxyquire('../src/services/debtService', {
  '../lib/prisma': {},
  '../utils/dateUtils': {
    getTodayLocalString: () => '2026-07-13',
    getTodayLocalDate: () => new Date('2026-07-13T00:00:00.000Z'),
  },
});
const { computeLiveDebtTotal } = debtServiceModule;

describe('Bloque 4: Consistencia Absoluta', () => {
  describe('computeLiveRecordPunitory', () => {
    test('debería calcular punitorios vivos para un registro abierto', () => {
      const record = {
        rentAmount: 100000,
        servicesTotal: 10000,
        ivaAmount: 0,
        amountPaid: 0,
        periodMonth: 6,
        periodYear: 2026,
        punitoryAmount: 1000,
        punitoryDays: 10,
        contract: {
          punitoryStartDay: 10,
          punitoryGraceDay: 5,
          punitoryPercent: 0.1,
        },
        transactions: [],
      };
      const date = '2026-07-13';

      const result = computeLiveRecordPunitory(record, record.contract, [], date);
      
      assert.ok(result.amount !== undefined);
      assert.ok(result.days !== undefined);
      assert.ok(result.unpaidFrozenPunitory !== undefined);
      assert.ok(result.newPunitory !== undefined);
    });

    test('debería eximir punitorios si el contrato exime', () => {
      const record = {
        rentAmount: 100000,
        servicesTotal: 10000,
        amountPaid: 0,
        periodMonth: 6,
        periodYear: 2026,
        contract: {
          punitoryStartDay: 10,
          punitoryGraceDay: 5,
          punitoryPercent: 0.1,
          exemptFromPunitory: true,
        },
        transactions: [],
      };

      const result = computeLiveRecordPunitory(record, record.contract, [], '2026-07-13');
      assert.strictEqual(result.amount, 0);
      assert.strictEqual(result.newPunitory, 0);
    });
  });

  describe('computeLiveDebtTotal', () => {
    test('debería devolver 0 para deuda PAGADA', async () => {
      const debt = {
        status: 'PAID',
        remainingDebt: 0,
        liveCurrentTotal: 0,
      };

      const result = await computeLiveDebtTotal(debt, '2026-07-13');
      assert.strictEqual(result.liveCurrentTotal, 0);
      assert.strictEqual(result.liveAccumulatedPunitory, 0);
      assert.strictEqual(result.livePunitoryDays, 0);
    });
  });
});
