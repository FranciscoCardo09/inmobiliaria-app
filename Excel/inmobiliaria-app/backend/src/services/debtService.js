// Debt Service - Gestión de deudas con punitorios acumulados
const { PrismaClient } = require('@prisma/client');
const { calculatePunitoryV2, getHolidaysForYear } = require('../utils/punitory');

const prisma = new PrismaClient();

// Helper: parse a date string as local midnight (avoids UTC shift)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return new Date();
  const s = String(dateStr).replace(/T.*/, '');
  const parts = s.split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  return new Date(dateStr);
};

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Calcular imputación de pagos parciales: servicios primero, luego alquiler.
 * Retorna cuánto queda impago de alquiler.
 */
function calculateImputation(monthlyRecord) {
  const rentAmount = monthlyRecord.rentAmount || 0;
  const servicesTotal = monthlyRecord.servicesTotal || 0;
  const punitoryAmount = monthlyRecord.punitoryAmount || 0;
  const amountPaid = monthlyRecord.amountPaid || 0;

  // Imputar primero a servicios, luego a alquiler, luego a punitorios
  let remaining = amountPaid;

  // 1. Cubrir servicios
  const servicesCovered = Math.min(remaining, servicesTotal);
  remaining -= servicesCovered;

  // 2. Cubrir alquiler
  const rentCovered = Math.min(remaining, rentAmount);
  remaining -= rentCovered;

  // 3. Cubrir punitorios del record (si quedaron fondos)
  const punitoryCovered = Math.min(remaining, punitoryAmount);

  const unpaidRent = rentAmount - rentCovered;
  const unpaidPunitory = punitoryAmount - punitoryCovered;

  return {
    servicesCovered,
    rentCovered,
    punitoryCovered,
    unpaidRent,
    unpaidPunitory,
    totalOriginal: rentAmount + servicesTotal + punitoryAmount,
    totalUnpaid: unpaidRent + unpaidPunitory,
  };
}

/**
 * Crear deuda a partir de un MonthlyRecord impago/parcial.
 * Se llama durante el cierre mensual.
 */
const createDebtFromMonthlyRecord = async (monthlyRecord, contract) => {
  console.log('\n========== CREATE DEBT FROM MONTHLY RECORD ==========');
  console.log('MonthlyRecord ID:', monthlyRecord.id);
  console.log('MonthlyRecord data:');
  console.log('  - rentAmount:', monthlyRecord.rentAmount);
  console.log('  - servicesTotal:', monthlyRecord.servicesTotal);
  console.log('  - amountPaid:', monthlyRecord.amountPaid);
  console.log('  - punitoryAmount (frozen):', monthlyRecord.punitoryAmount);
  console.log('  - status:', monthlyRecord.status);

  // Verificar que no exista deuda para este record
  const existing = await prisma.debt.findUnique({
    where: { monthlyRecordId: monthlyRecord.id },
  });
  if (existing) {
    console.log('DEBT ALREADY EXISTS - skipping');
    console.log('========== END CREATE DEBT ==========\n');
    return existing;
  }

  // CRITICAL: Calculate CURRENT accumulated punitorios at time of closing
  // The monthlyRecord.punitoryAmount is frozen from the last payment, but punitorios
  // continue to accumulate. We need to calculate the LIVE punitorios now.
  let currentPunitoryAmount = monthlyRecord.punitoryAmount || 0;

  if (monthlyRecord.status !== 'COMPLETE' && !monthlyRecord.punitoryForgiven) {
    try {
      // Calculate unpaid rent (payments cover services first, then rent)
      const amountPaid = monthlyRecord.amountPaid || 0;
      const servicesTotal = monthlyRecord.servicesTotal || 0;
      const prevBalance = monthlyRecord.previousBalance || 0;
      const totalCredits = amountPaid + prevBalance;
      const paidTowardRent = Math.max(totalCredits - servicesTotal, 0);
      const unpaidRent = Math.max(monthlyRecord.rentAmount - paidTowardRent, 0);

      // Get last payment date (if partial payment was made)
      let lastPaymentDate = null;
      if (monthlyRecord.transactions && monthlyRecord.transactions.length > 0) {
        const lastTx = monthlyRecord.transactions[monthlyRecord.transactions.length - 1];
        lastPaymentDate = new Date(lastTx.paymentDate);
      }

      // Calculate until NOW (when closing the month)
      const calculationDate = new Date();
      const holidays = await getHolidaysForYear(monthlyRecord.periodYear);

      const liveResult = calculatePunitoryV2(
        calculationDate,
        monthlyRecord.periodMonth,
        monthlyRecord.periodYear,
        unpaidRent,
        contract.punitoryStartDay,
        contract.punitoryGraceDay,
        contract.punitoryPercent,
        holidays,
        lastPaymentDate
      );

      currentPunitoryAmount = liveResult.amount;

      console.log('LIVE PUNITORY CALCULATION (at closing):');
      console.log('  - Unpaid rent:', unpaidRent);
      console.log('  - Last payment date:', lastPaymentDate);
      console.log('  - Calculation date:', calculationDate);
      console.log('  - Frozen punitoryAmount:', monthlyRecord.punitoryAmount);
      console.log('  - CURRENT punitoryAmount:', currentPunitoryAmount);
    } catch (error) {
      console.error('Error calculating live punitorios:', error);
      // Fallback to frozen value if calculation fails
    }
  }

  // Create a modified monthlyRecord with current punitorios for imputation calculation
  const recordWithCurrentPunitorios = {
    ...monthlyRecord,
    punitoryAmount: currentPunitoryAmount,
  };

  const { unpaidRent, unpaidPunitory, totalOriginal, totalUnpaid, servicesCovered, rentCovered, punitoryCovered } = calculateImputation(recordWithCurrentPunitorios);

  console.log('Imputation calculation:');
  console.log('  - totalOriginal:', totalOriginal);
  console.log('  - servicesCovered:', servicesCovered);
  console.log('  - rentCovered:', rentCovered);
  console.log('  - punitoryCovered:', punitoryCovered);
  console.log('  - unpaidRent:', unpaidRent);
  console.log('  - unpaidPunitory:', unpaidPunitory);
  console.log('  - totalUnpaid:', totalUnpaid);

  // Si no queda nada impago (ni alquiler ni punitorios), no crear deuda
  if (totalUnpaid <= 0) {
    console.log('NO UNPAID AMOUNT - not creating debt');
    console.log('========== END CREATE DEBT ==========\n');
    return null;
  }

  // Fecha desde donde cuentan punitorios
  // Como la deuda se crea sin pagos (amountPaid=0), los punitorios comienzan
  // desde el día 1 del mes o desde el último pago del MonthlyRecord
  let punitoryStartDate;

  if (monthlyRecord.transactions && monthlyRecord.transactions.length > 0) {
    // Si hubo pagos parciales en el MonthlyRecord, punitorios desde el último pago
    const lastTx = monthlyRecord.transactions[monthlyRecord.transactions.length - 1];
    punitoryStartDate = new Date(lastTx.paymentDate);
  } else {
    // No hubo pagos: punitorios desde día 1 del mes del período
    punitoryStartDate = new Date(monthlyRecord.periodYear, monthlyRecord.periodMonth - 1, 1);
  }

  console.log('Punitory calculation:');
  console.log('  - punitoryStartDate:', punitoryStartDate);

  // IMPORTANTE: unpaidRent ya refleja los pagos aplicados del MonthlyRecord
  // Por lo tanto, la deuda se crea con amountPaid = 0 (sin pagos adicionales)
  // El pago del MonthlyRecord ya fue contabilizado al calcular unpaidRent
  const initialDebtPaid = 0;

  // Guardar cuánto se pagó del MonthlyRecord antes de crear la deuda (para información al usuario)
  const previousRecordPayment = monthlyRecord.amountPaid || 0;

  console.log('Initial debt paid calculation:');
  console.log('  - unpaidRent (after applying MonthlyRecord.amountPaid):', unpaidRent);
  console.log('  - previousRecordPayment (what was paid before closing):', previousRecordPayment);
  console.log('  - initialDebtPaid (new debt starts unpaid):', initialDebtPaid);

  const initialStatus = 'OPEN'; // Siempre OPEN al crear, se actualizará cuando se pague
  console.log('  - CALCULATED STATUS:', initialStatus);

  const periodLabel = `${monthNames[monthlyRecord.periodMonth]} ${monthlyRecord.periodYear}`;

  const debt = await prisma.debt.create({
    data: {
      groupId: contract.groupId,
      contractId: contract.id,
      monthlyRecordId: monthlyRecord.id,
      periodLabel,
      periodMonth: monthlyRecord.periodMonth,
      periodYear: monthlyRecord.periodYear,
      originalAmount: totalOriginal,
      unpaidRentAmount: unpaidRent,
      previousRecordPayment, // Cuánto pagó antes de cerrar (para mostrar al usuario)
      accumulatedPunitory: unpaidPunitory, // Punitorios impagos del MonthlyRecord
      currentTotal: unpaidRent + unpaidPunitory, // Total impago (alquiler + punitorios del record)
      amountPaid: initialDebtPaid, // Siempre 0 al crear (pagos de la deuda)
      punitoryPercent: contract.punitoryPercent,
      punitoryStartDate,
      lastPaymentDate: null, // No hay pagos aún en la deuda
      status: initialStatus, // Siempre OPEN al crear
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          property: { select: { id: true, address: true, code: true } },
        },
      },
    },
  });

  console.log('DEBT CREATED:');
  console.log('  - id:', debt.id);
  console.log('  - unpaidRentAmount:', debt.unpaidRentAmount);
  console.log('  - accumulatedPunitory:', debt.accumulatedPunitory);
  console.log('  - amountPaid:', debt.amountPaid);
  console.log('  - currentTotal:', debt.currentTotal);
  console.log('  - status:', debt.status);
  console.log('========== END CREATE DEBT ==========\n');

  return debt;
};

/**
 * Calcular punitorios acumulados para una deuda a una fecha dada.
 * Ahora usa calculatePunitoryV2 para consistencia con el resto del sistema.
 */
const calculateDebtPunitory = async (debt, paymentDate = new Date()) => {
  console.log('\n[debtService] CALCULATE DEBT PUNITORY:');
  console.log('  Debt ID:', debt.id);
  console.log('  Period:', `${debt.periodMonth}/${debt.periodYear}`);
  console.log('  Payment date:', paymentDate);

  // Los punitorios acumulados son los del MonthlyRecord que quedaron impagos
  const accumulatedPunitory = debt.accumulatedPunitory || 0;

  // La deuda base sobre la que se calculan punitorios es SOLO el alquiler impago
  // NO calculamos punitorios sobre punitorios (anatocismo)
  const remainingRent = Math.max(debt.unpaidRentAmount - debt.amountPaid, 0);

  console.log('  Unpaid rent amount:', debt.unpaidRentAmount);
  console.log('  Amount paid on debt:', debt.amountPaid);
  console.log('  Remaining rent:', remainingRent);
  console.log('  Accumulated punitory (stored):', accumulatedPunitory);

  // Si no queda renta impaga, calcular punitorios sobre los punitorios acumulados impagos
  if (remainingRent <= 0) {
    console.log('  -> Rent fully paid, calculating punitorios on unpaid punitorios');

    // IMPORTANTE: Primero calcular nuevos punitorios sobre los punitorios acumulados del período
    // Obtener configuración del contrato
    const contract = await prisma.contract.findUnique({
      where: { id: debt.contractId },
      select: {
        punitoryStartDay: true,
        punitoryGraceDay: true,
        punitoryPercent: true,
      },
    });

    if (!contract) {
      throw new Error('Contract not found for debt');
    }

    const holidays = await getHolidaysForYear(debt.periodYear);
    const lastPaymentDate = debt.lastPaymentDate ? new Date(debt.lastPaymentDate) : new Date(debt.punitoryStartDate);

    // Calcular nuevos punitorios sobre los punitorios acumulados del período
    console.log('  Calculating NEW punitorios on accumulated punitory:', accumulatedPunitory);
    console.log('  From date (last payment):', lastPaymentDate);
    console.log('  To date:', paymentDate);

    const newPunitorios = calculatePunitoryV2(
      paymentDate,
      debt.periodMonth,
      debt.periodYear,
      accumulatedPunitory,  // Calcular sobre los punitorios acumulados del período
      contract.punitoryStartDay,
      contract.punitoryGraceDay,
      contract.punitoryPercent,
      holidays,
      lastPaymentDate
    );

    // Total de punitorios = acumulados del período + nuevos
    const totalPunitory = accumulatedPunitory + newPunitorios.amount;

    // Cuánto se pagó de punitorios = lo que excede el alquiler
    const amountPaidToPunitory = Math.max(0, debt.amountPaid - debt.unpaidRentAmount);

    // Punitorios impagos = total de punitorios - lo pagado
    const unpaidPunitory = Math.max(0, totalPunitory - amountPaidToPunitory);

    console.log('  Accumulated punitory (period):', accumulatedPunitory);
    console.log('  New punitorios calculated:', newPunitorios.amount);
    console.log('  Days:', newPunitorios.days);
    console.log('  Total punitory (period + new):', totalPunitory);
    console.log('  Amount paid to punitory:', amountPaidToPunitory);
    console.log('  Unpaid punitory:', unpaidPunitory);

    // Si no quedan punitorios impagos, return 0
    if (unpaidPunitory <= 0) {
      console.log('  -> No unpaid punitorios, returning 0');
      return {
        days: 0,
        amount: 0,
        newPunitoryAmount: 0,
        accumulatedPunitory: 0,
        remainingDebt: 0,
        startDate: null,
        endDate: null,
      };
    }

    return {
      days: newPunitorios.days,
      amount: unpaidPunitory,  // Total impago
      newPunitoryAmount: newPunitorios.amount,
      accumulatedPunitory: accumulatedPunitory,
      remainingDebt: 0,
      startDate: newPunitorios.fromDate,
      endDate: newPunitorios.toDate,
    };
  }

  // Get contract info from debt (we need punitory config)
  const contract = await prisma.contract.findUnique({
    where: { id: debt.contractId },
    select: {
      punitoryStartDay: true,
      punitoryGraceDay: true,
      punitoryPercent: true,
    },
  });

  if (!contract) {
    throw new Error('Contract not found for debt');
  }

  // Get holidays for the period
  const holidays = await getHolidaysForYear(debt.periodYear);

  // Use calculatePunitoryV2 with proper parameters
  // The debt is from a PAST period, so punitorios count from punitoryStartDate
  // If there was a partial payment on the debt, use lastPaymentDate
  // If there was NO partial payment on debt, but debt started from a specific date (punitoryStartDate),
  // we need to pass that as lastPaymentDate to avoid counting from day 1 of the month

  const punitoryStartDate = new Date(debt.punitoryStartDate);
  let effectiveLastPaymentDate;

  if (debt.lastPaymentDate) {
    // There was a partial payment on the debt itself
    effectiveLastPaymentDate = new Date(debt.lastPaymentDate);
    console.log('  Using lastPaymentDate from debt:', effectiveLastPaymentDate);
  } else {
    // No partial payment on debt, but debt started counting from punitoryStartDate
    // Check if punitoryStartDate is different from day 1 of the month
    const firstOfMonth = new Date(debt.periodYear, debt.periodMonth - 1, 1);
    const punitoryStartDay = punitoryStartDate.getDate();
    const firstDay = firstOfMonth.getDate();

    if (punitoryStartDay !== firstDay || punitoryStartDate.getTime() !== firstOfMonth.getTime()) {
      // punitoryStartDate is NOT day 1, so use it as effectiveLastPaymentDate
      // This happens when there was a partial payment on the MonthlyRecord before closing
      effectiveLastPaymentDate = punitoryStartDate;
      console.log('  Using punitoryStartDate as effective last payment:', effectiveLastPaymentDate);
    } else {
      // punitoryStartDate IS day 1, so let calculatePunitoryV2 handle it naturally
      effectiveLastPaymentDate = null;
      console.log('  No effective last payment, will count from day 1');
    }
  }

  console.log('  Punitory start date:', punitoryStartDate);
  console.log('  Last payment date on debt:', debt.lastPaymentDate || 'NONE');
  console.log('  Effective last payment date for calculation:', effectiveLastPaymentDate || 'NONE');
  console.log('  Contract config:', contract);

  const result = calculatePunitoryV2(
    paymentDate,
    debt.periodMonth,
    debt.periodYear,
    remainingRent, // Calculate ONLY on remaining rent (not on accumulated punitorios)
    contract.punitoryStartDay,
    contract.punitoryGraceDay,
    contract.punitoryPercent,
    holidays,
    effectiveLastPaymentDate // Use effective last payment date
  );

  console.log('  Calculated punitory result:', result);
  console.log('  New punitory amount:', result.amount);
  console.log('  Days:', result.days);

  return {
    days: result.days,
    amount: result.amount,
    newPunitoryAmount: result.amount,
    accumulatedPunitory, // Original punitorios from MonthlyRecord (not compounded)
    remainingDebt: remainingRent, // Only rent, not including punitorios
    startDate: result.fromDate,
    endDate: result.toDate,
  };
};

/**
 * Pagar una deuda (total o parcial).
 * Recalcula punitorios al momento del pago.
 */
const payDebt = async (debtId, amount, paymentDate, paymentMethod = 'EFECTIVO', observations = null) => {
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    include: { payments: true },
  });

  if (!debt) throw new Error('Deuda no encontrada');
  if (debt.status === 'PAID') throw new Error('Esta deuda ya está pagada');

  // Calcular punitorios al momento del pago
  const { amount: punitoryAmount, days } = await calculateDebtPunitory(debt, paymentDate);

  const remainingDebt = debt.unpaidRentAmount - debt.amountPaid;
  const totalWithPunitory = remainingDebt + punitoryAmount;

  // Crear registro de pago
  const debtPayment = await prisma.debtPayment.create({
    data: {
      debtId,
      paymentDate: parseLocalDate(paymentDate),
      amount: parseFloat(amount),
      punitoryAtPayment: punitoryAmount,
      paymentMethod,
      observations,
    },
  });

  // Also create a PaymentTransaction so it appears in the payment history
  // IMPORTANT: Payment order is RENT FIRST, then PUNITORIOS
  const parsedAmount = parseFloat(amount);
  const rentPortion = Math.min(remainingDebt, parsedAmount);
  const punitoryPortion = Math.max(parsedAmount - rentPortion, 0);

  console.log('\n[payDebt] PAYMENT IMPUTATION:');
  console.log('  Payment amount:', parsedAmount);
  console.log('  Remaining debt (rent):', remainingDebt);
  console.log('  Punitory amount:', punitoryAmount);
  console.log('  -> Rent portion:', rentPortion);
  console.log('  -> Punitory portion:', punitoryPortion);

  const transaction = await prisma.paymentTransaction.create({
    data: {
      groupId: debt.groupId,
      monthlyRecordId: debt.monthlyRecordId,
      paymentDate: parseLocalDate(paymentDate),
      amount: parsedAmount,
      paymentMethod,
      punitoryAmount: punitoryPortion,
      punitoryForgiven: false,
      observations: observations || `Pago de deuda: ${debt.periodLabel || 'período anterior'}`,
      concepts: {
        create: [
          ...(rentPortion > 0 ? [{ type: 'ALQUILER_DEUDA', description: 'Pago deuda alquiler', amount: rentPortion }] : []),
          ...(punitoryPortion > 0 ? [{ type: 'PUNITORIOS', description: 'Punitorios por mora', amount: punitoryPortion }] : []),
        ],
      },
    },
  });

  // Actualizar deuda
  const newAmountPaid = debt.amountPaid + parseFloat(amount);
  const newAccumulatedPunitory = punitoryAmount;
  const newCurrentTotal = debt.unpaidRentAmount + newAccumulatedPunitory - newAmountPaid;

  let status = 'OPEN';
  let closedAt = null;

  // Usar newCurrentTotal para determinar si la deuda quedó saldada.
  // La tolerancia de $1 evita problemas de redondeo entre preview y pago.
  // El check anterior (parseFloat(amount) >= totalWithPunitory) solo comparaba
  // el pago actual vs el total, lo cual fallaba en pagos parciales acumulados.
  if (newCurrentTotal <= 1) {
    status = 'PAID';
    closedAt = new Date();
  } else if (newAmountPaid > 0) {
    status = 'PARTIAL';
  }

  const updatedDebt = await prisma.debt.update({
    where: { id: debtId },
    data: {
      amountPaid: newAmountPaid,
      accumulatedPunitory: newAccumulatedPunitory,
      currentTotal: Math.max(newCurrentTotal, 0),
      lastPaymentDate: parseLocalDate(paymentDate),
      status,
      closedAt,
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          property: { select: { id: true, address: true, code: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });

  // When debt is fully paid (including punitorios), update the associated MonthlyRecord
  if (status === 'PAID' && debt.monthlyRecordId) {
    console.log('\n[payDebt] Updating MonthlyRecord - Debt FULLY PAID');

    // Use recalculateMonthlyRecord to sum all transactions correctly
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    const updatedRecord = await recalculateMonthlyRecord(debt.monthlyRecordId);

    console.log('  MonthlyRecord recalculated');
    console.log('  New amountPaid:', updatedRecord.amountPaid);
    console.log('  Status:', updatedRecord.status);

    // If still not COMPLETE, force it (debt is fully paid)
    if (updatedRecord.status !== 'COMPLETE') {
      await prisma.monthlyRecord.update({
        where: { id: debt.monthlyRecordId },
        data: {
          status: 'COMPLETE',
          isPaid: true,
          isCancelled: true,
          fullPaymentDate: parseLocalDate(paymentDate),
        },
      });
      console.log('  Forced MonthlyRecord to COMPLETE');
    }
  } else if (debt.monthlyRecordId) {
    console.log('\n[payDebt] Updating MonthlyRecord - Debt PARTIAL payment');
    console.log('  Debt status:', status);
    console.log('  Remaining debt:', remainingDebt - rentPortion);
    console.log('  Unpaid punitory:', punitoryAmount - punitoryPortion);

    // Partial debt payment: DO NOT mark MonthlyRecord as COMPLETE
    // because there are still unpaid punitorios or rent on the debt
    // Use recalculateMonthlyRecord to sum all transactions correctly
    // (avoids manual increment that causes duplicates)
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    await recalculateMonthlyRecord(debt.monthlyRecordId);

    console.log('  MonthlyRecord recalculated (amountPaid updated from transactions)');
  }

  return { debt: updatedDebt, payment: debtPayment };
};

/**
 * Obtener deudas abiertas (OPEN o PARTIAL) para un grupo.
 * Opcionalmente filtrar por contrato.
 */
const getOpenDebts = async (groupId, contractId = null) => {
  const where = {
    groupId,
    status: { in: ['OPEN', 'PARTIAL'] },
  };
  if (contractId) where.contractId = contractId;

  const debts = await prisma.debt.findMany({
    where,
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          property: { select: { id: true, address: true, code: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  });

  // Recalcular punitorios actuales para cada deuda
  return Promise.all(debts.map(async (debt) => {
    const { amount: currentPunitory, days, startDate, endDate } = await calculateDebtPunitory(debt);
    const remainingDebt = debt.unpaidRentAmount - debt.amountPaid;
    return {
      ...debt,
      liveAccumulatedPunitory: currentPunitory,
      livePunitoryDays: days,
      liveCurrentTotal: remainingDebt + currentPunitory,
      remainingDebt,
      punitoryFromDate: startDate,
      punitoryToDate: endDate,
    };
  }));
};

/**
 * Obtener todas las deudas de un grupo con filtros opcionales.
 */
const getDebts = async (groupId, filters = {}) => {
  const where = { groupId };

  if (filters.status) where.status = filters.status;
  if (filters.contractId) where.contractId = filters.contractId;

  const debts = await prisma.debt.findMany({
    where,
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          property: { select: { id: true, address: true, code: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
  });

  // Recalcular punitorios en vivo para deudas abiertas
  return Promise.all(debts.map(async (debt) => {
    if (debt.status === 'PAID') return { ...debt, liveCurrentTotal: 0, livePunitoryDays: 0, liveAccumulatedPunitory: 0, remainingDebt: 0, punitoryFromDate: null, punitoryToDate: null };

    const { amount: currentPunitory, days, startDate, endDate } = await calculateDebtPunitory(debt);
    const remainingDebt = debt.unpaidRentAmount - debt.amountPaid;
    return {
      ...debt,
      liveAccumulatedPunitory: currentPunitory,
      livePunitoryDays: days,
      liveCurrentTotal: remainingDebt + currentPunitory,
      remainingDebt,
      punitoryFromDate: startDate,
      punitoryToDate: endDate,
    };
  }));
};

/**
 * Resumen de deudas para el dashboard.
 */
const getDebtsSummary = async (groupId) => {
  const openDebts = await getOpenDebts(groupId);

  const totalDebt = openDebts.reduce((sum, d) => sum + d.liveCurrentTotal, 0);
  const totalBase = openDebts.reduce((sum, d) => sum + d.remainingDebt, 0);
  const totalPunitory = openDebts.reduce((sum, d) => sum + d.liveAccumulatedPunitory, 0);

  // Contratos bloqueados (con deudas abiertas)
  const blockedContractIds = [...new Set(openDebts.map((d) => d.contractId))];

  return {
    openDebtsCount: openDebts.length,
    totalDebt: Math.round(totalDebt),
    totalBase: Math.round(totalBase),
    totalPunitory: Math.round(totalPunitory),
    blockedContracts: blockedContractIds.length,
  };
};

/**
 * Verificar si un contrato puede pagar el mes actual (no tiene deudas abiertas).
 */
const canPayCurrentMonth = async (groupId, contractId) => {
  const openDebts = await prisma.debt.findMany({
    where: {
      groupId,
      contractId,
      status: { in: ['OPEN', 'PARTIAL'] },
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true } },
          property: { select: { id: true, address: true } },
        },
      },
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  });

  if (openDebts.length === 0) {
    return { canPay: true, debts: [] };
  }

  // Recalcular punitorios
  const debtsWithPunitory = await Promise.all(openDebts.map(async (debt) => {
    const { amount: currentPunitory, days } = await calculateDebtPunitory(debt);
    const remainingDebt = debt.unpaidRentAmount - debt.amountPaid;
    return {
      id: debt.id,
      periodLabel: debt.periodLabel,
      remainingDebt,
      punitory: currentPunitory,
      total: remainingDebt + currentPunitory,
    };
  }));

  return {
    canPay: false,
    debts: debtsWithPunitory,
    message: `${openDebts[0].contract?.tenant?.name || 'Inquilino'} tiene ${openDebts.length} deuda(s) abierta(s). Pagar deudas anteriores primero.`,
  };
};

/**
 * Anular un pago de deuda (solo el último - LIFO).
 * Revierte cambios en la Debt y en el MonthlyRecord asociado.
 * @param {string} skipTransactionDeletion - Si es true, no intenta eliminar el PaymentTransaction (ya fue eliminado)
 */
const cancelDebtPayment = async (debtId, paymentId, skipTransactionDeletion = false) => {
  console.log('\n========== CANCEL DEBT PAYMENT START ==========');
  console.log('DebtId:', debtId);
  console.log('PaymentId:', paymentId);

  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    include: { payments: { orderBy: { createdAt: 'asc' } } },
  });

  console.log('DEBT BEFORE CANCEL:');
  console.log('  - status:', debt.status);
  console.log('  - unpaidRentAmount:', debt.unpaidRentAmount);
  console.log('  - amountPaid:', debt.amountPaid);
  console.log('  - payments count:', debt.payments.length);

  if (!debt) throw new Error('Deuda no encontrada');

  // Buscar el pago a anular
  const payment = debt.payments.find((p) => p.id === paymentId);
  if (!payment) throw new Error('Pago no encontrado');

  console.log('PAYMENT TO CANCEL:');
  console.log('  - amount:', payment.amount);

  // Validar que sea el ÚLTIMO pago (LIFO)
  const lastPayment = debt.payments[debt.payments.length - 1];
  if (payment.id !== lastPayment.id) {
    throw new Error('Solo se puede anular el último pago registrado. Anule pagos en orden inverso (LIFO).');
  }

  // Buscar y eliminar el PaymentTransaction vinculado (solo si no se skipea)
  if (!skipTransactionDeletion) {
    const transaction = await prisma.paymentTransaction.findFirst({
      where: {
        monthlyRecordId: debt.monthlyRecordId,
        paymentDate: payment.paymentDate,
        amount: payment.amount,
      },
    });

    console.log('PAYMENT TRANSACTION FOUND:', transaction ? 'YES' : 'NO');

    if (transaction) {
      // Los TransactionConcept se borran en cascada
      await prisma.paymentTransaction.delete({
        where: { id: transaction.id },
      });
      console.log('PAYMENT TRANSACTION DELETED');
    }
  } else {
    console.log('SKIPPING PAYMENT TRANSACTION DELETION (already deleted)');
  }

  // Revertir cambios en Debt
  const newAmountPaid = Math.max(debt.amountPaid - payment.amount, 0);

  // Restaurar accumulatedPunitory del pago anterior (si existe).
  // Cada DebtPayment guarda punitoryAtPayment = punitorios totales calculados al momento de ese pago.
  // Al anular el último pago, el accumulatedPunitory debe volver al valor del pago previo.
  // Si no quedan pagos, se pone 0 porque calculateDebtPunitory recalcula desde punitoryStartDate.
  let newAccumulatedPunitory = 0;
  if (debt.payments.length > 1) {
    const previousPayment = debt.payments[debt.payments.length - 2];
    newAccumulatedPunitory = previousPayment.punitoryAtPayment || 0;
  }

  // Calcular deuda restante (solo la parte de alquiler sin punitorios)
  const remainingDebt = debt.unpaidRentAmount - newAmountPaid;

  console.log('CALCULATIONS:');
  console.log('  - newAmountPaid:', newAmountPaid);
  console.log('  - newAccumulatedPunitory:', newAccumulatedPunitory);
  console.log('  - remainingDebt:', remainingDebt);
  console.log('  - payments remaining:', debt.payments.length - 1);

  // Determinar nuevo estado y lastPaymentDate
  let newStatus = 'OPEN';
  let newLastPaymentDate = null;

  // Si quedan pagos previos, tomar el último
  if (debt.payments.length > 1) {
    console.log('CASE: Multiple payments (will have', debt.payments.length - 1, 'after cancel)');
    const previousPayment = debt.payments[debt.payments.length - 2];
    newLastPaymentDate = previousPayment.paymentDate;
  } else {
    console.log('CASE: Single payment (will have 0 after cancel)');
    newLastPaymentDate = null;
  }

  // IMPORTANTE: Para determinar el status, necesitamos calcular punitorios después de anular
  // No podemos marcar como PAID solo porque amountPaid >= unpaidRentAmount, porque pueden quedar punitorios impagos
  const rentRemaining = Math.max(debt.unpaidRentAmount - newAmountPaid, 0);

  // Si no queda renta por pagar, verificar punitorios
  if (rentRemaining === 0) {
    // Crear deuda temporal para calcular punitorios con el nuevo amountPaid
    // IMPORTANTE: usar newAccumulatedPunitory (del pago previo) en vez del valor actual
    const tempDebt = {
      ...debt,
      amountPaid: newAmountPaid,
      accumulatedPunitory: newAccumulatedPunitory,
      lastPaymentDate: newLastPaymentDate,
    };

    // Calcular punitorios impagos
    // IMPORTANTE: calculateDebtPunitory ya resta internamente lo pagado a punitorios
    // (amountPaidToPunitory = amountPaid - unpaidRentAmount), así que su retorno
    // es directamente los punitorios IMPAGOS. NO restar de nuevo aquí.
    const { amount: unpaidPunitory } = await calculateDebtPunitory(tempDebt, new Date());

    console.log('PUNITORY CHECK:');
    console.log('  - Unpaid punitory (from calculateDebtPunitory):', unpaidPunitory);

    if (unpaidPunitory <= 1) {
      newStatus = 'PAID';
      console.log('  -> newStatus: PAID (rent and punitorios fully paid)');
    } else {
      newStatus = 'PARTIAL';
      console.log('  -> newStatus: PARTIAL (rent paid, but punitorios remain)');
    }
  } else if (newAmountPaid > 0) {
    newStatus = 'PARTIAL';
    console.log('  -> newStatus: PARTIAL (rent partially paid)');
  } else {
    newStatus = 'OPEN';
    console.log('  -> newStatus: OPEN (no payments)');
  }

  console.log('NEW STATUS DETERMINED:', newStatus);

  // IMPORTANTE: Eliminar el DebtPayment ANTES de la query final
  // para que el debt retornado tenga la lista de payments correcta
  await prisma.debtPayment.delete({
    where: { id: paymentId },
  });
  console.log('DEBT PAYMENT DELETED');

  const updatedDebt = await prisma.debt.update({
    where: { id: debtId },
    data: {
      amountPaid: newAmountPaid,
      accumulatedPunitory: newAccumulatedPunitory,
      currentTotal: Math.max(debt.unpaidRentAmount + newAccumulatedPunitory - newAmountPaid, 0),
      lastPaymentDate: newLastPaymentDate,
      status: newStatus,
      closedAt: newStatus === 'PAID' ? debt.closedAt : null,
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          property: { select: { id: true, address: true, code: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });

  console.log('DEBT UPDATED IN DB:');
  console.log('  - status:', updatedDebt.status);
  console.log('  - amountPaid:', updatedDebt.amountPaid);
  console.log('  - currentTotal:', updatedDebt.currentTotal);
  console.log('  - closedAt:', updatedDebt.closedAt);

  // Recalcular MonthlyRecord si existe
  if (debt.monthlyRecordId) {
    console.log('RECALCULATING MonthlyRecord:', debt.monthlyRecordId);
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    await recalculateMonthlyRecord(debt.monthlyRecordId);
  }

  console.log('========== CANCEL DEBT PAYMENT END ==========\n');

  return {
    debt: updatedDebt,
    message: `Pago de ${payment.amount.toLocaleString('es-AR')} anulado. Deuda revertida a ${newStatus}.`,
  };
};

/**
 * Recalcular una deuda cuando el MonthlyRecord cambia (ej: se anula un pago previo al cierre)
 */
const recalculateDebtFromMonthlyRecord = async (debtId, monthlyRecordId) => {
  console.log('\n========== RECALCULATE DEBT FROM MONTHLY RECORD ==========');
  console.log('DebtId:', debtId);
  console.log('MonthlyRecordId:', monthlyRecordId);

  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    include: { payments: true },
  });

  if (!debt) {
    console.log('Debt not found');
    return null;
  }

  const monthlyRecord = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    include: { transactions: true },
  });

  if (!monthlyRecord) {
    console.log('MonthlyRecord not found');
    return null;
  }

  console.log('Current MonthlyRecord state:');
  console.log('  - rentAmount:', monthlyRecord.rentAmount);
  console.log('  - servicesTotal:', monthlyRecord.servicesTotal);
  console.log('  - amountPaid:', monthlyRecord.amountPaid);

  // Recalcular unpaidRent basado en el estado actual del MonthlyRecord
  const { unpaidRent, totalOriginal } = calculateImputation(monthlyRecord);

  console.log('Recalculated values:');
  console.log('  - unpaidRent:', unpaidRent);
  console.log('  - totalOriginal:', totalOriginal);
  console.log('  - previousRecordPayment:', monthlyRecord.amountPaid);

  // Recalcular el status basándose en el nuevo unpaidRent y los pagos de la deuda
  let newStatus = 'OPEN';
  let closedAt = null;

  if (debt.amountPaid >= unpaidRent) {
    newStatus = 'PAID';
    closedAt = debt.closedAt || new Date();
  } else if (debt.amountPaid > 0) {
    newStatus = 'PARTIAL';
  }

  console.log('Status recalculation:');
  console.log('  - debt.amountPaid:', debt.amountPaid);
  console.log('  - unpaidRent:', unpaidRent);
  console.log('  - newStatus:', newStatus);

  // Actualizar la deuda
  const updatedDebt = await prisma.debt.update({
    where: { id: debtId },
    data: {
      originalAmount: totalOriginal,
      unpaidRentAmount: unpaidRent,
      previousRecordPayment: monthlyRecord.amountPaid || 0,
      // Recalcular currentTotal: unpaidRent + punitorios - pagos de la deuda
      currentTotal: Math.max(unpaidRent + debt.accumulatedPunitory - debt.amountPaid, 0),
      status: newStatus,
      closedAt,
    },
    include: {
      payments: true,
      contract: {
        include: {
          tenant: true,
          property: true,
        },
      },
    },
  });

  console.log('Debt updated:');
  console.log('  - unpaidRentAmount:', updatedDebt.unpaidRentAmount);
  console.log('  - previousRecordPayment:', updatedDebt.previousRecordPayment);
  console.log('  - currentTotal:', updatedDebt.currentTotal);
  console.log('  - status:', updatedDebt.status);
  console.log('========== END RECALCULATE DEBT ==========\n');

  return updatedDebt;
};

module.exports = {
  createDebtFromMonthlyRecord,
  calculateDebtPunitory,
  calculateImputation,
  payDebt,
  cancelDebtPayment,
  recalculateDebtFromMonthlyRecord,
  getOpenDebts,
  getDebts,
  getDebtsSummary,
  canPayCurrentMonth,
};
