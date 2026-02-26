// Adjustment Service - LÓGICA CORREGIDA
// Los ajustes ocurren cada frequencyMonths A PARTIR del startMonth
// NO en múltiplos absolutos de frequencyMonths


const prisma = require('../lib/prisma');

// Helper: compute real current month from startDate
const computeCurrentMonth = (contract) => {
  const start = new Date(contract.startDate);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  return Math.max(1, Math.min(monthsDiff + 1, contract.durationMonths));
};

// Helper: get tenant name(s) from contract (supports multi-tenant)
const getTenantsNameAdj = (contract) => {
  if (contract.contractTenants && contract.contractTenants.length > 0) {
    return contract.contractTenants.map((ct) => ct.tenant.name).join(' / ');
  }
  return contract.tenant?.name || 'Sin inquilino';
};

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

  // First adjustment is at startMonth + frequencyMonths (never at startMonth itself)
  let nextAdjustment = startMonth + frequencyMonths;

  // If we've passed that, find the next one
  if (currentMonth >= nextAdjustment) {
    const periodsPassed = Math.floor((currentMonth - startMonth) / frequencyMonths);
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
  if (currentMonth <= startMonth) return false; // No adjustment on first month
  return (currentMonth - startMonth) % frequencyMonths === 0;
};

/**
 * Calculate contract month from calendar date
 * @param {Date} contractStartDate - Contract start date
 * @param {number} calendarMonth - Calendar month (1-12)
 * @param {number} calendarYear - Calendar year
 * @returns {number} Contract month (1-based)
 */
const calculateContractMonthFromCalendar = (contractStartDate, calendarMonth, calendarYear) => {
  const startDate = new Date(contractStartDate);
  const targetDate = new Date(calendarYear, calendarMonth - 1, 1);
  
  // Calcular diferencia en meses
  const yearDiff = targetDate.getFullYear() - startDate.getFullYear();
  const monthDiff = targetDate.getMonth() - startDate.getMonth();
  const totalMonths = yearDiff * 12 + monthDiff + 1; // +1 porque el primer mes es 1
  
  return totalMonths;
};

/**
 * Get contracts that adjust in a specific calendar month/year
 * Uses isAdjustmentMonth() based on frequency to determine if a contract adjusts,
 * regardless of whether the adjustment was already applied or not.
 */
const getContractsWithAdjustmentInCalendar = async (groupId, calendarMonth, calendarYear) => {
  const contractInclude = {
    tenant: { select: { id: true, name: true, dni: true } },
    contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
    property: {
      select: {
        id: true,
        address: true,
        owner: { select: { id: true, name: true } }
      }
    },
    adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
  };

  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: { not: null },
    },
    include: contractInclude,
  });

  // Filtrar contratos que ajustan en este mes de calendario
  const contractsInMonth = [];
  
  for (const contract of allContracts) {
    if (!contract.adjustmentIndex) continue;
    
    const contractMonth = calculateContractMonthFromCalendar(
      contract.startDate,
      calendarMonth,
      calendarYear
    );
    
    // El mes debe estar dentro del rango del contrato
    if (contractMonth < 1 || contractMonth > contract.durationMonths) continue;
    
    // Usar isAdjustmentMonth para verificar si es mes de ajuste según la frecuencia
    // (no depende de nextAdjustmentMonth que cambia al aplicar)
    if (!isAdjustmentMonth(contract.startMonth, contractMonth, contract.adjustmentIndex.frequencyMonths)) {
      continue;
    }
    
    // Buscar TODOS los registros de historial para este mes
    const rentHistoryRecords = await prisma.rentHistory.findMany({
      where: {
        contractId: contract.id,
        effectiveFromMonth: contractMonth,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    // Determinar si ya fue aplicado (tiene al menos un registro de historial)
    const applied = rentHistoryRecords.length > 0;
    
    // El alquiler vigente en este período: buscar el último historial anterior o igual a este mes
    const lastHistoryBefore = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: contractMonth },
      },
      orderBy: { effectiveFromMonth: 'desc' },
    });
    
    // El alquiler ANTES del ajuste de este mes
    const rentBeforeAdjustment = lastHistoryBefore ? lastHistoryBefore.rentAmount : contract.baseRent;
    
    contractsInMonth.push({
      ...contract,
      contractMonth,
      rentHistory: rentHistoryRecords,
      applied,
      rentBeforeAdjustment,
    });
  }

  return contractsInMonth;
};

/**
 * Get contracts with adjustment this month
 * Usa nextAdjustmentMonth como fuente de verdad
 */
const getContractsWithAdjustmentThisMonth = async (groupId) => {
  const contractInclude = {
    tenant: { select: { id: true, name: true, dni: true } },
    contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
    property: {
      select: {
        id: true,
        address: true,
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

  return contracts.filter((c) => c.nextAdjustmentMonth === computeCurrentMonth(c));
};

/**
 * Get contracts with adjustment next month
 * Usa nextAdjustmentMonth como fuente de verdad
 */
const getContractsWithAdjustmentNextMonth = async (groupId) => {
  const contractInclude = {
    tenant: { select: { id: true, name: true, dni: true } },
    contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
    property: {
      select: {
        id: true,
        address: true,
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

  return contracts.filter((c) => c.nextAdjustmentMonth === computeCurrentMonth(c) + 1);
};

/**
 * Get contracts with adjustment in a specific month
 * @param {string} groupId - Group ID
 * @param {number} targetMonth - Target month (1-based, considering contract month)
 * @returns {Promise<Array>} Contracts that adjust in the target month
 */
const getContractsWithAdjustmentInMonth = async (groupId, targetMonth) => {
  const contractInclude = {
    tenant: { select: { id: true, name: true, dni: true } },
    contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
    property: {
      select: {
        id: true,
        address: true,
        owner: { select: { id: true, name: true } }
      }
    },
    adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
    rentHistory: {
      where: { effectiveFromMonth: targetMonth },
      orderBy: { createdAt: 'desc' },
    },
  };

  const contracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: { not: null },
      nextAdjustmentMonth: { not: null },
    },
    include: contractInclude,
  });

  // Filtrar contratos donde nextAdjustmentMonth === targetMonth
  return contracts.filter((c) => c.nextAdjustmentMonth === targetMonth);
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
  const contractsToAdjust = allContracts.filter((c) => c.nextAdjustmentMonth === computeCurrentMonth(c) + 1);

  const results = [];

  for (const contract of contractsToAdjust) {
    const realCurrentMonth = computeCurrentMonth(contract);
    const newRent = contract.baseRent * (1 + percentageIncrease / 100);

    // Calcular el siguiente mes de ajuste despues del que estamos aplicando
    const newNextAdjustmentMonth = calculateNextAdjustmentMonth(
      contract.startMonth,
      realCurrentMonth + 1, // +1 porque estamos aplicando para el mes que viene
      contract.adjustmentIndex.frequencyMonths,
      contract.durationMonths
    );

    // Guardar en el historial de alquileres
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: realCurrentMonth + 1, // Aplica desde el próximo mes
        rentAmount: newRent,
        adjustmentPercent: percentageIncrease,
        reason: 'AJUSTE_AUTOMATICO',
      },
    });

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        baseRent: newRent,
        nextAdjustmentMonth: newNextAdjustmentMonth,
      },
      include: {
        tenant: { select: { name: true } },
        contractTenants: { include: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { address: true } },
      },
    });

    results.push({
      contractId: updated.id,
      tenant: getTenantsNameAdj(updated),
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
 * Apply adjustment to contracts for a specific month
 * @param {string} groupId - Group ID
 * @param {string} indexId - Adjustment index ID
 * @param {number} percentageIncrease - Percentage to increase
 * @param {number} targetMonth - Target month to apply the adjustment
 * @returns {Promise<Array>} Results of applied adjustments
 */
const applyAdjustmentToSpecificMonth = async (groupId, indexId, percentageIncrease, targetMonth) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
      nextAdjustmentMonth: targetMonth,
    },
    include: {
      adjustmentIndex: { select: { frequencyMonths: true } },
    },
  });

  const results = [];

  for (const contract of allContracts) {
    const newRent = contract.baseRent * (1 + percentageIncrease / 100);

    // Calcular el siguiente mes de ajuste después del que estamos aplicando
    const newNextAdjustmentMonth = calculateNextAdjustmentMonth(
      contract.startMonth,
      targetMonth,
      contract.adjustmentIndex.frequencyMonths,
      contract.durationMonths
    );

    // Guardar en el historial de alquileres
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: targetMonth,
        rentAmount: newRent,
        adjustmentPercent: percentageIncrease,
        reason: 'AJUSTE_AUTOMATICO',
      },
    });

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        baseRent: newRent,
        nextAdjustmentMonth: newNextAdjustmentMonth,
      },
      include: {
        tenant: { select: { name: true } },
        contractTenants: { include: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { address: true } },
      },
    });

    results.push({
      contractId: updated.id,
      tenant: getTenantsNameAdj(updated),
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
 * Undo adjustment for a specific month
 * Reverts the rent to the previous value and deletes the rent history entry
 * @param {string} groupId - Group ID
 * @param {string} indexId - Adjustment index ID
 * @param {number} targetMonth - Month to undo
 * @returns {Promise<Array>} Results of undone adjustments
 */
const undoAdjustmentForMonth = async (groupId, indexId, targetMonth) => {
  // Buscar todos los contratos que tienen ajuste aplicado en ese mes
  const rentHistories = await prisma.rentHistory.findMany({
    where: {
      effectiveFromMonth: targetMonth,
      reason: 'AJUSTE_AUTOMATICO',
      contract: {
        groupId,
        adjustmentIndexId: indexId,
        active: true,
      },
    },
    include: {
      contract: {
        include: {
          adjustmentIndex: { select: { frequencyMonths: true } },
          tenant: { select: { name: true } },
        contractTenants: { include: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
          property: { select: { address: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const results = [];

  for (const history of rentHistories) {
    const contract = history.contract;

    // Buscar el alquiler anterior (el registro inmediatamente anterior en el historial)
    const previousHistory = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: targetMonth },
      },
      orderBy: { effectiveFromMonth: 'desc' },
    });

    const previousRent = previousHistory ? previousHistory.rentAmount : contract.baseRent;

    // Restaurar el nextAdjustmentMonth al valor que tenía (targetMonth)
    const restoredNextAdjustmentMonth = targetMonth;

    // Revertir el contrato
    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        baseRent: previousRent,
        nextAdjustmentMonth: restoredNextAdjustmentMonth,
      },
    });

    // Eliminar el registro del historial
    await prisma.rentHistory.delete({
      where: { id: history.id },
    });

    results.push({
      contractId: updated.id,
      tenant: getTenantsNameAdj(contract),
      property: contract.property.address,
      currentRent: history.rentAmount,
      restoredRent: previousRent,
      undoneMonth: targetMonth,
    });
  }

  return results;
};

/**
 * Apply adjustment to contracts for a specific calendar month/year
 */
const applyAdjustmentToCalendar = async (groupId, indexId, percentageIncrease, calendarMonth, calendarYear) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
    },
    include: {
      adjustmentIndex: { select: { frequencyMonths: true } },
      tenant: { select: { name: true } },
      property: { select: { address: true } },
    },
  });

  const results = [];

  for (const contract of allContracts) {
    const contractMonth = calculateContractMonthFromCalendar(
      contract.startDate,
      calendarMonth,
      calendarYear
    );
    
    // Verificar que el mes esté dentro del rango del contrato
    if (contractMonth < 1 || contractMonth > contract.durationMonths) continue;
    
    // Usar isAdjustmentMonth basado en la frecuencia para determinar si ajusta
    if (!isAdjustmentMonth(contract.startMonth, contractMonth, contract.adjustmentIndex.frequencyMonths)) {
      continue;
    }
    
    // Verificar que no haya sido ya aplicado para este mes
    const existingHistory = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: contractMonth,
        reason: 'AJUSTE_AUTOMATICO',
      },
    });
    
    if (existingHistory) continue; // Ya fue aplicado, no duplicar
    
    // Buscar el alquiler anterior para calcular el nuevo
    const lastHistory = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: contractMonth },
      },
      orderBy: { effectiveFromMonth: 'desc' },
    });
    
    const currentRent = lastHistory ? lastHistory.rentAmount : contract.baseRent;
    const newRent = Math.round(currentRent * (1 + percentageIncrease / 100));

    // Calcular el siguiente mes de ajuste después del que estamos aplicando
    const newNextAdjustmentMonth = calculateNextAdjustmentMonth(
      contract.startMonth,
      contractMonth,
      contract.adjustmentIndex.frequencyMonths,
      contract.durationMonths
    );

    // Guardar en el historial de alquileres
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: contractMonth,
        rentAmount: newRent,
        adjustmentPercent: percentageIncrease,
        reason: 'AJUSTE_AUTOMATICO',
      },
    });

    // Actualizar el contrato: baseRent y nextAdjustmentMonth
    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        baseRent: newRent,
        nextAdjustmentMonth: newNextAdjustmentMonth,
      },
    });

    results.push({
      contractId: updated.id,
      tenant: getTenantsNameAdj(contract),
      property: contract.property.address,
      oldRent: currentRent,
      newRent: newRent,
      increase: percentageIncrease,
      nextAdjustmentMonth: newNextAdjustmentMonth,
    });
  }

  return results;
};

/**
 * Undo adjustment for a specific calendar month/year
 */
const undoAdjustmentForCalendar = async (groupId, indexId, calendarMonth, calendarYear) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
    },
    include: {
      adjustmentIndex: { select: { frequencyMonths: true } },
      tenant: { select: { name: true } },
      property: { select: { address: true } },
    },
  });

  const results = [];

  for (const contract of allContracts) {
    const contractMonth = calculateContractMonthFromCalendar(
      contract.startDate,
      calendarMonth,
      calendarYear
    );

    // Verificar que sea un mes de ajuste según la frecuencia
    if (!isAdjustmentMonth(contract.startMonth, contractMonth, contract.adjustmentIndex.frequencyMonths)) {
      continue;
    }

    // Buscar ajuste aplicado para este mes
    const history = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: contractMonth,
        reason: 'AJUSTE_AUTOMATICO',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!history) continue;

    // Buscar el alquiler anterior
    const previousHistory = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: contractMonth },
      },
      orderBy: { effectiveFromMonth: 'desc' },
    });

    const previousRent = previousHistory ? previousHistory.rentAmount : contract.baseRent;

    // Restaurar el nextAdjustmentMonth al mes que estamos deshaciendo
    const restoredNextAdjustmentMonth = contractMonth;

    // Revertir el contrato
    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        baseRent: previousRent,
        nextAdjustmentMonth: restoredNextAdjustmentMonth,
      },
    });

    // Eliminar el registro del historial
    await prisma.rentHistory.delete({
      where: { id: history.id },
    });

    results.push({
      contractId: contract.id,
      tenant: getTenantsNameAdj(contract),
      property: contract.property.address,
      currentRent: history.rentAmount,
      restoredRent: previousRent,
      undoneMonth: contractMonth,
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
  calculateContractMonthFromCalendar,
  getContractsWithAdjustmentThisMonth,
  getContractsWithAdjustmentNextMonth,
  getContractsWithAdjustmentInMonth,
  getContractsWithAdjustmentInCalendar,
  applyAdjustmentToNextMonthContracts,
  applyAdjustmentToSpecificMonth,
  applyAdjustmentToCalendar,
  undoAdjustmentForMonth,
  undoAdjustmentForCalendar,
  applyAllNextMonthAdjustments,
};
