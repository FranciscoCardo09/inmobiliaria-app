// Monthly Close Service - Cierre mensual que genera deudas automáticas
const { createDebtFromMonthlyRecord, calculateImputation } = require('./debtService');

const prisma = require('../lib/prisma');

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Preview del cierre mensual: qué deudas se generarían.
 * NO ejecuta cambios, solo muestra preview.
 */
const previewCloseMonth = async (groupId, month, year) => {
  const periodMonth = parseInt(month);
  const periodYear = parseInt(year);

  // Buscar MonthlyRecords no pagados completamente para este período
  const unpaidRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth,
      periodYear,
      status: { in: ['PENDING', 'PARTIAL'] },
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
          property: { select: { id: true, address: true } },
        },
      },
      services: {
        include: {
          conceptType: { select: { name: true, label: true, category: true } },
        },
      },
      transactions: { orderBy: { createdAt: 'asc' } },
      debt: true, // Verificar si ya tiene deuda
    },
  });

  // Filtrar los que ya tienen deuda generada
  const recordsToClose = unpaidRecords.filter((r) => !r.debt);

  const debtsPreview = recordsToClose.map((record) => {
    const { unpaidRent, unpaidPunitory, totalOriginal, totalUnpaid, servicesCovered, rentCovered, punitoryCovered } = calculateImputation(record);

    return {
      monthlyRecordId: record.id,
      tenant: record.contract.tenant || null,
      tenants: record.contract.contractTenants?.length > 0
        ? record.contract.contractTenants.map((ct) => ct.tenant)
        : record.contract.tenant ? [record.contract.tenant] : [],
      property: record.contract.property,
      periodLabel: `${monthNames[periodMonth]} ${periodYear}`,
      status: record.status,
      totalOriginal,
      amountPaid: record.amountPaid,
      servicesCovered,
      rentCovered,
      punitoryCovered,
      unpaidRent,
      unpaidPunitory,
      totalUnpaid,
      willGenerateDebt: totalUnpaid > 0,
    };
  });

  const summary = {
    totalRecords: unpaidRecords.length,
    alreadyHaveDebt: unpaidRecords.length - recordsToClose.length,
    willGenerateDebts: debtsPreview.filter((d) => d.willGenerateDebt).length,
    totalDebtAmount: debtsPreview.reduce((sum, d) => sum + d.totalUnpaid, 0),
  };

  return { debtsPreview, summary };
};

/**
 * Ejecutar cierre mensual: genera deudas para registros impagos.
 */
const closeMonth = async (groupId, month, year) => {
  const periodMonth = parseInt(month);
  const periodYear = parseInt(year);

  // Buscar MonthlyRecords no pagados completamente
  const unpaidRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth,
      periodYear,
      status: { in: ['PENDING', 'PARTIAL'] },
    },
    include: {
      contract: true,
      services: {
        include: {
          conceptType: { select: { category: true } },
        },
      },
      transactions: { orderBy: { createdAt: 'asc' } },
      debt: true,
    },
  });

  const debtsCreated = [];
  const errors = [];

  for (const record of unpaidRecords) {
    // Saltar si ya tiene deuda
    if (record.debt) continue;

    try {
      const debt = await createDebtFromMonthlyRecord(record, record.contract);
      if (debt) {
        debtsCreated.push(debt);
        // No marcar isCancelled: solo se marca TRUE cuando el inquilino paga todo
      }
    } catch (error) {
      errors.push({
        recordId: record.id,
        contractId: record.contractId,
        error: error.message,
      });
    }
  }

  return {
    periodLabel: `${monthNames[periodMonth]} ${periodYear}`,
    debtsCreated: debtsCreated.length,
    errors: errors.length > 0 ? errors : undefined,
    summary: {
      totalUnpaid: unpaidRecords.length,
      alreadyHadDebt: unpaidRecords.filter((r) => r.debt).length,
      newDebts: debtsCreated.length,
    },
  };
};

module.exports = {
  previewCloseMonth,
  closeMonth,
};
