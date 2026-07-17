/*
 * Deudas Acumuladas debe poder mostrar "Ajuste de X%" en el mes pendiente
 * cuando ese mes de contrato tuvo un ajuste real de alquiler — mismo dato
 * que ya usa Liquidación Actual, ahora también disponible acá.
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, createMonthlyRecord, cleanupGroup } = require('./fixtures');
const { getLiquidacionData } = require('../../src/services/reportDataService');

test('Deudas Acumuladas: ajustePercent viene seteado cuando el mes de la deuda tuvo ajuste', async (t) => {
  const { group, contract, monthlyRecord: oldRecord } = await seedScenario(prisma, {
    monthlyRecord: { monthNumber: 1, periodMonth: 1, periodYear: 2026, status: 'PARTIAL', amountPaid: 0 },
  });

  try {
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: 1,
        rentAmount: 100000,
        adjustmentPercent: 15,
        reason: 'AJUSTE_MANUAL',
      },
    });

    await prisma.debt.create({
      data: {
        groupId: group.id,
        contractId: contract.id,
        monthlyRecordId: oldRecord.id,
        periodLabel: 'Enero 2026',
        periodMonth: 1,
        periodYear: 2026,
        originalAmount: 100000,
        unpaidRentAmount: 100000,
        unpaidServicesAmount: 0,
        accumulatedPunitory: 0,
        currentTotal: 100000,
        amountPaid: 0,
        punitoryPercent: 0.006,
        punitoryStartDate: new Date(2026, 0, 10),
        status: 'OPEN',
      },
    });

    await createMonthlyRecord(prisma, { groupId: group.id, contractId: contract.id }, {
      monthNumber: 2, periodMonth: 2, periodYear: 2026, rentAmount: 100000, amountPaid: 100000, status: 'PAID',
    });

    const result = await getLiquidacionData(group.id, contract.id, 2, 2026, {});
    const pendiente = result.deudasUnificadas.find((d) => d.estado === 'PENDIENTE');

    assert.ok(pendiente, 'debe existir un mes PENDIENTE (la deuda de Enero)');
    assert.strictEqual(pendiente.ajustePercent, 15, `ajustePercent debía ser 15, fue ${pendiente.ajustePercent}`);
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});

test('Deudas Acumuladas: ajustePercent es null cuando no hubo ajuste ese mes', async (t) => {
  const { group, contract, monthlyRecord: oldRecord } = await seedScenario(prisma, {
    monthlyRecord: { monthNumber: 1, periodMonth: 1, periodYear: 2026, status: 'PARTIAL', amountPaid: 0 },
  });

  try {
    await prisma.debt.create({
      data: {
        groupId: group.id,
        contractId: contract.id,
        monthlyRecordId: oldRecord.id,
        periodLabel: 'Enero 2026',
        periodMonth: 1,
        periodYear: 2026,
        originalAmount: 100000,
        unpaidRentAmount: 100000,
        unpaidServicesAmount: 0,
        accumulatedPunitory: 0,
        currentTotal: 100000,
        amountPaid: 0,
        punitoryPercent: 0.006,
        punitoryStartDate: new Date(2026, 0, 10),
        status: 'OPEN',
      },
    });

    await createMonthlyRecord(prisma, { groupId: group.id, contractId: contract.id }, {
      monthNumber: 2, periodMonth: 2, periodYear: 2026, rentAmount: 100000, amountPaid: 100000, status: 'PAID',
    });

    const result = await getLiquidacionData(group.id, contract.id, 2, 2026, {});
    const pendiente = result.deudasUnificadas.find((d) => d.estado === 'PENDIENTE');

    assert.ok(pendiente, 'debe existir un mes PENDIENTE (la deuda de Enero)');
    assert.strictEqual(pendiente.ajustePercent, null);
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});
