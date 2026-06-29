// Debt Service - Gestión de deudas con punitorios acumulados
const { calculatePunitoryV2, getHolidaysForYear, round2 } = require('../utils/punitory');
const { MONTH_NAMES } = require('../utils/constants');

const prisma = require('../lib/prisma');

/**
 * Expand a contractId to its full renewal chain (current + all renewedFrom ancestors).
 * Local helper to avoid a circular require with contractService.
 */
async function expandToChain(contractId) {
  const chain = [];
  let currentId = contractId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    chain.push(currentId);
    const c = await prisma.contract.findUnique({
      where: { id: currentId },
      select: { renewedFromContractId: true },
    });
    currentId = c?.renewedFromContractId || null;
  }
  return chain;
}

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

  // Imputar primero a servicios, luego a IVA, luego a alquiler, luego a punitorios.
  // IMPORTANTE: el saldo a favor del mes anterior (previousBalance) NO se imputa acá:
  // no debe reducir la base de los punitorios. Se aplica al TOTAL al final (appliedCredit).
  // Solo los pagos REALES (amountPaid) cubren conceptos para determinar lo impago.
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

  const unpaidRent = round2(rentAmount - rentCovered);
  const unpaidIva = round2(ivaAmount - ivaCovered);
  const unpaidPunitory = round2(punitoryAmount - punitoryCovered);
  const unpaidServices = round2((servicesTotal - servicesCovered) + unpaidIva); // servicios + IVA impagos

  return {
    servicesCovered,
    ivaCovered,
    rentCovered,
    punitoryCovered,
    unpaidRent,
    unpaidIva,
    unpaidServices,
    unpaidPunitory,
    totalOriginal: round2(rentAmount + servicesTotal + punitoryAmount + ivaAmount),
    totalUnpaid: round2(unpaidRent + unpaidPunitory + unpaidServices),
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
      // Calculate unpaid rent (payments cover services + IVA first, then rent)
      const amountPaid = monthlyRecord.amountPaid || 0;
      const servicesTotal = monthlyRecord.servicesTotal || 0;
      const ivaAmount = monthlyRecord.ivaAmount || 0;
      // Base de punitorios: SOLO los pagos reales (amountPaid). El saldo a favor del
      // mes anterior NO reduce la base (se aplica al total al final).
      const totalCredits = amountPaid;
      // La bonificación (servicesTotal negativo) NO debe reducir la base de
      // punitorios del alquiler acumulados durante el mes abierto (mismo criterio
      // que paymentTransactionService). Clampeamos a >=0 para que un neto negativo
      // no se reste como si fuera alquiler ya pagado.
      const servicesOwedForPunitory = Math.max(servicesTotal, 0);
      const paidTowardRent = Math.max(totalCredits - servicesOwedForPunitory - ivaAmount, 0);
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

      // ADD new punitorios accrued since last payment to the ALREADY accumulated ones
      currentPunitoryAmount = (monthlyRecord.punitoryAmount || 0) + liveResult.amount;
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

  const { unpaidRent, unpaidPunitory, unpaidServices, totalOriginal, totalUnpaid } = calculateImputation(recordWithCurrentPunitorios);

  // Saldo a favor del mes anterior: se aplica al TOTAL (no a la base de punitorios).
  // unpaidRent/unpaidServices/unpaidPunitory ya están calculados con la base completa
  // (sin restar el crédito); acá descontamos el crédito del total adeudado.
  const appliedCredit = round2(Math.min(Math.max(monthlyRecord.previousBalance || 0, 0), totalUnpaid));
  const netUnpaid = round2(totalUnpaid - appliedCredit);

  // Si no queda nada impago (ni alquiler ni punitorios), o queda menos de $1 por decimales, no crear deuda
  if (netUnpaid <= 1) {
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

  const periodLabel = `${MONTH_NAMES[monthlyRecord.periodMonth]} ${monthlyRecord.periodYear}`;

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
      unpaidServicesAmount: unpaidServices, // Servicios + IVA impagos
      previousRecordPayment, // Cuánto pagó antes de cerrar (para mostrar al usuario)
      appliedCredit, // Saldo a favor del mes anterior (se resta del total, no de la base de punitorios)
      accumulatedPunitory: unpaidPunitory, // Punitorios impagos del MonthlyRecord
      currentTotal: round2(unpaidRent + unpaidServices + unpaidPunitory - appliedCredit), // Total impago neto del crédito
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
  const monthlyRecordIds = debts.filter(d => d.monthlyRecordId && d.amountPaid === 0).map(d => d.monthlyRecordId);

  const [contracts, monthlyRecords, ...holidayArrays] = await Promise.all([
    prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true },
    }),
    monthlyRecordIds.length > 0 ? prisma.monthlyRecord.findMany({
      where: { id: { in: monthlyRecordIds } },
      select: { id: true, servicesTotal: true, ivaAmount: true, rentAmount: true, amountPaid: true, punitoryAmount: true, previousBalance: true },
    }) : Promise.resolve([]),
    ...years.map(year => getHolidaysForYear(year)),
  ]);

  const contractMap = new Map(contracts.map(c => [c.id, c]));
  const holidayMap = new Map(years.map((year, i) => [year, holidayArrays[i]]));
  const monthlyRecordMap = new Map(monthlyRecords.map(m => [m.id, m]));

  return { contractMap, holidayMap, monthlyRecordMap };
};

/**
 * Calcular punitorios acumulados para una deuda a una fecha dada.
 * Accepts optional pre-loaded contract and holidays to avoid DB queries (batch mode).
 */
const calculateDebtPunitory = async (debt, paymentDate = new Date(), preloaded = null, skipUpdate = false) => {
  let accumulatedPunitory = debt.accumulatedPunitory || 0;

  // Para deudas donde los montos impagos pueden estar mal calculados (legacy o corruptos),
  // recalcular usando calculateImputation solo cuando no se hizo ningún pago a la deuda aún.
  let unpaidServicesAmount = debt.unpaidServicesAmount || 0;
  let unpaidRentAmount = debt.unpaidRentAmount || 0;
  if (debt.monthlyRecordId && debt.amountPaid === 0) {
    let mr = null;
    if (preloaded?.monthlyRecordMap) {
      mr = preloaded.monthlyRecordMap.get(debt.monthlyRecordId);
    }
    
    if (!mr) {
      mr = await prisma.monthlyRecord.findUnique({
        where: { id: debt.monthlyRecordId },
        select: { servicesTotal: true, ivaAmount: true, rentAmount: true, amountPaid: true, punitoryAmount: true, previousBalance: true },
      });
    }
    
    if (mr) {
      const imputation = calculateImputation(mr);
      const correctUnpaidServices = imputation.unpaidServices;
      const correctUnpaidRent = imputation.unpaidRent;
      const correctUnpaidPunitory = imputation.unpaidPunitory;

      // GUARD: this auto-recompute exists to CORRECT legacy/corrupt debts DOWNWARD.
      // It must NEVER inflate a debt. If the recomputed total exceeds what the debt
      // was created with, the source MonthlyRecord is almost certainly corrupt
      // (e.g. a stale negative previousBalance carried from a month that was deleted
      // by an earlier bug). In that case the stored debt values are more trustworthy,
      // so we leave them untouched. Without this guard, opening a settled debt whose
      // MonthlyRecord has a bad previousBalance reinflates it to a huge phantom amount.
      const storedTotal = (debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0) + (debt.accumulatedPunitory || 0);
      const recomputedTotal = correctUnpaidRent + correctUnpaidServices + correctUnpaidPunitory;
      const wouldInflate = recomputedTotal > storedTotal + 0.5; // tolerancia de redondeo

      const updateData = {};
      if (!wouldInflate) {
        if (correctUnpaidServices !== unpaidServicesAmount) {
          unpaidServicesAmount = correctUnpaidServices;
          updateData.unpaidServicesAmount = correctUnpaidServices;
        }
        if (correctUnpaidRent !== unpaidRentAmount) {
          unpaidRentAmount = correctUnpaidRent;
          updateData.unpaidRentAmount = correctUnpaidRent;
        }
        if (correctUnpaidPunitory !== accumulatedPunitory) {
          accumulatedPunitory = correctUnpaidPunitory;
          updateData.accumulatedPunitory = correctUnpaidPunitory;
        }
      }

      if (Object.keys(updateData).length > 0) {
        // Enforce setting currentTotal correctly
        updateData.currentTotal = correctUnpaidRent + correctUnpaidServices + correctUnpaidPunitory;

        // If everything is paid, we could close the debt, but we just set values.
        // The display will show $0.
        if (!skipUpdate) {
          await prisma.debt.update({ where: { id: debt.id }, data: updateData });
        }
      }
    }
  }
  const totalBase = round2(unpaidRentAmount + unpaidServicesAmount);
  const remainingBase = round2(Math.max(totalBase - debt.amountPaid, 0));

  // Regla de base para punitorios:
  //  - Si NUNCA hubo un pago (ni del MonthlyRecord original → previousRecordPayment,
  //    ni de la deuda → amountPaid): los punitorios van SOLO sobre el alquiler.
  //  - Si hubo algún pago: van sobre el saldo restante = (alquiler + servicios) - pagos.
  // (unpaidServicesAmount = servicios + IVA impagos; ya viene neto de descuentos.)
  const hasPayment = (debt.amountPaid || 0) > 0 || (debt.previousRecordPayment || 0) > 0;
  const punitoryBase = hasPayment
    ? remainingBase
    : round2(Math.max(unpaidRentAmount - (debt.amountPaid || 0), 0));

  // Para display: cuánto queda de servicios vs alquiler (imputación servicios → alquiler)
  const servicePaid = Math.min(debt.amountPaid, unpaidServicesAmount);
  const remainingServices = round2(unpaidServicesAmount - servicePaid);
  const remainingRent = round2(Math.max(unpaidRentAmount - Math.max(debt.amountPaid - unpaidServicesAmount, 0), 0));

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

  const contract = await getContract();
  if (!contract) throw new Error('Contract not found for debt');
  const holidays = await getHolidays();

  if (remainingBase <= 0) {
    // Todo el alquiler+servicios pagado; pueden quedar punitorios acumulados impagos.
    const lastPaymentDate = debt.lastPaymentDate ? new Date(debt.lastPaymentDate) : new Date(debt.punitoryStartDate);

    // Los punitorios nuevos se calculan SOBRE EL SALDO PENDIENTE REAL = punitorio impago
    // (acumulado − lo ya pagado a punitorios), NO sobre el acumulado total. Usar el total
    // cobraría punitorios sobre punitorios YA pagados (regla confirmada: "de cada saldo
    // pendiente hay que cobrar punitorios").
    const amountPaidToPunitory = round2(Math.max(0, debt.amountPaid - totalBase));
    const unpaidAccumulated = round2(Math.max(0, accumulatedPunitory - amountPaidToPunitory));

    const newPunitorios = calculatePunitoryV2(
      paymentDate,
      debt.periodMonth,
      debt.periodYear,
      unpaidAccumulated,
      contract.punitoryStartDay,
      contract.punitoryGraceDay,
      contract.punitoryPercent,
      holidays,
      lastPaymentDate
    );

    const totalPunitory = round2(accumulatedPunitory + newPunitorios.amount);
    const unpaidPunitory = round2(Math.max(0, totalPunitory - amountPaidToPunitory));

    if (unpaidPunitory <= 0) {
      return { days: 0, amount: 0, newPunitoryAmount: 0, accumulatedPunitory: 0, unpaidAccumulatedPunitory: 0, remainingDebt: 0, remainingServices: 0, remainingRent: 0, startDate: null, endDate: null };
    }

    return {
      days: newPunitorios.days,
      amount: unpaidPunitory,
      newPunitoryAmount: newPunitorios.amount,
      accumulatedPunitory,
      unpaidAccumulatedPunitory: 0,
      remainingDebt: 0,
      remainingServices: 0,
      remainingRent: 0,
      startDate: newPunitorios.fromDate,
      endDate: newPunitorios.toDate,
    };
  }

  // Hay saldo base pendiente: calcular punitorios sobre punitoryBase
  const punitoryStartDate = new Date(debt.punitoryStartDate);
  let effectiveLastPaymentDate;

  if (debt.lastPaymentDate) {
    effectiveLastPaymentDate = new Date(debt.lastPaymentDate);
  } else {
    const firstOfMonth = new Date(debt.periodYear, debt.periodMonth - 1, 1);
    effectiveLastPaymentDate = punitoryStartDate.getTime() !== firstOfMonth.getTime()
      ? punitoryStartDate
      : null;
  }

  // Punitorios históricos impagos que no están cubiertos por el cálculo live.
  // Cuando amountPaid === 0: liveAccumulatedPunitory ya cubre desde punitoryStartDate,
  //   por lo que accumulatedPunitory está contenido en él → no sumar.
  // Cuando amountPaid > 0: liveAccumulatedPunitory solo cuenta desde lastPaymentDate,
  //   y accumulatedPunitory acumulado hasta ese pago puede no haber sido pagado → sí sumar.
  const paidToPunitory = round2(Math.max(debt.amountPaid - totalBase, 0));
  const unpaidAccumulatedPunitory = debt.amountPaid > 0
    ? round2(Math.max(accumulatedPunitory - paidToPunitory, 0))
    : 0;

  // INTERÉS COMPUESTO: una vez que hubo un pago, los punitorios corren sobre el saldo
  // restante TOTAL = (alquiler + servicios pendientes) + punitorios acumulados impagos.
  // Sin ningún pago todavía, la base es solo el alquiler (sin componer) — punitoryBase ya
  // lo refleja (rama hasPayment=false más arriba).
  const compoundBase = hasPayment
    ? round2(punitoryBase + unpaidAccumulatedPunitory)
    : punitoryBase;

  const result = calculatePunitoryV2(
    paymentDate,
    debt.periodMonth,
    debt.periodYear,
    compoundBase,  // sin pago → solo alquiler; con pago → saldo restante + punitorios impagos (compuesto)
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
    unpaidAccumulatedPunitory,
    // remainingDebt (para mostrar el total adeudado) va NETO del saldo a favor.
    // La base de punitorios usó `remainingBase` completo (sin el crédito) más arriba.
    remainingDebt: round2(Math.max(remainingBase - (debt.appliedCredit || 0), 0)),
    remainingServices,
    remainingRent,
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

  // ORDEN CRONOLÓGICO: solo se puede pagar el período impago más antiguo de la cadena
  // (mirando deudas abiertas + meses pendientes sin cerrar). Si esta deuda no es la
  // más antigua, bloquear y señalar qué debe pagarse primero.
  const unpaidPeriods = await getUnpaidPeriods(debt.groupId, debt.contractId);
  if (unpaidPeriods.length > 0) {
    const oldest = unpaidPeriods[0];
    const thisKey = debt.periodYear * 12 + debt.periodMonth;
    const oldestKey = oldest.periodYear * 12 + oldest.periodMonth;
    if (thisKey > oldestKey) {
      const error = new Error(`Debe pagar primero ${oldest.periodLabel} antes de ${debt.periodLabel || 'esta deuda'}.`);
      error.code = 'ORDER_BLOCK';
      error.blockingPeriod = oldest;
      throw error;
    }
  }

  // Calcular punitorios al momento del pago
  const { amount: punitoryAmount, days, remainingDebt: remainingBase, unpaidAccumulatedPunitory } = await calculateDebtPunitory(debt, paymentDate);

  // Punitorio TOTAL adeudado al momento del pago = acumulado impago de pagos previos
  // (unpaidAccumulatedPunitory) + nuevo en vivo (punitoryAmount). Antes se usaba solo el
  // nuevo, por lo que un pago del total real dejaba sin imputar el acumulado y generaba
  // un saldo a favor falso (y el modal mostraba menos plata que el Control Mensual).
  const totalPunitoryOwed = round2((unpaidAccumulatedPunitory || 0) + punitoryAmount);
  const totalWithPunitory = remainingBase + totalPunitoryOwed;

  // Crear registro de pago
  const debtPayment = await prisma.debtPayment.create({
    data: {
      debtId,
      paymentDate: parseLocalDate(paymentDate),
      amount: parseFloat(amount),
      punitoryAtPayment: totalPunitoryOwed,
      paymentMethod,
      observations,
    },
  });

  // Orden de imputación: servicios → alquiler → punitorios
  const parsedAmount = parseFloat(amount);
  const unpaidServicesNow = debt.unpaidServicesAmount || 0;
  const servicePaidSoFar = Math.min(debt.amountPaid, unpaidServicesNow);
  const remainingServicesBefore = unpaidServicesNow - servicePaidSoFar;
  const rentPaidSoFar = Math.max(debt.amountPaid - unpaidServicesNow, 0);
  const remainingRentBefore = Math.max(debt.unpaidRentAmount - rentPaidSoFar, 0);

  const servicesPortion = round2(Math.min(remainingServicesBefore, parsedAmount));
  const afterServices = round2(parsedAmount - servicesPortion);
  const rentPortion = round2(Math.min(remainingRentBefore, afterServices));
  const afterRent = round2(Math.max(afterServices - rentPortion, 0));
  // Topear la porción de punitorios al punitorio REAL adeudado. Lo que sobre es
  // pago en exceso → saldo a favor del próximo mes (NO inflar punitorios, porque
  // eso inflaría el totalDue del MonthlyRecord en el recálculo y anularía el saldo).
  const punitoryPortion = round2(Math.min(afterRent, totalPunitoryOwed));
  const overpay = round2(Math.max(afterRent - punitoryPortion, 0));

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
          ...(servicesPortion > 0 ? [{ type: 'SERVICIOS_DEUDA', description: 'Pago deuda servicios', amount: servicesPortion }] : []),
          ...(rentPortion > 0 ? [{ type: 'ALQUILER_DEUDA', description: 'Pago deuda alquiler', amount: rentPortion }] : []),
          ...(punitoryPortion > 0 ? [{ type: 'PUNITORIOS', description: 'Punitorios por mora', amount: punitoryPortion }] : []),
          ...(overpay > 0.01 ? [{ type: 'SOBREPAGO', description: 'Pago en exceso (a favor próximo mes)', amount: overpay }] : []),
        ],
      },
    },
  });

  // Actualizar deuda
  const newAmountPaid = round2(debt.amountPaid + parsedAmount);
  const newAccumulatedPunitory = totalPunitoryOwed;
  // El saldo a favor (appliedCredit) reduce el TOTAL, no la base de punitorios.
  const newCurrentTotal = round2(debt.unpaidRentAmount + unpaidServicesNow + newAccumulatedPunitory - (debt.appliedCredit || 0) - newAmountPaid);

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

// Normaliza una fecha de pago a Date. Acepta "YYYY-MM-DD" (la fija al mediodía local
// para evitar corrimientos de zona) o un ISO completo / Date.
const toPaymentDate = (paymentDate) => {
  if (!paymentDate) return new Date();
  if (typeof paymentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return new Date(paymentDate + 'T12:00:00');
  }
  return new Date(paymentDate);
};

/**
 * Cargar y validar un conjunto de deudas seleccionadas para pago múltiple.
 * Reglas: todas del mismo grupo, mismo contrato (o misma cadena de renovación),
 * ninguna pagada, y deben formar un prefijo contiguo de los períodos impagos
 * (empezar en el más antiguo, sin saltear meses) para no romper el orden cronológico.
 *
 * @returns {{ debts: object[], contractId: string }} deudas ordenadas más viejo→más nuevo
 */
const loadAndValidateBulkDebts = async (groupId, debtIds) => {
  if (!Array.isArray(debtIds) || debtIds.length === 0) {
    throw new Error('Debe seleccionar al menos una deuda');
  }

  const debts = await prisma.debt.findMany({
    where: { id: { in: debtIds } },
    include: { payments: true },
  });

  if (debts.length !== debtIds.length) {
    throw new Error('Alguna de las deudas seleccionadas no existe');
  }
  if (debts.some((d) => d.groupId !== groupId)) {
    throw new Error('Alguna deuda no pertenece a este grupo');
  }
  if (debts.some((d) => d.status === 'PAID')) {
    throw new Error('Alguna de las deudas seleccionadas ya está pagada');
  }

  // Mismo contrato (admitiendo la cadena de renovación)
  const chain = await expandToChain(debts[0].contractId);
  const chainSet = new Set(chain);
  if (debts.some((d) => !chainSet.has(d.contractId))) {
    throw new Error('El pago múltiple solo admite deudas de un mismo inquilino/contrato');
  }

  // Ordenar más viejo → más nuevo
  debts.sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth));

  // Validar contigüidad: todo período impago anterior al más nuevo seleccionado
  // debe estar incluido en la selección (si no, payDebt bloquearía por orden).
  const unpaidPeriods = await getUnpaidPeriods(groupId, debts[0].contractId);
  const selectedKeys = new Set(debts.map((d) => periodKey(d)));
  const newestSelectedKey = Math.max(...debts.map((d) => periodKey(d)));
  const missing = unpaidPeriods.find(
    (p) => periodKey(p) <= newestSelectedKey && !selectedKeys.has(periodKey(p))
  );
  if (missing) {
    const error = new Error(`Debe incluir ${missing.periodLabel} en la selección (es un período impago anterior).`);
    error.code = 'ORDER_BLOCK';
    error.blockingPeriod = missing;
    throw error;
  }

  return { debts, contractId: debts[0].contractId };
};

/**
 * Preview del pago múltiple: total a pagar de cada deuda a la fecha elegida.
 * El frontend usa estos totales para repartir el monto en vivo (waterfall).
 */
const previewBulkDebtPayment = async (groupId, debtIds, paymentDate) => {
  const { debts } = await loadAndValidateBulkDebts(groupId, debtIds);
  const date = toPaymentDate(paymentDate);

  const items = [];
  for (const debt of debts) {
    const { amount, days, remainingDebt, remainingServices, remainingRent, startDate, endDate, unpaidAccumulatedPunitory } =
      await calculateDebtPunitory(debt, date);
    // Punitorios totales impagos = acumulado impago (de pagos previos) + nuevo en vivo.
    // Sin sumar el acumulado el total quedaba por debajo del real (mismo bug que el preview individual).
    const totalPunitory = round2((unpaidAccumulatedPunitory || 0) + amount);
    items.push({
      id: debt.id,
      periodLabel: debt.periodLabel,
      periodMonth: debt.periodMonth,
      periodYear: debt.periodYear,
      remainingServices: remainingServices || 0,
      remainingRent: remainingRent || 0,
      punitory: totalPunitory,
      punitoryDays: days,
      totalToPay: round2(remainingDebt + totalPunitory),
      fromDate: startDate,
      toDate: endDate,
    });
  }

  const total = round2(items.reduce((s, it) => s + it.totalToPay, 0));
  return { debts: items, total };
};

/**
 * Pago múltiple de deudas (waterfall): reparte un monto entre varias deudas del
 * mismo contrato, de la más vieja a la más nueva, reutilizando payDebt por cada una.
 * El excedente (si el monto supera el total) se aplica a la última deuda como
 * sobrepago → saldo a favor del próximo mes.
 */
const payDebtsBulk = async (groupId, debtIds, totalAmount, paymentDate, paymentMethod = 'EFECTIVO', observations = null) => {
  const amount = parseFloat(totalAmount);
  if (!amount || amount <= 0) throw new Error('Monto inválido');

  const { debts } = await loadAndValidateBulkDebts(groupId, debtIds);
  const date = toPaymentDate(paymentDate);

  // Total a pagar de cada deuda a la fecha elegida (mismo cálculo que hará payDebt)
  const totals = [];
  for (const debt of debts) {
    const { amount: punitory, remainingDebt } = await calculateDebtPunitory(debt, date);
    totals.push(round2(remainingDebt + punitory));
  }

  let remaining = amount;
  const results = [];
  for (let i = 0; i < debts.length; i++) {
    if (remaining <= 0) break;
    const debt = debts[i];
    const isLast = i === debts.length - 1;
    // A la última deuda alcanzada se le asigna todo lo que reste (excedente → SOBREPAGO)
    let alloc = isLast ? remaining : Math.min(remaining, totals[i]);
    alloc = round2(alloc);
    if (alloc <= 0) continue;

    const { debt: updatedDebt } = await payDebt(debt.id, alloc, paymentDate, paymentMethod, observations);
    results.push({
      debtId: debt.id,
      periodLabel: debt.periodLabel,
      allocated: alloc,
      status: updatedDebt.status,
    });
    remaining = round2(remaining - alloc);
  }

  return {
    results,
    totalApplied: round2(amount - Math.max(remaining, 0)),
    remaining: Math.max(remaining, 0),
  };
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
  if (contractId) {
    // Incluir deudas de toda la cadena de renovación (contratos anteriores que fueron renovados)
    const chain = await expandToChain(contractId);
    where.contractId = { in: chain };
  }

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
    const { amount: currentPunitory, days, remainingDebt, unpaidAccumulatedPunitory, startDate, endDate } = await calculateDebtPunitory(debt, new Date(), preloaded, true);
    return {
      ...debt,
      liveAccumulatedPunitory: currentPunitory,
      livePunitoryDays: days,
      liveCurrentTotal: remainingDebt + (unpaidAccumulatedPunitory || 0) + currentPunitory,
      remainingDebt,
      unpaidAccumulatedPunitory: unpaidAccumulatedPunitory || 0,
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
  if (filters.contractId) {
    const chain = await expandToChain(filters.contractId);
    where.contractId = { in: chain };
  }

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

    const { amount: currentPunitory, days, remainingDebt, unpaidAccumulatedPunitory, startDate, endDate } = await calculateDebtPunitory(debt, new Date(), preloaded, true);
    return {
      ...debt,
      liveAccumulatedPunitory: currentPunitory,
      livePunitoryDays: days,
      liveCurrentTotal: remainingDebt + (unpaidAccumulatedPunitory || 0) + currentPunitory,
      remainingDebt,
      unpaidAccumulatedPunitory: unpaidAccumulatedPunitory || 0,
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
 * Construir la lista de períodos impagos de toda la cadena de renovación de un
 * contrato, ordenada cronológicamente ascendente (más viejo primero).
 *
 * Combina DOS fuentes que de otro modo se evalúan por separado:
 *   1. Deudas (meses ya cerrados) con status OPEN/PARTIAL → siempre son obligaciones confirmadas.
 *   2. MonthlyRecords que el inquilino EMPEZÓ a pagar (status PARTIAL y amountPaid > 0),
 *      todavía NO cerrados, en rango del contrato y sin Debt asociada.
 *
 * IMPORTANTE: NO se cuentan los MonthlyRecord PENDING nunca tocados (amountPaid = 0).
 * El control mensual autogenera registros PENDING para casi todos los meses (incluso
 * futuros y anteriores al inicio real), que NO son obligaciones reales. Tomarlos como
 * período impago bloqueaba el pago del mes actual por meses fantasma (regresión).
 * También se descartan los registros fuera de rango (monthNumber inválido / corrupto).
 *
 * Devuelve: [{ type: 'DEBT'|'RECORD', id, monthlyRecordId, periodMonth, periodYear, periodLabel }]
 */
const getUnpaidPeriods = async (groupId, contractId) => {
  const chain = await expandToChain(contractId);

  // Deudas abiertas de la cadena
  const openDebts = await prisma.debt.findMany({
    where: {
      groupId,
      contractId: { in: chain },
      status: { in: ['OPEN', 'PARTIAL'] },
    },
    select: {
      id: true, monthlyRecordId: true, periodMonth: true, periodYear: true,
      periodLabel: true, contractId: true,
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  });

  // monthlyRecordIds que ya tienen una deuda (cualquier estado) → excluir de records
  const allDebts = await prisma.debt.findMany({
    where: { groupId, contractId: { in: chain } },
    select: { monthlyRecordId: true },
  });
  const recordIdsWithDebt = new Set(allDebts.map((d) => d.monthlyRecordId));

  // Datos de contratos de la cadena para validar rango (evita registros corruptos/fuera de rango)
  const chainContracts = await prisma.contract.findMany({
    where: { id: { in: chain } },
    select: { id: true, startMonth: true, durationMonths: true, rescindedAt: true, startDate: true },
  });
  const contractMap = new Map(chainContracts.map((c) => [c.id, c]));

  // ¿el monthNumber de un record cae dentro del rango real del contrato?
  // (replica isContractInRangeForMonth de monthlyRecordService para evitar require circular)
  const recordInRange = (record) => {
    const c = contractMap.get(record.contractId);
    if (!c) return false;
    if (record.monthNumber == null) return true; // sin dato → no descartar
    const endMonth = c.startMonth + c.durationMonths - 1;
    if (record.monthNumber < c.startMonth || record.monthNumber > endMonth) return false;
    if (c.rescindedAt) {
      const r = new Date(c.rescindedAt);
      // mes calendario del record vs mes de rescisión
      const recKey = record.periodYear * 12 + record.periodMonth;
      const rescKey = r.getFullYear() * 12 + (r.getMonth() + 1);
      if (recKey > rescKey) return false;
    }
    return true;
  };

  // SOLO meses con pago parcial iniciado (obligación real en curso), no cerrados.
  const unpaidRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      contractId: { in: chain },
      status: 'PARTIAL',
      amountPaid: { gt: 0 },
      isCancelled: false,
    },
    select: {
      id: true, periodMonth: true, periodYear: true, contractId: true, monthNumber: true,
    },
  });

  const periods = [];
  for (const d of openDebts) {
    periods.push({
      type: 'DEBT',
      id: d.id,
      monthlyRecordId: d.monthlyRecordId,
      periodMonth: d.periodMonth,
      periodYear: d.periodYear,
      periodLabel: d.periodLabel,
    });
  }
  for (const r of unpaidRecords) {
    if (recordIdsWithDebt.has(r.id)) continue; // representado por su deuda
    if (!recordInRange(r)) continue; // fuera de rango / corrupto → ignorar
    periods.push({
      type: 'RECORD',
      id: r.id,
      monthlyRecordId: r.id,
      periodMonth: r.periodMonth,
      periodYear: r.periodYear,
      periodLabel: `${MONTH_NAMES[r.periodMonth]} ${r.periodYear}`,
    });
  }

  periods.sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth));
  return periods;
};

// Clave numérica comparable de un período (año*12 + mes)
const periodKey = (p) => (p.periodYear * 12 + p.periodMonth);

/**
 * Verificar si un período puede pagarse respetando el orden cronológico.
 *
 * Regla: solo el período impago MÁS ANTIGUO de la cadena (mirando deudas + meses
 * pendientes) puede pagarse. Debe quedar 100% saldado antes de habilitar el siguiente.
 *
 * @param {object|null} targetPeriod - { periodMonth, periodYear } del período que se
 *   intenta pagar. Si es null (llamada legacy a nivel contrato), se bloquea si hay
 *   cualquier deuda abierta (comportamiento histórico).
 */
const canPayCurrentMonth = async (groupId, contractId, targetPeriod = null) => {
  const periods = await getUnpaidPeriods(groupId, contractId);

  if (periods.length === 0) {
    return { canPay: true, debts: [], blockingPeriod: null, oldestUnpaid: null };
  }

  const oldest = periods[0];
  const openDebtPeriods = periods.filter((p) => p.type === 'DEBT');

  // Enriquecer las deudas abiertas con punitorios en vivo (para la UI). Compatible
  // con el shape previo: { id, periodLabel, periodMonth, periodYear, total, ... }
  let debtsWithPunitory = [];
  if (openDebtPeriods.length > 0) {
    const openDebts = await prisma.debt.findMany({
      where: { id: { in: openDebtPeriods.map((p) => p.id) } },
    });
    const preloaded = await preloadDebtDependencies(openDebts);
    debtsWithPunitory = await Promise.all(openDebts.map(async (debt) => {
      const { amount: currentPunitory, remainingDebt, unpaidAccumulatedPunitory } = await calculateDebtPunitory(debt, new Date(), preloaded, true);
      return {
        id: debt.id,
        periodLabel: debt.periodLabel,
        periodMonth: debt.periodMonth,
        periodYear: debt.periodYear,
        remainingDebt,
        punitory: currentPunitory,
        total: remainingDebt + (unpaidAccumulatedPunitory || 0) + currentPunitory,
      };
    }));
    // Mismo orden cronológico que las deudas
    debtsWithPunitory.sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth));
  }

  let canPay;
  if (targetPeriod && targetPeriod.periodMonth != null && targetPeriod.periodYear != null) {
    canPay = periodKey(targetPeriod) <= periodKey(oldest);
  } else {
    // Legacy: a nivel contrato, bloquear si hay alguna deuda abierta
    canPay = openDebtPeriods.length === 0;
  }

  if (canPay) {
    return { canPay: true, debts: debtsWithPunitory, blockingPeriod: null, oldestUnpaid: oldest };
  }

  return {
    canPay: false,
    debts: debtsWithPunitory,
    blockingPeriod: oldest,
    oldestUnpaid: oldest,
    message: `Debe pagar primero ${oldest.periodLabel} (el período impago más antiguo) antes de continuar.`,
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
      currentTotal: Math.max(debt.unpaidRentAmount + (debt.unpaidServicesAmount || 0) + newAccumulatedPunitory - (debt.appliedCredit || 0) - newAmountPaid, 0),
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
 * Condonar una deuda (marcarla como pagada sin cobrar).
 */
const forgiveDebt = async (debtId, observations = 'Deuda condonada') => {
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
  });

  if (!debt) throw new Error('Deuda no encontrada');
  if (debt.status === 'PAID') throw new Error('Esta deuda ya está pagada');

  const updatedDebt = await prisma.debt.update({
    where: { id: debtId },
    data: {
      status: 'PAID',
      closedAt: new Date(),
      observations,
    },
  });

  if (debt.monthlyRecordId) {
    const { recalculateMonthlyRecord } = require('./monthlyRecordService');
    const updatedRecord = await recalculateMonthlyRecord(debt.monthlyRecordId);

    if (updatedRecord.status !== 'COMPLETE') {
      await prisma.monthlyRecord.update({
        where: { id: debt.monthlyRecordId },
        data: {
          status: 'COMPLETE',
          isPaid: true,
          isCancelled: true,
          fullPaymentDate: new Date(),
        },
      });
    }
  }

  return updatedDebt;
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

  // Recalcular unpaidRent y unpaidServices basado en el estado actual del MonthlyRecord
  const { unpaidRent, unpaidServices, totalOriginal } = calculateImputation(monthlyRecord);

  // Recalcular el status
  let newStatus = 'OPEN';
  let closedAt = null;
  const totalBase = unpaidRent + unpaidServices;

  if (debt.amountPaid >= totalBase) {
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
      unpaidServicesAmount: unpaidServices,
      previousRecordPayment: monthlyRecord.amountPaid || 0,
      currentTotal: Math.max(totalBase + debt.accumulatedPunitory - (debt.appliedCredit || 0) - debt.amountPaid, 0),
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

/**
 * Sincronizar los servicios impagos de la deuda asociada a un MonthlyRecord.
 *
 * Se llama cuando se agrega / edita / quita un servicio en un mes que YA generó
 * deuda. Antes, agregar un servicio actualizaba el mes pero NO la deuda: el servicio
 * no se sumaba a la deuda ni se le calculaban punitorios. Acá recalculamos los
 * servicios impagos desde los servicios actuales del mes (mismo criterio que
 * createDebtFromMonthlyRecord: servicios netos + IVA, imputando primero los pagos del
 * mes a servicios) y los escribimos en la deuda.
 *
 * Solo toca servicios (y los totales derivados). NO toca el alquiler impago ni los
 * punitorios acumulados, así que NO interfiere con el guard anti-inflación de
 * calculateDebtPunitory (caso Yocsina): una vez sincronizada, la base almacenada
 * coincide con la recalculada. Los punitorios sobre el servicio nuevo los aplica
 * calculateDebtPunitory vía punitoryBase = saldo restante (alquiler + servicios).
 */
const syncDebtServicesFromRecord = async (monthlyRecordId) => {
  const debt = await prisma.debt.findUnique({ where: { monthlyRecordId } });
  if (!debt || debt.status === 'PAID') return null;

  const record = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    select: {
      rentAmount: true, includeIva: true, amountPaid: true,
      punitoryAmount: true, previousBalance: true,
      services: { select: { amount: true, conceptType: { select: { category: true } } } },
    },
  });
  if (!record) return null;

  // servicesTotal NETO — mismo criterio que _recalculateCore: descuentos/bonificaciones restan
  let servicesTotal = 0;
  for (const s of record.services) {
    if (s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION') {
      servicesTotal -= Math.abs(s.amount);
    } else {
      servicesTotal += s.amount;
    }
  }
  const ivaAmount = record.includeIva ? round2(record.rentAmount * 0.21) : 0;

  // previousBalance negativo: nunca usarlo como "crédito negativo" en la imputación.
  // Un previousBalance negativo corrupto (caso Yocsina: arrastre de un mes borrado)
  // haría que calculateImputation crea que NADA está cubierto e inflaría los
  // servicios impagos de la deuda. Solo cuenta como crédito si es saldo a favor (> 0).
  const { unpaidServices } = calculateImputation({
    rentAmount: record.rentAmount,
    servicesTotal,
    ivaAmount,
    punitoryAmount: record.punitoryAmount || 0,
    amountPaid: record.amountPaid || 0,
    previousBalance: Math.max(record.previousBalance || 0, 0),
  });

  if (round2(unpaidServices) === round2(debt.unpaidServicesAmount || 0)) return debt;

  const delta = round2(unpaidServices - (debt.unpaidServicesAmount || 0));
  const newCurrentTotal = round2(
    Math.max((debt.unpaidRentAmount || 0) + unpaidServices + (debt.accumulatedPunitory || 0) - (debt.amountPaid || 0), 0)
  );
  const newOriginal = round2((debt.originalAmount || 0) + delta);

  return prisma.debt.update({
    where: { id: debt.id },
    data: {
      unpaidServicesAmount: unpaidServices,
      currentTotal: newCurrentTotal,
      originalAmount: newOriginal,
    },
  });
};

module.exports = {
  createDebtFromMonthlyRecord,
  calculateDebtPunitory,
  syncDebtServicesFromRecord,
  calculateImputation,
  preloadDebtDependencies,
  payDebt,
  payDebtsBulk,
  previewBulkDebtPayment,
  cancelDebtPayment,
  forgiveDebt,
  recalculateDebtFromMonthlyRecord,
  getOpenDebts,
  getDebts,
  getDebtsSummary,
  canPayCurrentMonth,
  getUnpaidPeriods,
};
