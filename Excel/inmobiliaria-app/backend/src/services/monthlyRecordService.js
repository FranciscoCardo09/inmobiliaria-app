// Monthly Record Service - Core auto-generation and control logic
const { calculatePunitoryV2, getHolidaysForYear } = require('../utils/punitory');
const { calculateDebtPunitory } = require('./debtService');

const prisma = require('../lib/prisma');

/**
 * Calculate which calendar month/year corresponds to a given contract month number
 */
function getCalendarPeriod(contract, monthNumber) {
  const startDate = new Date(contract.startDate);
  // Month number relative to start: monthNumber 1 = startDate month
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
  return monthNumber >= 1 && monthNumber <= contract.durationMonths && contract.active;
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
 */
const getOrCreateMonthlyRecords = async (groupId, periodMonth, periodYear) => {
  const month = parseInt(periodMonth);
  const year = parseInt(periodYear);

  // Get all active contracts with related data
  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true },
    include: {
      tenant: { select: { id: true, name: true, dni: true } },
      contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
      property: {
        select: {
          id: true,
          address: true,
          code: true,
          category: { select: { id: true, name: true, color: true } },
          owner: { select: { id: true, name: true } },
        },
      },
      adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
    },
  });

  const records = [];

  for (const contract of contracts) {
    const monthNumber = getMonthNumber(contract, month, year);

    // Skip if contract is not active for this month
    if (!isContractActiveForMonth(contract, monthNumber)) continue;

    // Check if record already exists
    let record = await prisma.monthlyRecord.findUnique({
      where: {
        contractId_periodMonth_periodYear: {
          contractId: contract.id,
          periodMonth: month,
          periodYear: year,
        },
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

    if (!record) {
      // Auto-generate the record
      const rentAmount = await calculateRentForMonth(contract, monthNumber);

      // Get previous month balance
      const prevMonthNumber = monthNumber - 1;
      let previousBalance = 0;
      if (prevMonthNumber >= 1) {
        const prevRecord = await prisma.monthlyRecord.findUnique({
          where: {
            contractId_monthNumber: {
              contractId: contract.id,
              monthNumber: prevMonthNumber,
            },
          },
          select: { balance: true },
        });
        if (prevRecord && prevRecord.balance > 0) {
          previousBalance = prevRecord.balance; // positive = a favor
        }
      }

      const totalDue = rentAmount - previousBalance; // Services start at 0, punitorios at 0

      record = await prisma.monthlyRecord.create({
        data: {
          groupId,
          contractId: contract.id,
          monthNumber,
          periodMonth: month,
          periodYear: year,
          rentAmount,
          servicesTotal: 0,
          previousBalance,
          punitoryAmount: 0,
          punitoryDays: 0,
          totalDue: Math.max(totalDue, 0),
          amountPaid: 0,
          balance: -Math.max(totalDue, 0),
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
        },
      });
    } else {
      // Record exists — refresh previousBalance from latest state of previous month
      // This handles the case where previous month was paid after this record was created
      const prevMonthNumber = monthNumber - 1;
      if (prevMonthNumber >= 1 && record.status !== 'COMPLETE') {
        const prevRecord = await prisma.monthlyRecord.findUnique({
          where: {
            contractId_monthNumber: {
              contractId: contract.id,
              monthNumber: prevMonthNumber,
            },
          },
          select: { balance: true },
        });
        const latestPrevBalance = (prevRecord && prevRecord.balance > 0) ? prevRecord.balance : 0;

        if (latestPrevBalance !== record.previousBalance) {
          // Update the record with the fresh previous balance
          const recordIva = record.includeIva ? record.rentAmount * 0.21 : 0;
          const newTotalDue = record.rentAmount + record.servicesTotal + record.punitoryAmount + recordIva - latestPrevBalance;
          const newBalance = record.amountPaid - Math.max(newTotalDue, 0);

          record = await prisma.monthlyRecord.update({
            where: { id: record.id },
            data: {
              previousBalance: latestPrevBalance,
              totalDue: Math.max(newTotalDue, 0),
              balance: newBalance,
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
        }
      }
    }

    // Calculate next adjustment info
    let nextAdjustmentLabel = null;
    if (contract.nextAdjustmentMonth && contract.adjustmentIndex) {
      const adjPeriod = getCalendarPeriod(contract, contract.nextAdjustmentMonth);
      const monthNames = [
        '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      nextAdjustmentLabel = `${monthNames[adjPeriod.periodMonth]} ${adjPeriod.periodYear}`;
    }

    const monthNames = [
      '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    // Calcular datos de deuda en vivo si existe
    let debtInfo = null;
    if (record.debt) {
      console.log('\n--- DEBT INFO CALCULATION ---');
      console.log('Record ID:', record.id);
      console.log('Contract:', contract.id);
      console.log('Debt status:', record.debt.status);
      console.log('Debt unpaidRentAmount:', record.debt.unpaidRentAmount);
      console.log('Debt amountPaid:', record.debt.amountPaid);
    }

    if (record.debt && record.debt.status !== 'PAID') {
      const { amount, days, startDate, endDate } = await calculateDebtPunitory(record.debt);
      const remainingDebt = Math.max(0, record.debt.unpaidRentAmount - record.debt.amountPaid);
      debtInfo = {
        ...record.debt,
        liveAccumulatedPunitory: amount,
        livePunitoryDays: days,
        liveCurrentTotal: remainingDebt + amount,
        remainingDebt,
        punitoryFromDate: startDate,
        punitoryToDate: endDate,
      };
      console.log('Debt NOT PAID - calculating live values');
      console.log('  remainingDebt:', remainingDebt);
      console.log('  liveCurrentTotal:', remainingDebt + amount);
    } else if (record.debt) {
      debtInfo = { ...record.debt, liveCurrentTotal: 0, liveAccumulatedPunitory: 0, livePunitoryDays: 0, remainingDebt: 0, punitoryFromDate: null, punitoryToDate: null };
      console.log('Debt PAID - setting values to 0');
    }

    if (debtInfo) {
      console.log('Final debtInfo.status:', debtInfo.status);
      console.log('--- END DEBT INFO CALCULATION ---\n');
    }

    // Calculate LIVE punitorios for display
    // IMPORTANT: record.punitoryAmount is the frozen value from the last payment.
    // We need to:
    // 1. Keep frozen punitorios that were not covered by payments
    // 2. Calculate additional LIVE punitorios on remaining unpaid rent since last payment
    let livePunitoryAmount = record.punitoryAmount || 0;
    let livePunitoryDays = record.punitoryDays || 0;
    const isFullyPaid = record.status === 'COMPLETE';

    if (!isFullyPaid && !record.punitoryForgiven) {
      try {
        // Calculate unpaid rent (payments cover services first, then rent, then punitorios)
        const amountPaid = record.amountPaid || 0;
        const servicesTotal = record.servicesTotal || 0;
        const prevBalance = record.previousBalance || 0;
        const frozenPunitory = record.punitoryAmount || 0;
        const totalCredits = amountPaid + prevBalance;
        
        // Credits cover: services → rent → frozen punitorios
        let remaining = totalCredits;
        const servicesCovered = Math.min(remaining, servicesTotal);
        remaining -= servicesCovered;
        const rentCovered = Math.min(remaining, record.rentAmount);
        remaining -= rentCovered;
        const punitoryCovered = Math.min(remaining, frozenPunitory);
        remaining -= punitoryCovered;
        
        const unpaidRent = Math.max(record.rentAmount - rentCovered, 0);
        const unpaidFrozenPunitory = Math.max(frozenPunitory - punitoryCovered, 0);

        // Get last payment date (if partial payment was made)
        let lastPaymentDate = null;
        if (record.transactions && record.transactions.length > 0) {
          const lastTx = record.transactions[record.transactions.length - 1];
          lastPaymentDate = new Date(lastTx.paymentDate);
        }

        // Calculate ADDITIONAL live punitorios on remaining unpaid rent since last payment
        const calculationDate = new Date();
        const holidays = await getHolidaysForYear(year);
        
        if (unpaidRent > 0) {
          // There's still unpaid rent → calculate live punitorios on it
          const liveResult = calculatePunitoryV2(
            calculationDate,
            month,
            year,
            unpaidRent,
            contract.punitoryStartDay,
            contract.punitoryGraceDay,
            contract.punitoryPercent,
            holidays,
            lastPaymentDate
          );
          // Total punitorios = frozen unpaid + new live
          livePunitoryAmount = unpaidFrozenPunitory + liveResult.amount;
          livePunitoryDays = liveResult.days;
        } else {
          // Rent fully paid → only unpaid frozen punitorios remain
          livePunitoryAmount = unpaidFrozenPunitory;
          livePunitoryDays = record.punitoryDays || 0;
        }

        console.log('\n[monthlyRecordService] LIVE PUNITORY CALCULATION:');
        console.log('  Record ID:', record.id);
        console.log('  Period:', `${month}/${year}`);
        console.log('  Rent amount:', record.rentAmount);
        console.log('  Amount paid:', amountPaid);
        console.log('  Services total:', servicesTotal);
        console.log('  Frozen punitory:', frozenPunitory);
        console.log('  Unpaid rent:', unpaidRent);
        console.log('  Unpaid frozen punitory:', unpaidFrozenPunitory);
        console.log('  Last payment date:', lastPaymentDate);
        console.log('  Calculation date:', calculationDate);
        console.log('  Live punitory amount:', livePunitoryAmount);
        console.log('  Live punitory days:', livePunitoryDays);
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
    const liveBalance = record.amountPaid - liveTotalDue;

    // TOTALES HISTÓRICOS: incluyen punitorios de la deuda (pagados + impagos)
    let totalPunitoriosHistoricos = livePunitoryAmount; // Punitorios del record
    let totalAbonado = record.amountPaid; // Lo pagado al record (ya incluye pagos de deuda)
    let totalHistorico = liveTotalDue; // Total con punitorios del record + IVA

    if (debtInfo && record.debt) {
      // Si hay deuda, los punitorios del record se "transfirieron" a la deuda
      // NO sumar ambos, usar SOLO los de la deuda (pagados + impagos)
      const debtPunitoriosPagados = Math.max(0, record.debt.amountPaid - record.debt.unpaidRentAmount);
      const debtPunitoriosImpagos = debtInfo.liveAccumulatedPunitory || 0;
      const debtPunitoriosTotales = debtPunitoriosPagados + debtPunitoriosImpagos;

      // IMPORTANTE: Reemplazar (no sumar) los punitorios del record con los de la deuda
      totalPunitoriosHistoricos = debtPunitoriosTotales;

      // NOTA: NO sumar debt.amountPaid porque record.amountPaid ya lo incluye
      // (cuando se paga la deuda, se actualiza MonthlyRecord.amountPaid en payDebt)

      // Total histórico = alquiler + servicios + punitorios de la deuda + IVA
      totalHistorico = record.rentAmount + record.servicesTotal + totalPunitoriosHistoricos + ivaAmount - record.previousBalance;

      console.log('\n[monthlyRecordService] HISTORICAL TOTALS WITH DEBT:');
      console.log('  Record punitorios (congelados):', livePunitoryAmount);
      console.log('  Debt punitorios pagados:', debtPunitoriosPagados);
      console.log('  Debt punitorios impagos:', debtPunitoriosImpagos);
      console.log('  TOTAL punitorios históricos (SOLO deuda):', totalPunitoriosHistoricos);
      console.log('  Record amountPaid (incluye pagos de deuda):', record.amountPaid);
      console.log('  Debt amountPaid:', record.debt.amountPaid);
      console.log('  TOTAL abonado:', totalAbonado);
      console.log('  TOTAL histórico:', totalHistorico);
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
      totalAbonado,                // Total pagado (record + deuda)
      totalHistorico,              // Total real (alquiler + servicios + todos los punitorios)
      // Enriched data
      contract: {
        id: contract.id,
        startDate: contract.startDate,
        durationMonths: contract.durationMonths,
        currentMonth: contract.currentMonth,
        punitoryStartDay: contract.punitoryStartDay,
        punitoryGraceDay: contract.punitoryGraceDay,
        punitoryPercent: contract.punitoryPercent,
        nextAdjustmentMonth: contract.nextAdjustmentMonth,
        adjustmentIndex: contract.adjustmentIndex,
      },
      tenant: contract.tenant || null,
      tenants: contract.contractTenants?.length > 0
        ? contract.contractTenants.map((ct) => ct.tenant)
        : contract.tenant ? [contract.tenant] : [],
      property: contract.property,
      owner: contract.property?.owner,
      periodLabel: `${monthNames[month]} - Mes ${monthNumber}`,
      nextAdjustmentLabel,
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
    });
  }

  return records;
};

/**
 * Recalculate a MonthlyRecord's totals after services or payment changes
 */
const recalculateMonthlyRecord = async (monthlyRecordId) => {
  const record = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    include: {
      services: true,
      transactions: true,
    },
  });

  if (!record) return null;

  // Sum services (DESCUENTO types subtract)
  const services = await prisma.monthlyService.findMany({
    where: { monthlyRecordId },
    include: { conceptType: { select: { category: true } } },
  });

  let servicesTotal = 0;
  for (const s of services) {
    if (s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION') {
      servicesTotal -= Math.abs(s.amount);
    } else {
      servicesTotal += s.amount;
    }
  }

  // Sum payments
  const amountPaid = record.transactions.reduce((sum, t) => sum + t.amount, 0);

  // Get latest punitory info from most recent transaction
  let punitoryAmount = record.punitoryAmount;
  let punitoryDays = record.punitoryDays;
  let punitoryForgiven = record.punitoryForgiven;
  if (record.transactions.length > 0) {
    const lastTx = record.transactions[record.transactions.length - 1];
    punitoryAmount = lastTx.punitoryForgiven ? 0 : lastTx.punitoryAmount;
    punitoryDays = lastTx.punitoryForgiven ? 0 : record.punitoryDays;
    punitoryForgiven = lastTx.punitoryForgiven;
  }

  const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;
  const totalDue = record.rentAmount + servicesTotal + punitoryAmount + ivaAmount - record.previousBalance;
  const balance = amountPaid - Math.max(totalDue, 0);

  // Check if there's an open debt for this record
  const openDebt = await prisma.debt.findFirst({
    where: {
      monthlyRecordId,
      status: { in: ['OPEN', 'PARTIAL'] },
    },
  });

  // Determine status: COMPLETE only if ALL is paid (rent + services + punitorios)
  let status = 'PENDING';
  if (openDebt) {
    // Si hay deuda abierta, NUNCA marcar como COMPLETE
    status = amountPaid > 0 ? 'PARTIAL' : 'PENDING';
  } else if (balance >= 0 && amountPaid > 0) {
    // Paid enough to cover everything including punitorios
    status = 'COMPLETE';
  } else if (amountPaid > 0) {
    status = 'PARTIAL';
  }

  const isPaid = status === 'COMPLETE';
  const fullPaymentDate = isPaid && !record.fullPaymentDate
    ? new Date()
    : (isPaid ? record.fullPaymentDate : null);

  return prisma.monthlyRecord.update({
    where: { id: monthlyRecordId },
    data: {
      servicesTotal,
      punitoryAmount,
      punitoryDays,
      punitoryForgiven,
      totalDue: Math.max(totalDue, 0),
      amountPaid,
      balance,
      status,
      isPaid,
      isCancelled: isPaid,
      fullPaymentDate,
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
    },
  });
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
          tenant: { select: { id: true, name: true, dni: true } },
          contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
          property: {
            select: {
              id: true,
              address: true,
              code: true,
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
  getMonthlyRecordById,
  getCalendarPeriod,
  getMonthNumber,
};
