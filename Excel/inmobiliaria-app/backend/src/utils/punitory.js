// Punitory (late fee) calculation utilities - V2
// Supports business day calculation with holidays

const prisma = require('../lib/prisma');
const { getTodayLocalDate } = require('./dateUtils');

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a holiday
 * @param {Date} date
 * @param {Date[]} holidays - Array of holiday dates
 */
function isHoliday(date, holidays) {
  const dateStr = date.toISOString().split('T')[0];
  return holidays.some((h) => h.toISOString().split('T')[0] === dateStr);
}

/**
 * Check if a date is a business day (not weekend, not holiday)
 */
function isBusinessDay(date, holidays) {
  return !isWeekend(date) && !isHoliday(date, holidays);
}

/**
 * Get the next business day from a given date
 */
function getNextBusinessDay(date, holidays) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (!isBusinessDay(next, holidays)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Get the effective grace date for a month.
 * The grace day (e.g., day 10) is adjusted if it falls on a non-business day.
 * If day 10 = Saturday → Monday 12
 * If day 10 = Sunday → Monday 11
 * If day 10 = Holiday → next business day
 */
function getEffectiveGraceDate(year, month, graceDayTarget, holidays) {
  // month is 1-12, JS Date month is 0-11
  const graceDate = new Date(year, month - 1, graceDayTarget);

  if (isBusinessDay(graceDate, holidays)) {
    return graceDate;
  }

  // Move to next business day
  return getNextBusinessDay(graceDate, holidays);
}

/**
 * Parse a date value into a local-midnight Date, handling timezone-safe parsing.
 * Strings like "2026-02-09" are parsed as LOCAL date, not UTC.
 */
function toLocalDate(d) {
  if (typeof d === 'string') {
    const parts = d.replace(/T.*/, '').split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  if (d instanceof Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return new Date(d);
}

/**
 * Calculate difference in calendar days between two dates
 */
function diffCalendarDays(dateA, dateB) {
  const a = toLocalDate(dateA);
  const b = toLocalDate(dateB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate punitorios with V2 rules:
 * - If there's a lastPaymentDate (partial payment was made):
 *   Punitorios count from lastPaymentDate to paymentDate (both inclusive)
 * - For PAST months (period month is before payment date month):
 *   Count from day 1 of the period month to the payment date (inclusive)
 * - For CURRENT month:
 *   Pay by business grace day → $0
 *   Pay after business grace day → count from startDay to payment date
 * - punitorios = baseRent * punitoryPercent * days
 *
 * @param {Date} paymentDate - Actual payment date (or today for preview)
 * @param {number} periodMonth - Period month (1-12)
 * @param {number} periodYear - Period year
 * @param {number} baseRent - Amount on which punitorios are calculated (can be unpaid rent)
 * @param {number} punitoryStartDay - Day from which punitorios count (default: 4)
 * @param {number} punitoryGraceDay - Business day limit without punitorios (default: 10)
 * @param {number} punitoryPercent - Daily percentage (default: 0.02 = 2%)
 * @param {Date[]} holidays - Array of holiday dates for the period
 * @param {Date|null} lastPaymentDate - Date of the last partial payment (if any)
 * @returns {{ amount: number, days: number, graceDate: Date, fromDate: Date|null, toDate: Date|null }}
 */
function calculatePunitoryV2(
  paymentDate,
  periodMonth,
  periodYear,
  baseRent,
  punitoryStartDay = 4,
  punitoryGraceDay = 10,
  punitoryPercent = 0.02,
  holidays = [],
  lastPaymentDate = null
) {
  // Normalize payment date to local midnight (timezone-safe)
  const payDateNorm = toLocalDate(paymentDate);
  const graceDate = getEffectiveGraceDate(
    periodYear,
    periodMonth,
    punitoryGraceDay,
    holidays
  );
  const graceDateNorm = toLocalDate(graceDate);

  // If baseRent is 0 or negative, no punitorios
  if (baseRent <= 0) {
    return { amount: 0, days: 0, graceDate, fromDate: null, toDate: null };
  }

  // Check if the period month is in the past relative to the payment date
  const payMonth = payDateNorm.getMonth() + 1;
  const payYear = payDateNorm.getFullYear();
  const isPastPeriod = periodYear < payYear || (periodYear === payYear && periodMonth < payMonth);

  // GRACE PERIOD CHECK FIRST: if paying within the current month's grace period, never punitorios
  if (!isPastPeriod && payDateNorm <= graceDateNorm) {
    return { amount: 0, days: 0, graceDate, fromDate: null, toDate: null };
  }

  // If there was a previous partial payment, punitorios count from that date
  if (lastPaymentDate) {
    const lastPayNorm = toLocalDate(lastPaymentDate);
    // If new payment is on the same day or before the last payment, no additional punitorios
    if (payDateNorm <= lastPayNorm) {
      return { amount: 0, days: 0, graceDate, fromDate: null, toDate: null };
    }
    // REGLA CONFIRMADA POR EL USUARIO (2026-07): el tramo cuenta desde la fecha del
    // último pago hasta la fecha de este pago, AMBAS INCLUSIVE (por eso el +1).
    // No cambiar a exclusivo aunque parezca "doble conteo" del día del pago anterior.
    const diasPunitorios = diffCalendarDays(payDateNorm, lastPayNorm) + 1;
    const dailyRate = baseRent * punitoryPercent;
    const amount = Math.round(dailyRate * diasPunitorios * 100) / 100;
    return { amount, days: diasPunitorios, graceDate, fromDate: lastPayNorm, toDate: payDateNorm };
  }

  if (isPastPeriod) {
    // Past month: count from day 1 of the period month to payment date (inclusive of day 1)
    const firstOfPeriod = new Date(periodYear, periodMonth - 1, 1);
    const days = diffCalendarDays(payDateNorm, firstOfPeriod);
    const totalDays = days + 1; // Include day 1 itself
    const dailyRate = baseRent * punitoryPercent;
    const amount = Math.round(dailyRate * totalDays * 100) / 100;
    return { amount, days: totalDays, graceDate, fromDate: firstOfPeriod, toDate: payDateNorm };
  }

  // Current month, after grace, no previous payment: count from punitoryStartDay to paymentDate (inclusive)
  const fromDate = new Date(periodYear, periodMonth - 1, punitoryStartDay);
  const diasPunitorios = diffCalendarDays(payDateNorm, fromDate) + 1;
  const dailyRate = baseRent * punitoryPercent;
  const amount = Math.round(dailyRate * diasPunitorios * 100) / 100;

  return { amount, days: diasPunitorios, graceDate, fromDate, toDate: payDateNorm };
}

/**
 * Cache en memoria de feriados por año. Los feriados de un año no cambian
 * durante la vida del proceso salvo que alguien los edite via CRUD (poco
 * frecuente); en ese caso se invalida con clearHolidayCache(). Esto evita un
 * findMany a la DB en cada llamada de cálculo de punitorios, que se invoca
 * decenas de veces por request (monthlyRecordService, debtService,
 * paymentTransactionService) y era un cuello de botella real con pocos datos.
 */
const holidayCache = new Map();

/**
 * Get holidays from database for a specific year (memoizado por proceso).
 */
async function getHolidaysForYear(year) {
  if (holidayCache.has(year)) {
    return holidayCache.get(year);
  }
  const holidays = await prisma.holiday.findMany({
    where: { year },
    select: { date: true },
  });
  const dates = holidays.map((h) => new Date(h.date));
  holidayCache.set(year, dates);
  return dates;
}

/**
 * Invalida el cache de feriados. Llamar tras crear/eliminar/sembrar feriados
 * (ver holidayService.js) para que el próximo cálculo relea la DB.
 */
function clearHolidayCache(year) {
  if (year === undefined) {
    holidayCache.clear();
  } else {
    holidayCache.delete(year);
  }
}

/**
 * Round a monetary value to 2 decimal places, eliminating floating-point drift.
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Base ÚNICA de punitorios para un mes abierto (LOGICA.md §4.3, regla confirmada
 * por el usuario 2026-07-11 — AUDITORIA_FUNCIONAL_2026-07-10.md A-03/A-04):
 *   - Sin ningún pago real: la base es SOLO el alquiler (los servicios/IVA
 *     impagos no generan punitorios en mes abierto sin ningún pago).
 *   - Con pagos parciales: la base es el SALDO RESTANTE = alquiler + servicios
 *     + IVA impago − pagos reales, y la bonificación/descuento (servicesTotal
 *     negativo) NO reduce esa base (clamp a >=0): la TASA de mora se calcula
 *     sobre el alquiler+servicios brutos, sin descontar bonificaciones.
 *   - El saldo a favor del mes anterior (previousBalance) entra como
 *     `appliedCredit`: cuenta como plata cobrada del PRIMER pago (ver abajo).
 * Antes de esta función existían 4 copias de esta misma fórmula (display y
 * _recalculateCore en monthlyRecordService.js, cobro en paymentTransactionService.js,
 * cierre en debtService.js) — las dos primeras ya coincidían entre sí; las de
 * cobro y cierre calculaban una base rent-only distinta (bug real, no solo
 * duplicación). Esta es ahora la única implementación.
 *
 * Bug (2026-07-23, caso Godoy Fernando Alberto, julio 2026): el clamp de arriba
 * se aplicaba ANTES de esta función (cada caller pasaba `Math.max(servicesTotal,
 * 0)`), así que un mes con una bonificación real que cubre parte del alquiler
 * (ej. "Cocina cuota 2 de 3") nunca podía saldarse del todo: aunque el pago
 * cubriera el total NETO exacto (alquiler+servicios con el descuento aplicado),
 * la base seguía comparando contra el alquiler BRUTO sin descuento, dejando un
 * saldo fantasma que devengaba mora en vivo contra la fecha de HOY (crecía cada
 * día que el pago tardara en registrarse). Fix: si lo pagado ya cubre el total
 * NETO (servicesTotal SIN clampear), no hay ninguna base de punitorio — la
 * bonificación sigue sin bajar la TASA mientras algo quede pendiente, pero deja
 * de haber pendiente en cuanto se paga el neto completo.
 *
 * Bug (2026-07-30, caso Biassi Gonzalo Amir, julio 2026): `appliedCredit`. Un
 * mes cuyos cargos se cubren con efectivo MÁS el saldo a favor del mes anterior
 * quedaba con la porción del crédito como base impaga, devengando mora todos los
 * días — y como el mes nunca llegaba a COMPLETE, tampoco entraba en la segunda
 * pasada de `_recalculateCore` que congela el punitorio a lo realmente cobrado,
 * así que el error crecía solo. Biassi pagó $767.918 en efectivo y usó $560 de
 * saldo a favor contra cargos de $768.478: cancelaba justo, pero el sistema veía
 * $560 impagos.
 *
 * REGLA (definida por el usuario 2026-07-30, REEMPLAZA a "el saldo a favor nunca
 * entra acá"): el saldo a favor se computa como si fuera un monto del PRIMER
 * pago. Se suma UNA sola vez al total cobrado — nunca por cada pago posterior —
 * y es puramente interno a este cálculo: NO se escribe en `amountPaid` ni en los
 * `TransactionConcept`, porque el recibo tiene que seguir mostrando el efectivo
 * real que entregó el inquilino ($767.918, no $768.478). El crédito sigue sin
 * cancelar mora cuando el mes queda genuinamente impago: descuenta como plata
 * cobrada, pero el resto del saldo sigue devengando (alquiler 100.000 + crédito
 * 10.000 + cero efectivo → base 90.000, no 0).
 *
 * `appliedCredit` es 0 por defecto: los callers del motor de DEUDAS
 * (debtService.js) no lo pasan, porque ahí el crédito se resta al final sobre
 * `remainingDebt` y no debe activar la base ampliada.
 */
function computePunitoryBase({ rentAmount = 0, servicesTotal = 0, ivaAmount = 0, amountPaid = 0, appliedCredit = 0 }) {
  const credit = Math.max(appliedCredit || 0, 0);
  const cash = amountPaid || 0;
  const totalCredits = cash + credit;

  // Nada cobrado (ni efectivo ni crédito): la base es SOLO el alquiler.
  if (totalCredits <= 0) return (rentAmount || 0);

  // Mes saldado: efectivo + crédito cubren el neto → no queda base.
  const netTotalOwed = (rentAmount || 0) + (servicesTotal || 0) + (ivaAmount || 0);
  if (totalCredits >= netTotalOwed - 0.01) return 0;

  // Sin efectivo real, el crédito descuenta pero NO activa la base AMPLIADA: los
  // servicios impagos siguen sin generar mora mientras el inquilino no haya
  // pagado nada (regla confirmada 2026-07-11, "el saldo a favor nunca activa la
  // base ampliada"). Sólo un pago real cambia de rama.
  if (cash <= 0) return Math.max((rentAmount || 0) - credit, 0);

  const baseNonPunitory = (rentAmount || 0) + Math.max(servicesTotal || 0, 0) + (ivaAmount || 0);
  return Math.max(baseNonPunitory - totalCredits, 0);
}

/**
 * FUENTE ÚNICA DE VERDAD para el punitorio en vivo de un MonthlyRecord abierto.
 *
 * Centraliza las 4 implementaciones paralelas que existían en:
 *   1. monthlyRecordService.js — inline en getOrCreateMonthlyRecords (enrichment display)
 *   2. monthlyRecordService.js — computeLivePunitoryAmount (para _recalculateCore)
 *   3. paymentTransactionService.js — inline en registerPaymentCore (cobro real)
 *   4. paymentTransactionService.js — calculatePunitoryPreview (preview del formulario)
 *
 * Reglas de negocio:
 *  - isFullyPaid=true → retorna la SUMA REAL de conceptos PUNITORIOS de las
 *    transacciones (sumPunitoryConcepts), NO el congelado del último pago.
 *  - isPostExpiry=true → sin punitorios (mes extra post-vencimiento).
 *  - punitoryForgiven=true → sin punitorios.
 *  - Caso normal abierto:
 *      unpaidFrozenPunitory = punitoryAmount − lo que el último pago imputó a PUNITORIOS.
 *      base = computePunitoryBase(rentAmount, servicesTotal, ivaAmount, amountPaid).
 *      nuevoPunitory = calculatePunitoryV2(calculationDate, ..., base, ..., lastPaymentDate).
 *      total = round2(unpaidFrozenPunitory + nuevoPunitory.amount).
 *
 * @param {object} record  MonthlyRecord con campos: rentAmount, servicesTotal, ivaAmount?,
 *                         punitoryAmount, punitoryDays, punitoryForgiven, amountPaid,
 *                         includeIva, periodMonth, periodYear, isPostExpiry?,
 *                         transactions? [{paymentDate, punitoryForgiven, concepts[]}]
 * @param {object} contract Contrato con: punitoryStartDay, punitoryGraceDay, punitoryPercent
 * @param {Date[]} holidays Feriados del año del período (de getHolidaysForYear)
 * @param {object} options
 *   @param {boolean} options.isFullyPaid     true si el mes ya está COMPLETE
 *   @param {boolean} [options.isPostExpiry]  true si es un mes extra post-vencimiento
 *   @param {string|Date} [options.calculationDate]  Fecha de cálculo (default: hoy ART)
 *   @param {Function} [options.sumPunitoryConceptsFn] Inyectable para tests / evitar require circular
 * @returns {{ amount: number, days: number, unpaidFrozenPunitory: number, newPunitory: number }}
 */
function computeLiveRecordPunitory(record, contract, holidays, {
  isFullyPaid,
  isPostExpiry = record.isPostExpiry || false,
  calculationDate,
  sumPunitoryConceptsFn,
} = {}) {
  // Importar getTodayLocalString solo si no se recibió calculationDate (evita require at top-level)
  // y sumPunitoryConcepts solo si se necesita (evita require circular con helpers)
  if (!calculationDate) {
    const { getTodayLocalString } = require('../utils/dateUtils');
    calculationDate = getTodayLocalString();
  }
  const sumPunitoryConcepts = sumPunitoryConceptsFn || require('../utils/helpers').sumPunitoryConcepts;

  // Caso: mes ya completamente pagado → punitorio REAL = suma de conceptos PUNITORIOS
  if (isFullyPaid && !record.punitoryForgiven) {
    const amount = sumPunitoryConcepts(record.transactions || []);
    return { amount, days: record.punitoryDays || 0, unpaidFrozenPunitory: 0, newPunitory: amount };
  }

  // Casos que devuelven cero
  if (record.punitoryForgiven || isPostExpiry || contract?.exemptFromPunitory) {
    return { amount: 0, days: 0, unpaidFrozenPunitory: 0, newPunitory: 0, graceDate: null, fromDate: null, toDate: null };
  }

  let amount = record.punitoryAmount || 0;
  let days = record.punitoryDays || 0;
  let unpaidFrozenPunitory = 0;
  let newPunitory = 0;

  let graceDate = null;
  let fromDate = null;
  let toDate = null;

  try {
    const amountPaid = record.amountPaid || 0;
    const servicesTotal = record.servicesTotal || 0;
    const frozenPunitory = record.punitoryAmount || 0;
    const ivaForPunitory = record.includeIva ? (record.rentAmount || 0) * 0.21 : 0;

    // Base ÚNICA de punitorios (A-03/A-04, computePunitoryBase). El saldo a favor
    // del mes anterior entra como plata del primer pago (caso Biassi, ver el
    // docblock de computePunitoryBase).
    const punitoryBase = computePunitoryBase({
      rentAmount: record.rentAmount || 0,
      servicesTotal,
      ivaAmount: ivaForPunitory,
      amountPaid,
      appliedCredit: record.previousBalance || 0,
    });

    // Punitorios congelados IMPAGOS: lo que queda del congelado del último pago
    // que ese pago NO imputó al concepto PUNITORIOS (caso Etica S.A.).
    const txs = record.transactions || [];
    const lastTx = txs.length > 0 ? txs[txs.length - 1] : null;
    const lastTxPunitoryPaid = (lastTx?.concepts || [])
      .filter((c) => c.type === 'PUNITORIOS')
      .reduce((s, c) => s + c.amount, 0);
    unpaidFrozenPunitory = lastTx?.punitoryForgiven
      ? 0
      : Math.max(frozenPunitory - lastTxPunitoryPaid, 0);

    const lastPaymentDate = lastTx ? new Date(lastTx.paymentDate) : null;

    if (punitoryBase > 0) {
      const liveResult = calculatePunitoryV2(
        calculationDate,
        record.periodMonth,
        record.periodYear,
        punitoryBase,
        contract.punitoryStartDay,
        contract.punitoryGraceDay,
        contract.punitoryPercent,
        holidays,
        lastPaymentDate
      );
      newPunitory = liveResult.amount;
      amount = round2(unpaidFrozenPunitory + newPunitory);
      days = liveResult.days;
      graceDate = liveResult.graceDate || null;
      fromDate = liveResult.fromDate || null;
      toDate = liveResult.toDate || null;
    } else if (unpaidFrozenPunitory > 0) {
      // Base = 0: alquiler+servicios+IVA ya cubiertos por pagos, pero queda
      // punitorio congelado sin pagar. Mismo criterio que el motor de deudas
      // (calculateDebtPunitory, rama remainingBase<=0): a partir de acá los
      // punitorios NUEVOS se calculan COMPUESTOS sobre el saldo de punitorio
      // pendiente (interés sobre interés), no se congelan en $0 — regla
      // confirmada por el usuario 2026-07-14 (ver memoria punitory-base-rule,
      // que dejaba esto explícitamente pendiente "si el usuario lo pide").
      const liveResult = calculatePunitoryV2(
        calculationDate,
        record.periodMonth,
        record.periodYear,
        unpaidFrozenPunitory,
        contract.punitoryStartDay,
        contract.punitoryGraceDay,
        contract.punitoryPercent,
        holidays,
        lastPaymentDate
      );
      newPunitory = liveResult.amount;
      amount = round2(unpaidFrozenPunitory + newPunitory);
      days = liveResult.days;
      graceDate = liveResult.graceDate || null;
      fromDate = liveResult.fromDate || null;
      toDate = liveResult.toDate || null;
    } else {
      // Base = 0 y nada pendiente de punitorio tampoco: no hay nada sobre lo
      // que seguir acumulando.
      amount = frozenPunitory;
      days = record.punitoryDays || 0;
      newPunitory = 0;
    }
  } catch (e) {
    // En caso de error de cálculo, mantener el valor congelado del record.
    console.error('[punitory.js] Error in computeLiveRecordPunitory:', e.message);
    amount = record.punitoryAmount || 0;
    days = record.punitoryDays || 0;
    unpaidFrozenPunitory = record.punitoryAmount || 0;
    newPunitory = 0;
  }

  return { amount, days, unpaidFrozenPunitory, newPunitory, graceDate, fromDate, toDate };
}

/**
 * FUENTE ÚNICA del punitorio que entra en `totalDue` de un MonthlyRecord.
 *
 * Devuelve el punitorio **BRUTO** del período: el que ya se cobró MÁS el que sigue
 * adeudado. Es la única escala en la que `totalDue` se puede comparar contra
 * `amountPaid`, porque `amountPaid` es toda la plata que entró — incluida la parte
 * imputada al concepto PUNITORIOS.
 *
 * El bug que esto cierra (2026-08-26): `totalDue` usaba sólo el punitorio ADEUDADO
 * (`unpaidFrozen + nuevo`, o `debt.accumulatedPunitory` con el mes ya cerrado). Contra
 * un `amountPaid` bruto, los punitorios ya cobrados contaban dos veces a favor del
 * inquilino: `balance = 2 × cobrado − total + crédito`. Bastaba pagar más de la mitad
 * de la mora para que cerrar el mes generara un saldo a favor fantasma y, a la vez, una
 * deuda por el resto. El reverso también pasaba: si lo cobrado superaba lo adeudado, la
 * primera pasada de `_recalculateCore` daba COMPLETE y la mora impaga se auto-condonaba.
 *
 * `punitoryOutsideConcepts` es, cuando el mes YA tiene una Deuda, la parte del punitorio
 * del período que NO aparece en los conceptos PUNITORIOS: el impago en vivo MÁS el que
 * quedó cubierto por el saldo a favor (`appliedCredit` no se imputa a un concepto, pero sí
 * descuenta punitorios en `calculateDebtPunitory`). Lo arma el llamador, que es quien
 * conoce la Deuda.
 *
 * No se usa `grossPunitoryToDate` de la Deuda: en una deuda recién creada
 * `accumulatedPunitory` es el punitorio IMPAGO del record, así que ese "bruto" no incluye
 * lo que el pago pre-cierre ya había cubierto. Y no se usa
 * `computeLiveRecordPunitory(...).amount` como impago: su rama "base agotada" devuelve el
 * CONGELADO, que sumado a los conceptos cobrados duplicaría.
 *
 * @param {object} record   MonthlyRecord con `transactions[].concepts[]` (ver computeLiveRecordPunitory)
 * @param {object} contract Contrato con punitoryStartDay/punitoryGraceDay/punitoryPercent
 * @param {Date[]} holidays Feriados del año del período
 * @param {object} options
 *   @param {number} [options.punitoryOutsideConcepts] Punitorio del período que no está en los conceptos (Deuda)
 *   @param {string|Date} [options.calculationDate] Fecha de cálculo (default: hoy ART)
 *   @param {Function} [options.sumPunitoryConceptsFn] Inyectable para tests / evitar require circular
 * @returns {{ amount: number, paid: number, unpaid: number, newPunitory: number, days: number }}
 */
function computeGrossRecordPunitory(record, contract, holidays, {
  punitoryOutsideConcepts,
  isPostExpiry,
  calculationDate,
  sumPunitoryConceptsFn,
} = {}) {
  const sumPunitoryConcepts = sumPunitoryConceptsFn || require('../utils/helpers').sumPunitoryConcepts;

  // Lo YA cobrado: suma de los conceptos PUNITORIOS de TODAS las transacciones del mes
  // (incluidas las que crea `payDebt`, que también viven en el record).
  const paid = sumPunitoryConcepts(record.transactions || []);

  if (typeof punitoryOutsideConcepts === 'number') {
    // Caso Deuda: lo que no está en los conceptos lo define la Deuda. El split "devengado
    // en vivo vs congelado" lo reconstruye el llamador con los campos de
    // `calculateDebtPunitory`.
    const unpaid = round2(Math.max(punitoryOutsideConcepts, 0));
    return { amount: round2(paid + unpaid), paid, unpaid, newPunitory: 0, days: record.punitoryDays || 0 };
  }

  const live = computeLiveRecordPunitory(record, contract, holidays, {
    isFullyPaid: false,
    isPostExpiry,
    calculationDate,
    sumPunitoryConceptsFn,
  });
  const newPunitory = live.newPunitory || 0;
  const unpaid = round2((live.unpaidFrozenPunitory || 0) + newPunitory);
  return { amount: round2(paid + unpaid), paid, unpaid, newPunitory, days: live.days };
}

// Keep legacy functions for backward compatibility
function calculatePunitoryDays(paymentDate, punitoryStartDay) {
  const payDay = paymentDate.getDate();
  const payMonth = paymentDate.getMonth();
  const payYear = paymentDate.getFullYear();
  const limitDate = new Date(payYear, payMonth, punitoryStartDay);
  if (paymentDate <= limitDate) return 0;
  const diffMs = paymentDate.getTime() - limitDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function calculatePunitoryAmount(baseRent, daysLate, punitoryPercent) {
  if (daysLate <= 0) return 0;
  return round2(baseRent * punitoryPercent * daysLate);
}

/**
 * Días TOTALES de atraso de una deuda: desde que empezó a correr el punitorio
 * (`punitoryStartDate`) hasta que se saldó (`lastPaymentDate`/`closedAt`) o, si
 * sigue viva, hasta la fecha de corte (hoy, o el `endDate` de un cálculo en vivo).
 *
 * A diferencia de los `days` que devuelve `calculatePunitoryV2` (que cuentan solo
 * el tramo desde el ÚLTIMO pago — correcto para el interés compuesto, pero engañoso
 * como etiqueta: una deuda pagada en 4 cuotas a lo largo de 20 días mostraría "2 días"
 * en vez de los 20 reales), esto es el conteo acumulado real de mora que se muestra
 * al usuario. No reemplaza el cálculo del monto de punitorios, solo la etiqueta.
 */
function debtDelinquencyDays(debt, liveEndDate = null) {
  if (!debt || !debt.punitoryStartDate) return 0;
  const start = new Date(debt.punitoryStartDate);
  const end = debt.status === 'PAID'
    ? new Date(debt.lastPaymentDate || debt.closedAt || start)
    : new Date(liveEndDate || getTodayLocalDate());
  return Math.max(diffCalendarDays(end, start) + 1, 0);
}

module.exports = {
  calculatePunitoryDays,
  calculatePunitoryAmount,
  calculatePunitoryV2,
  computePunitoryBase,
  computeLiveRecordPunitory,
  computeGrossRecordPunitory,
  getEffectiveGraceDate,
  getHolidaysForYear,
  clearHolidayCache,
  isBusinessDay,
  isWeekend,
  isHoliday,
  diffCalendarDays,
  toLocalDate,
  round2,
  debtDelinquencyDays,
};
