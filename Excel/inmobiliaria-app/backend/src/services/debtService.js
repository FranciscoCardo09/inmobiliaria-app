// Debt Service - Gestión de deudas con punitorios acumulados
const { calculatePunitoryV2, getHolidaysForYear } = require('../utils/punitory');

const prisma = require('../lib/prisma');

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
  const ivaAmount = monthlyRecord.ivaAmount || 0;
  const amountPaid = monthlyRecord.amountPaid || 0;

  // Imputar primero a servicios, luego a IVA, luego a alquiler, luego a punitorios
  let remaining = amountPaid;

  // 1. Cubrir servicios
  const servicesCovered = Math.min(remaining, servicesTotal);
  remaining -= servicesCovered;

  // 2. Cubrir IVA
  const ivaCovered = Math.min(remaining, ivaAmount);
  remaining -= ivaCovered;

  // 3. Cubrir alquiler
  const rentCovered = Math.min(remaining, rentAmount);
  remaining -= rentCovered;

  // 4. Cubrir punitorios del record (si quedaron fondos)
  const punitoryCovered = Math.min(remaining, punitoryAmount);

  const unpaidRent = rentAmount - rentCovered;
  const unpaidIva = ivaAmount - ivaCovered;
  const unpaidPunitory = punitoryAmount - punitoryCovered;

  return {
    servicesCovered,
    ivaCovered,
    rentCovered,
    punitoryCovered,
    unpaidRent,
    unpaidIva,
    unpaidPunitory,
    totalOriginal: rentAmount + servicesTotal + punitoryAmount + ivaAmount,
    totalUnpaid: unpaidRent + unpaidPunitory + unpaidIva,
  };
}

/**
 * Crear deuda a partir de un MonthlyRecord impago/parcial.
 * Se llama durante el cierre mensual.
 */
const createDebtFromMonthlyRecord = async (monthlyRecord, contract) => {
  // Verificar que no exista deuda para este record
  const existing = await prisma.debt.findUnique({
    where: { monthlyRecordId: monthlyRecord.id },
  });
  if (existing) {
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

  // Si no queda nada impago (ni alquiler ni punitorios), no crear deuda
  if (totalUnpaid <= 0) {
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

  // IMPORTANTE: unpaidRent ya refleja los pagos aplicados del MonthlyRecord
  // Por lo tanto, la deuda se crea con amountPaid = 0 (sin pagos adicionales)
  // El pago del MonthlyRecord ya fue contabilizado al calcular unpaidRent
  const initialDebtPaid = 0;

  // Guardar cuánto se pagó del MonthlyRecord antes de crear la deuda (para información al usuario)
  const previousRecordPayment = monthlyRecord.amountPaid || 0;

  const initialStatus = 'OPEN'; // Siempre OPEN al crear, se actualizará cuando se pague

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
          property: { select: { id: true, address: true } },
        },
      },
    },
  });

  return debt;
};

/**
 * Batch-load contracts and holidays needed by calculateDebtPunitory.
 * Call once before processing multiple debts to avoid N+1 queries.
 */
const preloadDebtDependencies = async (debts) => {
  const contractIds = [...new Set(debts.map(d => d.contractId))];
  const years = [...new Set(debts.map(d => d.periodYear))];

  const [contracts, ...holidayArrays] = await Promise.all([
    prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true },
    }),
    ...years.map(year => getHolidaysForYear(year)),
  ]);

  const contractMap = new Map(contracts.map(c => [c.id, c]));
  const holidayMap = new Map(years.map((year, i) => [year, holidayArrays[i]]));

  return { contractMap, holidayMap };
};

/**
 * Calcular punitorios acumulados para una deuda a una fecha dada.
 * Accepts optional pre-loaded contract and holidays to avoid DB queries (batch mode).
 */
const calculateDebtPunitory = async (debt, paymentDate = new Date(), preloaded = null) => {
  const accumulatedPunitory = debt.accumulatedPunitory || 0;
  const remainingRent = Math.max(debt.unpaidRentAmount - debt.amountPaid, 0);

  // Helper to get contract - from preloaded cache or DB
  const getContract = async () => {
    if (preloaded?.contractMap) {
      const c = preloaded.contractMap.get(debt.contractId);
      if (c) return c;
    }
    return prisma.contract.findUnique({
      where: { id: debt.contractId },
      select: { punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true },
    });
  };

  // Helper to get holidays - from preloaded cache or DB
  const getHolidays = async () => {
    if (preloaded?.holidayMap) {
      const h = preloaded.holidayMap.get(debt.periodYear);
      if (h) return h;
    }
    return getHolidaysForYear(debt.periodYear);
  };

  if (remainingRent <= 0) {
    const contract = await getContract();
    if (!contract) throw new Error('Contract not found for debt');

    const holidays = await getHolidays();
    const lastPaymentDate = debt.lastPaymentDate ? new Date(debt.lastPaymentDate) : new Date(debt.punitoryStartDate);

    const newPunitorios = calculatePunitoryV2(
      paymentDate,
      debt.periodMonth,
      debt.periodYear,
      accumulatedPunitory,
      contract.punitoryStartDay,
      contract.punitoryGraceDay,
      contract.punitoryPercent,
      holidays,
      lastPaymentDate
    );

    const totalPunitory = accumulatedPunitory + newPunitorios.amount;
    const amountPaidToPunitory = Math.max(0, debt.amountPaid - debt.unpaidRentAmount);
    const unpaidPunitory = Math.max(0, totalPunitory - amountPaidToPunitory);

    if (unpaidPunitory <= 0) {
      return { days: 0, amount: 0, newPunitoryAmount: 0, accumulatedPunitory: 0, remainingDebt: 0, startDate: null, endDate: null };
    }

    return {
      days: newPunitorios.days,
      amount: unpaidPunitory,
      newPunitoryAmount: newPunitorios.amount,
      accumulatedPunitory,
      remainingDebt: 0,
      startDate: newPunitorios.fromDate,
      endDate: newPunitorios.toDate,
    };
  }

  const contract = await getContract();
  if (!contract) throw new Error('Contract not found for debt');

  const holidays = await getHolidays();

  const punitoryStartDate = new Date(debt.punitoryStartDate);
  let effectiveLastPaymentDate;

  if (debt.lastPaymentDate) {
    effectiveLastPaymentDate = new Date(debt.lastPaymentDate);
  } else {
    const firstOfMonth = new Date(debt.periodYear, debt.periodMonth - 1, 1);
    if (punitoryStartDate.getTime() !== firstOfMonth.getTime()) {
      effectiveLastPaymentDate = punitoryStartDate;
    } else {
      effectiveLastPaymentDate = null;
    }
  }

  const result = calculatePunitoryV2(
    paymentDate,
    debt.periodMonth,
    debt.periodYear,
    remainingRent,
    contract.punitoryStartDay,
    contract.punitoryGraceDay,
    contract.punitoryPercent,
    holidays,
    effectiveLastPaymentDate
  );

  return {
    days: result.days,
    amount: result.amount,
    newPunitoryAmount: result.amount,
    accumulatedPunitory,
    remainingDebt: remainingRent,
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
          property: { select: { id: true, address: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });

  // When debt is fully paid (including punitorios), update the associated MonthlyRecord
  if (status === 'PAID' && debt.monthlyRecordId) {
    // Use recalculateMonthlyRecord to sum all transactions correctly
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    const updatedRecord = await recalculateMonthlyRecord(debt.monthlyRecordId);

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
    }
  } else if (debt.monthlyRecordId) {
    // Partial debt payment: DO NOT mark MonthlyRecord as COMPLETE
    // because there are still unpaid punitorios or rent on the debt
    // Use recalculateMonthlyRecord to sum all transactions correctly
    // (avoids manual increment that causes duplicates)
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    await recalculateMonthlyRecord(debt.monthlyRecordId);
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
          property: { select: { id: true, address: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  });

  // Batch-load contracts and holidays for all debts (avoids N+1)
  const preloaded = debts.length > 0 ? await preloadDebtDependencies(debts) : null;

  return Promise.all(debts.map(async (debt) => {
    const { amount: currentPunitory, days, startDate, endDate } = await calculateDebtPunitory(debt, new Date(), preloaded);
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
          property: { select: { id: true, address: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
  });

  // Batch-load dependencies for non-PAID debts (avoids N+1)
  const openDebts = debts.filter(d => d.status !== 'PAID');
  const preloaded = openDebts.length > 0 ? await preloadDebtDependencies(openDebts) : null;

  return Promise.all(debts.map(async (debt) => {
    if (debt.status === 'PAID') return { ...debt, liveCurrentTotal: 0, livePunitoryDays: 0, liveAccumulatedPunitory: 0, remainingDebt: 0, punitoryFromDate: null, punitoryToDate: null };

    const { amount: currentPunitory, days, startDate, endDate } = await calculateDebtPunitory(debt, new Date(), preloaded);
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

  // Batch-load dependencies and recalculate punitorios
  const preloaded = await preloadDebtDependencies(openDebts);
  const debtsWithPunitory = await Promise.all(openDebts.map(async (debt) => {
    const { amount: currentPunitory, days } = await calculateDebtPunitory(debt, new Date(), preloaded);
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
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    include: { payments: { orderBy: { createdAt: 'asc' } } },
  });

  if (!debt) throw new Error('Deuda no encontrada');

  // Buscar el pago a anular
  const payment = debt.payments.find((p) => p.id === paymentId);
  if (!payment) throw new Error('Pago no encontrado');

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

    if (transaction) {
      // Los TransactionConcept se borran en cascada
      await prisma.paymentTransaction.delete({
        where: { id: transaction.id },
      });
    }
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

  // Determinar nuevo estado y lastPaymentDate
  let newStatus = 'OPEN';
  let newLastPaymentDate = null;

  // Si quedan pagos previos, tomar el último
  if (debt.payments.length > 1) {
    const previousPayment = debt.payments[debt.payments.length - 2];
    newLastPaymentDate = previousPayment.paymentDate;
  } else {
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

    if (unpaidPunitory <= 1) {
      newStatus = 'PAID';
    } else {
      newStatus = 'PARTIAL';
    }
  } else if (newAmountPaid > 0) {
    newStatus = 'PARTIAL';
  } else {
    newStatus = 'OPEN';
  }

  // IMPORTANTE: Eliminar el DebtPayment ANTES de la query final
  // para que el debt retornado tenga la lista de payments correcta
  await prisma.debtPayment.delete({
    where: { id: paymentId },
  });

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
          property: { select: { id: true, address: true } },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });

  // Recalcular MonthlyRecord si existe
  if (debt.monthlyRecordId) {
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    await recalculateMonthlyRecord(debt.monthlyRecordId);
  }

  return {
    debt: updatedDebt,
    message: `Pago de ${payment.amount.toLocaleString('es-AR')} anulado. Deuda revertida a ${newStatus}.`,
  };
};

/**
 * Recalcular una deuda cuando el MonthlyRecord cambia (ej: se anula un pago previo al cierre)
 */
const recalculateDebtFromMonthlyRecord = async (debtId, monthlyRecordId) => {
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    include: { payments: true },
  });

  if (!debt) {
    return null;
  }

  const monthlyRecord = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    include: { transactions: true },
  });

  if (!monthlyRecord) {
    return null;
  }

  // Recalcular unpaidRent basado en el estado actual del MonthlyRecord
  const { unpaidRent, totalOriginal } = calculateImputation(monthlyRecord);

  // Recalcular el status basándose en el nuevo unpaidRent y los pagos de la deuda
  let newStatus = 'OPEN';
  let closedAt = null;

  if (debt.amountPaid >= unpaidRent) {
    newStatus = 'PAID';
    closedAt = debt.closedAt || new Date();
  } else if (debt.amountPaid > 0) {
    newStatus = 'PARTIAL';
  }

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
          tenant: { select: { id: true, name: true, dni: true } },
          property: { select: { id: true, address: true } },
        },
      },
    },
  });

  return updatedDebt;
};

module.exports = {
  createDebtFromMonthlyRecord,
  calculateDebtPunitory,
  calculateImputation,
  preloadDebtDependencies,
  payDebt,
  cancelDebtPayment,
  recalculateDebtFromMonthlyRecord,
  getOpenDebts,
  getDebts,
  getDebtsSummary,
  canPayCurrentMonth,
};
