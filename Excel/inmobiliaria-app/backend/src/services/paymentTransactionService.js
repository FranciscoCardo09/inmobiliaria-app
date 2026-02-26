// Payment Transaction Service - Register and manage payment transactions
const { calculatePunitoryV2, getHolidaysForYear } = require('../utils/punitory');
const { recalculateMonthlyRecord } = require('./monthlyRecordService');
const { canPayCurrentMonth } = require('./debtService');

const prisma = require('../lib/prisma');

/**
 * Register a payment transaction against a MonthlyRecord
 */
const registerPayment = async (groupId, monthlyRecordId, data) => {
  const {
    paymentDate,
    amount,
    paymentMethod = 'EFECTIVO',
    forgivePunitorios = false,
    generateReceipt = false,
    observations,
  } = data;

  // Load the monthly record with contract
  const record = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    select: {
      id: true, groupId: true, contractId: true, monthNumber: true,
      periodMonth: true, periodYear: true, rentAmount: true,
      servicesTotal: true, previousBalance: true, amountPaid: true,
      punitoryAmount: true, punitoryDays: true, punitoryForgiven: true,
      includeIva: true, status: true,
      contract: {
        select: {
          id: true, punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true,
        },
      },
      services: {
        select: {
          id: true, amount: true, description: true,
          conceptType: { select: { category: true, name: true, label: true } },
        },
      },
    },
  });

  if (!record || record.groupId !== groupId) {
    throw new Error('Registro mensual no encontrado');
  }

  const contract = record.contract;

  // BLOQUEO: Verificar si el contrato tiene deudas abiertas
  const debtCheck = await canPayCurrentMonth(groupId, contract.id);
  if (!debtCheck.canPay) {
    const error = new Error(debtCheck.message);
    error.code = 'DEBT_BLOCK';
    error.debts = debtCheck.debts;
    throw error;
  }
  // Calculate punitorios for this payment date
  // Payments cover services first, then rent. Punitorios only apply to unpaid rent.
  const holidays = await getHolidaysForYear(record.periodYear);
  const amountPaidSoFar = record.amountPaid || 0;
  const servicesTotal = record.servicesTotal || 0;
  const prevBalance = record.previousBalance || 0;
  // previousBalance (a favor) acts as an extra credit alongside actual payments
  const totalCredits = amountPaidSoFar + prevBalance;
  // Credits cover services first, remainder goes to rent
  const paidTowardServices = Math.min(totalCredits, servicesTotal);
  const paidTowardRent = Math.max(totalCredits - servicesTotal, 0);
  const unpaidRent = Math.max(record.rentAmount - paidTowardRent, 0);

  // Get last payment date for this record (if partial payment was made)
  const lastTransaction = await prisma.paymentTransaction.findFirst({
    where: { monthlyRecordId },
    orderBy: { paymentDate: 'desc' },
    select: { paymentDate: true },
  });

  const punitory = calculatePunitoryV2(
    paymentDate,
    record.periodMonth,
    record.periodYear,
    unpaidRent,  // Only calculate on unpaid rent
    contract.punitoryStartDay,
    contract.punitoryGraceDay,
    contract.punitoryPercent,
    holidays,
    lastTransaction?.paymentDate || null
  );

  const punitoryAmount = forgivePunitorios ? 0 : punitory.amount;

  // Build transaction concepts breakdown
  // Concepts should reflect HOW THIS PAYMENT is distributed, not the total owed
  const concepts = [];

  // Payment order: Services → Rent → Punitorios
  // Credits from previous balance + payments already made
  const paymentAmount = parseFloat(amount);
  let remainingPayment = paymentAmount;

  // Track what's already been paid (before this transaction)
  const alreadyPaid = amountPaidSoFar + prevBalance;

  // Calculate what's still owed for each concept
  const servicesStillOwed = Math.max(servicesTotal - alreadyPaid, 0);
  const rentStillOwed = Math.max(record.rentAmount - Math.max(alreadyPaid - servicesTotal, 0), 0);

  // 1. Previous balance (if any) - show as credit
  if (prevBalance > 0) {
    concepts.push({
      type: 'A_FAVOR',
      amount: -prevBalance,
      description: 'Saldo a favor del mes anterior',
    });
  }

  // 2. Services (if any are still owed)
  if (servicesTotal > 0 && servicesStillOwed > 0) {
    for (const s of record.services) {
      const isDiscount = s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION';
      const serviceAmount = isDiscount ? -Math.abs(s.amount) : s.amount;

      // Calculate this service's share of what's still owed
      const serviceShare = servicesStillOwed > 0 ? (serviceAmount / servicesTotal) * servicesStillOwed : 0;

      if (serviceShare > 0 && remainingPayment > 0) {
        const paidToService = Math.min(serviceShare, remainingPayment);
        concepts.push({
          type: s.conceptType?.name || 'SERVICIO',
          amount: paidToService,
          description: s.conceptType?.label || s.description || s.conceptType?.name || 'Servicio',
        });
        remainingPayment -= paidToService;
      }
    }
  }

  // 3. Rent (if still owed after services)
  if (rentStillOwed > 0 && remainingPayment > 0) {
    const paidToRent = Math.min(rentStillOwed, remainingPayment);
    concepts.push({
      type: 'ALQUILER',
      amount: paidToRent,
      description: paidToRent >= rentStillOwed
        ? `Alquiler mes ${record.monthNumber}`
        : `Alquiler mes ${record.monthNumber} (pago parcial)`,
    });
    remainingPayment -= paidToRent;
  }

  // 4. Punitorios (if any after rent is paid)
  if (punitoryAmount > 0 && remainingPayment > 0) {
    const paidToPunitory = Math.min(punitoryAmount, remainingPayment);
    concepts.push({
      type: 'PUNITORIOS',
      amount: paidToPunitory,
      description: `${punitory.days} día(s) de atraso${forgivePunitorios ? ' (condonados)' : ''}`,
    });
    remainingPayment -= paidToPunitory;
  }

  // 5. Overpayment (if payment exceeds total due)
  if (remainingPayment > 0.01) {
    concepts.push({
      type: 'SOBREPAGO',
      amount: remainingPayment,
      description: 'Pago en exceso (a favor próximo mes)',
    });
  }

  // Generate receipt number if needed
  let receiptNumber = null;
  if (generateReceipt || paymentMethod === 'EFECTIVO') {
    const count = await prisma.paymentTransaction.count({ where: { groupId } });
    receiptNumber = `REC-${String(count + 1).padStart(6, '0')}`;
  }

  // Create the transaction
  const transaction = await prisma.$transaction(async (tx) => {
    const newTx = await tx.paymentTransaction.create({
      data: {
        groupId,
        monthlyRecordId,
        paymentDate: (() => {
          // Parse yyyy-mm-dd as local date to avoid timezone shift
          const [y, m, d] = String(paymentDate).split(/[-T]/);
          return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0);
        })(),
        amount: parseFloat(amount),
        paymentMethod,
        punitoryAmount,
        punitoryForgiven: forgivePunitorios,
        receiptGenerated: !!receiptNumber,
        receiptNumber,
        observations,
        concepts: {
          create: concepts,
        },
      },
      include: {
        concepts: true,
      },
    });

    // Update the monthly record's punitory info
    await tx.monthlyRecord.update({
      where: { id: monthlyRecordId },
      data: {
        punitoryAmount,
        punitoryDays: forgivePunitorios ? 0 : punitory.days,
        punitoryForgiven: forgivePunitorios,
      },
    });

    return newTx;
  });

  // Recalculate the monthly record totals
  const updatedRecord = await recalculateMonthlyRecord(monthlyRecordId);

  return { transaction, monthlyRecord: updatedRecord };
};

/**
 * Calculate punitory preview for a given date (for the form)
 */
const calculatePunitoryPreview = async (monthlyRecordId, paymentDate) => {
  const record = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    select: {
      id: true, periodMonth: true, periodYear: true, rentAmount: true,
      servicesTotal: true, previousBalance: true, amountPaid: true,
      punitoryAmount: true, punitoryDays: true, status: true,
      contract: {
        select: {
          punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true,
        },
      },
      transactions: {
        orderBy: { paymentDate: 'desc' },
        take: 1,
        select: { paymentDate: true, amount: true },
      },
    },
  });

  if (!record) throw new Error('Registro no encontrado');

  const holidays = await getHolidaysForYear(record.periodYear);

  // Payments cover services first, then rent. Punitorios only on unpaid rent.
  const amountPaid = record.amountPaid || 0;
  const servicesTotal = record.servicesTotal || 0;
  const prevBalance = record.previousBalance || 0;
  // previousBalance (a favor) acts as an extra credit alongside actual payments
  const totalCredits = amountPaid + prevBalance;
  const paidTowardRent = Math.max(totalCredits - servicesTotal, 0);
  const unpaidRent = Math.max(record.rentAmount - paidTowardRent, 0);

  // Last payment date (transactions ordered desc, so [0] is most recent)
  const lastTx = record.transactions[0] || null;

  const result = calculatePunitoryV2(
    paymentDate,
    record.periodMonth,
    record.periodYear,
    unpaidRent,  // Only calculate on unpaid rent
    record.contract.punitoryStartDay,
    record.contract.punitoryGraceDay,
    record.contract.punitoryPercent,
    holidays,
    lastTx?.paymentDate || null
  );

  return {
    ...result,
    baseRent: record.rentAmount,
    unpaidRent,
    punitoryPercent: record.contract.punitoryPercent,
    punitoryStartDay: record.contract.punitoryStartDay,
    punitoryGraceDay: record.contract.punitoryGraceDay,
    lastPaymentDate: lastTx?.paymentDate || null,
    lastPaymentAmount: lastTx?.amount || null,
    amountPaid: record.amountPaid,
    status: record.status,
  };
};

/**
 * Get payment history with filters
 */
const getPaymentHistory = async (groupId, filters = {}) => {
  const { contractId, month, year, paymentMethod, tenantId, categoryId, search, limit = 50, offset = 0 } = filters;

  const where = { groupId };

  if (contractId) {
    where.monthlyRecord = { contractId };
  }
  if (month || year) {
    where.monthlyRecord = {
      ...where.monthlyRecord,
      ...(month && { periodMonth: parseInt(month) }),
      ...(year && { periodYear: parseInt(year) }),
    };
  }
  if (tenantId) {
    where.monthlyRecord = {
      ...where.monthlyRecord,
      contract: {
        ...(where.monthlyRecord?.contract || {}),
        tenantId,
      },
    };
  }
  if (categoryId) {
    where.monthlyRecord = {
      ...where.monthlyRecord,
      contract: {
        ...(where.monthlyRecord?.contract || {}),
        property: { categoryId },
      },
    };
  }
  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }
  if (search) {
    where.OR = [
      { monthlyRecord: { contract: { tenant: { name: { contains: search } } } } },
      { monthlyRecord: { contract: { property: { address: { contains: search } } } } },
      { receiptNumber: { contains: search } },
    ];
  }

  const [transactions, total] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where,
      include: {
        concepts: { orderBy: { createdAt: 'asc' } },
        monthlyRecord: {
          include: {
            contract: {
              include: {
                tenant: { select: { id: true, name: true, dni: true } },
                property: {
                  select: {
                    id: true,
                    address: true,
                    category: { select: { id: true, name: true, color: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    }),
    prisma.paymentTransaction.count({ where }),
  ]);

  return { transactions, total };
};

/**
 * Get a single transaction by ID
 */
const getTransactionById = async (groupId, id) => {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id },
    include: {
      concepts: { orderBy: { createdAt: 'asc' } },
      monthlyRecord: {
        include: {
          contract: {
            include: {
              tenant: { select: { id: true, name: true, dni: true } },
              property: {
                select: {
                  id: true,
                  address: true,
                  category: { select: { id: true, name: true, color: true } },
                },
              },
            },
          },
          services: {
            include: {
              conceptType: { select: { id: true, name: true, label: true, category: true } },
            },
          },
        },
      },
    },
  });

  if (!transaction || transaction.groupId !== groupId) return null;
  return transaction;
};

/**
 * Delete a transaction and recalculate the monthly record.
 * Also handles deletion of associated DebtPayment if it exists.
 */
const deleteTransaction = async (groupId, id) => {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id },
    include: {
      monthlyRecord: {
        include: {
          debt: {
            include: {
              payments: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      },
    },
  });

  if (!transaction || transaction.groupId !== groupId) {
    return null;
  }

  // Check if there's an associated Debt with DebtPayments
  const debt = transaction.monthlyRecord?.debt;
  if (debt && debt.payments && debt.payments.length > 0) {
    // Find matching DebtPayment by date and amount
    const matchingDebtPayment = debt.payments.find((p) => {
      const txDate = new Date(transaction.paymentDate);
      const pDate = new Date(p.paymentDate);
      const sameDate = txDate.toDateString() === pDate.toDateString();
      const sameAmount = Math.abs(p.amount - transaction.amount) < 0.01;
      return sameDate && sameAmount;
    });

    if (matchingDebtPayment) {
      const { cancelDebtPayment } = require('./debtService');
      try {
        await cancelDebtPayment(debt.id, matchingDebtPayment.id, true);
      } catch (error) {
        // Continue with transaction deletion even if debt payment cancellation fails
      }
    } else {
      debt.needsRecalculation = true;
    }
  }

  await prisma.paymentTransaction.delete({ where: { id } });
  await recalculateMonthlyRecord(transaction.monthlyRecordId);

  if (debt && debt.needsRecalculation) {
    const { recalculateDebtFromMonthlyRecord } = require('./debtService');
    try {
      await recalculateDebtFromMonthlyRecord(debt.id, transaction.monthlyRecordId);
    } catch (error) {
      // Debt recalculation failed, but transaction is already deleted
    }
  }

  return transaction;
};

module.exports = {
  registerPayment,
  calculatePunitoryPreview,
  getPaymentHistory,
  getTransactionById,
  deleteTransaction,
};
