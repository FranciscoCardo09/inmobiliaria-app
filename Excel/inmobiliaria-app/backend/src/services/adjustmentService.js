// Adjustment Service - LÓGICA CORREGIDA
// Los ajustes ocurren cada frequencyMonths A PARTIR del startMonth
// NO en múltiplos absolutos de frequencyMonths


const prisma = require('../lib/prisma');

// Helper: compute real current month from startDate
// When startMonth > 1, the contract was loaded mid-way, so current = startMonth + elapsed
const computeCurrentMonth = (contract) => {
  const start = new Date(contract.startDate);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  const sm = contract.startMonth || 1;
  const endMonth = sm + contract.durationMonths - 1;
  return Math.max(sm, Math.min(sm + monthsDiff, endMonth));
};

// Helper: get effective nextAdjustmentMonth, recalculating if DB value is stale
const getEffectiveNextAdj = (contract) => {
  if (!contract.nextAdjustmentMonth || !contract.adjustmentIndex) return contract.nextAdjustmentMonth;
  const realMonth = computeCurrentMonth(contract);
  if (contract.nextAdjustmentMonth < realMonth) {
    return calculateNextAdjustmentMonth(
      contract.startMonth, realMonth, contract.adjustmentIndex.frequencyMonths, contract.durationMonths
    );
  }
  return contract.nextAdjustmentMonth;
};

// Helper: asegura que el contrato tenga una fila de historial que cubra los meses
// ANTERIORES al ajuste. Sin ella, el recálculo de meses pasados cae en baseRent
// (que el ajuste acaba de pisar) y reescribe el alquiler histórico (caso Rezzonico).
const ensureBaselineHistory = async (contract, oldRent, targetMonth) => {
  const existing = await prisma.rentHistory.findFirst({
    where: { contractId: contract.id, effectiveFromMonth: { lt: targetMonth } },
    select: { id: true },
  });
  if (existing) return;
  await prisma.rentHistory.create({
    data: {
      contractId: contract.id,
      effectiveFromMonth: contract.startMonth || 1,
      rentAmount: oldRent,
      adjustmentPercent: null,
      reason: 'INICIAL',
    },
  });
};

// Helper: alquiler vigente ANTES de un mes dado, según historial (fallback baseRent)
const getRentBeforeMonth = async (contract, targetMonth) => {
  const lastHistory = await prisma.rentHistory.findFirst({
    where: { contractId: contract.id, effectiveFromMonth: { lt: targetMonth } },
    orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
  });
  return lastHistory ? lastHistory.rentAmount : contract.baseRent;
};

// Helper: get tenant name(s) from contract (supports multi-tenant)
const getTenantsNameAdj = (contract) => {
  if (contract.contractTenants && contract.contractTenants.length > 0) {
    return contract.contractTenants.map((ct) => ct.tenant.name).join(' / ');
  }
  return contract.tenant?.name || 'Sin inquilino';
};

// A-09 (AUDITORIA_FUNCIONAL_2026-07-10.md): ninguna de las tres funciones de
// ajuste (applyAdjustmentToCalendar, undoAdjustmentForMonth,
// undoAdjustmentForCalendar) validaba si el mes objetivo ya estaba
// pagado/cerrado antes de pisar rentAmount/baseRent — reabría meses ya
// cobrados y podía generar punitorios ficticios sobre un inquilino que pagó.
// Decisión del usuario (2026-07-12): bloquear (saltar el contrato, no abortar
// todo el lote) si el MonthlyRecord del mes objetivo está COMPLETE, tiene
// `amountPaid>0`, tiene transacciones registradas, o tiene una Debt asociada
// (mes ya cerrado). Fuente única: esta es la ÚNICA implementación del chequeo;
// las tres funciones la reutilizan.
const isMonthLocked = async (contractId, monthNumber) => {
  const record = await prisma.monthlyRecord.findFirst({
    where: { contractId, monthNumber },
    select: {
      status: true,
      amountPaid: true,
      debt: { select: { id: true } },
      transactions: { select: { id: true } },
    },
  });
  if (!record) return false; // el mes todavía no existe: nada que proteger
  return (
    record.status === 'COMPLETE' ||
    (record.amountPaid || 0) > 0 ||
    !!record.debt ||
    (record.transactions || []).length > 0
  );
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
  // Cuando startMonth > 1, el último mes es startMonth + durationMonths - 1
  const endMonth = startMonth + durationMonths - 1;
  return nextAdjustment <= endMonth ? nextAdjustment : null;
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
 * When startMonth > 1 (contract loaded mid-way), the first elapsed month maps to startMonth, not 1.
 * @param {Date} contractStartDate - Contract start date
 * @param {number} startMonth - Contract's startMonth (1-based, may be > 1 for mid-loaded contracts)
 * @param {number} calendarMonth - Calendar month (1-12)
 * @param {number} calendarYear - Calendar year
 * @returns {number} Contract month (startMonth-based)
 */
const calculateContractMonthFromCalendar = (contractStartDate, startMonth, calendarMonth, calendarYear) => {
  const startDate = new Date(contractStartDate);
  const targetDate = new Date(calendarYear, calendarMonth - 1, 1);

  // Calcular diferencia en meses desde startDate
  const yearDiff = targetDate.getFullYear() - startDate.getFullYear();
  const monthDiff = targetDate.getMonth() - startDate.getMonth();
  const monthsDiff = yearDiff * 12 + monthDiff;

  // startMonth + elapsed months (same formula as computeCurrentMonth and getMonthNumber)
  return (startMonth || 1) + monthsDiff;
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
      contract.startMonth,
      calendarMonth,
      calendarYear
    );

    // El mes debe estar dentro del rango del contrato
    const endMonth = contract.startMonth + contract.durationMonths - 1;
    if (contractMonth < contract.startMonth || contractMonth > endMonth) continue;

    // Usar isAdjustmentMonth para verificar si es mes de ajuste según la frecuencia
    // (no depende de nextAdjustmentMonth que cambia al aplicar)
    if (!isAdjustmentMonth(contract.startMonth, contractMonth, contract.adjustmentIndex.frequencyMonths)) {
      continue;
    }

    // Buscar registros de ajuste automático para este mes
    const rentHistoryRecords = await prisma.rentHistory.findMany({
      where: {
        contractId: contract.id,
        effectiveFromMonth: contractMonth,
        reason: 'AJUSTE_AUTOMATICO',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Determinar si ya fue aplicado (solo cuenta AJUSTE_AUTOMATICO, no INICIAL)
    const applied = rentHistoryRecords.length > 0;
    
    // El alquiler vigente en este período: buscar el último historial anterior o igual a este mes
    const lastHistoryBefore = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: contractMonth },
      },
      orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
    });

    // El alquiler ANTES del ajuste de este mes. Nunca caer directo en baseRent si el
    // contrato tiene historial: baseRent muta con cada ajuste y reescribiría meses
    // pasados (mismo bug que calculateRentForMonth ya evita en monthlyRecordService).
    let rentBeforeAdjustment;
    if (lastHistoryBefore) {
      rentBeforeAdjustment = lastHistoryBefore.rentAmount;
    } else if (rentHistoryRecords[0]?.adjustmentPercent) {
      // No hay fila anterior, pero el propio mes tiene un AJUSTE_AUTOMATICO con %:
      // derivar el valor previo a partir del porcentaje (no baseRent).
      const aj = rentHistoryRecords[0];
      rentBeforeAdjustment = Math.round(aj.rentAmount / (1 + aj.adjustmentPercent / 100));
    } else {
      // Sin fila anterior ni % derivable: usar la fila más antigua del historial
      // conocida (alquiler más viejo). baseRent solo si no hay historial en absoluto.
      const oldestHistory = await prisma.rentHistory.findFirst({
        where: { contractId: contract.id },
        orderBy: [{ effectiveFromMonth: 'asc' }, { createdAt: 'asc' }],
      });
      rentBeforeAdjustment = oldestHistory ? oldestHistory.rentAmount : contract.baseRent;
    }

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

  return contracts.filter((c) => getEffectiveNextAdj(c) === computeCurrentMonth(c));
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

  return contracts.filter((c) => getEffectiveNextAdj(c) === computeCurrentMonth(c) + 1);
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

  // Filtrar contratos donde el próximo ajuste efectivo === targetMonth
  return contracts.filter((c) => getEffectiveNextAdj(c) === targetMonth);
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

  // Solo contratos donde el próximo ajuste efectivo === currentMonth + 1
  const contractsToAdjust = allContracts.filter((c) => getEffectiveNextAdj(c) === computeCurrentMonth(c) + 1);

  const results = [];

  for (const contract of contractsToAdjust) {
    const realCurrentMonth = computeCurrentMonth(contract);
    const targetMonth = realCurrentMonth + 1; // Aplica desde el próximo mes

    // No duplicar: si ya hay un ajuste automático para ese mes, saltear
    const existingHistory = await prisma.rentHistory.findFirst({
      where: { contractId: contract.id, effectiveFromMonth: targetMonth, reason: 'AJUSTE_AUTOMATICO' },
    });
    if (existingHistory) continue;

    // Alquiler vigente según historial (no baseRent directo) + fila INICIAL si falta,
    // para que los meses anteriores al ajuste conserven su alquiler histórico.
    const currentRent = await getRentBeforeMonth(contract, targetMonth);
    await ensureBaselineHistory(contract, currentRent, targetMonth);
    const newRent = Math.round(currentRent * (1 + percentageIncrease / 100));

    // Calcular el siguiente mes de ajuste despues del que estamos aplicando
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
      oldRent: currentRent,
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
 * @param {string|null} contractId - Optional: apply ONLY to this contract
 * @returns {Promise<Array>} Results of applied adjustments
 */
const applyAdjustmentToSpecificMonth = async (groupId, indexId, percentageIncrease, targetMonth, contractId = null) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
      nextAdjustmentMonth: { not: null },
      ...(contractId ? { id: contractId } : {}),
    },
    include: {
      adjustmentIndex: { select: { frequencyMonths: true } },
    },
  });

  // Filtrar por el próximo ajuste efectivo (recalculado si el DB value es viejo)
  const contractsToApply = allContracts.filter((c) => getEffectiveNextAdj(c) === targetMonth);

  const results = [];

  for (const contract of contractsToApply) {
    // No duplicar: si ya hay un ajuste automático para ese mes, saltear
    const existingHistory = await prisma.rentHistory.findFirst({
      where: { contractId: contract.id, effectiveFromMonth: targetMonth, reason: 'AJUSTE_AUTOMATICO' },
    });
    if (existingHistory) continue;

    // Alquiler vigente según historial (no baseRent directo) + fila INICIAL si falta
    const currentRent = await getRentBeforeMonth(contract, targetMonth);
    await ensureBaselineHistory(contract, currentRent, targetMonth);
    const newRent = Math.round(currentRent * (1 + percentageIncrease / 100));

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
      oldRent: currentRent,
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

    // A-09: no revertir el ajuste de un mes ya pagado/cerrado.
    if (await isMonthLocked(contract.id, targetMonth)) {
      results.push({
        contractId: contract.id,
        tenant: getTenantsNameAdj(contract),
        property: contract.property.address,
        skipped: true,
        reason: 'El mes objetivo ya está pagado o cerrado; no se deshizo el ajuste.',
      });
      continue;
    }

    // Buscar el alquiler anterior (el registro inmediatamente anterior en el historial)
    const previousHistory = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: targetMonth },
      },
      orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
    });

    // Sin historial previo: derivar el alquiler anterior desde el % del ajuste que se
    // deshace. NUNCA usar contract.baseRent (ya contiene el ajuste → el undo no revertiría).
    const previousRent = previousHistory
      ? previousHistory.rentAmount
      : Math.round(history.rentAmount / (1 + (history.adjustmentPercent || 0) / 100));

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
const applyAdjustmentToCalendar = async (groupId, indexId, percentageIncrease, calendarMonth, calendarYear, contractId = null) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
      ...(contractId ? { id: contractId } : {}),
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
      contract.startMonth,
      calendarMonth,
      calendarYear
    );

    // Verificar que el mes esté dentro del rango del contrato
    const endMonth = contract.startMonth + contract.durationMonths - 1;
    if (contractMonth < contract.startMonth || contractMonth > endMonth) continue;

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

    // A-09: no reabrir un mes ya pagado/cerrado con un ajuste retroactivo.
    if (await isMonthLocked(contract.id, contractMonth)) {
      results.push({
        contractId: contract.id,
        tenant: getTenantsNameAdj(contract),
        property: contract.property.address,
        skipped: true,
        reason: 'El mes objetivo ya está pagado o cerrado; no se aplicó el ajuste.',
      });
      continue;
    }

    // Alquiler vigente según historial (no baseRent directo) + fila INICIAL si falta,
    // para que los meses anteriores al ajuste conserven su alquiler histórico.
    const currentRent = await getRentBeforeMonth(contract, contractMonth);
    await ensureBaselineHistory(contract, currentRent, contractMonth);
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
const undoAdjustmentForCalendar = async (groupId, indexId, calendarMonth, calendarYear, contractId = null) => {
  const allContracts = await prisma.contract.findMany({
    where: {
      groupId,
      active: true,
      adjustmentIndexId: indexId,
      ...(contractId ? { id: contractId } : {}),
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
      contract.startMonth,
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

    // A-09: no revertir el ajuste de un mes ya pagado/cerrado.
    if (await isMonthLocked(contract.id, contractMonth)) {
      results.push({
        contractId: contract.id,
        tenant: getTenantsNameAdj(contract),
        property: contract.property.address,
        skipped: true,
        reason: 'El mes objetivo ya está pagado o cerrado; no se deshizo el ajuste.',
      });
      continue;
    }

    // Buscar el alquiler anterior
    const previousHistory = await prisma.rentHistory.findFirst({
      where: {
        contractId: contract.id,
        effectiveFromMonth: { lt: contractMonth },
      },
      orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
    });

    // Sin historial previo: derivar el alquiler anterior desde el % del ajuste que se
    // deshace. NUNCA usar contract.baseRent (ya contiene el ajuste → el undo no revertiría).
    const previousRent = previousHistory
      ? previousHistory.rentAmount
      : Math.round(history.rentAmount / (1 + (history.adjustmentPercent || 0) / 100));

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
  computeCurrentMonth,
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
