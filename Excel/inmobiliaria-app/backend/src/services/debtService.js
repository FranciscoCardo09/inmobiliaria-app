// Debt Service - Gestión de deudas con punitorios acumulados
const { calculatePunitoryV2, getHolidaysForYear, round2, computePunitoryBase } = require('../utils/punitory');
const { MONTH_NAMES } = require('../utils/constants');
// A-25: "hoy" del negocio en ART, TZ-inmune (ver dateUtils.js). El servidor
// corre sin TZ configurada (= UTC); usar `new Date()` crudo como "hoy" en un
// cálculo de punitorios cuenta un día de más entre las 21:00 y las 23:59 ART.
const { getTodayLocalString, getTodayLocalDate } = require('../utils/dateUtils');

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

  // INVARIANTE del motor de deudas: `accumulatedPunitory` es el punitorio bruto devengado
  // HASTA EL ANCLA (`lastPaymentDate ?? punitoryStartDate`), y `calculateDebtPunitory` suma
  // el tramo vivo DESDE el ancla hasta la fecha de pago. `payDebt` lo respeta (guarda
  // `grossPunitoryToDate` y mueve `lastPaymentDate` al día del pago).
  //
  // Por eso el catch-up de abajo (punitorio devengado entre el último pago y el cierre) SOLO
  // puede aplicarse cuando el ancla es el día 1 del período, o sea cuando el mes no tuvo
  // ningún pago (ver `punitoryStartDate` más abajo). Con ancla = fecha del pago parcial,
  // sumarlo acá cobra ese tramo DOS VECES: una congelada en `accumulatedPunitory` y otra en
  // el tramo vivo — que además lo compone, porque `accumulatedPunitory` impago entra al
  // `compoundBase` de `calculateDebtPunitory`.
  //
  // Bug real (2026-08-14, caso Brunello Ana Carolina julio 2026): pago parcial el 23/07,
  // cierre el 31/07 → los 9 días 23→31 se cobraban duplicados y compuestos. Control Mensual,
  // el modal de pago de deuda y Liquidación mostraban $111.094 (Acumulados $43.605 +
  // Actuales 23d $67.490) en vez de los $83.721 reales (Acumulados $19.551 + Actuales 23d
  // $64.170). El bug quedó latente hasta el gate A-01, que empezó a sumar
  // `accumulatedPunitory` cuando `previousRecordPayment > 0` sin advertir que ese campo ya
  // traía el tramo solapado adentro.
  const anchorIsPayment = !!(monthlyRecord.transactions && monthlyRecord.transactions.length > 0);

  if (!anchorIsPayment && monthlyRecord.status !== 'COMPLETE' && !monthlyRecord.punitoryForgiven) {
    try {
      // Base ÚNICA de punitorios (A-03, utils/punitory.js#computePunitoryBase). La
      // bonificación (servicesTotal negativo) no la reduce (clamp a >=0), mismo criterio
      // que paymentTransactionService. En esta rama no hay transacciones, así que
      // amountPaid es 0 y la base queda en rent-only; el escenario "con pago parcial"
      // (base = saldo restante total, LOGICA.md §6) ya lo cubre calculateDebtPunitory
      // sobre el tramo vivo desde el ancla, sin duplicar.
      //
      // `appliedCredit` (2026-08-26, regla confirmada por el usuario): si el saldo a favor
      // arrastrado cubre el alquiler, NO se devengan punitorios. Antes este cálculo NO
      // pasaba el crédito y Control Mensual SÍ (`computeLiveRecordPunitory`), así que las
      // dos capas discrepaban: la pantalla mostraba $0 de mora y "le sobran $5.000",
      // mientras el cierre cobraba mora sobre el alquiler COMPLETO y armaba una deuda de
      // $8.200 por punitorios sobre plata que el crédito ya había cubierto.
      const amountPaid = monthlyRecord.amountPaid || 0;
      const servicesTotal = monthlyRecord.servicesTotal || 0;
      const ivaAmount = monthlyRecord.ivaAmount || 0;
      const unpaidRent = computePunitoryBase({
        rentAmount: monthlyRecord.rentAmount,
        servicesTotal,
        ivaAmount,
        amountPaid,
        appliedCredit: monthlyRecord.previousBalance || 0,
      });

      // Sin transacciones el tramo se cuenta desde el día 1 del período (mismo ancla que
      // `punitoryStartDate` más abajo y que `calculateDebtPunitory`).
      const lastPaymentDate = null;

      // Calculate until NOW (when closing the month).
      // A-25: usar el día ART correcto (string, TZ-inmune para calculatePunitoryV2),
      // no `new Date()` crudo del proceso (que corre en UTC en producción).
      const calculationDate = getTodayLocalString();
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

      // ADD new punitorios accrued since day 1 of the period to the ALREADY accumulated ones
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

  // Fecha desde donde cuentan punitorios (ANCLA, ver el invariante arriba: el tramo vivo
  // de calculateDebtPunitory arranca acá, así que `accumulatedPunitory` no puede contener
  // nada devengado después de esta fecha).
  // Como la deuda se crea sin pagos (amountPaid=0), los punitorios comienzan
  // desde el día 1 del mes o desde el último pago del MonthlyRecord
  let punitoryStartDate;

  if (anchorIsPayment) {
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
 * A-25: el default es el día ART correcto (string, TZ-inmune), no `new Date()` crudo.
 */
const calculateDebtPunitory = async (debt, paymentDate = getTodayLocalString(), preloaded = null, skipUpdate = false) => {
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
      // Bug (2026-07-16): NO se usa imputation.unpaidPunitory para corregir
      // `accumulatedPunitory`. calculateImputation lo deriva de `mr.punitoryAmount`,
      // el punitorio CONGELADO DEL ÚLTIMO PAGO del MonthlyRecord (0 si nunca se
      // pagó) — no tiene ninguna noción del catch-up que
      // `createDebtFromMonthlyRecord` calculó y congeló en `accumulatedPunitory` al
      // crear la deuda (punitorio devengado entre el cierre del mes y el momento de
      // creación, vía calculatePunitoryV2). Antes este bloque igualaba
      // `accumulatedPunitory` a ese valor y lo persistía (con skipUpdate=false):
      // CUALQUIER lectura (GET /debts/:id, punitory-preview, e incluso el primer
      // payDebt/payDebtsBulk) sobre una deuda nunca pagada borraba ese catch-up
      // para siempre — plata real adeudada que desaparecía de currentTotal.
      // `accumulatedPunitory` solo debe cambiar en su creación o al pagar
      // (payDebt), nunca en este auto-heal de solo lectura.

      // GUARD: this auto-recompute exists to CORRECT legacy/corrupt debts DOWNWARD.
      // It must NEVER inflate a debt. If the recomputed total exceeds what the debt
      // was created with, the source MonthlyRecord is almost certainly corrupt
      // (e.g. a stale negative previousBalance carried from a month that was deleted
      // by an earlier bug). In that case the stored debt values are more trustworthy,
      // so we leave them untouched. Without this guard, opening a settled debt whose
      // MonthlyRecord has a bad previousBalance reinflates it to a huge phantom amount.
      // `accumulatedPunitory` entra sin corregir en ambos lados de la comparación: el
      // guard sigue protegiendo alquiler/servicios de un previousBalance corrupto,
      // sin verse afectado por el punitorio (que ya no se toca).
      const storedTotal = (debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0) + accumulatedPunitory;
      const recomputedTotal = correctUnpaidRent + correctUnpaidServices + accumulatedPunitory;
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
      }

      if (Object.keys(updateData).length > 0) {
        // Enforce setting currentTotal correctly
        updateData.currentTotal = correctUnpaidRent + correctUnpaidServices + accumulatedPunitory;

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
  const remainingServicesGross = round2(unpaidServicesAmount - servicePaid);
  const remainingRent = round2(Math.max(unpaidRentAmount - Math.max(debt.amountPaid - unpaidServicesAmount, 0), 0));

  // IVA como línea aparte para el desglose (unpaidServicesAmount es "servicios + IVA"
  // en un solo campo, ver calculateImputation más arriba): se deriva del ivaAmount
  // original del MonthlyRecord que originó la deuda. Exacto si la deuda no tuvo pagos
  // parciales previos a su cierre; aproximado (proporcional a lo que quede de
  // "servicios") si los tuvo, ya que ese reparto no se guarda por separado. Antes esto
  // solo lo calculaba `previewBulkDebtPayment` para el pago en lote; vive acá para que
  // TODO consumidor de `calculateDebtPunitory` (modal de una deuda, GET /debts/:id,
  // preview individual, bulk) muestre el IVA separado y no mezclado con "servicios".
  let ivaOriginal = 0;
  if (debt.monthlyRecordId) {
    let mrForIva = preloaded?.monthlyRecordMap?.get(debt.monthlyRecordId);
    if (!mrForIva) {
      mrForIva = await prisma.monthlyRecord.findUnique({
        where: { id: debt.monthlyRecordId },
        select: { ivaAmount: true },
      });
    }
    ivaOriginal = mrForIva?.ivaAmount || 0;
  }
  const remainingIva = round2(Math.min(remainingServicesGross, ivaOriginal));
  const remainingServices = round2(remainingServicesGross - remainingIva);

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
    // A-02: cuánto se pagó de punitorios = (efectivo + crédito aplicado) que excede la
    // base, no solo el efectivo — `payDebt` imputa el `appliedCredit` a la base ANTES que
    // el efectivo (regla Brunello), así que ignorarlo acá hacía "resucitar" como impago
    // efectivo que, según los conceptos reales del pago, ya había cubierto punitorios.
    const amountPaidToPunitory = round2(Math.max(0, (debt.amountPaid || 0) + (debt.appliedCredit || 0) - totalBase));
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
      return { days: 0, amount: 0, newPunitoryAmount: 0, accumulatedPunitory: 0, unpaidAccumulatedPunitory: 0, grossPunitoryToDate: totalPunitory, remainingDebt: 0, remainingServices: 0, remainingRent: 0, iva: 0, startDate: null, endDate: null };
    }

    return {
      days: newPunitorios.days,
      amount: unpaidPunitory,
      newPunitoryAmount: newPunitorios.amount,
      accumulatedPunitory,
      unpaidAccumulatedPunitory: 0,
      // Punitorio BRUTO total a la fecha (pagado + impago) = congelado previo + lo
      // devengado desde entonces. Distinto de `amount` (que acá es el NETO impago) y
      // de `newPunitoryAmount` (solo el incremento) — ver comentario en el llamador
      // `getOrCreateMonthlyRecords` (monthlyRecordService.js) sobre por qué mezclar
      // estos campos generó saldo a favor falso (caso Ponce Emilia Roxana, 2026-07-13).
      grossPunitoryToDate: totalPunitory,
      remainingDebt: 0,
      remainingServices: 0,
      remainingRent: 0,
      iva: 0,
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
  // Cuando NUNCA hubo pago (ni de la deuda ni del mes de origen, `hasPayment` false):
  //   liveAccumulatedPunitory ya cubre desde punitoryStartDate (día 1 del mes), por lo
  //   que accumulatedPunitory está contenido en él → no sumar.
  // Cuando SÍ hubo algún pago (`hasPayment`, A-01: incluye el pago parcial del MES antes
  //   del cierre, no solo pagos de la deuda en sí — antes este gate miraba solo
  //   `debt.amountPaid`, perdiendo los punitorios congelados de deudas nacidas de un mes
  //   con pago parcial): liveAccumulatedPunitory solo cuenta desde lastPaymentDate, y
  //   accumulatedPunitory acumulado hasta ese pago puede no haber sido pagado → sí sumar.
  // A-02: cuánto se pagó de punitorios = (efectivo + crédito aplicado) que excede la
  // base, no solo el efectivo — ver comentario equivalente más arriba (rama remainingBase<=0).
  const paidToPunitory = round2(Math.max((debt.amountPaid || 0) + (debt.appliedCredit || 0) - totalBase, 0));
  const unpaidAccumulatedPunitory = hasPayment
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
    // Punitorio BRUTO total a la fecha (pagado + impago). Si nunca hubo pago,
    // `result.amount` YA es un recómputo completo desde el día 1 del período (no un
    // incremento) — sumarle `accumulatedPunitory` (congelado al cierre) lo duplicaría
    // (caso Airaldi). Si hubo pago, `result.amount` es el incremento desde
    // `lastPaymentDate`, así que sí se suma al congelado previo.
    grossPunitoryToDate: hasPayment ? round2(accumulatedPunitory + result.amount) : result.amount,
    // remainingDebt (para mostrar el total adeudado) va NETO del saldo a favor.
    // La base de punitorios usó `remainingBase` completo (sin el crédito) más arriba.
    //
    // Bug real (2026-07-14, caso "C21"): cuando appliedCredit (solo o junto con
    // amountPaid) SUPERA el totalBase (alquiler+servicios, BRUTO — no el neto de
    // amountPaid que es `remainingBase`), el sobrante debe seguir descontando de los
    // punitorios. `paidToPunitory` (arriba) ya mide ese sobrante bruto
    // (amountPaid+appliedCredit-totalBase) y lo neta contra `accumulatedPunitory`
    // (el pool CONGELADO) vía `unpaidAccumulatedPunitory`; lo que sobra DESPUÉS de
    // agotar ese pool congelado (`overflowBeyondAccumulated`) es lo que hay que
    // restarle acá al total EN VIVO — si en cambio se resta `appliedCredit` directo
    // de `remainingBase` (que YA está neto de amountPaid), se duplica el efecto del
    // efectivo cuando hay amountPaid>0 (regresión real: test A-02 pasaba 85000 en
    // efectivo + 20000 de crédito sobre una base de 100000 — sin cash de por medio el
    // crédito no sobra nada, pero restarlo de remainingBase daba -5000 igual).
    // Todo caller suma `remainingDebt + unpaidAccumulatedPunitory + amount` para el
    // total en vivo, así que restar acá el sobrante (dejando remainingDebt negativo
    // si hace falta) es matemáticamente equivalente a restarlo de los punitorios.
    remainingDebt: round2(Math.max(remainingBase - (debt.appliedCredit || 0), 0) - Math.max(paidToPunitory - accumulatedPunitory, 0)),
    remainingServices,
    remainingRent,
    iva: remainingIva,
    startDate: result.fromDate,
    endDate: result.toDate,
  };
};

/**
 * Pagar una deuda (total o parcial).
 * Recalcula punitorios al momento del pago.
 */
const payDebt = async (debtId, amount, paymentDate, paymentMethod = 'EFECTIVO', observations = null, forgivePunitorios = false) => {
  // Lectura previa SOLO para el chequeo de orden cronológico y el fail-fast (no usar
  // estos campos para ningún cálculo numérico: se releen frescos bajo el lock más abajo).
  const debtPre = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { id: true, groupId: true, contractId: true, periodYear: true, periodMonth: true, periodLabel: true, status: true },
  });

  if (!debtPre) throw new Error('Deuda no encontrada');
  if (debtPre.status === 'PAID') throw new Error('Esta deuda ya está pagada');

  // ORDEN CRONOLÓGICO: solo se puede pagar el período impago más antiguo de la cadena
  // (mirando deudas abiertas + meses pendientes sin cerrar). Si esta deuda no es la
  // más antigua, bloquear y señalar qué debe pagarse primero.
  const unpaidPeriods = await getUnpaidPeriods(debtPre.groupId, debtPre.contractId);
  if (unpaidPeriods.length > 0) {
    const oldest = unpaidPeriods[0];
    const thisKey = debtPre.periodYear * 12 + debtPre.periodMonth;
    const oldestKey = oldest.periodYear * 12 + oldest.periodMonth;
    if (thisKey > oldestKey) {
      const error = new Error(`Debe pagar primero ${oldest.periodLabel} antes de ${debtPre.periodLabel || 'esta deuda'}.`);
      error.code = 'ORDER_BLOCK';
      error.blockingPeriod = oldest;
      throw error;
    }
  }

  const parsedAmount = parseFloat(amount);
  // Lazy require (evita circular con monthlyRecordService, que a su vez requiere debtService).
  const { recalculateMultipleRecords } = require('./monthlyRecordService');

  // C-04: todo el ciclo leer-fresco→calcular→escribir corre en UNA transacción, serializado
  // por el mismo advisory lock por contrato que usa el recálculo mensual. Esto es lo que
  // evita el lost-update: dos payDebt concurrentes sobre la MISMA deuda ya no pueden
  // computar `newAmountPaid` a partir de la misma lectura vieja (bug C-04 confirmado con
  // test de concurrencia antes de este fix: 2 pagos de $50.000 dejaban amountPaid=50.000
  // en vez de 100.000).
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${debtPre.contractId}'))`);

    // Releer la deuda YA bajo el lock: ningún otro payDebt/registerPayment sobre este
    // contrato puede estar a mitad de camino en este punto (o ya hizo commit, o todavía
    // no arrancó su sección crítica).
    const debt = await tx.debt.findUnique({
      where: { id: debtId },
      include: { payments: true },
    });
    if (!debt) throw new Error('Deuda no encontrada');
    if (debt.status === 'PAID') throw new Error('Esta deuda ya está pagada');

    // Calcular punitorios al momento del pago (idéntico a antes, ahora sobre datos frescos)
    const { amount: punitoryAmount, days, remainingDebt: remainingBase, unpaidAccumulatedPunitory, grossPunitoryToDate } = await calculateDebtPunitory(debt, paymentDate);

    // Punitorio TOTAL adeudado al momento del pago = acumulado impago de pagos previos
    // (unpaidAccumulatedPunitory) + nuevo en vivo (punitoryAmount). Antes se usaba solo el
    // nuevo, por lo que un pago del total real dejaba sin imputar el acumulado y generaba
    // un saldo a favor falso (y el modal mostraba menos plata que el Control Mensual).
    const totalPunitoryOwed = forgivePunitorios ? 0 : round2((unpaidAccumulatedPunitory || 0) + punitoryAmount);
    const totalWithPunitory = remainingBase + totalPunitoryOwed;

    // Crear registro de pago
    const debtPayment = await tx.debtPayment.create({
      data: {
        debtId,
        paymentDate: parseLocalDate(paymentDate),
        amount: parsedAmount,
        punitoryAtPayment: totalPunitoryOwed,
        paymentMethod,
        observations,
      },
    });

    // Orden de imputación: servicios → alquiler → punitorios.
    // El saldo a favor aplicado (appliedCredit) cubre esos mismos conceptos ANTES que el
    // efectivo (misma convención que los pagos normales: créditos cubren servicios primero).
    // Sin esto, los targets de efectivo incluyen la parte ya cubierta por el crédito, la
    // porción de punitorios queda corta por ese monto (se va a SOBREPAGO) y el mes termina
    // con un falso saldo a favor igual al crédito (caso Brunello Mayo 2026).
    // Saldo a favor: si es el PRIMER pago de esta deuda (no hay pagos previos), dejar
    // constancia informativa en el recibo de que el total ya vino descontado del crédito
    // (síntoma reportado por el usuario: el recibo de deuda no mostraba el saldo a favor).
    // Concepto informativo con amount:0 — NO resta nada de nuevo del efectivo (el crédito
    // ya se descontó del total al calcular remainingDebt/totalToPay, ver calculateDebtPunitory
    // arriba), solo dice a dónde fue esa plata. En pagos 2°, 3°, etc. de la MISMA deuda se
    // omite (mismo patrón que "ya utilizado" en registerPayment, paymentTransactionService.js).
    const isFirstPaymentToDebt = (debt.amountPaid || 0) === 0 && (debt.payments?.length || 0) === 0;
    const credit = debt.appliedCredit || 0;
    const unpaidServicesNow = debt.unpaidServicesAmount || 0;
    const creditOnServices = Math.min(credit, unpaidServicesNow);
    const creditOnRent = Math.min(credit - creditOnServices, debt.unpaidRentAmount || 0);
    const creditOnPunitory = round2(credit - creditOnServices - creditOnRent);

    const cashServicesTarget = round2(unpaidServicesNow - creditOnServices);
    const cashRentTarget = round2(Math.max((debt.unpaidRentAmount || 0) - creditOnRent, 0));
    const servicePaidSoFar = Math.min(debt.amountPaid, cashServicesTarget);
    const remainingServicesBefore = cashServicesTarget - servicePaidSoFar;
    const rentPaidSoFar = Math.max(debt.amountPaid - cashServicesTarget, 0);
    const remainingRentBefore = Math.max(cashRentTarget - rentPaidSoFar, 0);

    const servicesPortion = round2(Math.min(remainingServicesBefore, parsedAmount));
    const afterServices = round2(parsedAmount - servicesPortion);
    const rentPortion = round2(Math.min(remainingRentBefore, afterServices));
    const afterRent = round2(Math.max(afterServices - rentPortion, 0));
    // Topear la porción de punitorios al punitorio REAL adeudado (neto de lo que cubra el
    // crédito). Lo que sobre es pago en exceso → saldo a favor del próximo mes (NO inflar
    // punitorios, porque eso inflaría el totalDue del MonthlyRecord en el recálculo y
    // anularía el saldo).
    const punitoryPortion = round2(Math.min(afterRent, Math.max(totalPunitoryOwed - creditOnPunitory, 0)));
    const overpay = round2(Math.max(afterRent - punitoryPortion, 0));

    const transaction = await tx.paymentTransaction.create({
      data: {
        groupId: debt.groupId,
        monthlyRecordId: debt.monthlyRecordId,
        paymentDate: parseLocalDate(paymentDate),
        amount: parsedAmount,
        paymentMethod,
        punitoryAmount: punitoryPortion,
        punitoryForgiven: forgivePunitorios,
        observations: observations || `Pago de deuda: ${debt.periodLabel || 'período anterior'}`,
        concepts: {
          create: [
            ...(isFirstPaymentToDebt && credit > 0 ? [{
              type: 'A_FAVOR',
              amount: 0,
              description: `Saldo a favor aplicado a esta deuda: $${round2(credit)} (ya descontado del total a pagar)`,
            }] : []),
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
    // Bug real (2026-07-16, caso C06_none — 2 pagos parciales sobre la misma deuda):
    // antes se guardaba `totalPunitoryOwed` (lo que quedaba IMPAGO en ESTE pago puntual),
    // no el total bruto histórico. En un pago que saldó la deuda de una sola vez daba
    // igual (nada quedaba impago de antes), pero con 2+ pagos parciales cada uno
    // PISABA el acumulado del anterior con un número menor — el 2do pago de este caso
    // dejó accumulatedPunitory=100.180 en vez de 186.180 (perdiendo los 86.000 ya
    // cubiertos por el 1er pago), y la columna "Total" (que lee accumulatedPunitory de
    // una deuda PAID) mostraba $420.180 en vez de los $506.180 reales.
    // `grossPunitoryToDate` (calculateDebtPunitory) SÍ es el bruto acumulado correcto
    // en cualquier escenario, se haya pagado en uno o varios pagos.
    const newAccumulatedPunitory = forgivePunitorios ? 0 : grossPunitoryToDate;
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

    const updatedDebt = await tx.debt.update({
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

    // Recalcular el MonthlyRecord asociado INLINE, dentro de la MISMA transacción/lock
    // (en vez de encolar el recálculo async de siempre — evita que el resto de esta
    // sección crítica dependa de un worker fire-and-forget, A-14, que además ya
    // demostró correr en carrera consigo mismo si se dispara dos veces).
    if (debt.monthlyRecordId) {
      await recalculateMultipleRecords([debt.monthlyRecordId], tx, true);

      if (status === 'PAID') {
        // When debt is fully paid (including punitorios), the record must end COMPLETE.
        const updatedRecord = await tx.monthlyRecord.findUnique({ where: { id: debt.monthlyRecordId } });
        if (updatedRecord.status !== 'COMPLETE') {
          await tx.monthlyRecord.update({
            where: { id: debt.monthlyRecordId },
            data: {
              status: 'COMPLETE',
              isPaid: true,
              isCancelled: true,
              fullPaymentDate: parseLocalDate(paymentDate),
            },
          });
        }
      }
    }

    return { debt: updatedDebt, payment: debtPayment, transaction };
  }, { timeout: 15000 });
};

// Normaliza una fecha de pago a Date. Acepta "YYYY-MM-DD" (la fija al mediodía local
// para evitar corrimientos de zona) o un ISO completo / Date.
const toPaymentDate = (paymentDate) => {
  // A-25: sin fecha explícita, usar el día ART correcto (no `new Date()` crudo).
  if (!paymentDate) return getTodayLocalDate();
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
const loadAndValidateBulkDebts = async (groupId, debtIds, currentRecordId = null) => {
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

  // Mes actual opcional (cola del waterfall): un MonthlyRecord todavía sin deuda,
  // que se paga con registerPayment en vez de payDebt. Solo él puede quedar con
  // saldo a favor (nunca una Debt).
  let currentRecord = null;
  if (currentRecordId) {
    currentRecord = await prisma.monthlyRecord.findUnique({ where: { id: currentRecordId } });
    if (!currentRecord) throw new Error('El mes actual seleccionado no existe');
    if (currentRecord.groupId !== groupId) throw new Error('El mes actual no pertenece a este grupo');
    if (!chainSet.has(currentRecord.contractId)) {
      throw new Error('El mes actual no pertenece al mismo inquilino/contrato que las deudas seleccionadas');
    }
    if (currentRecord.status === 'COMPLETE') {
      throw new Error('El mes actual ya está completamente pagado');
    }
  }

  // Validar contigüidad: todo período impago hasta el último período incluido en el
  // pago (la deuda más nueva seleccionada, o el mes actual si se incluyó) debe estar
  // cubierto por la selección (si no, payDebt/registerPayment bloquearían por orden).
  const unpaidPeriods = await getUnpaidPeriods(groupId, debts[0].contractId);
  const selectedKeys = new Set(debts.map((d) => periodKey(d)));
  const cutoffKey = currentRecord
    ? periodKey({ periodMonth: currentRecord.periodMonth, periodYear: currentRecord.periodYear })
    : Math.max(...debts.map((d) => periodKey(d)));
  const missing = unpaidPeriods.find(
    (p) => periodKey(p) <= cutoffKey
      && !selectedKeys.has(periodKey(p))
      && p.monthlyRecordId !== currentRecordId
  );
  if (missing) {
    const error = new Error(`Debe incluir ${missing.periodLabel} en la selección (es un período impago anterior).`);
    error.code = 'ORDER_BLOCK';
    error.blockingPeriod = missing;
    throw error;
  }

  return { debts, contractId: debts[0].contractId, currentRecord };
};

/**
 * Preview del pago múltiple: total a pagar de cada deuda (y, opcionalmente, del mes
 * actual como último ítem) a la fecha elegida. El frontend usa estos totales para
 * repartir el monto en vivo (waterfall) y mostrar el desglose por mes.
 */
const previewBulkDebtPayment = async (groupId, debtIds, paymentDate, currentRecordId = null) => {
  const { debts, currentRecord } = await loadAndValidateBulkDebts(groupId, debtIds, currentRecordId);
  const date = toPaymentDate(paymentDate);

  const items = [];
  for (const debt of debts) {
    // remainingServices/iva ya vienen desglosados de calculateDebtPunitory (el IVA se
    // deriva ahí una sola vez desde el ivaAmount original del MonthlyRecord).
    const { amount, days, remainingDebt, remainingServices, remainingRent, iva, startDate, endDate, unpaidAccumulatedPunitory } =
      await calculateDebtPunitory(debt, date);
    // Punitorios totales impagos = acumulado impago (de pagos previos) + nuevo en vivo.
    // Sin sumar el acumulado el total quedaba por debajo del real (mismo bug que el preview individual).
    const totalPunitory = round2((unpaidAccumulatedPunitory || 0) + amount);
    items.push({
      type: 'DEBT',
      id: debt.id,
      periodLabel: debt.periodLabel,
      periodMonth: debt.periodMonth,
      periodYear: debt.periodYear,
      remainingRent: remainingRent || 0,
      remainingServices: remainingServices || 0,
      iva: iva || 0,
      punitory: totalPunitory,
      punitoryDays: days,
      totalToPay: round2(remainingDebt + totalPunitory),
      fromDate: startDate,
      toDate: endDate,
    });
  }

  if (currentRecord) {
    // Lazy require: paymentTransactionService requiere debtService a nivel de módulo
    // (canPayCurrentMonth), así que el require inverso debe ser diferido para evitar
    // un ciclo circular al cargar el módulo.
    const { calculatePunitoryPreview } = require('./paymentTransactionService');
    const preview = await calculatePunitoryPreview(currentRecord.id, paymentDate);
    const previousBalance = currentRecord.previousBalance || 0;
    const amountPaid = currentRecord.amountPaid || 0;
    // Misma fórmula canónica que PaymentRegistrationModal (totalDue = alquiler +
    // servicios + punitorio + iva − a favor anterior; remaining = totalDue − pagado).
    const totalDue = round2(
      (currentRecord.rentAmount || 0) + Math.max(currentRecord.servicesTotal || 0, 0)
      + (preview.amount || 0) + (currentRecord.ivaAmount || 0) - previousBalance
    );
    const totalToPay = Math.max(round2(totalDue - amountPaid), 0);
    items.push({
      type: 'RECORD',
      id: currentRecord.id,
      periodLabel: `${MONTH_NAMES[currentRecord.periodMonth]} ${currentRecord.periodYear} (mes actual)`,
      periodMonth: currentRecord.periodMonth,
      periodYear: currentRecord.periodYear,
      remainingRent: currentRecord.rentAmount || 0,
      remainingServices: Math.max(currentRecord.servicesTotal || 0, 0),
      iva: currentRecord.ivaAmount || 0,
      punitory: preview.amount || 0,
      punitoryDays: preview.days || 0,
      previousBalance,
      totalToPay,
    });
  }

  const total = round2(items.reduce((s, it) => s + it.totalToPay, 0));
  return { debts: items, total };
};

/**
 * Pago múltiple de deudas (waterfall), opcionalmente con el mes actual como cola:
 * reparte un monto entre varias deudas del mismo contrato, de la más vieja a la más
 * nueva, reutilizando payDebt por cada una, y por último —si se pasó
 * currentRecordId— aplica el remanente al mes actual vía registerPayment.
 *
 * REGLA: una Debt (mes cerrado) NUNCA queda con saldo a favor — cada una se topea a
 * su total real. El excedente, si lo hay, es SIEMPRE del mes actual (único que puede
 * guardarlo como previousBalance del mes siguiente). Sin currentRecordId se mantiene
 * el comportamiento histórico (la última deuda absorbe el excedente como SOBREPAGO),
 * usado hoy por el pago múltiple de solo-deudas desde DebtList.
 */
const payDebtsBulk = async (
  groupId, debtIds, totalAmount, paymentDate, paymentMethod = 'EFECTIVO',
  observations = null, currentRecordId = null, forgivePunitorios = false
) => {
  const amount = parseFloat(totalAmount);
  if (!amount || amount <= 0) throw new Error('Monto inválido');

  const { debts, currentRecord } = await loadAndValidateBulkDebts(groupId, debtIds, currentRecordId);
  const date = toPaymentDate(paymentDate);

  // Total a pagar de cada deuda a la fecha elegida (mismo cálculo que hará payDebt).
  // Incluye el punitorio acumulado impago de pagos previos (igual que el preview):
  // sin sumarlo, las deudas intermedias quedaban PARTIAL y el resto iba a SOBREPAGO.
  // Si se condona (forgivePunitorios), el tope de cada deuda NO debe incluir punitorio:
  // payDebt cobrará 0 de punitorio, así que un tope inflado con el punitorio real
  // dejaría alocar de más → esa diferencia entraría como SOBREPAGO dentro de la deuda
  // (el saldo a favor prohibido que este feature justamente evita).
  const totals = [];
  for (const debt of debts) {
    const { amount: punitory, remainingDebt, unpaidAccumulatedPunitory } = await calculateDebtPunitory(debt, date);
    const punitoryOwed = forgivePunitorios ? 0 : round2((unpaidAccumulatedPunitory || 0) + punitory);
    totals.push(round2(remainingDebt + punitoryOwed));
  }

  let remaining = amount;
  const results = [];
  const paidMonthlyRecordIds = [];
  for (let i = 0; i < debts.length; i++) {
    if (remaining <= 0) break;
    const debt = debts[i];
    const isLast = i === debts.length - 1;
    // Con mes actual de cola, TODAS las deudas se topean a su total real (el
    // excedente se reserva para el mes actual). Sin mes actual, se preserva el
    // comportamiento histórico: la última deuda alcanzada absorbe el excedente.
    let alloc = (isLast && !currentRecord) ? remaining : Math.min(remaining, totals[i]);
    alloc = round2(alloc);
    if (alloc <= 0) continue;

    const { debt: updatedDebt } = await payDebt(debt.id, alloc, paymentDate, paymentMethod, observations, forgivePunitorios);
    results.push({
      debtId: debt.id,
      periodLabel: debt.periodLabel,
      allocated: alloc,
      status: updatedDebt.status,
    });
    paidMonthlyRecordIds.push(debt.monthlyRecordId);
    remaining = round2(remaining - alloc);
  }

  let recordResult = null;
  if (currentRecord && remaining > 0) {
    // Lazy require: ver nota de circularidad en previewBulkDebtPayment.
    const { registerPayment } = require('./paymentTransactionService');
    const { transaction } = await registerPayment(groupId, currentRecord.id, {
      paymentDate,
      amount: remaining,
      paymentMethod,
      forgivePunitorios,
      generateReceipt: false,
      observations,
    });
    recordResult = {
      monthlyRecordId: currentRecord.id,
      periodLabel: `${MONTH_NAMES[currentRecord.periodMonth]} ${currentRecord.periodYear}`,
      allocated: remaining,
      transactionId: transaction?.id || null,
    };
    paidMonthlyRecordIds.push(currentRecord.id);
    remaining = 0;
  }

  return {
    results,
    recordResult,
    paidMonthlyRecordIds,
    totalApplied: round2(amount - Math.max(remaining, 0)),
    remaining: Math.max(remaining, 0),
  };
};

/**
 * Obtener deudas abiertas (OPEN o PARTIAL) para un grupo.
 * Opcionalmente filtrar por contrato.
 */
/**
 * Helper to compute the single source of truth for an open debt's live values.
 * Returns the enriched debt object with `liveCurrentTotal` and related punitory properties.
 *
 * @param {object} debt - The original debt object
 * @param {string} calculationDate - The date to calculate punitorios against (usually today ART)
 * @param {object} preloaded - Preloaded dependencies (contracts, holidays)
 * @returns {Promise<object>} The enriched debt object
 */
const computeLiveDebtTotal = async (debt, calculationDate, preloaded = null) => {
  if (debt.status === 'PAID') {
    return {
      ...debt,
      liveCurrentTotal: 0,
      livePunitoryDays: 0,
      liveAccumulatedPunitory: 0,
      remainingDebt: 0,
      punitoryFromDate: null,
      punitoryToDate: null,
      unpaidAccumulatedPunitory: 0,
      remainingRent: 0,
      remainingServices: 0,
      iva: 0,
    };
  }

  const { amount: currentPunitory, days, remainingDebt, unpaidAccumulatedPunitory, startDate, endDate, remainingRent, remainingServices, iva } = await calculateDebtPunitory(debt, calculationDate, preloaded, true);
  return {
    ...debt,
    liveAccumulatedPunitory: currentPunitory,
    livePunitoryDays: days,
    liveCurrentTotal: remainingDebt + (unpaidAccumulatedPunitory || 0) + currentPunitory,
    remainingDebt,
    unpaidAccumulatedPunitory: unpaidAccumulatedPunitory || 0,
    punitoryFromDate: startDate,
    punitoryToDate: endDate,
    // Desglose alquiler vs servicios (neto de IVA) vs IVA pendientes (para mostrar
    // "Deudas Acumuladas" con el mismo nivel de detalle que "Cobrado de deudas
    // anteriores", y para que el modal de pago muestre el IVA en su propia línea
    // en vez de mezclado con "servicios").
    remainingRent: remainingRent || 0,
    remainingServices: remainingServices || 0,
    iva: iva || 0,
  };
};

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
    return computeLiveDebtTotal(debt, getTodayLocalString(), preloaded);
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
    return computeLiveDebtTotal(debt, getTodayLocalString(), preloaded);
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
      // A-25: día ART correcto (string, TZ-inmune), no `new Date()` crudo del proceso.
      const { amount: currentPunitory, remainingDebt, unpaidAccumulatedPunitory } = await calculateDebtPunitory(debt, getTodayLocalString(), preloaded, true);
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
const cancelDebtPayment = async (debtId, paymentId, skipTransactionDeletion = false, tx = null) => {
  // Cuando deleteTransaction (C-05) llama con skipTransactionDeletion=true, pasa su propia
  // `tx` (transacción con advisory lock) para que revertir la Debt/DebtPayment y borrar la
  // PaymentTransaction ocurran atómicamente. El endpoint standalone de anular pago (sin
  // `tx`) sigue usando el cliente normal, sin cambios de comportamiento.
  const db = tx || prisma;

  const debt = await db.debt.findUnique({
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
    const transaction = await db.paymentTransaction.findFirst({
      where: {
        monthlyRecordId: debt.monthlyRecordId,
        paymentDate: payment.paymentDate,
        amount: payment.amount,
      },
    });

    if (transaction) {
      // Los TransactionConcept se borran en cascada
      await db.paymentTransaction.delete({
        where: { id: transaction.id },
      });
    }
  }

  // Revertir cambios en Debt
  const newAmountPaid = Math.max(debt.amountPaid - payment.amount, 0);

  // Restaurar accumulatedPunitory del pago anterior (si existe).
  // Cada DebtPayment guarda punitoryAtPayment = punitorios totales calculados al momento de ese pago.
  // Al anular el último pago, el accumulatedPunitory debe volver al valor del pago previo.
  let newAccumulatedPunitory;
  if (debt.payments.length > 1) {
    const previousPayment = debt.payments[debt.payments.length - 2];
    newAccumulatedPunitory = previousPayment.punitoryAtPayment || 0;
  } else {
    // Bug real (2026-07-16, "pago completo, borro el pago, queda como saldada"): no
    // hay pago previo al que volver, pero NO se puede poner 0 acá — eso borra el
    // punitorio devengado desde punitoryStartDate hasta ahora, que sigue siendo plata
    // real adeudada (mismo patrón que el catch-up de createDebtFromMonthlyRecord).
    // `computeLiveDebtTotal` compensa esto en la pantalla (recalcula todo en vivo
    // desde punitoryStartDate cuando no hay pagos), pero OTROS lectores confían en el
    // campo PERSISTIDO (p. ej. `_recalculateCore` usa `openDebt.accumulatedPunitory`
    // tal cual para el "Total" de Control Mensual) — con 0 ahí, el Total quedaba muy
    // por debajo del Deuda real.
    //
    // NO se puede usar calculateDebtPunitory con skipUpdate=true para esto: en este
    // punto el PaymentTransaction ya se borró pero el MonthlyRecord todavía NO se
    // recalculó (eso pasa más abajo), así que su `amountPaid` sigue siendo el VIEJO
    // (con el pago que se está anulando todavía contado). El auto-heal de
    // calculateDebtPunitory lee ese `amountPaid` desactualizado y REASIGNA en memoria
    // unpaidRentAmount/unpaidServicesAmount a 0 (cree que ya está todo cubierto) —
    // `skipUpdate` solo bloquea la escritura a la base, NO esa reasignación en
    // memoria, así que el resto del cálculo de esa misma llamada (remainingBase,
    // punitoryBase) queda corrompido y devuelve un grossPunitoryToDate ~0 igual.
    // Se calcula el catch-up DIRECTO con calculatePunitoryV2 (función pura, sin
    // auto-heal), mismo patrón que createDebtFromMonthlyRecord/recalculateDebtFromMonthlyRecord.
    let grossPunitoryToDate = 0;
    try {
      const contract = await prisma.contract.findUnique({ where: { id: debt.contractId } });
      if (contract) {
        const holidays = await getHolidaysForYear(debt.periodYear);
        // Regla de base (memoria punitory-base-rule): sin ningún pago (ni de la deuda
        // ni previousRecordPayment del MonthlyRecord), los punitorios van SOLO sobre
        // el alquiler; con un pago previo al cierre, sobre alquiler+servicios.
        const hasPreClosurePayment = (debt.previousRecordPayment || 0) > 0;
        const punitoryBase = hasPreClosurePayment
          ? round2((debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0))
          : (debt.unpaidRentAmount || 0);
        // ANCLA: si la deuda nació de un mes con pago parcial, `punitoryStartDate` es la
        // fecha de ESE pago, no el día 1 del período — pasar `null` acá hacía que
        // calculatePunitoryV2 recalculara desde el día 1 sobre alquiler+servicios,
        // sobre-contando el tramo. Mismo criterio que calculateDebtPunitory
        // (`effectiveLastPaymentDate`).
        const firstOfMonth = new Date(debt.periodYear, debt.periodMonth - 1, 1);
        const anchor = new Date(debt.punitoryStartDate);
        const anchorAsLastPayment = anchor.getTime() !== firstOfMonth.getTime() ? anchor : null;
        const liveResult = calculatePunitoryV2(
          getTodayLocalString(),
          debt.periodMonth,
          debt.periodYear,
          punitoryBase,
          contract.punitoryStartDay,
          contract.punitoryGraceDay,
          contract.punitoryPercent,
          holidays,
          anchorAsLastPayment // sin pagos propios: se cuenta desde el ancla de la deuda
        );
        grossPunitoryToDate = liveResult.amount || 0;
      }
    } catch (error) {
      console.error('Error recalculando catch-up de punitorios al anular pago:', error);
    }
    newAccumulatedPunitory = grossPunitoryToDate;
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
    // A-25: día ART correcto (string, TZ-inmune), no `new Date()` crudo del proceso.
    // skipUpdate=true (2026-07-16, mismo bug que el catch-up de arriba): el
    // MonthlyRecord todavía no se recalculó en este punto (su amountPaid sigue
    // contando el pago que se está anulando) — sin esto, si `tempDebt.amountPaid`
    // queda en 0 (se anuló el único pago), el auto-heal leería ese amountPaid viejo
    // y pisaría unpaidRentAmount/unpaidServicesAmount de la deuda real a 0.
    const { amount: unpaidPunitory } = await calculateDebtPunitory(tempDebt, getTodayLocalString(), null, true);

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
  await db.debtPayment.delete({
    where: { id: paymentId },
  });

  const updatedDebt = await db.debt.update({
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

  // Recalcular MonthlyRecord si existe. Dentro de una `tx` (llamado desde deleteTransaction,
  // C-05) el recálculo corre INLINE en la misma transacción/lock, igual que C-03/C-04; sin
  // `tx` (endpoint standalone de anular pago) se preserva el comportamiento async de siempre.
  if (debt.monthlyRecordId) {
    if (tx) {
      const { recalculateMultipleRecords } = require('./monthlyRecordService');
      await recalculateMultipleRecords([debt.monthlyRecordId], tx, true);
    } else {
      const { recalculateMonthlyRecord } = require('./monthlyRecordService');
      await recalculateMonthlyRecord(debt.monthlyRecordId);
    }
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
  // Lectura previa SOLO para el fail-fast (no usar para ningún cálculo: se relee
  // fresca bajo el lock, dentro de la transacción).
  const debtPre = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { id: true, contractId: true, status: true, monthlyRecordId: true },
  });

  if (!debtPre) throw new Error('Deuda no encontrada');
  if (debtPre.status === 'PAID') throw new Error('Esta deuda ya está pagada');

  // A-14 (AUDITORIA_FUNCIONAL_2026-07-10.md): antes el recálculo corría ASYNC
  // (recalculateMonthlyRecord → setImmediate(processDirtyRecords)); el
  // `findUnique` de retorno podía ver el estado VIEJO del record (todavía sin
  // el recálculo aplicado), y el forzado de COMPLETE de acá competía en
  // carrera con el worker async, que podía revertirlo a PENDING (
  // `_recalculateCore` no conoce `balanceForgiven`, así que una condonación
  // sin ningún pago real recalcula PENDING y pisa el COMPLETE que este mismo
  // forgiveDebt acababa de forzar — caso real: Amaya Nelida, mes PARTIAL con
  // deuda ya saldada). Fix: correr todo (update de la deuda + recálculo +
  // forzado de COMPLETE) en UNA transacción con el mismo advisory lock por
  // contrato que usan payDebt/registerPayment/cancelDebtPayment, y con el
  // recálculo INLINE (no fire-and-forget) para que no haya ventana de carrera.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${debtPre.contractId}'))`);

    const debt = await tx.debt.findUnique({ where: { id: debtId } });
    if (!debt) throw new Error('Deuda no encontrada');
    if (debt.status === 'PAID') throw new Error('Esta deuda ya está pagada');

    const updatedDebt = await tx.debt.update({
      where: { id: debtId },
      data: {
        status: 'PAID',
        closedAt: new Date(),
        observations,
      },
    });

    if (debt.monthlyRecordId) {
      const { recalculateMultipleRecords } = require('./monthlyRecordService');
      await recalculateMultipleRecords([debt.monthlyRecordId], tx, true);

      const updatedRecord = await tx.monthlyRecord.findUnique({ where: { id: debt.monthlyRecordId } });
      if (updatedRecord.status !== 'COMPLETE') {
        await tx.monthlyRecord.update({
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
  }, { timeout: 15000 });
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

  // Recalcular el "ancla" de punitorios (accumulatedPunitory + punitoryStartDate)
  // EXACTAMENTE igual que createDebtFromMonthlyRecord — no solo alquiler/servicios.
  // Bug real (2026-07-16, caso C20 Junio): esta función solo recalculaba
  // unpaidRent/unpaidServices; si se borraba una transacción PREVIA al cierre del
  // mes (la que quedó registrada en `previousRecordPayment` al crear la deuda),
  // `unpaidRentAmount` volvía a subir correctamente pero `accumulatedPunitory` y
  // `punitoryStartDate` quedaban congelados con el pago ya borrado —el punitorio
  // vivo (calculateDebtPunitory) seguía contando desde la fecha de ESE pago en vez
  // de desde el día 1 del período, sub-contando el punitorio real adeudado.
  //
  // GUARD (debt.amountPaid === 0, mismo criterio que el guard de calculateDebtPunitory):
  // si la deuda YA tiene pagos propios (vía payDebt/DebtPayment), accumulatedPunitory
  // es responsabilidad de ESE ciclo de vida —congelado/actualizado por payDebt en cada
  // pago— y no debe recalcularse acá desde el MonthlyRecord (que puede no tener ninguna
  // transacción propia si todo se pagó contra la deuda). Sin este guard, una deuda con
  // punitorios pendientes pero ya con pagos propios perdía ese punitorio pendiente.
  let accumulatedPunitory = debt.accumulatedPunitory || 0;
  let punitoryStartDate = debt.punitoryStartDate;

  if ((debt.amountPaid || 0) === 0) {
    const contract = await prisma.contract.findUnique({ where: { id: debt.contractId } });
    let currentPunitoryAmount = monthlyRecord.punitoryAmount || 0;

    const anchorIsPayment = !!(monthlyRecord.transactions && monthlyRecord.transactions.length > 0);

    if (anchorIsPayment) {
      const lastTx = monthlyRecord.transactions[monthlyRecord.transactions.length - 1];
      punitoryStartDate = new Date(lastTx.paymentDate);
    } else {
      punitoryStartDate = new Date(monthlyRecord.periodYear, monthlyRecord.periodMonth - 1, 1);
    }

    // Mismo invariante que createDebtFromMonthlyRecord (ver su comentario, caso Brunello
    // julio 2026): el catch-up solo puede aplicarse cuando el ancla es el día 1. Con ancla =
    // fecha del pago parcial, calculateDebtPunitory ya devenga ese tramo en vivo, y sumarlo
    // acá lo cobraba dos veces — peor todavía en esta función, que corre en CADA edición de
    // un servicio del mes cerrado con el `getTodayLocalString()` de ese momento, así que el
    // solapamiento crecía en cada toque.
    if (!anchorIsPayment && contract && monthlyRecord.status !== 'COMPLETE' && !monthlyRecord.punitoryForgiven) {
      try {
        const amountPaid = monthlyRecord.amountPaid || 0;
        const servicesTotal = monthlyRecord.servicesTotal || 0;
        const ivaAmount = monthlyRecord.ivaAmount || 0;
        // `appliedCredit`: misma regla que en createDebtFromMonthlyRecord (2026-08-26) —
        // si el saldo a favor arrastrado cubre el alquiler, no se devengan punitorios.
        const unpaidRentBase = computePunitoryBase({
          rentAmount: monthlyRecord.rentAmount,
          servicesTotal,
          ivaAmount,
          amountPaid,
          appliedCredit: monthlyRecord.previousBalance || 0,
        });
        const lastPaymentDate = null; // sin transacciones: se cuenta desde el día 1 del período
        const calculationDate = getTodayLocalString();
        const holidays = await getHolidaysForYear(monthlyRecord.periodYear);
        const liveResult = calculatePunitoryV2(
          calculationDate,
          monthlyRecord.periodMonth,
          monthlyRecord.periodYear,
          unpaidRentBase,
          contract.punitoryStartDay,
          contract.punitoryGraceDay,
          contract.punitoryPercent,
          holidays,
          lastPaymentDate
        );
        currentPunitoryAmount = (monthlyRecord.punitoryAmount || 0) + liveResult.amount;
      } catch (error) {
        console.error('Error recalculando catch-up de punitorios:', error);
        // Fallback al valor congelado si el cálculo falla.
      }
    }
    accumulatedPunitory = currentPunitoryAmount;
  }

  // Recalcular unpaidRent y unpaidServices basado en el estado actual del MonthlyRecord
  // (con el punitorio recién recalculado inyectado, mismo patrón que createDebtFromMonthlyRecord).
  const recordWithCurrentPunitorios = { ...monthlyRecord, punitoryAmount: accumulatedPunitory };
  const { unpaidRent, unpaidPunitory, unpaidServices, totalOriginal } = calculateImputation(recordWithCurrentPunitorios);

  const totalBase = unpaidRent + unpaidServices;
  // currentTotal (CON punitorios y saldo a favor aplicado) es la fuente de verdad para
  // decidir si la deuda quedó saldada — mismo criterio y tolerancia ($1) que payDebt().
  // Bug real (2026-07-14, 6 casos confirmados en producción): antes se comparaba
  // `amountPaid >= totalBase` SIN punitorios ni appliedCredit, así que una deuda con
  // punitorios pendientes podía marcarse 'PAID' con currentTotal > 0 — y como esta
  // función (a diferencia de payDebt) nunca tocaba el MonthlyRecord, el mes quedaba
  // congelado en 'PARTIAL' mientras la Deuda decía 'PAID' (Control Mensual vs Liquidación
  // mostraban estados distintos para el mismo período).
  const newCurrentTotal = round2(Math.max(totalBase + unpaidPunitory - (debt.appliedCredit || 0) - debt.amountPaid, 0));

  // Recalcular el status
  let newStatus = 'OPEN';
  let closedAt = null;

  if (newCurrentTotal <= 1) {
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
      accumulatedPunitory: unpaidPunitory,
      punitoryStartDate,
      currentTotal: newCurrentTotal,
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

  // Sincronizar el MonthlyRecord del período con la deuda (mismo patrón que payDebt()):
  // si la deuda quedó saldada, el mes tiene que quedar COMPLETE. Sin esto es como
  // reapareció el bug real de arriba.
  if (newStatus === 'PAID' && monthlyRecord.status !== 'COMPLETE') {
    await prisma.monthlyRecord.update({
      where: { id: monthlyRecordId },
      data: {
        status: 'COMPLETE',
        isPaid: true,
        isCancelled: true,
        fullPaymentDate: monthlyRecord.fullPaymentDate || debt.lastPaymentDate || new Date(),
      },
    });
  }

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
  if (!debt) return null;

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
  //
  // Bug real (2026-07-16, caso "pago primero, IVA después"): acá NO se puede usar
  // `record.amountPaid` — una vez que la deuda tiene pagos propios, `payDebt` espeja
  // cada pago como una PaymentTransaction sobre este mismo MonthlyRecord (para que
  // Historial de Pagos lo muestre), así que `record.amountPaid` termina incluyendo
  // pagos hechos DESPUÉS de cerrar la deuda. `payDebt` nunca decrementa
  // `unpaidServicesAmount` (es un ancla BRUTA; el neteo real vive en
  // `debt.amountPaid`/`currentTotal` agregados, con su propio reparto por concepto
  // vía servicesPortion/rentPortion/punitoryPortion). Si acá se neteara de nuevo
  // contra `record.amountPaid`, un pago viejo (que fue a alquiler/punitorios, antes
  // de que existiera el IVA) se "reasignaba" retroactivamente a cubrir el IVA nuevo,
  // ocultando que sigue impago. `debt.previousRecordPayment` es el único monto que
  // SÍ debe netear acá: es lo pagado ANTES de cerrar el mes (congelado al crear la
  // deuda, nunca tocado por payDebt), la misma base que usó calculateImputation en
  // ese momento.
  const { unpaidServices } = calculateImputation({
    rentAmount: record.rentAmount,
    servicesTotal,
    ivaAmount,
    punitoryAmount: record.punitoryAmount || 0,
    amountPaid: debt.previousRecordPayment || 0,
    previousBalance: Math.max(record.previousBalance || 0, 0),
  });

  if (round2(unpaidServices) === round2(debt.unpaidServicesAmount || 0)) return debt;

  const delta = round2(unpaidServices - (debt.unpaidServicesAmount || 0));
  const newCurrentTotal = round2(
    Math.max((debt.unpaidRentAmount || 0) + unpaidServices + (debt.accumulatedPunitory || 0) - (debt.appliedCredit || 0) - (debt.amountPaid || 0), 0)
  );
  const newOriginal = round2((debt.originalAmount || 0) + delta);

  // Decisión del usuario (2026-07-16): una deuda PAID SÍ se reabre si aparece una
  // obligación nueva (p. ej. IVA agregado después de haber pagado todo) — es plata
  // real que pasaría a no cobrarse nunca si se dejara "PAID" con $0. Si sigue sin
  // quedar nada pendiente, se mantiene/vuelve a PAID.
  const newStatus = newCurrentTotal > 1
    ? ((debt.amountPaid || 0) > 0 ? 'PARTIAL' : 'OPEN')
    : 'PAID';
  const newClosedAt = newStatus === 'PAID' ? (debt.closedAt || new Date()) : null;

  return prisma.debt.update({
    where: { id: debt.id },
    data: {
      unpaidServicesAmount: unpaidServices,
      currentTotal: newCurrentTotal,
      originalAmount: newOriginal,
      status: newStatus,
      closedAt: newClosedAt,
    },
  });
};

/**
 * Sincronizar el saldo a favor aplicado (`appliedCredit`) de la deuda con el
 * `previousBalance` ACTUAL (en vivo) del MonthlyRecord de origen.
 *
 * Bug reportado por el usuario (2026-07-12): `appliedCredit` se calculaba UNA
 * SOLA VEZ al crear la deuda (`createDebtFromMonthlyRecord:177`) y nunca se
 * volvía a tocar. Si el `previousBalance` del mes cambiaba DESPUÉS (por un
 * recálculo real: se anula un pago anterior, se deshace un ajuste, etc.),
 * Control Mensual mostraba el saldo a favor NUEVO (en vivo, vía
 * `record.previousBalance`) pero la ficha de Deuda seguía mostrando el VIEJO
 * (congelado en `appliedCredit`) — la columna "Debe Sig." y el monto de la
 * deuda divergían para el mismo concepto.
 *
 * Decisión del usuario (2026-07-12): gana el valor EN VIVO. Se llama desde
 * `_recalculateCore` (monthlyRecordService.js), cada vez que termina de
 * calcular el `previousBalance` final de un mes que ya tiene una Debt
 * asociada no pagada, pasándole ese mismo valor.
 *
 * Alcance acotado a propósito (mismo criterio que `syncDebtServicesFromRecord`):
 * SOLO toca `appliedCredit` y `currentTotal`. NO toca `unpaidRentAmount`,
 * `unpaidServicesAmount`, `accumulatedPunitory` ni `status` — esos son
 * responsabilidad de otros eventos/funciones (`recalculateDebtFromMonthlyRecord`,
 * `syncDebtServicesFromRecord`, `payDebt`). Misma fórmula de clamp que
 * `createDebtFromMonthlyRecord:177` (`min(max(previousBalance,0), totalImpago)`).
 *
 * Bug real (2026-07-14, caso "C21_credit_to_debt"): el TOPE de crédito a
 * sincronizar usaba `accumulatedPunitory` CONGELADO (el valor guardado al
 * crear/cerrar la deuda), no los punitorios que siguen corriendo EN VIVO desde
 * entonces. Con una deuda vieja (136+ días) el congelado puede ser $0 mientras
 * el vivo ya es $244.800 — el tope quedaba clampeado muy bajo y nunca dejaba
 * subir `appliedCredit` hasta el crédito real disponible, aunque hubiera de
 * sobra para cubrirlo todo (Control Mensual mostraba "Debe Sig. $40.000"
 * correcto pero "Deuda" mostraba de más).
 *
 * OJO: esto SOLO afecta el TOPE del clamp (`newAppliedCredit`) — `currentTotal`
 * (el campo guardado) se sigue calculando sobre `totalUnpaidBase` CONGELADO,
 * igual que en el resto de este archivo (payDebt, recalculateDebtFromMonthlyRecord).
 * `currentTotal` es una foto congelada; el total EN VIVO para mostrar al
 * usuario es `computeLiveDebtTotal().liveCurrentTotal`, que ya suma punitorios
 * en vivo por su cuenta — sumarlos ACÁ TAMBIÉN los contaba dos veces (regresión
 * real: un test existente esperaba currentTotal=100000 con accumulatedPunitory
 * congelado en 0, y con ese doble conteo daba 121000, de más).
 */
const syncDebtAppliedCreditFromRecord = async (debtId, currentPreviousBalance, tx = prisma, preloaded = null) => {
  const debt = await tx.debt.findUnique({ where: { id: debtId } });
  if (!debt || debt.status === 'PAID') return null;

  const totalUnpaidBase = round2(
    (debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0) + (debt.accumulatedPunitory || 0)
  );
  // Tope del clamp: SÍ incluye punitorios en vivo (no solo el congelado), para
  // no perder crédito sobrante que en la realidad ya alcanza a cubrirlos.
  const livePunitory = await calculateDebtPunitory(debt, getTodayLocalString(), preloaded, true);
  const liveTotalCeiling = round2(
    (debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0)
    + (livePunitory.unpaidAccumulatedPunitory || 0) + (livePunitory.amount || 0)
  );
  const newAppliedCredit = round2(Math.min(Math.max(currentPreviousBalance || 0, 0), liveTotalCeiling));

  if (newAppliedCredit === round2(debt.appliedCredit || 0)) return debt; // sin cambios, no escribir

  const newCurrentTotal = round2(
    Math.max(totalUnpaidBase - newAppliedCredit - (debt.amountPaid || 0), 0)
  );

  return tx.debt.update({
    where: { id: debt.id },
    data: { appliedCredit: newAppliedCredit, currentTotal: newCurrentTotal },
  });
};

module.exports = {
  createDebtFromMonthlyRecord,
  calculateDebtPunitory,
  syncDebtServicesFromRecord,
  syncDebtAppliedCreditFromRecord,
  calculateImputation,
  preloadDebtDependencies,
  computeLiveDebtTotal,
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
