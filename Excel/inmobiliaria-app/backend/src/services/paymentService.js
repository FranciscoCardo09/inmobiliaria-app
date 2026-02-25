// Payment Service - Phase 4
const { calculatePunitoryDays, calculatePunitoryAmount } = require('../utils/punitory');

const prisma = require('../lib/prisma');

/**
 * Get the last payment balance for a contract (positive = a favor)
 */
const getLastPaymentBalance = async (contractId) => {
  const lastPayment = await prisma.payment.findFirst({
    where: { contractId },
    orderBy: { monthNumber: 'desc' },
    select: { balance: true, monthNumber: true },
  });

  if (!lastPayment || lastPayment.balance <= 0) return 0;
  return lastPayment.balance;
};

/**
 * Get editable concepts from the last payment for pre-filling
 */
const getLastPaymentEditableConcepts = async (contractId) => {
  const lastPayment = await prisma.payment.findFirst({
    where: { contractId },
    orderBy: { monthNumber: 'desc' },
    include: {
      concepts: {
        where: { isAutomatic: false },
      },
    },
  });

  if (!lastPayment) return {};

  const editables = {};
  lastPayment.concepts.forEach((c) => {
    editables[c.type] = c.amount;
  });
  return editables;
};

/**
 * Calculate payment concepts for a contract
 */
const calculatePaymentConcepts = async (contract, paymentDate) => {
  const concepts = [];

  // 1. ALQUILER
  concepts.push({
    type: 'ALQUILER',
    amount: contract.baseRent,
    isAutomatic: true,
  });

  // 2. IVA - ahora se ingresa a mano, no se auto-calcula

  // 3. PUNITORIOS (si fecha de pago es despues del dia limite)
  if (paymentDate) {
    const date = new Date(paymentDate);
    const daysLate = calculatePunitoryDays(date, contract.punitoryStartDay);
    const punitoryAmount = calculatePunitoryAmount(
      contract.baseRent,
      daysLate,
      contract.punitoryPercent
    );

    if (punitoryAmount > 0) {
      concepts.push({
        type: 'PUNITORIOS',
        amount: Math.round(punitoryAmount),
        description: `${daysLate} día(s) de atraso`,
        isAutomatic: true,
      });
    }
  }

  // 4. A FAVOR ANTERIOR
  const aFavor = await getLastPaymentBalance(contract.id);
  if (aFavor > 0) {
    concepts.push({
      type: 'A_FAVOR',
      amount: -aFavor,
      description: 'Saldo a favor del pago anterior',
      isAutomatic: true,
    });
  }

  // 5. Get last payment editable concepts for pre-filling
  const lastEditables = await getLastPaymentEditableConcepts(contract.id);

  const totalDue = concepts.reduce((sum, c) => sum + c.amount, 0);

  return {
    concepts,
    lastEditables,
    totalDue,
  };
};

/**
 * Get payments for the current month
 */
const getCurrentMonthPayments = async (groupId) => {
  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true },
    include: {
      tenant: { select: { id: true, name: true, dni: true } },
      property: { select: { id: true, address: true } },
      payments: {
        include: { concepts: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return contracts.map((contract) => {
    const payment = contract.payments.find(
      (p) => p.monthNumber === contract.currentMonth
    );

    // Extract concept amounts
    const getConceptAmount = (concepts, type) => {
      const concept = concepts?.find((c) => c.type === type);
      return concept?.amount || 0;
    };

    if (payment) {
      return {
        contractId: contract.id,
        paymentId: payment.id,
        tenant: contract.tenant,
        property: contract.property,
        monthNumber: contract.currentMonth,
        baseRent: contract.baseRent,
        alquiler: getConceptAmount(payment.concepts, 'ALQUILER'),
        iva: getConceptAmount(payment.concepts, 'IVA'),
        punitorios: getConceptAmount(payment.concepts, 'PUNITORIOS'),
        expensas: getConceptAmount(payment.concepts, 'EXPENSAS'),
        municipal: getConceptAmount(payment.concepts, 'MUNICIPAL'),
        totalDue: payment.totalDue,
        amountPaid: payment.amountPaid,
        balance: payment.balance,
        status: payment.status,
        paymentDate: payment.paymentDate,
        hasPayment: true,
      };
    }

    // No payment registered yet - show as PENDING projection
    const alquiler = contract.baseRent;
    const totalDue = alquiler;

    return {
      contractId: contract.id,
      paymentId: null,
      tenant: contract.tenant,
      property: contract.property,
      monthNumber: contract.currentMonth,
      baseRent: contract.baseRent,
      alquiler,
      punitorios: 0,
      totalDue,
      amountPaid: 0,
      balance: -totalDue,
      status: 'PENDING',
      paymentDate: null,
      hasPayment: false,
    };
  });
};

/**
 * Get projected payments for next month
 */
const getNextMonthPayments = async (groupId) => {
  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true },
    include: {
      tenant: { select: { id: true, name: true, dni: true } },
      property: { select: { id: true, address: true } },
      adjustmentIndex: {
        select: { id: true, name: true, currentValue: true },
      },
      payments: {
        orderBy: { monthNumber: 'desc' },
        take: 1,
        include: {
          concepts: { where: { isAutomatic: false } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return contracts
    .filter((c) => c.currentMonth < c.durationMonths) // Only contracts with months remaining
    .map((contract) => {
      const nextMonth = contract.currentMonth + 1;

      // Check if adjustment applies next month
      let baseRent = contract.baseRent;
      let adjustmentApplied = false;
      if (
        contract.nextAdjustmentMonth &&
        contract.nextAdjustmentMonth === nextMonth &&
        contract.adjustmentIndex?.currentValue > 0
      ) {
        baseRent = Math.round(
          baseRent * (1 + contract.adjustmentIndex.currentValue / 100)
        );
        adjustmentApplied = true;
      }

      const totalDue = baseRent;

      return {
        contractId: contract.id,
        tenant: contract.tenant,
        property: contract.property,
        monthNumber: nextMonth,
        baseRent,
        alquiler: baseRent,
        totalDue,
        amountPaid: 0,
        balance: -totalDue,
        status: 'PENDING',
        adjustmentApplied,
        adjustmentIndex: contract.adjustmentIndex,
        hasPayment: false,
      };
    });
};

module.exports = {
  calculatePaymentConcepts,
  getCurrentMonthPayments,
  getNextMonthPayments,
  getLastPaymentBalance,
  getLastPaymentEditableConcepts,
};
