// Payment Transaction Service - Register and manage payment transactions
const { calculatePunitoryV2, getHolidaysForYear, round2 } = require('../utils/punitory');
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
          rescindedAt: true,
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

  // BLOQUEO: Verificar orden cronológico. Solo se puede pagar el período impago
  // más antiguo de la cadena (deudas + meses pendientes). Pasamos el período de
  // ESTE record para que, si es el más viejo, se permita; si hay algo anterior, se bloquee.
  const debtCheck = await canPayCurrentMonth(groupId, contract.id, {
    periodMonth: record.periodMonth,
    periodYear: record.periodYear,
  });
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
  const paidTowardRent = round2(Math.max(totalCredits - servicesTotal, 0));
  const unpaidRent = round2(Math.max(record.rentAmount - paidTowardRent, 0));

  // Base de punitorios: la bonificación (servicesTotal negativo) NO debe reducir
  // la base de punitorios del alquiler. Regla: mes abierto = solo alquiler.
  // Clampeamos servicesTotal a >=0 para que un neto negativo no se reste como si
  // fuera alquiler ya pagado (esto solo cambia el caso de bonificación; con
  // servicios positivos da idéntico a unpaidRent).
  const servicesOwedForPunitory = Math.max(servicesTotal, 0);
  const paidTowardRentForPunitory = round2(Math.max(totalCredits - servicesOwedForPunitory, 0));
  const unpaidRentForPunitory = round2(Math.max(record.rentAmount - paidTowardRentForPunitory, 0));

  // Compute accumulated unpaid punitorios from previous transactions (imputacion: servicios -> alquiler -> punitorios)
  const frozenPunitory = record.punitoryAmount || 0;
  const _crReg = Math.max(totalCredits - servicesTotal - record.rentAmount, 0);
  const unpaidFrozenPunitory = Math.max(frozenPunitory - Math.min(_crReg, frozenPunitory), 0);

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
    unpaidRentForPunitory,  // Only calculate on unpaid rent (bonificación no reduce la base)
    contract.punitoryStartDay,
    contract.punitoryGraceDay,
    contract.punitoryPercent,
    holidays,
    lastTransaction?.paymentDate || null
  );

  const punitoryAmount = forgivePunitorios ? 0 : round2(unpaidFrozenPunitory + punitory.amount);

  // Build transaction concepts breakdown.
  // Los conceptos reflejan QUÉ pagó ESTA transacción, con montos REALES por concepto
  // (cada servicio con su monto, alquiler real, punitorios), congelados al momento del pago.
  // Orden de imputación: los créditos previos (saldo a favor + pagos anteriores) cubren
  // servicios → alquiler → punitorios; luego ESTE pago cubre lo que reste en ese mismo orden.
  const concepts = [];
  const paymentAmount = parseFloat(amount);
  const alreadyPaid = round2(amountPaidSoFar + prevBalance);

  // Cuánto falta de cada concepto ANTES de este pago (descontando créditos previos)
  const creditsOnServices = round2(Math.min(alreadyPaid, Math.max(servicesTotal, 0)));
  const remainingServicesOwed = round2(Math.max(servicesTotal - creditsOnServices, 0));
  const remainingRentOwed = unpaidRent; // ya calculado arriba (neto de créditos)
  const remainingPunitoryOwed = round2(Math.max(punitoryAmount, 0)); // ya neto de créditos/frozen

  // Cuánto de ESTE pago se imputa a cada concepto (servicios → alquiler → punitorios → excedente)
  const servicesPay = round2(Math.min(remainingServicesOwed, paymentAmount));
  const rentPay = round2(Math.min(remainingRentOwed, paymentAmount - servicesPay));
  const punitoryPay = round2(Math.min(remainingPunitoryOwed, paymentAmount - servicesPay - rentPay));
  const overpay = round2(Math.max(paymentAmount - servicesPay - rentPay - punitoryPay, 0));

  // 1. Saldo a favor del mes anterior (crédito)
  if (prevBalance > 0) {
    concepts.push({
      type: 'A_FAVOR',
      amount: -prevBalance,
      description: 'Saldo a favor del mes anterior',
    });
  }

  // 2. Servicios: cada servicio con su monto REAL, secuencialmente, hasta agotar lo que
  //    este pago destina a servicios. Los descuentos/bonificaciones se muestran como
  //    líneas negativas (reducen el neto), igual que en el formulario de pago.
  if (servicesPay > 0) {
    let svcBudget = servicesPay;
    let skip = creditsOnServices; // porción de servicios ya cubierta por créditos previos
    for (const s of record.services) {
      const isDiscount = s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION';
      const label = s.conceptType?.label || s.description || s.conceptType?.name || 'Servicio';
      const type = s.conceptType?.name || 'SERVICIO';
      if (isDiscount) {
        concepts.push({ type, amount: -Math.abs(s.amount), description: label });
        continue;
      }
      let amt = s.amount;
      if (skip > 0) {
        const sk = Math.min(skip, amt);
        amt = round2(amt - sk);
        skip = round2(skip - sk);
      }
      if (amt > 0 && svcBudget > 0) {
        const pay = round2(Math.min(amt, svcBudget));
        concepts.push({ type, amount: pay, description: label });
        svcBudget = round2(svcBudget - pay);
      }
    }
  }

  // 3. Alquiler (lo que este pago destina al alquiler)
  if (rentPay > 0) {
    const isMultaRescision = (() => {
      const rescindedAt = record.contract?.rescindedAt;
      if (!rescindedAt) return false;
      const rescDate = new Date(rescindedAt);
      let pm = rescDate.getMonth() + 2;
      let py = rescDate.getFullYear();
      if (pm > 12) { pm = 1; py++; }
      return record.periodMonth === pm && record.periodYear === py;
    })();
    const isPartialRent = rentPay < remainingRentOwed;
    concepts.push({
      type: isMultaRescision ? 'MULTA_RESCISION' : 'ALQUILER',
      amount: rentPay,
      description: isMultaRescision
        ? `Multa Rescisión mes ${record.monthNumber}${isPartialRent ? ' (pago parcial)' : ''}`
        : `Alquiler mes ${record.monthNumber}${isPartialRent ? ' (pago parcial)' : ''}`,
    });
  }

  // 4. Punitorios (lo que este pago destina a punitorios)
  if (punitoryPay > 0) {
    // Si los nuevos punitorios son 0 días pero hay acumulados (frozen), mostrar los días originales del record
    const diasPunitorios = punitory.days > 0 ? punitory.days : (unpaidFrozenPunitory > 0 ? (record.punitoryDays || 0) : 0);
    concepts.push({
      type: 'PUNITORIOS',
      amount: punitoryPay,
      description: `${diasPunitorios} día(s) de atraso${forgivePunitorios ? ' (condonados)' : ''}`,
    });
  }

  // 5. Excedente (pago mayor al total adeudado → a favor del próximo mes)
  if (overpay > 0.01) {
    concepts.push({
      type: 'SOBREPAGO',
      amount: overpay,
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
      punitoryAmount: true, punitoryDays: true, status: true, includeIva: true,
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
  const paidTowardRent = round2(Math.max(totalCredits - servicesTotal, 0));
  const unpaidRent = round2(Math.max(record.rentAmount - paidTowardRent, 0));

  // Base de punitorios: la bonificación (servicesTotal negativo) NO reduce la base
  // de punitorios del alquiler (mismo criterio que registerPayment).
  const servicesOwedForPunitory = Math.max(servicesTotal, 0);
  const paidTowardRentForPunitory = round2(Math.max(totalCredits - servicesOwedForPunitory, 0));
  const unpaidRentForPunitory = round2(Math.max(record.rentAmount - paidTowardRentForPunitory, 0));

  // Compute accumulated unpaid punitorios from previous transactions (imputacion: servicios -> alquiler -> punitorios)
  const frozenPunitoryPreview = record.punitoryAmount || 0;
  const _crPrev = Math.max(totalCredits - servicesTotal - record.rentAmount, 0);
  const unpaidFrozenPunitoryPreview = Math.max(frozenPunitoryPreview - Math.min(_crPrev, frozenPunitoryPreview), 0);

  // Last payment date (transactions ordered desc, so [0] is most recent)
  const lastTx = record.transactions[0] || null;

  const result = calculatePunitoryV2(
    paymentDate,
    record.periodMonth,
    record.periodYear,
    unpaidRentForPunitory,  // Only calculate on unpaid rent (bonificación no reduce la base)
    record.contract.punitoryStartDay,
    record.contract.punitoryGraceDay,
    record.contract.punitoryPercent,
    holidays,
    lastTx?.paymentDate || null
  );

  return {
    ...result,
    newPunitory: result.amount,
    accumulatedPunitory: unpaidFrozenPunitoryPreview,
    amount: round2(unpaidFrozenPunitoryPreview + result.amount),
    baseRent: record.rentAmount,
    unpaidRent,
    unpaidRentForPunitory, // base real sobre la que se calculan los punitorios
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
      { monthlyRecord: { contract: { tenant: { name: { contains: search, mode: 'insensitive' } } } } },
      { monthlyRecord: { contract: { property: { address: { contains: search, mode: 'insensitive' } } } } },
      { receiptNumber: { contains: search, mode: 'insensitive' } },
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
