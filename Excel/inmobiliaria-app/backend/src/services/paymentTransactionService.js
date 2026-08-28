// Payment Transaction Service - Register and manage payment transactions
const { calculatePunitoryV2, getHolidaysForYear, round2, computePunitoryBase, computeLiveRecordPunitory } = require('../utils/punitory');
const { formatServiceLabel } = require('../utils/serviceLabel');
const { recalculateMonthlyRecord, recalculateMultipleRecords } = require('./monthlyRecordService');
const { canPayCurrentMonth } = require('./debtService');

const prisma = require('../lib/prisma');

const RECORD_SELECT = {
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
      id: true, amount: true, description: true, cuotaNumber: true, cuotaTotal: true,
      conceptType: { select: { category: true, name: true, label: true } },
    },
  },
};

/**
 * A-15: siguiente número de recibo, atómico y monotónico por grupo.
 * Usa el contador dedicado `ReceiptSequence` (nunca decrece, a diferencia de
 * `paymentTransaction.count()`, que bajaba con cada borrado y repetía números ya
 * emitidos). `upsert` con `{ increment: 1 }` es una única operación atómica a nivel
 * SQL (Postgres la traduce a INSERT ... ON CONFLICT DO UPDATE), así que dos pagos
 * concurrentes del mismo grupo (incluso de contratos distintos, fuera del alcance
 * del advisory lock por contrato) no pueden obtener el mismo número. El
 * `@@unique([groupId, receiptNumber])` del schema es el backstop final.
 */
const nextReceiptNumber = async (tx, groupId) => {
  const seq = await tx.receiptSequence.upsert({
    where: { groupId },
    create: { groupId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `REC-${String(seq.lastNumber).padStart(6, '0')}`;
};

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

  // Lectura previa SOLO para el chequeo de orden cronológico (no usar para ningún
  // cálculo numérico: el record se relee fresco bajo el lock, dentro de la transacción).
  const recordPre = await prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    select: { id: true, groupId: true, contractId: true, periodMonth: true, periodYear: true },
  });

  if (!recordPre || recordPre.groupId !== groupId) {
    throw new Error('Registro mensual no encontrado');
  }

  // BLOQUEO: Verificar orden cronológico. Solo se puede pagar el período impago
  // más antiguo de la cadena (deudas + meses pendientes). Pasamos el período de
  // ESTE record para que, si es el más viejo, se permita; si hay algo anterior, se bloquee.
  const debtCheck = await canPayCurrentMonth(groupId, recordPre.contractId, {
    periodMonth: recordPre.periodMonth,
    periodYear: recordPre.periodYear,
  });
  if (!debtCheck.canPay) {
    const error = new Error(debtCheck.message);
    error.code = 'DEBT_BLOCK';
    error.debts = debtCheck.debts;
    throw error;
  }

  // C-03: todo el ciclo leer-fresco→calcular→escribir corre en UNA transacción,
  // serializado por el mismo advisory lock por contrato que usa el recálculo mensual
  // y payDebt (C-04). A diferencia de payDebt, `amountPaid` no se pierde por lost-update
  // aquí (se recalcula por SUMA de todas las PaymentTransaction, no por incremento), pero
  // sin este lock dos registerPayment concurrentes sobre el mismo contrato disparan cada
  // uno su propio worker de recálculo async (setImmediate(processDirtyRecords)) que puede
  // correr en carrera consigo mismo — se demostró un deadlock real de Postgres (40P01)
  // en ese escenario durante el desarrollo de este fix. La recalculación ahora corre
  // inline, dentro de este mismo lock, en vez de fire-and-forget. El número de recibo
  // (antes por count() fuera de cualquier lock) también queda protegido por este mismo
  // candado. NOTA APARTE (no es un problema de concurrencia, no lo resuelve este fix):
  // el concepto A_FAVOR se repite completo en CADA transacción de un mes con
  // previousBalance>0, incluso pagando en dos cuotas secuenciales sin ninguna carrera de
  // por medio — hallazgo separado, reportado sin modificar.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${recordPre.contractId}'))`);

    // Forzar un recálculo SÍNCRONO antes de leer el record (bug 2026-07-14, caso
    // C01_full_ontime): el lock de arriba solo serializa contra OTRO
    // registerPayment/payDebt/processDirtyRecords que esté corriendo en ESE
    // instante — no garantiza que un recálculo asíncrono pendiente (p.ej. un
    // servicio agregado vía propagateServiceForward, que solo marca
    // needsRecalculation=true y agenda el trabajo con setImmediate) ya haya
    // corrido. Si ese trabajo de fondo todavía no se ejecutó (se demostró que
    // puede no ejecutarse en absoluto), el cobro se calculaba contra
    // servicesTotal/rentAmount desactualizados, cobrando de menos sin ningún
    // error. Recalcular acá, síncrono y dentro del mismo lock, cierra la
    // ventana de raíz sin importar la causa de la desactualización.
    await recalculateMultipleRecords([monthlyRecordId], tx, true);

    // Releer el record YA bajo el lock Y YA recalculado: ningún otro
    // registerPayment/payDebt/recálculo sobre este contrato puede estar a mitad de
    // camino en este punto, y servicesTotal/rentAmount/totalDue están garantizados
    // frescos.
    const record = await tx.monthlyRecord.findUnique({
      where: { id: monthlyRecordId },
      select: RECORD_SELECT,
    });

    if (!record || record.groupId !== groupId) {
      throw new Error('Registro mensual no encontrado');
    }

    const contract = record.contract;

    return registerPaymentCore(tx, { groupId, monthlyRecordId, record, contract, data });
  }, { timeout: 15000 });
};

/**
 * Cuerpo de registerPayment: cálculo de punitorios/conceptos + escrituras.
 * Corre SIEMPRE dentro de la transacción/lock de registerPayment; extraído solo para
 * mantener legible el wrapper de arriba, no para reutilizarse fuera de esa transacción.
 */
const registerPaymentCore = async (tx, { groupId, monthlyRecordId, record, contract, data }) => {
  const {
    paymentDate,
    amount,
    paymentMethod = 'EFECTIVO',
    forgivePunitorios = false,
    generateReceipt = false,
    observations,
  } = data;

  // Calculate punitorios for this payment date
  // Payments cover services first, then rent. Punitorios only apply to unpaid rent.
  const holidays = await getHolidaysForYear(record.periodYear);
  const amountPaidSoFar = record.amountPaid || 0;
  const servicesTotal = record.servicesTotal || 0;
  const prevBalance = record.previousBalance || 0;
  // El saldo a favor cuenta como crédito junto con los pagos previos (`alreadyPaid` más
  // abajo). El reparto de esos créditos por concepto se calcula junto con los baldes de
  // servicios/alquiler/IVA, para que el descuento entre una sola vez.

  // Base ÚNICA de punitorios (A-03, utils/punitory.js#computePunitoryBase):
  // - Sin ningún pago real: solo el alquiler.
  // - Con pago parcial: el saldo restante (alquiler + servicios + IVA impago − pagos
  //   reales). La bonificación (servicesTotal negativo) NO reduce la base (clamp a
  //   >=0), igual que antes.
  // El saldo a favor del mes anterior entra como plata del PRIMER pago
  // (`appliedCredit`, caso Biassi 2026-07-30 — ver el docblock de
  // computePunitoryBase). Tiene que pasarse acá también, y no sólo en
  // computeLiveRecordPunitory: si el cobro usara una base distinta de la que
  // después muestra Control Mensual, el mes quedaría con un pendiente que el
  // recibo no explica.
  const ivaForPunitory = record.includeIva ? record.rentAmount * 0.21 : 0;
  const unpaidRentForPunitory = computePunitoryBase({
    rentAmount: record.rentAmount,
    servicesTotal,
    ivaAmount: ivaForPunitory,
    amountPaid: amountPaidSoFar,
    appliedCredit: prevBalance,
  });

  // Get last payment date for this record (if partial payment was made)
  const lastTransaction = await tx.paymentTransaction.findFirst({
    where: { monthlyRecordId },
    orderBy: { paymentDate: 'desc' },
    select: {
      paymentDate: true,
      punitoryForgiven: true,
      concepts: { select: { type: true, amount: true } },
    },
  });

  // Punitorios congelados IMPAGOS = congelado del último pago MENOS lo que ese pago
  // imputó realmente a punitorios (concepto PUNITORIOS). Antes se estimaba por orden de
  // imputación sobre el total pagado, lo que fallaba cuando un pago de deuda cubrió SOLO
  // punitorios (caso Etica S.A.: se volvían a cobrar/etiquetar punitorios ya pagados).
  const frozenPunitory = record.punitoryAmount || 0;
  const lastTxPunitoryPaid = (lastTransaction?.concepts || [])
    .filter((c) => c.type === 'PUNITORIOS')
    .reduce((s, c) => s + c.amount, 0);
  const unpaidFrozenPunitory = lastTransaction?.punitoryForgiven
    ? 0
    : Math.max(frozenPunitory - lastTxPunitoryPaid, 0);

  // Bug (2026-07-14): esta base (unpaidRentForPunitory) da 0 en cuanto el
  // alquiler+servicios+IVA queda cubierto, aunque siga habiendo punitorio
  // congelado impago (unpaidFrozenPunitory > 0) — calculatePunitoryV2 devuelve
  // $0 con base 0 y ese punitorio pendiente dejaba de generar interés nuevo.
  // Mismo criterio que computeLiveRecordPunitory (utils/punitory.js, ya
  // corregido) y calculateDebtPunitory: una vez agotada la base de
  // alquiler/servicios, los punitorios NUEVOS se calculan COMPUESTOS sobre el
  // saldo de punitorio pendiente (regla confirmada 2026-07-14, ver memoria
  // punitory-base-rule). Sin esto, un pago que cubre exactamente el total
  // compuesto quedaba mal imputado: la porción de interés nuevo se etiquetaba
  // como SOBREPAGO ("a favor") en vez de PUNITORIOS, generando un saldo a
  // favor falso (caso C07_multi_same_month).
  const punitoryCalcBase = unpaidRentForPunitory > 0 ? unpaidRentForPunitory : unpaidFrozenPunitory;
  const punitory = punitoryCalcBase > 0
    ? calculatePunitoryV2(
        paymentDate,
        record.periodMonth,
        record.periodYear,
        punitoryCalcBase,
        contract.punitoryStartDay,
        contract.punitoryGraceDay,
        contract.punitoryPercent,
        holidays,
        lastTransaction?.paymentDate || null
      )
    : { amount: 0, days: 0 };

  const punitoryAmount = forgivePunitorios ? 0 : round2(unpaidFrozenPunitory + punitory.amount);

  // Build transaction concepts breakdown.
  // Los conceptos reflejan QUÉ pagó ESTA transacción, con montos REALES por concepto
  // (cada servicio con su monto, alquiler real, punitorios), congelados al momento del pago.
  // Orden de imputación: los créditos previos (saldo a favor + pagos anteriores) cubren
  // servicios → alquiler → punitorios; luego ESTE pago cubre lo que reste en ese mismo orden.
  const concepts = [];
  const paymentAmount = parseFloat(amount);
  const alreadyPaid = round2(amountPaidSoFar + prevBalance);

  // Servicios BRUTOS y descuentos POR SEPARADO. `record.servicesTotal` viene NETO, y
  // usarlo como presupuesto de servicios era el bug (2026-08-28): el descuento entraba dos
  // veces, una achicando el balde de servicios y otra como línea negativa del recibo.
  //   - descuento MENOR que los servicios: el balde no alcanzaba para todos los servicios
  //     reales, así que el último quedaba SIN concepto propio (desaparecía del recibo) y el
  //     alquiler cobrado quedaba inflado.
  //   - descuento MAYOR que los servicios: el balde daba 0, el bloque de conceptos se
  //     salteaba entero y TODO el pago se etiquetaba ALQUILER, con los impuestos reales
  //     viajando escondidos adentro. Caso Godoy (julio/agosto 2026): base de honorarios
  //     300.000 en vez de 262.503 en un pago parcial, y `paidServicios` = 0 en Liquidación.
  let grossServices = 0;
  let discountTotal = 0;
  for (const s of record.services || []) {
    const cat = s.conceptType?.category;
    if (cat === 'DESCUENTO' || cat === 'BONIFICACION') discountTotal += Math.abs(s.amount);
    else grossServices += s.amount;
  }

  // El descuento se imputa contra el ALQUILER — misma regla que honorarios
  // (`reportDataService`: DESCUENTO reduce la base del alquiler, no la de servicios). El
  // sobrante cae a IVA y después a servicios, así el TOTAL adeudado no cambia: era
  // `rent + (bruto − descuento) + iva` y pasa a ser `(rent − descuento) + bruto + iva`.
  let pendingDiscount = discountTotal;
  const rentOwedNet = round2(Math.max(record.rentAmount - pendingDiscount, 0));
  pendingDiscount = round2(Math.max(pendingDiscount - record.rentAmount, 0));
  const ivaOwedNet = round2(Math.max(ivaForPunitory - pendingDiscount, 0));
  pendingDiscount = round2(Math.max(pendingDiscount - ivaForPunitory, 0));
  const servicesOwedNet = round2(Math.max(grossServices - pendingDiscount, 0));

  // Cuánto falta de cada concepto ANTES de este pago (descontando créditos previos).
  // Los créditos se imputan en el mismo orden que el pago: servicios → alquiler → IVA.
  const creditsOnServices = round2(Math.min(alreadyPaid, servicesOwedNet));
  const remainingServicesOwed = round2(servicesOwedNet - creditsOnServices);
  const creditsAfterServices = round2(alreadyPaid - creditsOnServices);
  const remainingRentOwed = round2(Math.max(rentOwedNet - creditsAfterServices, 0));
  // IVA: créditos que exceden servicios + alquiler cubren el IVA antes que los punitorios.
  // Sin este concepto, en contratos con IVA el 21% del pago quedaba etiquetado como
  // SOBREPAGO ("a favor próximo mes") en recibos, aunque el balance fuera correcto.
  const creditsBeyondRent = round2(Math.max(creditsAfterServices - rentOwedNet, 0));
  const remainingIvaOwed = round2(Math.max(ivaOwedNet - creditsBeyondRent, 0));
  const remainingPunitoryOwed = round2(Math.max(punitoryAmount, 0)); // ya neto de créditos/frozen

  // Cuánto de ESTE pago se imputa a cada concepto (servicios → alquiler → IVA → punitorios → excedente)
  const servicesPay = round2(Math.min(remainingServicesOwed, paymentAmount));
  const rentPay = round2(Math.min(remainingRentOwed, paymentAmount - servicesPay));
  const ivaPay = round2(Math.min(remainingIvaOwed, paymentAmount - servicesPay - rentPay));
  const punitoryPay = round2(Math.min(remainingPunitoryOwed, paymentAmount - servicesPay - rentPay - ivaPay));
  const overpay = round2(Math.max(paymentAmount - servicesPay - rentPay - ivaPay - punitoryPay, 0));

  // 1. Saldo a favor del mes anterior (crédito). `prevBalance` (record.previousBalance)
  // es fijo para todo el mes — no se decrementa pago a pago — así que sin este guard
  // CADA transacción del mes volvía a mostrar el descuento completo, aunque un pago
  // anterior de ESE MISMO mes ya lo hubiera aplicado (C-08, confirmado por el usuario
  // 2026-07-11: reproducido con pagos 100% secuenciales, no es un bug de concurrencia).
  // `amountPaidSoFar > 0` ⟺ ya hubo un pago previo este mes ⟺ (bajo esta misma lógica,
  // aplicada en ESE pago anterior) el crédito ya se mostró aplicado una vez.
  if (prevBalance > 0) {
    if (amountPaidSoFar > 0) {
      concepts.push({
        type: 'A_FAVOR',
        amount: 0,
        description: `Saldo a favor del mes anterior ($${round2(prevBalance)}): ya utilizado en un pago anterior de este mes`,
      });
    } else {
      concepts.push({
        type: 'A_FAVOR',
        amount: -prevBalance,
        description: 'Saldo a favor del mes anterior',
      });
    }
  }

  // 2. Servicios: cada servicio con su monto REAL, secuencialmente, hasta agotar lo que
  //    este pago destina a servicios. Los descuentos/bonificaciones se muestran como
  //    líneas negativas (reducen el neto), igual que en el formulario de pago.
  if (servicesPay > 0) {
    let svcBudget = servicesPay;
    let skip = creditsOnServices; // porción de servicios ya cubierta por créditos previos
    for (const s of record.services) {
      const cat = s.conceptType?.category;
      if (cat === 'DESCUENTO' || cat === 'BONIFICACION') continue; // se imputan al alquiler
      const label = formatServiceLabel(s);
      const type = s.conceptType?.name || 'SERVICIO';
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

  // 2b. Descuentos / bonificaciones: línea informativa en negativo. Ya NO consumen el
  //     presupuesto de servicios (se imputan contra el alquiler, ver `rentOwedNet` arriba),
  //     pero tienen que verse en el recibo: antes, cuando el descuento superaba a los
  //     servicios, `servicesPay` daba 0 y el descuento no aparecía en ningún lado.
  if (servicesPay > 0 || rentPay > 0) {
    for (const s of record.services) {
      const cat = s.conceptType?.category;
      if (cat !== 'DESCUENTO' && cat !== 'BONIFICACION') continue;
      concepts.push({
        type: s.conceptType?.name || 'DESCUENTO',
        amount: -Math.abs(s.amount),
        description: formatServiceLabel(s),
      });
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

  // 3b. IVA (21% del alquiler, contratos con pagaIva)
  if (ivaPay > 0) {
    concepts.push({
      type: 'IVA',
      amount: ivaPay,
      description: 'IVA 21% sobre alquiler',
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

  // Generate receipt number if needed (A-15). Uses a monotonic per-group counter
  // (ReceiptSequence) instead of `count()`: a deleted transaction no longer frees up
  // its number for reuse, and `receiptNumber` is @@unique([groupId, receiptNumber])
  // in the schema as a hard backstop. The increment runs under the SAME lock/
  // transaction as the rest of registerPayment (pg_advisory_xact_lock per contrato),
  // so concurrent payments on the same contract can't race for the same number either.
  let receiptNumber = null;
  if (generateReceipt || paymentMethod === 'EFECTIVO') {
    receiptNumber = await nextReceiptNumber(tx, groupId);
  }

  const transaction = await tx.paymentTransaction.create({
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
      // Si este pago no acumula días nuevos pero sigue habiendo punitorios
      // (frozen/acumulados), preservar los días que ya tenía el record en lugar
      // de pisarlos con 0 (si no, el recibo mostraría "Punitorios (0 días)").
      punitoryDays: forgivePunitorios
        ? 0
        : (punitory.days > 0 ? punitory.days : (record.punitoryDays || 0)),
      punitoryForgiven: forgivePunitorios,
    },
  });

  // Recalcular el MonthlyRecord INLINE, dentro de la MISMA transacción/lock (en vez de
  // encolar el recálculo async de siempre — mismo razonamiento que en payDebt, C-04).
  await recalculateMultipleRecords([monthlyRecordId], tx, true);
  const updatedRecord = await tx.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
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
        select: {
          paymentDate: true,
          amount: true,
          punitoryForgiven: true,
          concepts: { select: { type: true, amount: true } },
        },
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

  // Base ÚNICA de punitorios (A-03, utils/punitory.js#computePunitoryBase). El saldo
  // a favor del mes anterior cuenta como plata del primer pago (`appliedCredit`); la
  // bonificación no reduce la base (clamp a >=0). Mismos argumentos que el cobro real
  // en registerPaymentCore: el preview del formulario tiene que anticipar exactamente
  // el punitorio que se va a cobrar.
  const ivaForPunitory = record.includeIva ? record.rentAmount * 0.21 : 0;
  const unpaidRentForPunitory = computePunitoryBase({
    rentAmount: record.rentAmount,
    servicesTotal,
    ivaAmount: ivaForPunitory,
    amountPaid,
    appliedCredit: prevBalance,
  });

  // FUENTE ÚNICA: computeLiveRecordPunitory espera transactions ordenadas asc (último al final).
  // La query ordena desc ([0] = más reciente), así que invertimos una copia para la función.
  const txsAsc = [...record.transactions].reverse();
  const recordForPreview = { ...record, transactions: txsAsc };
  const livePun = computeLiveRecordPunitory(recordForPreview, record.contract, holidays, {
    isFullyPaid: record.status === 'COMPLETE',
    calculationDate: paymentDate, // fecha de PAGO elegida en el formulario (no "hoy")
  });

  const lastTx = record.transactions[0] || null;

  return {
    days: livePun.days,
    graceDate: livePun.graceDate || null,
    fromDate: livePun.fromDate || null,
    toDate: livePun.toDate || null,
    newPunitory: livePun.newPunitory,
    accumulatedPunitory: livePun.unpaidFrozenPunitory,
    amount: livePun.amount,
    baseRent: record.rentAmount,
    unpaidRent,
    unpaidRentForPunitory,
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
        select: {
          id: true, contractId: true,
        },
      },
    },
  });

  if (!transaction || transaction.groupId !== groupId) {
    return null;
  }

  const contractId = transaction.monthlyRecord.contractId;
  let needsDebtRecalculation = false;
  let debtId = null;

  // C-05: cancelar el DebtPayment vinculado (si existe) y borrar la PaymentTransaction
  // corren en UNA transacción con el mismo advisory lock por contrato que C-03/C-04. Antes,
  // si cancelDebtPayment lanzaba (p. ej. el pago no era el último, regla LIFO), el error se
  // tragaba en un catch vacío y la transacción se borraba igual — dejando el DebtPayment
  // vivo con plata inexistente (deuda "cobrada" de más). Ahora, si cancelDebtPayment falla,
  // se aborta TODO (Prisma revierte la transacción: nada se borra) y el error se propaga.
  const { cancelDebtPayment } = require('./debtService');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${contractId}'))`);

    // Releer la deuda YA bajo el lock.
    const debt = await tx.debt.findUnique({
      where: { monthlyRecordId: transaction.monthlyRecord.id },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });

    if (debt) {
      debtId = debt.id;
      // Bug (2026-07-16): esta rama solo cubría "la deuda tiene DebtPayments pero
      // ninguno matchea" (needsDebtRecalculation dentro del if). Si la deuda NUNCA
      // tuvo pagos propios (debt.payments.length === 0) — caso típico: la
      // transacción borrada es la que quedó registrada en `previousRecordPayment`
      // al cerrar el mes, antes de que existiera la deuda — no se tomaba NINGUNA
      // rama, y `previousRecordPayment`/`unpaidRentAmount`/`currentTotal` de la
      // deuda quedaban congelados con el pago que se acaba de borrar. Ahora
      // `needsDebtRecalculation` se decide fuera del length-check: solo se
      // saltea cuando `cancelDebtPayment` ya se encargó de un DebtPayment real.
      let matchingDebtPayment = null;
      if (debt.payments.length > 0) {
        matchingDebtPayment = debt.payments.find((p) => {
          const txDate = new Date(transaction.paymentDate);
          const pDate = new Date(p.paymentDate);
          const sameDate = txDate.toDateString() === pDate.toDateString();
          const sameAmount = Math.abs(p.amount - transaction.amount) < 0.01;
          return sameDate && sameAmount;
        });

        if (matchingDebtPayment) {
          // Si esto lanza, la excepción propaga y Prisma revierte toda la transacción:
          // el PaymentTransaction NO se borra.
          await cancelDebtPayment(debt.id, matchingDebtPayment.id, true, tx);
        }
      }
      if (!matchingDebtPayment) {
        needsDebtRecalculation = true;
      }
    }

    await tx.paymentTransaction.delete({ where: { id } });
    await recalculateMultipleRecords([transaction.monthlyRecord.id], tx, true);
  }, { timeout: 15000 });

  // Camino preexistente y ya frágil (match heurístico por fecha+monto, sin FK explícita —
  // ver nota pendiente sobre schema en el plan): se mantiene fuera del lock, con su propio
  // try/catch, exactamente como antes. No forma parte del bug demostrado de C-05.
  if (debtId && needsDebtRecalculation) {
    const { recalculateDebtFromMonthlyRecord } = require('./debtService');
    try {
      await recalculateDebtFromMonthlyRecord(debtId, transaction.monthlyRecord.id);
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
