// Monthly Record Service - Core auto-generation and control logic
const { calculatePunitoryV2, getHolidaysForYear, round2 } = require('../utils/punitory');
const { calculateDebtPunitory } = require('./debtService');
const { calculateNextAdjustmentMonth } = require('./adjustmentService');
const { MONTH_NAMES } = require('../utils/constants');

const prisma = require('../lib/prisma');

/**
 * Calculate which calendar month/year corresponds to a given contract month number
 */
function getCalendarPeriod(contract, monthNumber) {
  const startDate = new Date(contract.startDate);
  // Month number relative to start: monthNumber startMonth = startDate month
  const monthsToAdd = monthNumber - contract.startMonth;
  const date = new Date(startDate.getFullYear(), startDate.getMonth() + monthsToAdd, 1);
  return {
    periodMonth: date.getMonth() + 1, // 1-12
    periodYear: date.getFullYear(),
  };
}

/**
 * Calculate which contract month number corresponds to a given calendar month/year
 */
function getMonthNumber(contract, periodMonth, periodYear) {
  const startDate = new Date(contract.startDate);
  const startCalMonth = startDate.getMonth() + 1;
  const startCalYear = startDate.getFullYear();

  const totalMonthsDiff = (periodYear - startCalYear) * 12 + (periodMonth - startCalMonth);
  return contract.startMonth + totalMonthsDiff;
}

/**
 * Check if a contract is active for a given month number
 */
function isContractActiveForMonth(contract, monthNumber) {
  // When startMonth > 1, monthNumber range is [startMonth .. startMonth + durationMonths - 1]
  const endMonth = contract.startMonth + contract.durationMonths - 1;
  if (!contract.active) return false;
  if (monthNumber < contract.startMonth || monthNumber > endMonth) return false;

  // For rescinded contracts, cap the active range at the rescission month number
  if (contract.rescindedAt) {
    const rescDate = new Date(contract.rescindedAt);
    const rescMonthNumber = getMonthNumber(contract, rescDate.getMonth() + 1, rescDate.getFullYear());
    return monthNumber <= Math.min(endMonth, rescMonthNumber);
  }

  return true;
}

/**
 * Returns the calendar {penaltyMonth, penaltyYear} for the penalty month of a rescinded contract
 * (the calendar month immediately following the rescission month)
 */
function getRescissionPenaltyPeriod(contract) {
  if (!contract.rescindedAt) return null;
  const rescDate = new Date(contract.rescindedAt);
  let penaltyMonth = rescDate.getMonth() + 2; // getMonth() is 0-indexed; +2 = next month in 1-indexed
  let penaltyYear = rescDate.getFullYear();
  if (penaltyMonth > 12) {
    penaltyMonth = 1;
    penaltyYear++;
  }
  return { penaltyMonth, penaltyYear };
}

/**
 * Calculate rent for a specific month considering adjustments
 */
async function calculateRentForMonth(contract, monthNumber) {
  // Buscar en el historial cuál era el rent vigente para este mes
  // El historial está ordenado por effectiveFromMonth descendente
  const rentHistory = await prisma.rentHistory.findFirst({
    where: {
      contractId: contract.id,
      effectiveFromMonth: { lte: monthNumber },
    },
    orderBy: {
      effectiveFromMonth: 'desc',
    },
  });

  if (rentHistory) {
    return rentHistory.rentAmount;
  }

  // Si no hay historial, usar baseRent (caso de contratos viejos sin historial)
  return contract.baseRent;
}

/**
 * Get or create monthly records for all active contracts in a group for a given period.
 * This is the core auto-generation function.
 *
 * OPTIMIZED: Uses batched queries instead of per-contract queries.
 * Before: 4-8 queries × N contracts = 600-1200 queries for 150 contracts
 * After: ~5 batch queries + individual creates/updates only for missing/changed records
 */
const getOrCreateMonthlyRecords = async (groupId, periodMonth, periodYear) => {
  const month = parseInt(periodMonth);
  const year = parseInt(periodYear);
  console.log(`[monthlyRecords] START month=${month} year=${year} groupId=${groupId}`);

  // Get all active contracts with related data
  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true },
    include: {
      tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } },
      contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
      property: {
        select: {
          id: true,
          address: true,
          category: { select: { id: true, name: true, color: true } },
          owner: { select: { id: true, name: true } },
        },
      },
      adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
    },
  });

  // Pre-filter active contracts and compute monthNumbers in memory
  const activeContracts = [];
  for (const contract of contracts) {
    const monthNumber = getMonthNumber(contract, month, year);

    // Check if this period is the penalty month for a rescinded contract
    if (contract.rescindedAt) {
      const penaltyPeriod = getRescissionPenaltyPeriod(contract);
      if (penaltyPeriod && penaltyPeriod.penaltyMonth === month && penaltyPeriod.penaltyYear === year) {
        // Include this contract as a penalty-only record
        const rescDate = new Date(contract.rescindedAt);
        const rescMonthNumber = getMonthNumber(contract, rescDate.getMonth() + 1, rescDate.getFullYear());
        activeContracts.push({ contract, monthNumber: rescMonthNumber + 1, isPenaltyRecord: true });
        continue;
      }
    }

    if (!isContractActiveForMonth(contract, monthNumber)) continue;
    activeContracts.push({ contract, monthNumber, isPenaltyRecord: false });
  }

  console.log(`[monthlyRecords] activeContracts=${activeContracts.length} of ${contracts.length} total`);
  if (activeContracts.length === 0) return [];

  const contractIds = activeContracts.map(ac => ac.contract.id);

  // --- BATCH 1: Fetch ALL existing monthly records for this period (1 query) ---
  const existingRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth: month,
      periodYear: year,
      contractId: { in: contractIds },
    },
    include: {
      services: {
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { createdAt: 'asc' },
      },
      debt: {
        include: {
          payments: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  const recordsByContractId = new Map();
  for (const r of existingRecords) {
    recordsByContractId.set(r.contractId, r);
  }

  // --- BATCH 2: Fetch ALL rent histories for active contracts (1 query) ---
  const allRentHistories = await prisma.rentHistory.findMany({
    where: { contractId: { in: contractIds } },
    orderBy: [
      { contractId: 'asc' },
      { effectiveFromMonth: 'desc' },
    ],
  });
  // Group by contractId, sorted desc by effectiveFromMonth
  const rentHistoriesByContractId = new Map();
  for (const rh of allRentHistories) {
    if (!rentHistoriesByContractId.has(rh.contractId)) {
      rentHistoriesByContractId.set(rh.contractId, []);
    }
    rentHistoriesByContractId.get(rh.contractId).push(rh);
  }

  // Helper: get rent for a specific month from batched data
  function getBatchedRentForMonth(contractId, monthNumber, baseRent) {
    const histories = rentHistoriesByContractId.get(contractId) || [];
    for (const rh of histories) {
      if (rh.effectiveFromMonth <= monthNumber) return rh.rentAmount;
    }
    return baseRent;
  }

  // --- BATCH 3: Fetch previous month records for balance calculation (1 simple query) ---
  // All contracts in the same calendar period have prevMonthNumber = monthNumber - 1,
  // which corresponds to the previous calendar month. Use simple period-based query.
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevRecordsByContractId = new Map();
  const prevRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth: prevMonth,
      periodYear: prevYear,
      contractId: { in: contractIds },
    },
    select: { contractId: true, balance: true },
  });
  for (const pr of prevRecords) {
    prevRecordsByContractId.set(pr.contractId, pr);
  }

  // --- BATCH 4: Get holidays once for the year (1 call instead of N) ---
  const holidays = await getHolidaysForYear(year);

  // --- BATCH 5: Bulk-create missing records (1 createMany instead of N creates) ---
  const recordsToCreate = [];
  const penaltyRecordsToSetup = []; // contracts needing penalty service after bulk create
  for (const { contract, monthNumber, isPenaltyRecord } of activeContracts) {
    if (recordsByContractId.has(contract.id)) continue;

    if (isPenaltyRecord) {
      // Penalty month: rent=0, total=penalty amount
      const penalty = contract.rescissionPenalty || 0;
      recordsToCreate.push({
        groupId,
        contractId: contract.id,
        monthNumber,
        periodMonth: month,
        periodYear: year,
        rentAmount: 0,
        includeIva: false,
        ivaAmount: 0,
        servicesTotal: penalty,
        previousBalance: 0,
        punitoryAmount: 0,
        punitoryDays: 0,
        totalDue: penalty,
        amountPaid: 0,
        balance: -penalty,
        comprobantesStatus: Array.isArray(contract.comprobantes) 
          ? contract.comprobantes.map(c => ({ ...c, presented: false })) 
          : [],
      });
      penaltyRecordsToSetup.push(contract);
    } else {
      const rentAmount = getBatchedRentForMonth(contract.id, monthNumber, contract.baseRent);
      let previousBalance = 0;
      if (monthNumber - 1 >= 1) {
        const prevRecord = prevRecordsByContractId.get(contract.id);
        if (prevRecord && prevRecord.balance > 0) {
          previousBalance = prevRecord.balance;
        }
      }
      const includeIva = !!contract.pagaIva;
      const ivaAmount = includeIva ? rentAmount * 0.21 : 0;
      const totalDue = rentAmount + ivaAmount - previousBalance;

      recordsToCreate.push({
        groupId,
        contractId: contract.id,
        monthNumber,
        periodMonth: month,
        periodYear: year,
        rentAmount,
        includeIva,
        ivaAmount,
        servicesTotal: 0,
        previousBalance,
        punitoryAmount: 0,
        punitoryDays: 0,
        totalDue: Math.max(totalDue, 0),
        amountPaid: 0,
        balance: -Math.max(totalDue, 0),
        comprobantesStatus: Array.isArray(contract.comprobantes) 
          ? contract.comprobantes.map(c => ({ ...c, presented: false })) 
          : [],
      });
    }
  }

  console.log(`[monthlyRecords] existing=${existingRecords.length} toCreate=${recordsToCreate.length}`);

  if (recordsToCreate.length > 0) {
    // --- FIX: Correct stale monthNumbers that would block createMany ---
    // When a contract's startDate is edited, existing records keep old monthNumbers.
    // This causes unique constraint conflicts when creating records for new periods.
    const monthNumbersNeeded = new Map(); // monthNumber -> contractId
    for (const r of recordsToCreate) {
      monthNumbersNeeded.set(`${r.contractId}_${r.monthNumber}`, r.contractId);
    }

    // Find existing records that occupy those monthNumbers but for a DIFFERENT period
    const contractIdsToCreate = [...new Set(recordsToCreate.map(r => r.contractId))];
    const monthNumberValues = recordsToCreate.map(r => r.monthNumber);
    const conflictingRecords = await prisma.monthlyRecord.findMany({
      where: {
        contractId: { in: contractIdsToCreate },
        monthNumber: { in: monthNumberValues },
        NOT: { periodMonth: month, periodYear: year },
      },
      select: { id: true, contractId: true, monthNumber: true, periodMonth: true, periodYear: true, amountPaid: true },
    });

    if (conflictingRecords.length > 0) {
      console.log(`[monthlyRecords] Fixing ${conflictingRecords.length} stale monthNumber conflicts`);
      const contractMap = new Map(activeContracts.map(ac => [ac.contract.id, ac.contract]));

      for (const cr of conflictingRecords) {
        const contract = contractMap.get(cr.contractId);
        if (!contract) continue;

        // Recalculate the correct monthNumber for the old record's actual period
        const correctMN = getMonthNumber(contract, cr.periodMonth, cr.periodYear);
        const endMonth = contract.startMonth + contract.durationMonths - 1;

        if (correctMN < contract.startMonth || correctMN > endMonth) {
          // Record is for a period outside the contract's active range
          if (cr.amountPaid > 0) {
            console.warn(`[monthlyRecords] Skipping out-of-range record with payments: ${cr.id}`);
            continue;
          }
          await prisma.monthlyRecord.delete({ where: { id: cr.id } });
        } else {
          // Update to the correct monthNumber
          await prisma.monthlyRecord.update({
            where: { id: cr.id },
            data: { monthNumber: correctMN },
          });
        }
      }
    }

    try {
      // skipDuplicates handles race conditions (another request already created the record)
      await prisma.monthlyRecord.createMany({
        data: recordsToCreate,
        skipDuplicates: true,
      });
    } catch (createErr) {
      // If createMany fails, fall back to individual creates with P2002 handling
      console.error(`[monthlyRecords] createMany failed, falling back to individual creates:`, createErr.message);
      for (const data of recordsToCreate) {
        try {
          await prisma.monthlyRecord.create({ data });
        } catch (err) {
          if (err.code !== 'P2002') throw err;
        }
      }
    }

    // Fetch the newly created records with full includes
    const newContractIds = recordsToCreate.map(r => r.contractId);
    const newRecords = await prisma.monthlyRecord.findMany({
      where: {
        groupId,
        periodMonth: month,
        periodYear: year,
        contractId: { in: newContractIds },
      },
      include: {
        services: {
          include: {
            conceptType: { select: { id: true, name: true, label: true, category: true } },
          },
        },
        transactions: {
          include: { concepts: true },
          orderBy: { createdAt: 'asc' },
        },
        debt: {
          include: {
            payments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    console.log(`[monthlyRecords] fetched ${newRecords.length} newly created records`);
    for (const r of newRecords) {
      recordsByContractId.set(r.contractId, r);
    }

    // Create MonthlyService for penalty records (rescission multa)
    if (penaltyRecordsToSetup.length > 0) {
      for (const contract of penaltyRecordsToSetup) {
        const penaltyRecord = recordsByContractId.get(contract.id);
        if (!penaltyRecord || contract.rescissionPenalty <= 0) continue;

        // Find or create the MULTA_RESCISION concept type for this group
        const conceptType = await prisma.conceptType.upsert({
          where: { groupId_name: { groupId: contract.groupId, name: 'MULTA_RESCISION' } },
          update: {},
          create: {
            groupId: contract.groupId,
            name: 'MULTA_RESCISION',
            label: 'Multa por rescisión',
            category: 'OTROS',
            isDefault: false,
          },
        });

        // Only create if service doesn't already exist
        const existing = await prisma.monthlyService.findFirst({
          where: { monthlyRecordId: penaltyRecord.id, conceptTypeId: conceptType.id },
        });
        if (!existing) {
          await prisma.monthlyService.create({
            data: {
              monthlyRecordId: penaltyRecord.id,
              conceptTypeId: conceptType.id,
              amount: contract.rescissionPenalty,
              description: 'Multa por rescisión anticipada del contrato',
            },
          });
        }
      }

      // Re-fetch records that had penalty services added so they have the service included
      const penaltyContractIds = penaltyRecordsToSetup.map(c => c.id);
      const updatedPenaltyRecords = await prisma.monthlyRecord.findMany({
        where: { groupId, periodMonth: month, periodYear: year, contractId: { in: penaltyContractIds } },
        include: {
          services: { include: { conceptType: { select: { id: true, name: true, label: true, category: true } } } },
          transactions: { include: { concepts: true }, orderBy: { createdAt: 'asc' } },
          debt: { include: { payments: { orderBy: { createdAt: 'asc' } } } },
        },
      });
      for (const r of updatedPenaltyRecords) {
        recordsByContractId.set(r.contractId, r);
      }
    }
  }

  // Batch: contratos con deudas abiertas (para marcar filas del mes actual)
  const contractIdsForDebt = activeContracts.map(({ contract }) => contract.id);
  const openDebtsForContracts = await prisma.debt.findMany({
    where: { contractId: { in: contractIdsForDebt }, status: { in: ['OPEN', 'PARTIAL'] } },
    select: { contractId: true },
  });
  const contractsWithOpenDebt = new Set(openDebtsForContracts.map(d => d.contractId));

  // --- BATCH 6: Preload all data needed for live debt/punitory calculations (Avoids N+1) ---
  const allDebts = [...recordsByContractId.values()].map(r => r.debt).filter(Boolean);
  const { preloadDebtDependencies } = require('./debtService');
  const debtPreloaded = allDebts.length > 0 
    ? await preloadDebtDependencies(allDebts) 
    : { contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() };
  
  // Inject current period data into the preloaded maps
  debtPreloaded.holidayMap.set(year, holidays);
  for (const r of recordsByContractId.values()) {
    debtPreloaded.monthlyRecordMap.set(r.id, r);
  }

  const updatesToPerform = [];
  const records = [];

  for (const { contract, monthNumber, isPenaltyRecord } of activeContracts) {
    let record = recordsByContractId.get(contract.id);

    if (!record) {
      console.error(`[monthlyRecords] MISSING record for contract ${contract.id} month=${monthNumber}`);
      continue; // Skip this contract instead of crashing
    }

    // Refresh rentAmount, IVA for ALL existing records (including COMPLETE)
    // Refresh previousBalance only for non-COMPLETE records
    // Skip rent refresh for penalty records (rent intentionally 0)
    if (record && !isPenaltyRecord) {
      const currentRent = getBatchedRentForMonth(contract.id, monthNumber, contract.baseRent);
      const rentChanged = currentRent !== record.rentAmount;

      // Sync includeIva from contract
      const contractIva = !!contract.pagaIva;
      const ivaChanged = contractIva !== record.includeIva;

      // Refresh previousBalance from batch (only for non-COMPLETE records)
      let latestPrevBalance = record.previousBalance;
      let prevBalanceChanged = false;
      if (record.status !== 'COMPLETE' && monthNumber - 1 >= 1) {
        const prevRecord = prevRecordsByContractId.get(contract.id);
        latestPrevBalance = (prevRecord && prevRecord.balance > 0) ? prevRecord.balance : 0;
        prevBalanceChanged = latestPrevBalance !== record.previousBalance;
      }

      if (rentChanged || prevBalanceChanged || ivaChanged) {
        const effectiveRent = rentChanged ? currentRent : record.rentAmount;
        const effectiveIva = ivaChanged ? contractIva : record.includeIva;
        const recordIva = round2(effectiveIva ? effectiveRent * 0.21 : 0);
        const newTotalDue = round2(effectiveRent + record.servicesTotal + record.punitoryAmount + recordIva - latestPrevBalance);
        const newBalance = round2(record.amountPaid - Math.max(newTotalDue, 0));

        const updateData = {
          previousBalance: latestPrevBalance,
          totalDue: Math.max(newTotalDue, 0),
          balance: newBalance,
        };
        if (rentChanged) {
          updateData.rentAmount = currentRent;
        }
        if (rentChanged || ivaChanged) {
          updateData.includeIva = effectiveIva;
          updateData.ivaAmount = recordIva;
        }

        // Recalculate status based on new amounts
        if (newBalance >= -0.01) {
          updateData.isPaid = true;
          updateData.status = 'COMPLETE';
          updateData.isCancelled = true;
          if (!record.fullPaymentDate) {
            updateData.fullPaymentDate = record.transactions?.[record.transactions.length - 1]?.paymentDate || new Date();
          }
        } else if (record.amountPaid > 0) {
          updateData.isPaid = false;
          updateData.status = 'PARTIAL';
          updateData.isCancelled = false;
          updateData.fullPaymentDate = null;
        } else {
          updateData.isPaid = false;
          updateData.status = 'PENDING';
          updateData.isCancelled = false;
          updateData.fullPaymentDate = null;
        }

        // Optimize: Don't perform a heavy include on every update inside a loop.
        // Queue data for batch chunked update to avoid sequential performance hit
        // and avoid saturating DB connection pool.
        updatesToPerform.push({
          id: record.id,
          data: updateData
        });
        
        // Update in-memory record so subsequent logic uses correct values
        Object.assign(record, updateData);
      }
    }

    // Calculate next adjustment info (recalcular si el valor de DB quedó en el pasado)
    let nextAdjustmentLabel = null;
    if (contract.nextAdjustmentMonth && contract.adjustmentIndex) {
      let effectiveNextAdj = contract.nextAdjustmentMonth;
      // Recalcular si quedó desfasado
      const start = new Date(contract.startDate);
      const now = new Date();
      const mDiff = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      const sm = contract.startMonth || 1;
      const realCurrentMonth = Math.max(sm, Math.min(sm + mDiff, sm + contract.durationMonths - 1));
      if (effectiveNextAdj < realCurrentMonth) {
        effectiveNextAdj = calculateNextAdjustmentMonth(
          contract.startMonth, realCurrentMonth, contract.adjustmentIndex.frequencyMonths, contract.durationMonths
        );
      }
      if (effectiveNextAdj) {
        const adjPeriod = getCalendarPeriod(contract, effectiveNextAdj);
        nextAdjustmentLabel = `${MONTH_NAMES[adjPeriod.periodMonth]} ${adjPeriod.periodYear}`;
      }
    }

    // Calcular datos de deuda en vivo si existe
    let debtInfo = null;

    if (record.debt && record.debt.status !== 'PAID') {
      // Optimize: skip individual debt updates and use preloaded data to avoid N+1 queries.
      const { amount, days, remainingDebt, unpaidAccumulatedPunitory, startDate, endDate, newPunitoryAmount } = await calculateDebtPunitory(record.debt, new Date(), debtPreloaded, true);
      debtInfo = {
        ...record.debt,
        liveAccumulatedPunitory: amount,
        livePunitoryDays: days,
        liveCurrentTotal: remainingDebt + (unpaidAccumulatedPunitory || 0) + amount,
        remainingDebt,
        unpaidAccumulatedPunitory: unpaidAccumulatedPunitory || 0,
        newPunitoryAmount: newPunitoryAmount || 0,
        punitoryFromDate: startDate,
        punitoryToDate: endDate,
      };
    } else if (record.debt) {
      debtInfo = { ...record.debt, liveCurrentTotal: 0, liveAccumulatedPunitory: 0, livePunitoryDays: 0, remainingDebt: 0, newPunitoryAmount: 0, punitoryFromDate: null, punitoryToDate: null };
    }

    // Calculate LIVE punitorios for display
    // IMPORTANT: record.punitoryAmount is the frozen value from the last payment.
    // We need to:
    // 1. Keep frozen punitorios that were not covered by payments
    // 2. Calculate additional LIVE punitorios on remaining unpaid rent since last payment
    let livePunitoryAmount = record.punitoryAmount || 0;
    let livePunitoryDays = record.punitoryDays || 0;
    const isFullyPaid = record.status === 'COMPLETE';

    let punitoriosAnteriores = 0;
    let punitoriosActuales = 0;

    if (!isFullyPaid && !record.punitoryForgiven) {
      try {
        const amountPaid = record.amountPaid || 0;
        const servicesTotal = record.servicesTotal || 0;
        const prevBalance = record.previousBalance || 0;
        const frozenPunitory = record.punitoryAmount || 0;
        const totalCredits = amountPaid + prevBalance;
        const ivaForPunitory = record.includeIva ? record.rentAmount * 0.21 : 0;

        // Saldo restante base (sin punitorios)
        const baseNonPunitory = record.rentAmount + servicesTotal + ivaForPunitory;
        const remainingBalance = Math.max(baseNonPunitory - totalCredits, 0);

        // Regla de base para punitorios:
        // - Sin pagos ni crédito: solo sobre alquiler
        // - Con pagos: sobre el saldo restante total
        const punitoryBase = totalCredits <= 0 ? record.rentAmount : remainingBalance;

        // Punitorios congelados no cubiertos (para sumar a los nuevos)
        let remaining = totalCredits;
        const servicesCovered = Math.min(remaining, servicesTotal);
        remaining -= servicesCovered;
        const rentCovered = Math.min(remaining, record.rentAmount);
        remaining -= rentCovered;
        const punitoryCovered = Math.min(remaining, frozenPunitory);
        const unpaidFrozenPunitory = Math.max(frozenPunitory - punitoryCovered, 0);

        // Get last payment date (if partial payment was made)
        let lastPaymentDate = null;
        if (record.transactions && record.transactions.length > 0) {
          const lastTx = record.transactions[record.transactions.length - 1];
          lastPaymentDate = new Date(lastTx.paymentDate);
        }

        const calculationDate = new Date();

        if (punitoryBase > 0) {
          const liveResult = calculatePunitoryV2(
            calculationDate,
            month,
            year,
            punitoryBase,
            contract.punitoryStartDay,
            contract.punitoryGraceDay,
            contract.punitoryPercent,
            holidays,
            lastPaymentDate
          );
          livePunitoryAmount = unpaidFrozenPunitory + liveResult.amount;
          livePunitoryDays = liveResult.days;
          punitoriosAnteriores = unpaidFrozenPunitory;
          punitoriosActuales = liveResult.amount;
        } else {
          livePunitoryAmount = unpaidFrozenPunitory;
          livePunitoryDays = record.punitoryDays || 0;
          punitoriosAnteriores = unpaidFrozenPunitory;
          punitoriosActuales = 0;
        }

      } catch (e) {
        console.error('[monthlyRecordService] Error calculating live punitory:', e.message);
        // If calculation fails, keep the stored values
      }
    }

    // Calculate IVA (21% of rent if includeIva is true)
    const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;

    // Live total = rent + services + live punitorios + IVA - a favor anterior
    const liveTotalDue = Math.max(record.rentAmount + record.servicesTotal + livePunitoryAmount + ivaAmount - record.previousBalance, 0);
    // Live balance = what was paid minus what is owed (with live punitorios)
    const liveBalance = Math.round((record.amountPaid - liveTotalDue) * 100) / 100;

    // TOTALES HISTÓRICOS: incluyen punitorios de la deuda (pagados + impagos)
    let totalPunitoriosHistoricos = livePunitoryAmount; // Punitorios del record
    let totalAbonado = record.amountPaid; // Lo pagado al record (ya incluye pagos de deuda)
    let totalHistorico = liveTotalDue; // Total con punitorios del record + IVA

    if (debtInfo && record.debt) {
      // Punitorios realmente pagados en el MonthlyRecord (imputación correcta en vez de sumar transacciones crudas)
      const totalCredits = record.amountPaid + record.previousBalance;
      const servicesCovered = Math.min(totalCredits, record.servicesTotal);
      const ivaCovered = Math.min(totalCredits - servicesCovered, record.ivaAmount);
      const rentCovered = Math.min(totalCredits - servicesCovered - ivaCovered, record.rentAmount);
      const recordPunitoriosPaid = Math.max(0, totalCredits - servicesCovered - ivaCovered - rentCovered);

      // En la deuda, dividimos claramente entre lo viejo (congelado) y lo nuevo (en vivo)
      const debtPunitoriosPagados = Math.max(0, record.debt.amountPaid - record.debt.unpaidRentAmount - (record.debt.unpaidServicesAmount || 0));
      
      // El total acumulado impago de la deuda que ya existía (antes de nuevos punitorios)
      const unpaidAccumulated = debtInfo.accumulatedPunitory - debtPunitoriosPagados;
      
      // Punitorios Anteriores: Lo pagado históricamente + lo viejo no pagado
      punitoriosAnteriores = recordPunitoriosPaid + debtPunitoriosPagados + Math.max(0, unpaidAccumulated);
      
      // Punitorios Actuales: Exclusivamente los nuevos punitorios en vivo
      punitoriosActuales = debtInfo.newPunitoryAmount || 0;

      // El total de punitorios en la historia
      totalPunitoriosHistoricos = punitoriosAnteriores + punitoriosActuales;

      // Corrección de días de mora para mostrar en el frontend
      livePunitoryDays = debtInfo.livePunitoryDays || 0;

      // Total coherente: lo pagado hasta ahora + lo que todavía se debe
      totalHistorico = Math.round((record.amountPaid + debtInfo.liveCurrentTotal) * 100) / 100;
    }

    records.push({
      ...record,
      debtInfo,
      ivaAmount,
      livePunitoryAmount,
      livePunitoryDays,
      liveTotalDue,
      liveBalance,
      // NUEVOS CAMPOS HISTÓRICOS
      totalPunitoriosHistoricos,  // Punitorios totales (record + deuda pagada + deuda impaga)
      punitoriosAnteriores,
      punitoriosActuales,
      totalAbonado,                // Total pagado (record + deuda)
      totalHistorico,              // Total real (alquiler + servicios + todos los punitorios)
      contractHasOpenDebt: contractsWithOpenDebt.has(contract.id),
      // Enriched data
      contractType: contract.contractType || 'INQUILINO',
      contract: {
        id: contract.id,
        contractType: contract.contractType || 'INQUILINO',
        startDate: contract.startDate,
        durationMonths: contract.durationMonths,
        currentMonth: contract.currentMonth,
        punitoryStartDay: contract.punitoryStartDay,
        punitoryGraceDay: contract.punitoryGraceDay,
        punitoryPercent: contract.punitoryPercent,
        nextAdjustmentMonth: contract.nextAdjustmentMonth,
        adjustmentIndex: contract.adjustmentIndex,
        pagaIva: contract.pagaIva,
      },
      tenant: contract.contractType === 'PROPIETARIO'
        ? null
        : (contract.tenant || null),
      tenants: contract.contractType === 'PROPIETARIO'
        ? []
        : (contract.contractTenants?.length > 0
          ? contract.contractTenants.map((ct) => ct.tenant)
          : contract.tenant ? [contract.tenant] : []),
      property: contract.property,
      owner: contract.property?.owner,
      periodLabel: `${MONTH_NAMES[month]} - Mes ${monthNumber - contract.startMonth + 1}`,
      nextAdjustmentLabel,
      // Ajuste de alquiler en este mes: comparar alquiler actual vs mes anterior
      ...(() => {
        if (monthNumber <= 1) return { tieneAjuste: false };
        const currentRent = record.rentAmount;
        const prevRent = getBatchedRentForMonth(contract.id, monthNumber - 1, contract.baseRent);
        if (currentRent === prevRent || prevRent === 0) return { tieneAjuste: false };
        const pct = ((currentRent - prevRent) / prevRent * 100).toFixed(1);
        return {
          tieneAjuste: true,
          ajustePorcentaje: parseFloat(pct),
          alquilerAnterior: prevRent,
        };
      })(),
      // Calculated fields for the view
      // IMPORTANTE: Cuando hay deuda, calcular balance sobre totales históricos
      aFavorNextMonth: (() => {
        let realBalance;
        if (debtInfo && record.debt) {
          // Si hay deuda (abierta o pagada), usar totales históricos
          realBalance = totalAbonado - totalHistorico;
        } else {
          // Sin deuda, usar balance del período actual
          realBalance = liveBalance;
        }
        return realBalance > 0 ? realBalance : 0;
      })(),
      debeNextMonth: (() => {
        let realBalance;
        if (debtInfo && record.debt) {
          // Si hay deuda (abierta o pagada), usar totales históricos
          realBalance = totalAbonado - totalHistorico;
        } else {
          // Sin deuda, usar balance del período actual
          realBalance = liveBalance;
        }
        return realBalance < 0 ? Math.abs(realBalance) : 0;
      })(),
      // Recalcular isCancelled y status en vivo para corregir redondeo de IVA
      ...(() => {
        if (debtInfo && debtInfo.status !== 'PAID') return {};
        let realBalance;
        if (debtInfo && record.debt) {
          realBalance = totalAbonado - totalHistorico;
        } else {
          realBalance = liveBalance;
        }
        const liveComplete = record.amountPaid > 0 && realBalance >= -1;
        if (liveComplete) {
          return { isCancelled: true, isPaid: true, status: 'COMPLETE' };
        }
        return {};
      })(),
      isPenaltyRecord: !!isPenaltyRecord,
    });
  }

  // Perform non-nested updates in small chunks to avoid pool exhaustion
  if (updatesToPerform.length > 0) {
    const CHUNK_SIZE = 5;
    console.log(`[monthlyRecords] Performing ${updatesToPerform.length} updates in chunks of ${CHUNK_SIZE}`);
    for (let i = 0; i < updatesToPerform.length; i += CHUNK_SIZE) {
      const chunk = updatesToPerform.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(update => 
        prisma.monthlyRecord.update({
          where: { id: update.id },
          data: update.data
        })
      ));
    }
  }

  return records;
};

/**
 * Recalculate a MonthlyRecord's totals after services or payment changes
 */
const recalculateMonthlyRecord = async (monthlyRecordId) => {
  // Leverage the gap-free downstream batch calculation to guarantee rolling balance consistency
  await recalculateMultipleRecords([monthlyRecordId]);

  // Return the fully updated record with expected payload footprint for legacy compatibility
  return prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    include: {
      services: {
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
};

/**
 * Helper to safely compare floats to 2 decimal places
 */
const _floatsDiffer = (a, b) => Math.abs((a || 0) - (b || 0)) >= 0.01;

/**
 * Core cascading recalculation logic (must run inside a valid transaction)
 */
const _recalculateCore = async (recordIds, tx) => {
  if (!recordIds || (Array.isArray(recordIds) && recordIds.length === 0)) return 0;
  
  const ids = Array.from(new Set(recordIds));
  
  // 1. Find the earliest affected monthNumber per contract to ensure downstream continuity
  const initialRecords = await tx.monthlyRecord.findMany({
    where: { id: { in: ids } },
    select: { contractId: true, monthNumber: true, periodYear: true } 
  });

  const minMonthsByContract = new Map();
  for (const r of initialRecords) {
    if (!minMonthsByContract.has(r.contractId) || r.monthNumber < minMonthsByContract.get(r.contractId).monthNumber) {
      minMonthsByContract.set(r.contractId, { monthNumber: r.monthNumber, periodYear: r.periodYear });
    }
  }

  const orConditions = Array.from(minMonthsByContract.entries()).map(([contractId, data]) => ({
    contractId,
    monthNumber: { gte: data.monthNumber },
    periodYear: data.periodYear // Strictly bound the cascade to the same calendar year
  }));

  if (orConditions.length === 0) return 0;

  // DB-BASED DISTRIBUTED LOCKING: Apply Postgres Advisory Transaction Locks
  // Protects identically against race conditions across multiple server instances (horizontally scaled)
  const sortedContractIds = Array.from(minMonthsByContract.keys()).sort();
  for (const contractId of sortedContractIds) {
    // hashtext is natively available in postgres to convert uuid to a lockable 32-bit int
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${contractId}'))`);
  }

  // 2. Pre-fetch records with services and transactions, sorted chronologically for rolling balances
  // This guarantees we process every month after the earliest modification point sequentially.
  const records = await tx.monthlyRecord.findMany({
    where: { OR: orConditions },
    include: {
      services: { include: { conceptType: { select: { category: true } } } },
      transactions: true,
    },
    orderBy: [
      { contractId: 'asc' },
      { monthNumber: 'asc' }
    ]
  });

  let numUpdated = 0;
  let currentContractId = null;
  let expectedNextMonthNumber = null;
  let runningPreviousBalance = null;

  for (const record of records) {
    let servicesTotal = 0;
    for (const s of record.services) {
      if (s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION') {
        servicesTotal -= Math.abs(s.amount);
      } else {
        servicesTotal += s.amount;
      }
    }

    const amountPaid = record.transactions.reduce((sum, t) => sum + t.amount, 0);

    let punitoryAmount = record.punitoryAmount;
    let punitoryDays = record.punitoryDays;
    let punitoryForgiven = false;
    if (record.transactions.length > 0) {
      const lastTx = record.transactions[record.transactions.length - 1];
      punitoryAmount = lastTx.punitoryForgiven ? 0 : lastTx.punitoryAmount;
      punitoryDays = lastTx.punitoryForgiven ? 0 : record.punitoryDays;
      punitoryForgiven = lastTx.punitoryForgiven;
    } else {
      punitoryAmount = 0;
      punitoryDays = 0;
    }

    // Determine the active previous balance
    const isNewContract = currentContractId !== record.contractId;
    const isGap = !isNewContract && record.monthNumber !== expectedNextMonthNumber;

    if (isGap) {
      throw new Error(`[Integridad] Secuencia rota para el contrato ${record.contractId}: salto del mes esperado ${expectedNextMonthNumber} al ${record.monthNumber}. Recalculo abortado.`);
    }

    const activePreviousBalance = isNewContract 
      ? record.previousBalance 
      : runningPreviousBalance;

    const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;
    const totalDue = record.rentAmount + servicesTotal + punitoryAmount + ivaAmount - activePreviousBalance;
    const balance = Math.round((amountPaid - Math.max(totalDue, 0)) * 100) / 100;
    const effectiveBalance = balance + (record.balanceForgiven || 0);

    // Update tracking variables for the next iteration
    currentContractId = record.contractId;
    expectedNextMonthNumber = record.monthNumber + 1;
    runningPreviousBalance = effectiveBalance;

    // Simple check for open debt
    const openDebt = await tx.debt.findFirst({
      where: { monthlyRecordId: record.id, status: { in: ['OPEN', 'PARTIAL'] } },
    });

    let status = 'PENDING';
    if (openDebt) {
      status = (amountPaid > 0) ? 'PARTIAL' : 'PENDING';
    } else if (effectiveBalance >= -1 && amountPaid > 0) {
      status = 'COMPLETE';
    } else if (amountPaid > 0) {
      status = 'PARTIAL';
    }

    const isPaid = status === 'COMPLETE';
    const fullPaymentDate = isPaid && !record.fullPaymentDate ? new Date() : (isPaid ? record.fullPaymentDate : null);

    // Early break calculation: Don't write to DB if absolutely nothing financially changed
    // Safe float precision matching
    const shouldUpdate = 
      _floatsDiffer(record.servicesTotal, servicesTotal) ||
      _floatsDiffer(record.punitoryAmount, punitoryAmount) ||
      record.punitoryDays !== punitoryDays ||
      record.punitoryForgiven !== punitoryForgiven ||
      _floatsDiffer(record.previousBalance, activePreviousBalance) ||
      _floatsDiffer(record.totalDue, Math.max(totalDue, 0)) ||
      _floatsDiffer(record.amountPaid, amountPaid) ||
      _floatsDiffer(record.balance, balance) ||
      record.status !== status ||
      record.isPaid !== isPaid ||
      record.isCancelled !== isPaid;

    if (shouldUpdate || ids.includes(record.id)) {
      await tx.monthlyRecord.update({
        where: { id: record.id },
        data: {
          servicesTotal,
          punitoryAmount,
          punitoryDays,
          punitoryForgiven,
          previousBalance: activePreviousBalance,
          totalDue: Math.max(totalDue, 0),
          amountPaid,
          balance,
          status,
          isPaid,
          isCancelled: isPaid,
          fullPaymentDate,
        }
      });
      numUpdated++;
    }
  }
  return numUpdated;
};

let isProcessingDirtyRecords = false;

const processDirtyRecords = async () => {
  if (isProcessingDirtyRecords) return;
  isProcessingDirtyRecords = true;

  try {
    let hasMore = true;
    while (hasMore) {
      // Find the first contract with dirty records
      const dirtyRecord = await prisma.monthlyRecord.findFirst({
        where: { needsRecalculation: true },
        select: { contractId: true },
      });

      if (!dirtyRecord) {
        hasMore = false;
        break;
      }

      await prisma.$transaction(async (tx) => {
        // Simple advisory lock mapping the contract UUID to an integer
        const lockValue = Array.from(dirtyRecord.contractId).reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockValue})`;

        const dirtyRecords = await tx.monthlyRecord.findMany({
          where: { contractId: dirtyRecord.contractId, needsRecalculation: true },
          select: { id: true },
          orderBy: { monthNumber: 'asc' }
        });

        if (dirtyRecords.length > 0) {
          const ids = dirtyRecords.map(r => r.id);
          
          await _recalculateCore(ids, tx);

          await tx.monthlyRecord.updateMany({
            where: { contractId: dirtyRecord.contractId, needsRecalculation: true },
            data: { needsRecalculation: false }
          });
        }
      }, { timeout: 30000 });
    }
  } catch (error) {
    console.error('[AsyncRecalculation] Error processing dirty records:', error);
  } finally {
    isProcessingDirtyRecords = false;
  }
};

const _markRecordsDirty = async (recordIds, txClient) => {
  const records = await txClient.monthlyRecord.findMany({
    where: { id: { in: recordIds } },
    select: { contractId: true, periodYear: true, periodMonth: true }
  });

  if (records.length === 0) return;

  const minMonthsByContractAndYear = new Map();
  for (const r of records) {
    const key = `${r.contractId}_${r.periodYear}`;
    if (!minMonthsByContractAndYear.has(key) || r.periodMonth < minMonthsByContractAndYear.get(key).periodMonth) {
      minMonthsByContractAndYear.set(key, { contractId: r.contractId, periodYear: r.periodYear, periodMonth: r.periodMonth });
    }
  }

  const orConditions = Array.from(minMonthsByContractAndYear.values()).map(r => ({
    contractId: r.contractId,
    periodYear: r.periodYear,
    periodMonth: { gte: r.periodMonth }
  }));

  if (orConditions.length > 0) {
    await txClient.monthlyRecord.updateMany({
      where: { OR: orConditions },
      data: { needsRecalculation: true }
    });
  }
};

/**
 * Recalculate multiple MonthlyRecords' totals.
 * Defaults to async dirty marking. Pass inline=true to force sync recalculation.
 */
const recalculateMultipleRecords = async (recordIds, tx = null, inline = false) => {
  if (!recordIds || recordIds.length === 0) return 0;

  if (inline) {
    if (tx) return _recalculateCore(recordIds, tx);
    return prisma.$transaction((t) => _recalculateCore(recordIds, t), { timeout: 30000 });
  }

  if (tx) {
    await _markRecordsDirty(recordIds, tx);
    setImmediate(processDirtyRecords);
    return 0;
  } else {
    await prisma.$transaction(async (t) => {
      await _markRecordsDirty(recordIds, t);
    });
    setImmediate(processDirtyRecords);
    return 0;
  }
};

/**
 * Get a single monthly record by ID with full relations
 */
const getMonthlyRecordById = async (groupId, id) => {
  const record = await prisma.monthlyRecord.findUnique({
    where: { id },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } },
          contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
          property: {
            select: {
              id: true,
              address: true,
              category: { select: { id: true, name: true, color: true } },
              owner: { select: { id: true, name: true } },
            },
          },
          adjustmentIndex: true,
        },
      },
      services: {
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!record || record.groupId !== groupId) return null;
  return record;
};

module.exports = {
  getOrCreateMonthlyRecords,
  recalculateMonthlyRecord,
  recalculateMultipleRecords,
  processDirtyRecords,
  getMonthlyRecordById,
  getCalendarPeriod,
  getMonthNumber,
  calculateRentForMonth,
};
