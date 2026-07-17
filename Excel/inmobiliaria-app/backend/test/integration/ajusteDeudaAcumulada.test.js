/*
 * Deudas Acumuladas debe poder mostrar "Ajuste de X%" en el mes pendiente
 * cuando ese mes de contrato tuvo un ajuste real de alquiler — mismo dato
 * que ya usa Liquidación Actual, ahora también disponible acá.
 *
 * deudasUnificadas solo lo produce getLiquidacionesAllContracts (la función
 * que alimenta el reporte "Liquidación General" / generateLiquidacionAllPDF),
 * por eso el test llama a esa función y no a getLiquidacionData (que es la
 * de un solo contrato y no calcula deudasUnificadas).
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, createMonthlyRecord, cleanupGroup } = require('./fixtures');
const { getLiquidacionesAllContracts } = require('../../src/services/reportDataService');

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

    // El mes que se está liquidando (Feb 2026) tiene que quedar "cerrado"
    // (isCancelled: true) para que getLiquidacionesAllContracts lo traiga
    // en su query global por defecto (soloConPago !== false -> isCancelled: true).
    await createMonthlyRecord(prisma, { groupId: group.id, contractId: contract.id }, {
      monthNumber: 2, periodMonth: 2, periodYear: 2026, rentAmount: 100000, amountPaid: 100000, status: 'PAID', isCancelled: true,
    });

    const all = await getLiquidacionesAllContracts(group.id, 2, 2026);
    const liq = all.find((item) => item.contractId === contract.id);
    assert.ok(liq, 'debe existir una liquidación para este contrato en el array devuelto');

    const pendiente = liq.deudasUnificadas.find((d) => d.estado === 'PENDIENTE');

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
      monthNumber: 2, periodMonth: 2, periodYear: 2026, rentAmount: 100000, amountPaid: 100000, status: 'PAID', isCancelled: true,
    });

    const all = await getLiquidacionesAllContracts(group.id, 2, 2026);
    const liq = all.find((item) => item.contractId === contract.id);
    assert.ok(liq, 'debe existir una liquidación para este contrato en el array devuelto');

    const pendiente = liq.deudasUnificadas.find((d) => d.estado === 'PENDIENTE');

    assert.ok(pendiente, 'debe existir un mes PENDIENTE (la deuda de Enero)');
    assert.strictEqual(pendiente.ajustePercent, null);
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});
