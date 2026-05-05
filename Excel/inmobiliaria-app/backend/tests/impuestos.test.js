const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire');

const prismaMock = {
  group: {
    findUnique: async () => ({ currency: 'ARS', bankName: 'Test Bank' })
  },
  monthlyRecord: {
    findMany: async () => ([
      {
        contractId: 'inq1',
        contract: {
          contractType: 'INQUILINO',
          debts: [{ currentTotal: 100, originalAmount: 100, amountPaid: 0, accumulatedPunitory: 0, status: 'PENDING', periodLabel: 'Abril' }],
          property: { address: 'Address 1', owner: { name: 'Owner' } },
          tenant: { name: 'Inquilino 1' }
        },
        services: [
          { amount: 50, conceptType: { category: 'IMPUESTO' } }
        ]
      },
      {
        contractId: 'prop1',
        contract: {
          contractType: 'PROPIETARIO',
          debts: [{ currentTotal: 200, originalAmount: 200, amountPaid: 0, accumulatedPunitory: 0, status: 'PENDING', periodLabel: 'Abril' }],
          property: { address: 'Address 2', owner: { name: 'Owner' } },
          tenant: { name: 'Propietario 1' }
        },
        services: [
          { amount: 50, conceptType: { category: 'IMPUESTO' } }
        ]
      }
    ])
  },
  debt: {
    findMany: async () => ([])
  }
};

const reportDataService = proxyquire('../src/services/reportDataService', {
  '../lib/prisma': prismaMock
});

describe('getImpuestosData logic', () => {
  test('includes both INQUILINO and PROPIETARIO, but only PROPIETARIO has debts mapped', async () => {
    const data = await reportDataService.getImpuestosData('gid', 5, 2026);
    
    assert.equal(data.impuestos.length, 2, 'Should include both contracts since they have tax services');
    
    const propWithDebt = data.impuestos.find(i => i.totalDeuda === 200);
    const inqWithoutDebt = data.impuestos.find(i => i.totalDeuda === 0);
    
    assert.ok(propWithDebt, 'Propietario should have its debts mapped');
    assert.ok(inqWithoutDebt, 'Inquilino should NOT have its debts mapped (totalDeuda = 0)');
    assert.equal(inqWithoutDebt.deudas.length, 0, 'Inquilino should have empty deudas array');
    assert.equal(propWithDebt.deudas.length, 1, 'Propietario should have 1 deuda mapped');
  });
});
