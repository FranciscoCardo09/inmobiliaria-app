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
    include: {
      contract: true,
      services: {
        include: { conceptType: { select: { category: true, name: true, label: true } } },
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

  console.log('\n========== PUNITORY CALCULATION ==========');
  console.log('Payment date:', paymentDate);
  console.log('Period:', `${record.periodMonth}/${record.periodYear}`);
  console.log('Unpaid rent:', unpaidRent);
  console.log('Punitory start day:', contract.punitoryStartDay);
  console.log('Punitory grace day:', contract.punitoryGraceDay);
  console.log('Punitory percent:', contract.punitoryPercent);
  console.log('Last transaction:', lastTransaction?.paymentDate || 'None');
  console.log('Calculated punitory:', punitory);
  console.log('Forgive punitorios?', forgivePunitorios);
  console.log('========== END PUNITORY CALCULATION ==========\n');

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
    include: {
      contract: true,
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

  console.log('\n[calculatePunitoryPreview] PREVIEW CALCULATION:');
  console.log('  MonthlyRecord ID:', monthlyRecordId);
  console.log('  Period:', `${record.periodMonth}/${record.periodYear}`);
  console.log('  Payment date for preview:', paymentDate);
  console.log('  Rent amount:', record.rentAmount);
  console.log('  Amount paid so far:', amountPaid);
  console.log('  Services total:', servicesTotal);
  console.log('  Unpaid rent:', unpaidRent);
  console.log('  Transactions count:', record.transactions.length);
  console.log('  Last transaction:', lastTx);
  console.log('  Last payment date:', lastTx?.paymentDate || 'NONE');

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

  console.log('  Result from calculatePunitoryV2:', result);
  console.log('  From date:', result.fromDate);
  console.log('  To date:', result.toDate);
  console.log('  Days:', result.days);
  console.log('  Amount:', result.amount);

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
                    code: true,
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
                  code: true,
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
  console.log('\n========== DELETE PAYMENT TRANSACTION START ==========');
  console.log('Transaction ID:', id);

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
    console.log('Transaction not found or wrong group');
    return null;
  }

  console.log('TRANSACTION TO DELETE:');
  console.log('  - monthlyRecordId:', transaction.monthlyRecordId);
  console.log('  - amount:', transaction.amount);
  console.log('  - paymentDate:', transaction.paymentDate);

  // Check if there's an associated Debt with DebtPayments
  const debt = transaction.monthlyRecord?.debt;
  if (debt && debt.payments && debt.payments.length > 0) {
    console.log('FOUND ASSOCIATED DEBT:');
    console.log('  - debtId:', debt.id);
    console.log('  - debt status:', debt.status);
    console.log('  - debt payments count:', debt.payments.length);

    // Find matching DebtPayment by date and amount
    const matchingDebtPayment = debt.payments.find((p) => {
      const txDate = new Date(transaction.paymentDate);
      const pDate = new Date(p.paymentDate);
      const sameDate = txDate.toDateString() === pDate.toDateString();
      const sameAmount = Math.abs(p.amount - transaction.amount) < 0.01;
      return sameDate && sameAmount;
    });

    if (matchingDebtPayment) {
      console.log('FOUND MATCHING DEBT PAYMENT:', matchingDebtPayment.id);
      console.log('  - amount:', matchingDebtPayment.amount);
      console.log('  - paymentDate:', matchingDebtPayment.paymentDate);

      // Use the cancelDebtPayment service to properly revert the debt
      // Pass skipTransactionDeletion=true because we'll delete it below
      const { cancelDebtPayment } = require('./debtService');
      try {
        await cancelDebtPayment(debt.id, matchingDebtPayment.id, true);
        console.log('DEBT PAYMENT CANCELLED SUCCESSFULLY');
      } catch (error) {
        console.error('ERROR CANCELLING DEBT PAYMENT:', error.message);
        // Continue with transaction deletion even if debt payment cancellation fails
      }
    } else {
      console.log('NO MATCHING DEBT PAYMENT FOUND');
      console.log('This is a payment from the MonthlyRecord BEFORE closing');
      console.log('Will recalculate debt AFTER updating MonthlyRecord');
      // Mark for recalculation after MonthlyRecord is updated
      debt.needsRecalculation = true;
    }
  } else {
    console.log('NO ASSOCIATED DEBT OR DEBT PAYMENTS');
  }

  // Delete the PaymentTransaction FIRST
  await prisma.paymentTransaction.delete({ where: { id } });
  console.log('PAYMENT TRANSACTION DELETED');

  // Recalculate the monthly record (updates amountPaid)
  await recalculateMonthlyRecord(transaction.monthlyRecordId);
  console.log('MONTHLY RECORD RECALCULATED');

  // NOW recalculate debt if needed (reads the UPDATED amountPaid)
  if (debt && debt.needsRecalculation) {
    console.log('Recalculating debt based on updated MonthlyRecord...');
    const { recalculateDebtFromMonthlyRecord } = require('./debtService');
    try {
      await recalculateDebtFromMonthlyRecord(debt.id, transaction.monthlyRecordId);
      console.log('DEBT RECALCULATED FROM MONTHLY RECORD');
    } catch (error) {
      console.error('ERROR RECALCULATING DEBT:', error.message);
    }
  }

  console.log('========== DELETE PAYMENT TRANSACTION END ==========\n');

  return transaction;
};

module.exports = {
  registerPayment,
  calculatePunitoryPreview,
  getPaymentHistory,
  getTransactionById,
  deleteTransaction,
};
