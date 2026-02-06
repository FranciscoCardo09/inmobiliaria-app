// Adjustment Service - LÓGICA CORREGIDA
// Los ajustes ocurren cada frequencyMonths A PARTIR del startMonth
// NO en múltiplos absolutos de frequencyMonths

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Calculate the next adjustment month based on start month and frequency
 * LÓGICA CORREGIDA:
 * - Los ajustes ocurren en: startMonth, startMonth+freq, startMonth+2*freq, etc.
 * - Si contrato arranca en mes 4 con ajuste trimestral: ajustes en 4, 7, 10, 13, 16, 19, 22
 * - Si contrato arranca en mes 11 con ajuste trimestral: ajustes en 11, 14, 17, 20, 23
 *
 * @param {number} startMonth - Mes de inicio del contrato (1-based)
 * @param {number} currentMonth - Current month of the contract (1-based)
 * @param {number} frequencyMonths - Adjustment frequency in months
 * @param {number} durationMonths - Total contract duration
 * @returns {number|null} Next adjustment month, or null if no more adjustments
 */
const calculateNextAdjustmentMonth = (startMonth, currentMonth, frequencyMonths, durationMonths) => {
  // Los ajustes ocurren en: startMonth + (n * frequencyMonths) donde n >= 0
  // Encontrar el siguiente n tal que startMonth + (n * frequencyMonths) > currentMonth

  let nextAdjustment = startMonth;

  // Si ya pasamos el startMonth, calcular el siguiente
  if (currentMonth >= startMonth) {
    // Calcular cuántos períodos han pasado desde startMonth
    const periodsPassed = Math.floor((currentMonth - startMonth) / frequencyMonths);

    // Siguiente ajuste
    nextAdjustment = startMonth + ((periodsPassed + 1) * frequencyMonths);
  }

  // Verificar que no exceda la duración del contrato
  return nextAdjustment <= durationMonths ? nextAdjustment : null;
};

/**
 * Check if a contract has an adjustment in a given month
 * LÓGICA CORREGIDA:
 * - Es mes de ajuste si (currentMonth - startMonth) es múltiplo de frequencyMonths
 * - Y currentMonth >= startMonth
 */
const isAdjustmentMonth = (startMonth, currentMonth, frequencyMonths) => {
  if (currentMonth < startMonth) return false;
  return (currentMonth - startMonth) % frequencyMonths === 0;
};

/**
 * Get contracts with adjustment this month
 * Usa nextAdjustmentMonth como fuente de verdad
 */
const getContractsWithAdjustmentThisMonth = async (groupId) => {
  const contractInclude = {
    tenant: { select: { id: true, name: true, dni: true } },
    property: {
      select: {
        id: true,
        address: true,
        code: true,
        owner: { select: { id: true, name: true } }
      }
    },
    adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
  };

  // Contratos donde nextAdjustmentMonth === currentMonth
  const contracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: { not: null },
      nextAdjustmentMonth: { not: null },
    },
    include: contractInclude,
  });

  return contracts.filter((c) => c.nextAdjustmentMonth === c.currentMonth);
};

/**
 * Get contracts with adjustment next month
 * Usa nextAdjustmentMonth como fuente de verdad
 */
const getContractsWithAdjustmentNextMonth = async (groupId) => {
  const contractInclude = {
    tenant: { select: { id: true, name: true, dni: true } },
    property: {
      select: {
        id: true,
        address: true,
        code: true,
        owner: { select: { id: true, name: true } }
      }
    },
    adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
  };

  // Contratos donde nextAdjustmentMonth === currentMonth + 1
  const contracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: { not: null },
      nextAdjustmentMonth: { not: null },
    },
    include: contractInclude,
  });

  return contracts.filter((c) => c.nextAdjustmentMonth === c.currentMonth + 1);
};

/**
 * Apply adjustment to contracts with adjustment next month
 * Updates baseRent and advances nextAdjustmentMonth
 */
const applyAdjustmentToNextMonthContracts = async (groupId, indexId, percentageIncrease) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
      nextAdjustmentMonth: { not: null },
    },
    include: {
      adjustmentIndex: { select: { frequencyMonths: true } },
    },
  });

  // Solo contratos donde nextAdjustmentMonth === currentMonth + 1
  const contractsToAdjust = allContracts.filter((c) => c.nextAdjustmentMonth === c.currentMonth + 1);

  const results = [];

  for (const contract of contractsToAdjust) {
    const newRent = contract.baseRent * (1 + percentageIncrease / 100);

    // Calcular el siguiente mes de ajuste despues del que estamos aplicando
    const newNextAdjustmentMonth = calculateNextAdjustmentMonth(
      contract.startMonth,
      contract.currentMonth + 1, // +1 porque estamos aplicando para el mes que viene
      contract.adjustmentIndex.frequencyMonths,
      contract.durationMonths
    );

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        baseRent: newRent,
        nextAdjustmentMonth: newNextAdjustmentMonth,
      },
      include: {
        tenant: { select: { name: true } },
        property: { select: { address: true } },
      },
    });

    results.push({
      contractId: updated.id,
      tenant: updated.tenant.name,
      property: updated.property.address,
      oldRent: contract.baseRent,
      newRent: newRent,
      increase: percentageIncrease,
      nextAdjustmentMonth: newNextAdjustmentMonth,
    });
  }

  return results;
};

/**
 * Apply ALL indices at once for next month contracts.
 * Iterates through all indices with currentValue > 0 and applies to their contracts.
 */
const applyAllNextMonthAdjustments = async (groupId) => {
  const indices = await prisma.adjustmentIndex.findMany({
    where: {
      groupId,
      currentValue: { gt: 0 },
    },
  });

  const allResults = [];

  for (const index of indices) {
    const results = await applyAdjustmentToNextMonthContracts(
      groupId,
      index.id,
      index.currentValue
    );

    if (results.length > 0) {
      allResults.push({
        index: { id: index.id, name: index.name, percentage: index.currentValue },
        contractsAdjusted: results.length,
        details: results,
      });
    }
  }

  return allResults;
};

module.exports = {
  calculateNextAdjustmentMonth,
  isAdjustmentMonth,
  getContractsWithAdjustmentThisMonth,
  getContractsWithAdjustmentNextMonth,
  applyAdjustmentToNextMonthContracts,
  applyAllNextMonthAdjustments,
};
