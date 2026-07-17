// Report Data Service - Prisma queries for all report types
const { numeroATexto, sumPunitoryConcepts } = require('../utils/helpers');
const { round2, diffCalendarDays, debtDelinquencyDays, getHolidaysForYear, computeLiveRecordPunitory } = require('../utils/punitory');
const { MONTH_NAMES } = require('../utils/constants');
const { formatServiceLabel } = require('../utils/serviceLabel');
// A-25: "hoy" del negocio en ART, TZ-inmune (ver dateUtils.js). El servidor
// corre sin TZ configurada (= UTC); usar `new Date()` crudo como "hoy" en un
// cálculo de punitorios cuenta un día de más entre las 21:00 y las 23:59 ART.
const { getTodayLocalString, getTodayLocalDate } = require('../utils/dateUtils');

const prisma = require('../lib/prisma');

// Helper: get tenant name(s) from contract (supports multi-tenant and PROPIETARIO)
const getTenantsName = (contract) => {
  if (contract.contractType === 'PROPIETARIO') {
    return contract.property?.owner?.name || 'Propietario';
  }
  if (contract.contractTenants && contract.contractTenants.length > 0) {
    return contract.contractTenants.map((ct) => ct.tenant.name).join(' / ');
  }
  return contract.tenant?.name || 'Sin inquilino';
};

// Helper: get tenant data from contract (primary tenant)
const getPrimaryTenant = (contract) => {
  if (contract.contractTenants && contract.contractTenants.length > 0) {
    return contract.contractTenants[0].tenant;
  }
  return contract.tenant || null;
};

// Agrupa transacciones por fecha calendario: varios pagos el mismo día (p.ej.
// de distintos meses de origen, cancelando deudas viejas + el mes actual en un
// solo cobro) aparecen como UN solo renglón sumado, no uno por transacción
// (AUDITORIA_CONTROL_LIQUIDACION_2026-07.md, punto 5).
const groupTransaccionesByFecha = (txList) => {
  const byDate = new Map();
  for (const t of txList) {
    const key = new Date(t.fecha).toDateString();
    if (!byDate.has(key)) {
      byDate.set(key, { fecha: t.fecha, monto: 0, metodo: t.metodo, inquilino: t.inquilino, propiedad: t.propiedad, conceptos: [] });
    }
    const row = byDate.get(key);
    row.monto = round2(row.monto + t.monto);
    row.conceptos.push(...t.conceptos);
  }
  return Array.from(byDate.values()).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
};

// Detecta si el contrato tuvo un ajuste de alquiler REAL (no el ajuste INICIAL)
// en un mes de contrato dado (`monthNumber`, no calendario) — usado para el
// sufijo "Ajuste de X%" en el label de Alquiler, compartido por las 3
// secciones del reporte de Liquidación (mes actual, deudas acumuladas, deudas
// pagadas).
const findAjusteForMonth = (rentHistory, monthNumber) =>
  (rentHistory || []).find(
    (h) => h.effectiveFromMonth === monthNumber && h.reason !== 'INICIAL' && h.adjustmentPercent != null
  );

// Reconciliación de DISPLAY (no toca ningún cálculo de plata): unifica, por mes,
// la deuda todavía abierta (`deudas`, viene de contract.debts con status != PAID)
// con lo cobrado de ese mismo mes en `cobradoOtrosPeriodos.detalle`. Antes un mes
// con pago parcial aparecía dos veces en el informe — "Deuda abierta" (lo que
// falta) en un lado y "Pago parcial de deuda" (lo cobrado) en otro — porque son
// dos fuentes de datos distintas para el mismo período. Acá se combinan en una
// sola entrada por mes, para que el PDF y la pantalla dibujen un solo recuadro.
// Un mes solo puede terminar en dos estados: 'PENDIENTE' (todavía debe algo,
// viene de `deudas`) o 'SALDADA' (quedó saldado, viene solo de `cobradoOtrosPeriodos`
// porque `contract.debts` ya no lo trae — se filtra por status != PAID).
const buildDeudasUnificadas = (deudasVivas, cobradoDetalle) => {
  const cobradoList = cobradoDetalle || [];
  const usedCobrado = new Set();

  const pendientes = (deudasVivas || []).map((d) => {
    const match = cobradoList.find((c) =>
      !usedCobrado.has(c) && c.periodMonth === d.periodMonth && c.periodYear === d.periodYear && !c.saldada
    );
    if (match) usedCobrado.add(match);
    return {
      periodLabel: d.periodo,
      dias: d.dias,
      estado: 'PENDIENTE',
      conceptos: null, // se arma desde alquilerPendiente/serviciosPendientes/punitorios*
      alquilerPendiente: d.alquilerPendiente,
      serviciosPendientes: d.serviciosPendientes,
      // Punitorios de esta deuda: lo ya cobrado en el período (real, va a honorarios)
      // vs lo que todavía falta pagar (incluye lo viejo acumulado + lo nuevo en vivo).
      // Antes se mostraba solo una porción de "faltan pagar" y no cerraba contra `pendiente`.
      punitoriosPagados: match ? (match.punitorios || 0) : 0,
      punitoriosPendientes: d.punitoriosPendientes,
      pendiente: d.pendiente,
      // "Total que tenía que pagar" ese mes = lo cobrado hasta hoy en esa deuda +
      // lo que todavía falta. Para lo cobrado se toma el máximo entre Debt.amountPaid
      // (acumulado histórico) y lo cobrado ESTE período — Debt.amountPaid puede quedar
      // desactualizado cuando un pago se registra fuera del flujo payDebt() (caso
      // observado 2026-07-15: pago de $400.000 vía transacción directa sobre el
      // monthlyRecord de la deuda, sin sincronizar debt.amountPaid).
      // `debtTotal` (no `monto`): lo realmente imputado a esta deuda, sin contar
      // un eventual sobrepago (crédito para otro período, no parte de "lo que
      // tenía que pagar" acá — caso C01_full_ontime 2026-07-15).
      pagadoTotal: Math.max(d.pagado || 0, match ? match.debtTotal : 0),
      totalAPagar: round2(Math.max(d.pagado || 0, match ? match.debtTotal : 0) + (d.pendiente || 0)),
      pagadoEstePeriodo: match ? match.debtTotal : 0,
      sobrepago: match ? (match.sobrepago || 0) : 0,
    };
  });

  // Cobros que no matchean ninguna deuda viva conocida: el caso normal es un mes
  // saldado (contract.debts no trae deudas PAID, así que "Deuda saldada" solo
  // existe acá). El caso raro es un contrato sin registro propio en el período
  // del reporte ("SOLO DEUDAS ANTERIORES") que cobró un pago PARCIAL de una
  // deuda vieja aún abierta: sin la deuda formal no hay forma de calcular cuánto
  // falta, así que se muestra lo cobrado sin inventar un "Falta pagar".
  const resto = cobradoList
    .filter((c) => !usedCobrado.has(c))
    .map((c) => ({
      periodLabel: c.periodLabel,
      dias: c.dias,
      estado: c.saldada ? 'SALDADA' : 'PENDIENTE',
      conceptos: c.conceptos,
      alquilerPendiente: 0,
      serviciosPendientes: 0,
      punitoriosPagados: c.punitorios || 0,
      punitoriosPendientes: 0,
      pendiente: 0,
      // `debtTotal` (no `monto`): lo realmente imputado a la deuda, sin el
      // sobrepago (crédito para otro período) — evita mostrar "Saldada $500.000"
      // cuando la deuda era de $396.000 y el resto quedó a favor.
      totalAPagar: c.debtTotal,
      pagadoTotal: c.debtTotal,
      pagadoEstePeriodo: c.debtTotal,
      sobrepago: c.sobrepago || 0,
    }));

  return [...pendientes, ...resto];
};

// Categorías que se muestran en la liquidación (mismo set que buildLiquidacionFromRecord).
const LIQUIDACION_CATEGORIES_DEUDA = new Set(['IMPUESTO', 'SERVICIO', 'DESCUENTO', 'BONIFICACION']);

// Total original de servicios+IVA de un MonthlyRecord (para reconciliar contra lo
// realmente cobrado e itemizar, o para saber cuánto le "falta" a ese balde al
// repartir un crédito aplicado).
const originalServiciosIvaTotal = (rec) => {
  if (!rec) return 0;
  const originalServicios = (rec.services || []).filter((s) => LIQUIDACION_CATEGORIES_DEUDA.has(s.conceptType?.category));
  return round2(
    originalServicios.reduce((s, sv) => {
      const isDiscount = sv.conceptType?.category === 'DESCUENTO' || sv.conceptType?.category === 'BONIFICACION';
      return s + (isDiscount ? -Math.abs(sv.amount) : sv.amount);
    }, 0) + (rec.includeIva ? (rec.ivaAmount || 0) : 0)
  );
};

// Reparte un crédito disponible en cascada servicios→alquiler→punitorios contra lo
// que YA falta de cada balde (objetivo menos lo ya cubierto en efectivo real).
// Mismo orden que usa el motor de pagos (paymentTransactionService.js / debtService.js
// payDebt) — se reconstruye acá porque el crédito aplicado no queda persistido por
// tipo de concepto, solo como una línea "A_FAVOR" informativa.
const splitCreditCascade = (credit, faltaServicios, faltaAlquiler, faltaPunitorios) => {
  let restante = credit;
  const servicios = round2(Math.min(restante, Math.max(0, faltaServicios)));
  restante = round2(restante - servicios);
  const alquiler = round2(Math.min(restante, Math.max(0, faltaAlquiler)));
  restante = round2(restante - alquiler);
  const punitorios = round2(Math.min(restante, Math.max(0, faltaPunitorios)));
  restante = round2(restante - punitorios);
  return { servicios, alquiler, punitorios, restante };
};

/**
 * Reconstruye los conceptos de una deuda vieja pagada con el MISMO nivel de detalle
 * que "Liquidación Actual" — alquiler con mes y "Mes N" del contrato, cada servicio
 * con su label y período — en vez de las líneas genéricas "Pago deuda alquiler/
 * servicios" que graba debtService.payDebt() (no itemiza por servicio).
 *
 * Solo itemiza servicios si el monto REALMENTE cobrado (`det.servicios`, que incluye
 * IVA — payDebt los graba juntos) coincide con la suma de los conceptos originales de
 * ese período. Si la deuda se pagó en cuotas repartidas en distintos meses de reporte,
 * no hay forma de saber qué parte corresponde a cada servicio, así que se muestra el
 * total sin desglosar en vez de inventar una atribución.
 *
 * `rec` = el MonthlyRecord ORIGINAL de esa deuda (rentAmount, monthNumber, services,
 * includeIva, ivaAmount, periodMonth/Year) — no el registro del mes que se está
 * liquidando ahora.
 */
const buildConceptosDeudaPagada = (rec, det) => {
  const items = [];
  if (!rec) {
    // Sin el record original (no debería pasar, pero por las dudas no perder el dato).
    if (det.alquiler > 0.009) items.push({ tipo: 'ALQUILER_DEUDA', label: 'Pago deuda alquiler', monto: det.alquiler });
    if (det.servicios > 0.009) items.push({ tipo: 'SERVICIOS_DEUDA', label: 'Pago deuda servicios', monto: det.servicios });
    if (det.punitorios > 0.009) items.push({ tipo: 'PUNITORIOS', label: 'Punitorios pagados', monto: det.punitorios });
    return items;
  }

  if (det.alquiler > 0.009) {
    items.push({
      tipo: 'ALQUILER_DEUDA',
      label: `Pago deuda Alquiler ${MONTH_NAMES[rec.periodMonth]} ${rec.periodYear} (Mes ${rec.monthNumber})`,
      monto: det.alquiler,
    });
  }

  if (det.servicios > 0.009) {
    const originalServicios = (rec.services || []).filter((s) => LIQUIDACION_CATEGORIES_DEUDA.has(s.conceptType?.category));
    const originalServiciosTotal = originalServiciosIvaTotal(rec);
    if (Math.abs(originalServiciosTotal - det.servicios) < 1) {
      const mesVencidoRec = rec.periodMonth === 1 ? 12 : rec.periodMonth - 1;
      const anioVencidoRec = rec.periodMonth === 1 ? rec.periodYear - 1 : rec.periodYear;
      for (const sv of originalServicios) {
        const cat = sv.conceptType?.category;
        const isDiscount = cat === 'DESCUENTO' || cat === 'BONIFICACION';
        const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
        const label = formatServiceLabel(sv);
        items.push({
          tipo: 'SERVICIOS_DEUDA',
          label: `Pago deuda ${label}${showPeriodo ? ` (período ${MONTH_NAMES[mesVencidoRec]} ${anioVencidoRec})` : ''}`,
          monto: isDiscount ? -Math.abs(sv.amount) : sv.amount,
        });
      }
      if (rec.includeIva && rec.ivaAmount > 0) {
        items.push({ tipo: 'IVA', label: 'Pago deuda IVA (21%)', monto: rec.ivaAmount });
      }
    } else {
      items.push({ tipo: 'SERVICIOS_DEUDA', label: 'Pago deuda servicios', monto: det.servicios });
    }
  }

  if (det.punitorios > 0.009) {
    items.push({ tipo: 'PUNITORIOS', label: 'Punitorios pagados', monto: det.punitorios });
  }

  return items;
};

/**
 * Punitorios y total PENDIENTE de una deuda EN VIVO (a hoy), vía calculateDebtPunitory
 * (incluye interés compuesto). Para reportes que mostraban el valor congelado guardado.
 *  - punitorios = acumulado impago + nuevos en vivo (o accumulated si está PAID)
 *  - pendiente  = saldo base restante (neto del crédito) + punitorios
 * `preloaded` = preloadDebtDependencies(debts) para evitar N+1 cuando hay muchas deudas.
 */
const liveDebtFigures = async (debt, preloaded = null) => {
  if (!debt) return { punitorios: 0, punitoriosPendientes: 0, pendiente: 0, alquiler: 0, servicios: 0 };
  const debtService = require('./debtService');
  // A-25: día ART correcto (string, TZ-inmune), no `new Date()` crudo del proceso.
  const liveDebt = await debtService.computeLiveDebtTotal(debt, getTodayLocalString(), preloaded);
  return {
    punitorios: liveDebt.liveAccumulatedPunitory || 0,
    // Punitorios TOTALES todavía impagos: el acumulado congelado de antes del
    // último pago (unpaidAccumulatedPunitory) + lo nuevo devengado desde
    // entonces (liveAccumulatedPunitory). `punitorios` de arriba solo trae la
    // segunda parte — se mantiene sin tocar por los demás reportes que ya lo
    // usan así; este campo nuevo es el que suma correctamente contra `pendiente`.
    punitoriosPendientes: round2((liveDebt.unpaidAccumulatedPunitory || 0) + (liveDebt.liveAccumulatedPunitory || 0)),
    pendiente: liveDebt.liveCurrentTotal || 0,
    // Desglose alquiler/servicios pendientes (para "Deudas Acumuladas" itemizado).
    alquiler: liveDebt.remainingRent || 0,
    servicios: liveDebt.remainingServices || 0,
  };
};

// ============================================
// EMPRESA DATA HELPER
// ============================================

/**
 * Fetches company data from Group settings with fallback defaults
 */
const getEmpresaData = async (groupId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      currency: true,
      companyName: true,
      address: true,
      phone: true,
      email: true,
      cuit: true,
      localidad: true,
      logo: true,
      ingBrutos: true,
      fechaInicioAct: true,
      ivaCondicion: true,
      subtitulo: true,
      bankName: true,
      bankHolder: true,
      bankCuit: true,
      bankAccountType: true,
      bankAccountNumber: true,
      bankCbu: true,
      bankAlias: true,
    },
  });

  return {
    nombre: group?.companyName || group?.name || 'Inmobiliaria',
    subtitulo: group?.subtitulo || '',
    direccion: group?.address || '',
    ciudad: group?.localidad || '',
    telefono: group?.phone || '',
    email: group?.email || '',
    cuit: group?.cuit || '',
    ingBrutos: group?.ingBrutos || '',
    fechaInicioAct: group?.fechaInicioAct || '',
    ivaCondicion: group?.ivaCondicion || '',
    logo: group?.logo || null,
    currency: group?.currency || 'ARS',
    banco: {
      nombre: group?.bankName || '',
      titular: group?.bankHolder || '',
      cuit: group?.bankCuit || '',
      tipoCuenta: group?.bankAccountType || '',
      numeroCuenta: group?.bankAccountNumber || '',
      cbu: group?.bankCbu || '',
      alias: group?.bankAlias || '',
    },
  };
};

// Helper: resolve bank data from property beneficiary, owner beneficiary, or owner itself
const resolveOwnerBank = (owner, property) => {
  // Priority: 1. Property specific beneficiary, 2. Owner default beneficiary, 3. Owner itself
  const bankSource = property?.transferBeneficiary?.bankName
    ? property.transferBeneficiary
    : (owner?.transferBeneficiary?.bankName ? owner.transferBeneficiary : owner);

  if (!bankSource?.bankName) return null;
  return {
    nombre: bankSource.bankName,
    titular: bankSource.bankHolder || '',
    cuit: bankSource.bankCuit || '',
    tipoCuenta: bankSource.bankAccountType || '',
    numeroCuenta: bankSource.bankAccountNumber || '',
    cbu: bankSource.bankCbu || '',
    alias: bankSource.bankAlias || '',
  };
};

// ============================================
// LIQUIDACION (Prioridad #1)
// ============================================

/**
 * Obtiene datos de liquidación para un contrato en un mes/año
 */
const getLiquidacionData = async (groupId, contractId, month, year, options = {}) => {
  let monthlyRecord = await prisma.monthlyRecord.findFirst({
    where: {
      groupId,
      contractId,
      periodMonth: month,
      periodYear: year,
    },
    include: {
      contract: {
        include: {
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
          property: {
            include: { owner: { include: { transferBeneficiary: true } }, transferBeneficiary: true },
          },
          rentHistory: { orderBy: { effectiveFromMonth: 'desc' } },
          debts: { where: { status: { not: 'PAID' } }, orderBy: { createdAt: 'asc' } },
        },
      },
      services: {
        include: { conceptType: true },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { paymentDate: 'asc' },
      },
      debt: true,
    },
  });

  // If no record exists, try to auto-create records for that period
  if (!monthlyRecord) {
    try {
      const { getOrCreateMonthlyRecords } = require('./monthlyRecordService');
      await getOrCreateMonthlyRecords(groupId, month, year);
      monthlyRecord = await prisma.monthlyRecord.findFirst({
        where: { groupId, contractId, periodMonth: month, periodYear: year },
        include: {
          contract: {
            include: {
              tenant: true,
              contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
              property: { include: { owner: { include: { transferBeneficiary: true } }, transferBeneficiary: true } },
              rentHistory: { orderBy: { effectiveFromMonth: 'desc' } },
              debts: { where: { status: { not: 'PAID' } }, orderBy: { createdAt: 'asc' } },
            },
          },
          services: { include: { conceptType: true } },
          transactions: { include: { concepts: true }, orderBy: { paymentDate: 'asc' } },
          debt: true,
        },
      });
    } catch (e) {
      // silently fail - record may not be applicable
    }
  }

  if (!monthlyRecord) return null;

  const empresa = await getEmpresaData(groupId);
  return buildLiquidacionFromRecord(monthlyRecord, empresa, month, year, options);
};

/**
 * Transforms a monthlyRecord (with includes) into a liquidacion data object.
 * Shared logic used by both getLiquidacionData and getLiquidacionesAllContracts.
 */
const buildLiquidacionFromRecord = async (monthlyRecord, empresa, month, year, options = {}) => {
  const { contract } = monthlyRecord;
  const owner = contract.property.owner;
  const isPropietario = contract.contractType === 'PROPIETARIO';

  const mesVencido = month === 1 ? 12 : month - 1;
  const anioVencido = month === 1 ? year - 1 : year;

  // Gastos a mi cargo options (per-contract)
  const gastosOpts = options.gastosAMiCargo || null;
  const gastosServiceIds = new Set(gastosOpts?.serviceIds || []);
  const gastosExtras = gastosOpts?.extras || [];
  const gastosComisionPercent = gastosOpts?.comisionPercent != null
    ? gastosOpts.comisionPercent
    : (options.honorariosPercent || 0);
  const hasGastos = gastosServiceIds.size > 0 || gastosExtras.length > 0;

  // Pre-calculate honorarios
  let honorarios = null;
  if (options.honorariosPercent > 0 || hasGastos) {
    const pct = options.honorariosPercent || 0;
    const punitoryAmt = (monthlyRecord.punitoryAmount > 0 && !monthlyRecord.punitoryForgiven) ? monthlyRecord.punitoryAmount : 0;
    const descuentoAlquiler = options.descuentosAlquiler || 0;
    const rentBase = Math.max(0, monthlyRecord.rentAmount - descuentoAlquiler);
    const baseHonorarios = rentBase + punitoryAmt;
    const montoAlquiler = pct > 0 ? Math.round(baseHonorarios * pct / 100 * 100) / 100 : 0;

    // Build gastos items from selected services (base cost only, no extra commission)
    const gastosItems = [];
    for (const svc of monthlyRecord.services) {
      if (!gastosServiceIds.has(svc.id)) continue;
      const cat = svc.conceptType?.category;
      const label = formatServiceLabel(svc);
      const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
      const concepto = showPeriodo ? `${label} (período ${MONTH_NAMES[mesVencido]} ${anioVencido})` : label;
      const importe = Math.abs(svc.amount);
      gastosItems.push({ concepto, importe });
    }

    // Build gastos items from manual extras (base cost only)
    for (const extra of gastosExtras) {
      const importe = Number(extra.importe) || 0;
      gastosItems.push({ concepto: extra.concepto || 'Extra', importe, isExtra: true });
    }

    const totalGastos = gastosItems.reduce((s, g) => s + g.importe, 0);
    const monto = montoAlquiler + totalGastos;

    honorarios = {
      porcentaje: pct,
      baseHonorarios,
      montoAlquiler,
      gastosAMiCargo: gastosItems,
      totalGastos,
      monto,
      montoEnLetras: numeroATexto(monto),
    };
  }

  // Detect if contract had a rent adjustment this month
  const ajusteEstesMes = findAjusteForMonth(contract.rentHistory, monthlyRecord.monthNumber);

  // Only show IMPUESTO, SERVICIO, DESCUENTO, BONIFICACION in liquidation reports
  const LIQUIDACION_CATEGORIES = new Set(['IMPUESTO', 'SERVICIO', 'DESCUENTO', 'BONIFICACION']);

  const conceptos = [];

  if (monthlyRecord.rentAmount > 0) {
    const isMultaRescision = (() => {
      const rescindedAt = contract.rescindedAt;
      if (!rescindedAt) return false;
      const rescDate = new Date(rescindedAt);
      let pm = rescDate.getMonth() + 2;
      let py = rescDate.getFullYear();
      if (pm > 12) { pm = 1; py++; }
      return monthlyRecord.periodMonth === pm && monthlyRecord.periodYear === py;
    })();

    let alquilerLabel = isMultaRescision
      ? `Multa Rescisión ${MONTH_NAMES[month]} ${year} (Mes ${monthlyRecord.monthNumber})`
      : `Alquiler ${MONTH_NAMES[month]} ${year} (Mes ${monthlyRecord.monthNumber})`;

    if (!isMultaRescision && ajusteEstesMes) {
      const pctStr = ajusteEstesMes.adjustmentPercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      alquilerLabel += ` Ajuste de ${pctStr}%`;
    }
    conceptos.push({
      concepto: alquilerLabel,
      base: monthlyRecord.rentAmount,
      importe: monthlyRecord.rentAmount,
      isAjuste: !isMultaRescision && !!ajusteEstesMes,
    });
  }

  for (const svc of monthlyRecord.services) {
    const cat = svc.conceptType?.category;
    if (!LIQUIDACION_CATEGORIES.has(cat)) continue;
    const isDiscount = cat === 'DESCUENTO' || cat === 'BONIFICACION';
    const label = formatServiceLabel(svc);
    const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
    conceptos.push({
      concepto: showPeriodo ? `${label} (período ${MONTH_NAMES[mesVencido]} ${anioVencido})` : label,
      base: null,
      importe: isDiscount ? -Math.abs(svc.amount) : svc.amount,
      serviceId: svc.id,
      isService: true,
      category: cat,
    });
  }

  if (monthlyRecord.includeIva && monthlyRecord.ivaAmount > 0) {
    conceptos.push({ concepto: 'IVA (21%)', base: monthlyRecord.rentAmount, importe: monthlyRecord.ivaAmount });
  }

  // Punitorios EN VIVO (no el campo congelado monthlyRecord.punitoryAmount, que solo
  // se "congela" en momentos puntuales — cierre de mes, pagos — y puede quedar en 0
  // para un mes recién abierto aunque ya esté devengando mora). Mismo criterio que
  // usa Control Mensual / /monthly-control (computeLiveRecordPunitory / deuda viva).
  // Confirmado con el usuario 2026-07-15: estos punitorios en vivo SÍ cuentan para
  // el total y el estado de pago del mes (pueden pasar un mes de PAGADO a PAGO PARCIAL).
  let livePunitoryAmt = 0;
  let livePunitoryDays = 0;
  if (!monthlyRecord.punitoryForgiven) {
    if (monthlyRecord.debt && monthlyRecord.debt.status !== 'PAID') {
      const live = await liveDebtFigures(monthlyRecord.debt);
      livePunitoryAmt = round2(live.punitoriosPendientes);
      livePunitoryDays = debtDelinquencyDays(monthlyRecord.debt);
    } else if (monthlyRecord.debt) {
      livePunitoryAmt = round2(monthlyRecord.debt.accumulatedPunitory || 0);
      livePunitoryDays = debtDelinquencyDays(monthlyRecord.debt);
    } else {
      // Inyectable vía options.holidays (preload en getLiquidacionesAllContracts,
      // evita N llamadas a DB en el loop; también permite tests puros sin DB).
      const holidays = options.holidays || await getHolidaysForYear(monthlyRecord.periodYear);
      const liveResult = computeLiveRecordPunitory(monthlyRecord, contract, holidays, {
        isFullyPaid: monthlyRecord.status === 'COMPLETE',
        calculationDate: options.calculationDate,
      });
      livePunitoryAmt = round2(liveResult.amount);
      // `liveResult.days` mide días "desde el último pago" — si hubo un pago HOY
      // sobre un punitorio viejo que quedó parcialmente impago, da 0 aunque el
      // monto ($21.600 en el caso Vaisman/C01 2026-07-15) sigue representando
      // varios días de mora ya congelados antes de ese pago. Nunca mostrar menos
      // días que los que ya estaban congelados en el record.
      livePunitoryDays = Math.max(liveResult.days, monthlyRecord.punitoryDays || 0);
    }
  }
  const punitoryAmt = livePunitoryAmt;
  if (punitoryAmt > 0) {
    conceptos.push({ concepto: `Punitorios (${livePunitoryDays} días)`, base: null, importe: punitoryAmt });
  }

  if (monthlyRecord.previousBalance !== 0) {
    conceptos.push({
      concepto: monthlyRecord.previousBalance > 0 ? 'Saldo a favor' : 'Deuda anterior',
      base: null,
      importe: monthlyRecord.previousBalance > 0 ? -monthlyRecord.previousBalance : Math.abs(monthlyRecord.previousBalance),
    });
  }

  // Total from visible conceptos only (gastos/mantenimiento excluded)
  const total = conceptos.reduce((sum, c) => sum + c.importe, 0);

  // Subtotal alquileres = ONLY rent (as requested by user for the main totals)
  const subtotalAlquileres = monthlyRecord.rentAmount;

  // ================================================================
  // PAYMENT ALLOCATION — leído de los TransactionConcept reales
  // ================================================================
  // Hallazgo #2/#5 (AUDITORIA_CONTROL_LIQUIDACION_2026-07.md): paidServicios/
  // paidAlquiler/paidPunitorios deben reflejar lo REALMENTE imputado por cada
  // pago (paymentTransactionService: servicios→alquiler→IVA→punitorios), no
  // una imputación propia re-derivada de amountPaid. Es lo único que permite
  // mostrar "punitorios pagados a la fecha del pago" en un mes parcial en
  // mora (no un valor recalculado contra el amountPaid total a la fecha en
  // que se genera el reporte).
  const amtPaid = monthlyRecord.amountPaid || 0;
  const previousBalance = monthlyRecord.previousBalance || 0;
  const bonificacionesTotal = conceptos
    .filter(c => c.isService && c.category === 'BONIFICACION')
    .reduce((s, c) => s + Math.abs(c.importe), 0);

  // Servicios + IVA, excluyendo bonificaciones (crédito, no reduce la base).
  // Los descuentos sí se mantienen restando (su negativo queda incluido).
  const serviciosTotal = conceptos
    .filter(c => c.isService && c.category !== 'BONIFICACION')
    .reduce((s, c) => s + c.importe, 0);
  const ivaTotal = (monthlyRecord.includeIva && monthlyRecord.ivaAmount > 0) ? monthlyRecord.ivaAmount : 0;
  const serviciosIvaTotal = Math.max(0, serviciosTotal + ivaTotal);
  const alquilerTotal = monthlyRecord.rentAmount;

  // conceptType.name → category, para reconocer BONIFICACION entre los
  // TransactionConcept reales (su `type` es el nombre del servicio, no la
  // categoría — hay que cruzarlo contra los servicios del propio record).
  const serviceCategoryByName = new Map(
    (monthlyRecord.services || [])
      .filter((s) => s.conceptType?.name)
      .map((s) => [s.conceptType.name, s.conceptType.category])
  );

  // Suma los TransactionConcept reales de las transacciones del record en
  // los 3 baldes de display (servicios+IVA / alquiler / punitorios) + el
  // excedente (SOBREPAGO). BONIFICACION y A_FAVOR son créditos informativos,
  // no "cobrado" nuevo, y se excluyen (igual criterio que el fallback).
  const sumRealConceptBuckets = (transactions) => {
    let servicios = 0, alquiler = 0, punitorios = 0, sobrepago = 0, sawConcepts = false;
    for (const tx of (transactions || [])) {
      for (const c of (tx.concepts || [])) {
        sawConcepts = true;
        const amt = c.amount || 0;
        if (c.type === 'PUNITORIOS') punitorios += amt;
        else if (c.type === 'ALQUILER' || c.type === 'MULTA_RESCISION') alquiler += amt;
        else if (c.type === 'SOBREPAGO') sobrepago += amt;
        else if (c.type === 'A_FAVOR') { /* crédito informativo, no es cobro nuevo */ }
        else if (serviceCategoryByName.get(c.type) === 'BONIFICACION') { /* crédito */ }
        else servicios += amt; // servicios/impuestos reales, IVA y descuentos (negativos)
      }
    }
    return { servicios: round2(servicios), alquiler: round2(alquiler), punitorios: round2(punitorios), sobrepago: round2(sobrepago), sawConcepts };
  };

  const realBuckets = sumRealConceptBuckets(monthlyRecord.transactions);

  let paidServicios, paidAlquiler, paidPunitorios, saldoAFavor;
  if (realBuckets.sawConcepts) {
    paidServicios = realBuckets.servicios;
    paidAlquiler = realBuckets.alquiler;
    paidPunitorios = realBuckets.punitorios;
    saldoAFavor = realBuckets.sobrepago > 0 ? realBuckets.sobrepago : 0;

    // Crédito previo aplicado (previousBalance): el motor de pagos SÍ lo imputa
    // en cascada servicios→alquiler→IVA→punitorios (paymentTransactionService.js),
    // pero solo queda registrado como una línea "A_FAVOR" genérica, sin decir a
    // qué concepto fue — por eso `realBuckets` (que solo lee TransactionConcept
    // reales) subestima paidAlquiler cuando hubo crédito de por medio (caso
    // Vaisman/C01 2026-07-15: pagó $100.000 en efectivo + $104.000 de crédito;
    // el crédito cubrió $15.214 de servicios y $88.786 de alquiler, pero
    // realBuckets solo veía los $100.000 tageados como ALQUILER).
    // Se reparte contra lo que YA falta de cada concepto (neto de lo real-tageado),
    // en el mismo orden — nunca reabre punitorios "viejos" ya pagados en efectivo,
    // ni retrocede el detalle histórico de qué cubrió cada pago en su momento.
    if (previousBalance > 0) {
      const split = splitCreditCascade(
        previousBalance,
        serviciosIvaTotal - paidServicios,
        alquilerTotal - paidAlquiler,
        punitoryAmt - paidPunitorios
      );
      paidServicios = round2(paidServicios + split.servicios);
      paidAlquiler = round2(paidAlquiler + split.alquiler);
      paidPunitorios = round2(paidPunitorios + split.punitorios);
      // Crédito que sobra después de cubrir todo: queda a favor (además del
      // sobrepago en efectivo que ya traía realBuckets.sobrepago).
      if (split.restante > 0) saldoAFavor = round2(saldoAFavor + split.restante);
    }
  } else {
    // Fallback: records legacy/de test sin TransactionConcept reales →
    // asignación secuencial anterior sobre amountPaid (servicios+IVA →
    // alquiler → punitorios). Poder de pago = pagado + crédito previo +
    // BONIFICACIONES (no descuentos, que ya restan dentro de serviciosTotal).
    let remaining = amtPaid + previousBalance + bonificacionesTotal;
    paidServicios = Math.min(remaining, serviciosIvaTotal);
    remaining -= paidServicios;
    paidAlquiler = Math.min(remaining, alquilerTotal);
    remaining -= paidAlquiler;
    paidPunitorios = Math.min(remaining, punitoryAmt);
    remaining -= paidPunitorios;
    saldoAFavor = remaining > 0 ? remaining : 0;
  }

  // ================================================================
  // 4-STATE PAYMENT CLASSIFICATION
  // ================================================================
  let paymentStatus;
  if (total <= 0) {
    paymentStatus = 'SALDO A FAVOR';
  } else if (amtPaid >= total - 0.01) { // 1 cent tolerance
    paymentStatus = saldoAFavor > 0 ? 'SALDO A FAVOR' : 'PAGADO';
  } else if (amtPaid > 0) {
    paymentStatus = 'PAGO PARCIAL';
  } else {
    paymentStatus = 'NO COBRADO';
  }

  const isRentPaid = paymentStatus === 'PAGADO' || paymentStatus === 'SALDO A FAVOR';
  const pendingAmount = isRentPaid ? 0 : Math.max(0, total - amtPaid);

  const deudasVivas = await Promise.all((contract.debts || []).map(async (d) => {
    const live = await liveDebtFigures(d);
    return {
      periodo: d.periodLabel,
      periodMonth: d.periodMonth,
      periodYear: d.periodYear,
      original: d.originalAmount,
      pagado: d.amountPaid,
      punitorios: live.punitorios,
      punitoriosPendientes: live.punitoriosPendientes,
      pendiente: live.pendiente,
      status: d.status,
      // Días TOTALES de mora (desde que empezó a correr el punitorio hasta HOY, fecha
      // de generación del reporte) — no el tramo desde el último pago parcial.
      dias: debtDelinquencyDays(d),
      // Desglose alquiler/servicios pendientes, para itemizar "Deudas Acumuladas"
      // con el mismo nivel de detalle que "Cobrado de deudas anteriores".
      alquilerPendiente: live.alquiler,
      serviciosPendientes: live.servicios,
    };
  }));

  // Total adeudado consolidado = lo impago del mes actual + deudas formales de meses anteriores.
  // previousBalance solo acarrea SALDO A FAVOR (crédito), nunca deuda → no hay doble conteo con totalDeuda.
  const totalDeuda = deudasVivas.reduce((sum, d) => sum + d.pendiente, 0);
  const totalSinAbonar = pendingAmount + totalDeuda;

  // DISPLAY TOTALS: "Total Alquileres Cobrados" = alquiler pagado + punitorios pagados - descuentos
  // DESCUENTO reduce el alquiler cobrado (y por ende los honorarios). BONIFICACION no.
  // El saldo a favor previo (prevCredit) representa alquiler de este mes pagado con crédito de
  // un mes anterior — no se restan honorarios por eso (ese mes anterior no cobró honorarios
  // sobre la sobre-pago).
  const prevCredit = Math.max(0, previousBalance); // previousBalance > 0 = credit from prior month
  const descuentosTotal = conceptos
    .filter(c => c.isService && c.category === 'DESCUENTO')
    .reduce((s, c) => s + Math.abs(c.importe), 0);
  const subtotalAlquileresCobrado = paidAlquiler + paidPunitorios - descuentosTotal;

  // HONORARIOS: pct% of subtotalAlquileresCobrado (same base as Total Alquileres Cobrados)
  // Si no se cobró nada (NO COBRADO) no se cobran honorarios, aunque haya saldo a favor previo.
  const honPct = options.honorariosPercent || 0;
  const honorariosAlquilerCobrado = (honPct > 0 && amtPaid > 0)
    ? Math.max(0, Math.round(subtotalAlquileresCobrado * honPct / 100 * 100) / 100)
    : 0;
  const gastosCobrado = amtPaid > 0 ? (honorarios?.totalGastos ?? 0) : 0;
  const honorariosCobrado = honorariosAlquilerCobrado + gastosCobrado;

  // Update per-contract honorarios display to reflect collected amounts
  if (honorarios) {
    honorarios.montoAlquiler = honorariosAlquilerCobrado;
    honorarios.monto = honorariosCobrado;
    honorarios.montoEnLetras = numeroATexto(honorariosCobrado);
  }

  // Available services for frontend checkbox rendering (excludes discounts/bonifications)
  const serviciosDisponibles = monthlyRecord.services
    .filter(s => s.conceptType?.category !== 'BONIFICACION' && s.conceptType?.category !== 'DESCUENTO')
    .map(s => ({
      id: s.id,
      concepto: s.conceptType?.label || s.description || 'Servicio',
      importe: s.amount,
      category: s.conceptType?.category || '',
    }));

  return {
    empresa,
    contractType: contract.contractType || 'INQUILINO',
    inquilino: isPropietario
      ? { nombre: owner?.name || 'Propietario', dni: owner?.dni || '', email: owner?.email || '', telefono: owner?.phone || '', esPropietario: true }
      : { nombre: getTenantsName(contract), dni: (getPrimaryTenant(contract))?.dni || '', email: (getPrimaryTenant(contract))?.email || '', telefono: (getPrimaryTenant(contract))?.phone || '' },
    propiedad: { direccion: contract.property.address, piso: contract.property.floor, depto: contract.property.apartment },
    propietario: { nombre: owner?.name || 'Sin propietario', dni: owner?.dni || '', banco: resolveOwnerBank(owner, contract.property) },
    periodo: { mes: month, anio: year, label: `${MONTH_NAMES[month]} ${year}`, mesContrato: monthlyRecord.monthNumber, mesVencido, anioVencido, labelVencido: `${MONTH_NAMES[mesVencido]} ${anioVencido}` },
    conceptos,
    serviciosDisponibles,
    total,
    totalEnLetras: numeroATexto(total),
    rentAmount: monthlyRecord.rentAmount,
    punitoryAmount: punitoryAmt,
    subtotalAlquileres,
    subtotalAlquileresEnLetras: numeroATexto(subtotalAlquileres),
    subtotalAlquileresCobrado,
    pendingAmount,
    isRentPaid,
    paymentStatus,
    saldoAFavor,
    prevCredit,
    // Payment allocation breakdown
    paidServicios,
    paidPunitorios,
    paidAlquiler,
    honorariosCobrado,
    amountPaid: monthlyRecord.amountPaid,
    balance: monthlyRecord.balance,
    estado: monthlyRecord.status,
    isPaid: !!monthlyRecord.isPaid,
    isCancelled: !!monthlyRecord.isCancelled,
    fechaPago: monthlyRecord.fullPaymentDate,
    honorarios,
    deudas: deudasVivas,
    totalDeuda,
    totalSinAbonar,
    transacciones: groupTransaccionesByFecha(monthlyRecord.transactions.map((t) => ({
      fecha: t.paymentDate, monto: t.amount, metodo: t.paymentMethod,
      inquilino: getTenantsName(contract), propiedad: contract.property.address,
      conceptos: t.concepts.map((c) => ({ tipo: c.type, descripcion: c.description, monto: c.amount })),
    }))),
    currency: empresa.currency,
    contractId: contract.id,
    monthlyRecordId: monthlyRecord.id,
  };
};

const computeGrandTotals = (dataArray) => {
  const paidRows = dataArray.filter((d) => d.paymentStatus === 'PAGADO');
  const saldoRows = dataArray.filter((d) => d.paymentStatus === 'SALDO A FAVOR');
  const partialRows = dataArray.filter((d) => d.paymentStatus === 'PAGO PARCIAL');
  const unpaidRows = dataArray.filter((d) => d.paymentStatus === 'NO COBRADO');

  return {
    // Grand totals
    grandSubtotalAlquileres: dataArray.reduce((s, d) => s + (d.subtotalAlquileresCobrado || 0), 0),
    grandSubtotalAlquileresPartial: partialRows.reduce((s, d) => s + (d.pendingAmount || 0), 0),
    grandSubtotalAlquileresUnpaid: unpaidRows.reduce((s, d) => s + (d.pendingAmount || 0), 0),
    // Hallazgo #4: la caja real del mes = lo cobrado del propio período +
    // lo cobrado de deudas/meses anteriores (cobradoOtrosPeriodos), no solo
    // amountPaid del período (AUDITORIA_CONTROL_LIQUIDACION_2026-07.md).
    grandTotal: dataArray.reduce((s, d) => s + (d.amountPaid || 0) + (d.cobradoOtrosPeriodos?.total || 0), 0),
    // "Total Pendiente" debe incluir tanto lo impago del período actual como las
    // deudas viejas todavía abiertas (antes solo sumaba pendingAmount: un contrato
    // con Junio y Julio sin pagar mostraba solo Julio, perdiendo Junio del total).
    grandPending: dataArray.reduce((s, d) => s + (d.pendingAmount || 0) + (d.totalDeuda || 0), 0),
    grandHonorarios: dataArray.reduce((s, d) => s + (d.honorariosCobrado || 0), 0),
    // Allocation breakdown totals — incluyen lo cobrado de otros períodos por concepto
    grandServiciosCobrado: dataArray.reduce((s, d) => s + (d.paidServicios || 0) + (d.cobradoOtrosPeriodos?.servicios || 0), 0),
    grandPunitoriosCobrado: dataArray.reduce((s, d) => s + (d.paidPunitorios || 0) + (d.cobradoOtrosPeriodos?.punitorios || 0), 0),
    grandAlquilerCobrado: dataArray.reduce((s, d) => s + (d.paidAlquiler || 0) + (d.cobradoOtrosPeriodos?.alquiler || 0), 0),
    grandSaldoAFavor: dataArray.reduce((s, d) => s + (d.saldoAFavor || 0), 0),
    // Counts
    paidCount: paidRows.length,
    saldoCount: saldoRows.length,
    partialCount: partialRows.length,
    unpaidCount: unpaidRows.length,
  };
};

/**
 * Obtiene liquidaciones de TODOS los contratos activos para un mes/año
 * Single batch query instead of N+1 queries per contract.
 */
const getLiquidacionesAllContracts = async (groupId, month, year, propertyIds = null, options = {}, ownerId = null, contractIds = null) => {
  // Auto-create monthly records for the GLOBAL period before querying.
  // Los períodos override NO se auto-crean (decisión: evitar tocar/regenerar meses viejos).
  try {
    const { getOrCreateMonthlyRecords } = require('./monthlyRecordService');
    await getOrCreateMonthlyRecords(groupId, month, year);
  } catch (e) {
    // silently fail
  }

  const empresa = await getEmpresaData(groupId);

  const soloConPago = options.soloConPago !== false; // default true: only show cancelled (paid) records
  const includePlaceholders = !!options.includePlaceholders;

  // Overrides de período por contrato: { [contractId]: { month, year } }
  const periodOverrides = (options.periodOverrides && typeof options.periodOverrides === 'object' && !Array.isArray(options.periodOverrides))
    ? options.periodOverrides
    : {};
  const overrideContractIds = Object.keys(periodOverrides).filter((cid) => {
    const o = periodOverrides[cid];
    return o && Number(o.month) >= 1 && Number(o.month) <= 12 && Number(o.year) > 1900;
  });
  const overrideSet = new Set(overrideContractIds);

  // Filtros base compartidos por la query global y la de overrides (sin período)
  const buildBaseWhere = () => {
    // M-26 (AUDITORIA_FUNCIONAL_2026-07-10.md, confirmado con el usuario 2026-07-11):
    // un contrato RENOVADO (active:false, renewedAt seteado) sigue siendo dueño de
    // sus períodos históricos — mismo criterio que ya usa Control Mensual
    // (monthlyRecordService.js, "renewed/inactive contracts still own their
    // historical periods"). Antes este filtro era `active:true` a secas, así que
    // regenerar la Liquidación general de un mes ya cerrado hacía desaparecer a
    // cualquier contrato renovado después de ese mes. Un contrato RESCINDIDO
    // (active:false, renewedAt:null) sigue excluido — eso no cambia acá.
    const w = { groupId, contract: { OR: [{ active: true }, { renewedAt: { not: null } }] } };
    if (soloConPago) w.isCancelled = true;
    if (contractIds && contractIds.length > 0) {
      w.contractId = { in: contractIds };
    } else if (propertyIds && propertyIds.length > 0) {
      w.contract.propertyId = { in: propertyIds };
    }
    if (ownerId) {
      w.contract.property = { ownerId };
      w.contract.contractType = 'INQUILINO';
    }
    return w;
  };

  const includeClause = {
    contract: {
      include: {
        tenant: true,
        contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
        property: {
          include: {
            owner: { include: { transferBeneficiary: true } },
            transferBeneficiary: true
          }
        },
        rentHistory: { orderBy: { effectiveFromMonth: 'desc' } },
        debts: { where: { status: { not: 'PAID' } }, orderBy: { createdAt: 'asc' } },
      },
    },
    services: { include: { conceptType: true } },
    transactions: { include: { concepts: true }, orderBy: { paymentDate: 'asc' } },
    debt: true,
  };
  const orderByClause = { contract: { property: { address: 'asc' } } };

  // 1) Query GLOBAL: contratos SIN override, en el mes/año global
  const globalWhere = buildBaseWhere();
  globalWhere.periodMonth = month;
  globalWhere.periodYear = year;
  if (overrideContractIds.length > 0) {
    if (globalWhere.contractId && globalWhere.contractId.in) {
      globalWhere.contractId = { in: globalWhere.contractId.in.filter((id) => !overrideSet.has(id)) };
    } else {
      globalWhere.contractId = { notIn: overrideContractIds };
    }
  }
  const globalRecords = await prisma.monthlyRecord.findMany({ where: globalWhere, include: includeClause, orderBy: orderByClause });

  // 2) Query OVERRIDE: contratos con override, en su propio período (registros EXISTENTES, sin auto-crear)
  let overrideRecords = [];
  if (overrideContractIds.length > 0) {
    const ow = buildBaseWhere();
    // El usuario eligió explícitamente ese período: no forzar isCancelled, traer el registro exista o no como "cobrado".
    delete ow.isCancelled;
    ow.OR = overrideContractIds.map((cid) => ({
      contractId: cid,
      periodMonth: periodOverrides[cid].month,
      periodYear: periodOverrides[cid].year,
    }));
    overrideRecords = await prisma.monthlyRecord.findMany({ where: ow, include: includeClause, orderBy: orderByClause });
  }

  const allRecords = [...globalRecords, ...overrideRecords];

  // Preload feriados por año (evita N llamadas a DB dentro del loop; getHolidaysForYear
  // ya memoiza por proceso, pero esto lo deja explícito como el resto de los preloads).
  const yearsNeeded = [...new Set(allRecords.map((r) => r.periodYear))];
  const holidaysByYear = new Map(
    await Promise.all(yearsNeeded.map(async (y) => [y, await getHolidaysForYear(y)]))
  );

  const result = await Promise.all(allRecords.map((record) => {
    // Route per-contract gastosAMiCargo if provided as a map { [contractId]: {...} }
    const contractOptions = { ...options, holidays: holidaysByYear.get(record.periodYear) || [] };
    if (options.gastosAMiCargo && typeof options.gastosAMiCargo === 'object' && !Array.isArray(options.gastosAMiCargo)) {
      contractOptions.gastosAMiCargo = options.gastosAMiCargo[record.contractId] || null;
    }
    if (options.descuentosAlquiler && typeof options.descuentosAlquiler === 'object') {
      contractOptions.descuentosAlquiler = options.descuentosAlquiler[record.contractId] || 0;
    }
    // Usar el período PROPIO del registro (para overrides difiere del global; para el resto es igual)
    return buildLiquidacionFromRecord(record, empresa, record.periodMonth, record.periodYear, contractOptions);
  }));

  // 3) Placeholders "sin datos" para contratos con override que no tienen registro en ese período (solo preview)
  if (includePlaceholders && overrideContractIds.length > 0) {
    const foundCids = new Set(overrideRecords.map((r) => r.contractId));
    const missingCids = overrideContractIds.filter((cid) => !foundCids.has(cid));
    if (missingCids.length > 0) {
      const missingContracts = await prisma.contract.findMany({
        where: { id: { in: missingCids } },
        include: {
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
          property: { include: { owner: true } },
        },
      });
      for (const c of missingContracts) {
        const o = periodOverrides[c.id];
        const isProp = c.contractType === 'PROPIETARIO';
        result.push({
          noData: true,
          contractId: c.id,
          contractType: c.contractType || 'INQUILINO',
          propiedad: { direccion: c.property?.address || 'Sin dirección', piso: c.property?.floor, depto: c.property?.apartment },
          inquilino: { nombre: isProp ? (c.property?.owner?.name || 'Propietario') : getTenantsName(c) },
          periodo: { mes: o.month, anio: o.year, label: `${MONTH_NAMES[o.month]} ${o.year}` },
          conceptos: [], serviciosDisponibles: [], deudas: [], totalDeuda: 0,
          total: 0, paymentStatus: 'SIN DATOS',
        });
      }
    }
  }

  // ============================================
  // COBRADO DE DEUDAS ANTERIORES (vista de caja)
  // ============================================
  // Pagos cuya FECHA REAL (paymentDate) cae dentro del mes/año seleccionado
  // pero cuyo MonthlyRecord pertenece a OTRO período (deudas/meses anteriores).
  // Esto incluye los pagos de deudas, que debtService.payDebt() registra como
  // PaymentTransaction apuntando al MonthlyRecord del período original.
  const cobrosByContract = await (async () => {
    const map = new Map();
    // Rango del mes en fecha LOCAL (paymentDate se guarda a mediodía local)
    const fromDate = new Date(year, month - 1, 1, 0, 0, 0);
    const toDate = new Date(year, month, 0, 23, 59, 59);

    // Reusar el mismo filtro de contrato que la query principal
    const recordWhere = buildBaseWhere(); // { groupId, contract:{...}, [contractId], [isCancelled] }
    delete recordWhere.isCancelled;       // queremos todos los cobros, no solo registros cancelados

    const txs = await prisma.paymentTransaction.findMany({
      where: {
        groupId,
        paymentDate: { gte: fromDate, lte: toDate },
        monthlyRecord: {
          ...recordWhere,
          // Solo períodos ANTERIORES al seleccionado (no el propio mes ni meses futuros adelantados)
          OR: [
            { periodYear: { lt: year } },
            { periodYear: year, periodMonth: { lt: month } },
          ],
        },
      },
      include: {
        concepts: true,
        monthlyRecord: {
          select: {
            id: true,
            periodMonth: true,
            periodYear: true,
            contractId: true,
            // Para reconstruir etiquetas ricas en "Deudas Pagadas" (mismo criterio que
            // "Liquidación Actual": alquiler con mes/período, cada servicio con su label
            // y período — no la línea genérica "Pago deuda servicios/alquiler").
            monthNumber: true,
            rentAmount: true,
            includeIva: true,
            ivaAmount: true,
            services: {
              select: {
                id: true, amount: true, cuotaNumber: true, cuotaTotal: true, description: true,
                conceptType: { select: { category: true, name: true, label: true } },
              },
            },
            contract: {
              select: {
                contractType: true,
                tenant: { select: { name: true } },
                contractTenants: { select: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
                property: { select: { address: true, floor: true, apartment: true, owner: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });

    for (const tx of txs) {
      const rec = tx.monthlyRecord;
      if (!rec) continue;
      const cid = rec.contractId;
      // Desglose por concepto real (Hallazgo #2): alquiler/servicios/IVA/punitorios,
      // no re-derivado — leído directamente de los TransactionConcept de este pago.
      let alquiler = 0, servicios = 0, iva = 0, punitorios = 0, sobrepago = 0;
      const conceptosOut = [];
      for (const c of (tx.concepts || [])) {
        const amt = c.amount || 0;
        conceptosOut.push({ tipo: c.type, descripcion: c.description, monto: amt });
        if (c.type === 'PUNITORIOS') punitorios += amt;
        // ALQUILER_DEUDA es el tipo real que debtService.payDebt() graba al cobrar
        // el alquiler de una deuda vieja (distinto de 'ALQUILER' del mes corriente).
        // Sin este case, ese monto caía en "servicios" y "Total Alquileres Cobrados"
        // no lo contaba (bug reportado).
        else if (c.type === 'ALQUILER' || c.type === 'MULTA_RESCISION' || c.type === 'ALQUILER_DEUDA') alquiler += amt;
        else if (c.type === 'IVA') iva += amt;
        // Sobrepago de una deuda vieja: crédito para el mes siguiente, no es parte
        // de lo que se debía POR ESA deuda — se trackea aparte (caso Vaisman/
        // C01_full_ontime 2026-07-15: pagó $500.000 una deuda de $396.000).
        else if (c.type === 'A_FAVOR' || c.type === 'SOBREPAGO') sobrepago += amt;
        else servicios += amt; // incluye SERVICIOS_DEUDA: servicios+IVA de la deuda en un solo monto (payDebt no los desglosa)
      }
      if (!map.has(cid)) {
        map.set(cid, { total: 0, alquiler: 0, servicios: 0, iva: 0, punitorios: 0, detalle: [], transacciones: [], contract: rec.contract });
      }
      const entry = map.get(cid);
      entry.total += tx.amount || 0;
      entry.alquiler += alquiler;
      entry.servicios += servicios;
      entry.iva += iva;
      entry.punitorios += punitorios;
      entry.transacciones.push({
        fecha: tx.paymentDate, monto: tx.amount, metodo: tx.paymentMethod,
        inquilino: getTenantsName(rec.contract), propiedad: rec.contract.property?.address,
        conceptos: conceptosOut,
      });
      let det = entry.detalle.find((d) => d.periodMonth === rec.periodMonth && d.periodYear === rec.periodYear);
      if (!det) {
        det = {
          periodLabel: `${MONTH_NAMES[rec.periodMonth]} ${rec.periodYear}`, periodMonth: rec.periodMonth, periodYear: rec.periodYear,
          monto: 0, alquiler: 0, servicios: 0, iva: 0, punitorios: 0, sobrepago: 0,
          monthlyRecordId: rec.id, rec, lastTxDate: null,
        };
        entry.detalle.push(det);
      }
      det.monto += tx.amount || 0;
      det.alquiler += alquiler;
      det.servicios += servicios;
      det.iva += iva;
      det.punitorios += punitorios;
      det.sobrepago += sobrepago;
      if (!det.lastTxDate || new Date(tx.paymentDate) > new Date(det.lastTxDate)) det.lastTxDate = tx.paymentDate;
    }
    // Orden de presentación de cada línea: Alquiler primero, servicios en el medio, IVA y Punitorios al final.
    const conceptOrder = { ALQUILER: 0, MULTA_RESCISION: 0, ALQUILER_DEUDA: 0, IVA: 2, PUNITORIOS: 3 };
    for (const entry of map.values()) {
      entry.detalle.sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth));
      for (const d of entry.detalle) {
        d.alquiler = round2(d.alquiler);
        d.servicios = round2(d.servicios);
        d.iva = round2(d.iva);
        d.punitorios = round2(d.punitorios);
        d.sobrepago = round2(d.sobrepago);
      }
    }

    // "Deuda saldada" vs "Pago parcial de deuda": estado real de la Deuda (Debt) del período,
    // via monthlyRecordId. Sin Debt formal (p.ej. record legacy) se considera saldada.
    // También trae punitoryStartDate/lastPaymentDate/closedAt para "días TOTALES de mora",
    // y appliedCredit/accumulatedPunitory para repartir un eventual crédito aplicado
    // (ver más abajo — mismo hueco que buildLiquidacionFromRecord: debtService.js sí
    // reparte el crédito en cascada servicios→alquiler→punitorios internamente, pero
    // solo lo persiste como una línea "A_FAVOR" genérica, no por tipo de concepto).
    const allMonthlyRecordIds = [];
    for (const entry of map.values()) {
      for (const d of entry.detalle) if (d.monthlyRecordId) allMonthlyRecordIds.push(d.monthlyRecordId);
    }
    const debtByRecordId = new Map();
    if (allMonthlyRecordIds.length > 0) {
      const debts = await prisma.debt.findMany({
        where: { monthlyRecordId: { in: allMonthlyRecordIds } },
        select: { monthlyRecordId: true, status: true, punitoryStartDate: true, lastPaymentDate: true, closedAt: true, appliedCredit: true, accumulatedPunitory: true },
      });
      for (const d of debts) debtByRecordId.set(d.monthlyRecordId, d);
    }
    for (const entry of map.values()) {
      for (const d of entry.detalle) {
        const debtRow = debtByRecordId.get(d.monthlyRecordId);
        const status = debtRow?.status;
        d.saldada = (status == null) || status === 'PAID';
        // Si todavía no está saldada, "días" es hasta el ÚLTIMO pago capturado en ESTE
        // det (no hasta hoy ni hasta el lastPaymentDate mutable de la deuda, que puede
        // reflejar un cobro posterior de un mes de reporte distinto).
        d.dias = debtRow ? debtDelinquencyDays(debtRow, d.saldada ? null : d.lastTxDate) : 0;

        // Repartir el crédito aplicado a esta deuda (si hubo) contra lo que falta de
        // cada balde, usando los totales ORIGINALES del período (d.rec) y el punitorio
        // final acumulado de la deuda — caso Vaisman/C01 2026-07-15, mismo criterio que
        // buildLiquidacionFromRecord.
        if (debtRow?.appliedCredit > 0) {
          const faltaServicios = originalServiciosIvaTotal(d.rec) - d.servicios;
          const faltaAlquiler = (d.rec?.rentAmount || 0) - d.alquiler;
          const faltaPunitorios = (debtRow.accumulatedPunitory || 0) - d.punitorios;
          const split = splitCreditCascade(debtRow.appliedCredit, faltaServicios, faltaAlquiler, faltaPunitorios);
          d.servicios = round2(d.servicios + split.servicios);
          d.alquiler = round2(d.alquiler + split.alquiler);
          d.punitorios = round2(d.punitorios + split.punitorios);
          if (split.restante > 0) d.sobrepago = round2(d.sobrepago + split.restante);
        }

        // Lo que REALMENTE se debía por esta deuda (sin el sobrepago, que es crédito
        // para otro período) — `d.monto` sigue siendo el efectivo real cobrado (para
        // caja/grandTotal), pero para mostrar "Saldada $X" hay que usar este total.
        d.debtTotal = round2(d.alquiler + d.servicios + d.iva + d.punitorios);
        d.conceptos = buildConceptosDeudaPagada(d.rec, d)
          .sort((a, b) => (conceptOrder[a.tipo] ?? 1) - (conceptOrder[b.tipo] ?? 1));

        delete d.rec;
        delete d.monthlyRecordId;
        delete d.lastTxDate;
      }
      // Recomputar los totales agregados del contrato (usados para "Total Alquileres
      // Cobrados"/Honorarios) ahora que el crédito pudo haber corregido algún `d`.
      entry.alquiler = round2(entry.detalle.reduce((s, d) => s + d.alquiler, 0));
      entry.servicios = round2(entry.detalle.reduce((s, d) => s + d.servicios, 0));
      entry.iva = round2(entry.detalle.reduce((s, d) => s + d.iva, 0));
      entry.punitorios = round2(entry.detalle.reduce((s, d) => s + d.punitorios, 0));
    }
    return map;
  })();

  // Adjuntar a cada liquidación su bloque de cobros de otros períodos, y fusionar
  // su detalle de transacciones (propias + de otros períodos) agrupado por fecha.
  const cobrosAttached = new Set();
  for (const liq of result) {
    const entry = cobrosByContract.get(liq.contractId);
    const ownTx = liq.transacciones || [];
    const crossTx = entry ? entry.transacciones : [];
    liq.transacciones = groupTransaccionesByFecha([...ownTx, ...crossTx]);
    if (entry && entry.total > 0.009) {
      liq.cobradoOtrosPeriodos = {
        total: entry.total, alquiler: entry.alquiler, servicios: entry.servicios,
        iva: entry.iva, punitorios: entry.punitorios, detalle: entry.detalle,
      };
      cobrosAttached.add(liq.contractId);

      // "Total Alquileres Cobrados" y "Total Honorarios" deben contar también el
      // alquiler/punitorios de deudas viejas saldadas en este período (antes daban
      // $0 cuando el contrato solo había cobrado deuda, no alquiler del mes).
      const debtAlqPun = round2(entry.alquiler + entry.punitorios);
      if (debtAlqPun > 0) {
        liq.subtotalAlquileresCobrado = round2((liq.subtotalAlquileresCobrado || 0) + debtAlqPun);
        const honPct = options.honorariosPercent || 0;
        if (honPct > 0 && liq.honorarios) {
          const gastosCobrado = round2((liq.honorariosCobrado || 0) - (liq.honorarios.montoAlquiler || 0));
          const honAlqNuevo = round2(Math.max(0, liq.subtotalAlquileresCobrado * honPct / 100));
          liq.honorarios.montoAlquiler = honAlqNuevo;
          liq.honorarios.monto = round2(honAlqNuevo + gastosCobrado);
          liq.honorarios.montoEnLetras = numeroATexto(liq.honorarios.monto);
          liq.honorariosCobrado = liq.honorarios.monto;
        }
      }
    } else {
      liq.cobradoOtrosPeriodos = null;
    }
  }

  // Contratos que cobraron deudas viejas en el período pero no figuran en el resultado del período
  for (const [cid, entry] of cobrosByContract.entries()) {
    if (cobrosAttached.has(cid) || entry.total <= 0.009) continue;
    const c = entry.contract || {};
    const isProp = c.contractType === 'PROPIETARIO';
    const nombre = isProp
      ? (c.property?.owner?.name || 'Propietario')
      : (c.contractTenants?.length ? c.contractTenants.map((ct) => ct.tenant.name).join(' / ') : (c.tenant?.name || 'Sin inquilino'));

    // Estas filas no tienen liquidación propia del mes: "Total Alquileres Cobrados" y
    // honorarios deben salir enteramente de lo cobrado de deudas viejas.
    const debtAlqPun = round2(entry.alquiler + entry.punitorios);
    const honPct = options.honorariosPercent || 0;
    let honorarios = null;
    let honorariosCobrado = 0;
    if (honPct > 0 && debtAlqPun > 0) {
      const montoAlquiler = round2(Math.max(0, debtAlqPun * honPct / 100));
      honorarios = { porcentaje: honPct, baseHonorarios: debtAlqPun, montoAlquiler, gastosAMiCargo: [], totalGastos: 0, monto: montoAlquiler, montoEnLetras: numeroATexto(montoAlquiler) };
      honorariosCobrado = montoAlquiler;
    }

    result.push({
      contractId: cid,
      contractType: c.contractType || 'INQUILINO',
      propiedad: { direccion: c.property?.address || 'Sin dirección', piso: c.property?.floor, depto: c.property?.apartment },
      inquilino: { nombre },
      periodo: { mes: month, anio: year, label: `${MONTH_NAMES[month]} ${year}` },
      conceptos: [], serviciosDisponibles: [], deudas: [], totalDeuda: 0,
      total: 0, amountPaid: 0, paymentStatus: 'SOLO DEUDAS ANTERIORES',
      subtotalAlquileresCobrado: debtAlqPun, honorarios, honorariosCobrado,
      transacciones: groupTransaccionesByFecha(entry.transacciones),
      cobradoOtrosPeriodos: {
        total: entry.total, alquiler: entry.alquiler, servicios: entry.servicios,
        iva: entry.iva, punitorios: entry.punitorios, detalle: entry.detalle,
      },
    });
  }

  // Reconciliación de display: un solo bloque por mes (ver buildDeudasUnificadas).
  for (const liq of result) {
    liq.deudasUnificadas = buildDeudasUnificadas(liq.deudas || [], liq.cobradoOtrosPeriodos?.detalle || []);
  }

  // Natural sort by address: handles numbers correctly (Torre 1, Torre 2, ..., Torre 10)
  // and normalizes extra spaces that cause wrong lexicographic order
  result.sort((a, b) => {
    const addrA = (a.propiedad?.direccion || '').trim().replace(/\s+/g, ' ');
    const addrB = (b.propiedad?.direccion || '').trim().replace(/\s+/g, ' ');
    return addrA.localeCompare(addrB, 'es', { numeric: true, sensitivity: 'base' });
  });

  return result;
};

// ============================================
// ESTADO DE CUENTAS
// ============================================

const getEstadoCuentasData = async (groupId, contractId) => {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, groupId },
    include: {
      tenant: true,
      contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
      property: { include: { owner: true } },
    },
  });

  if (!contract) return null;

  const monthlyRecords = await prisma.monthlyRecord.findMany({
    where: { contractId, groupId },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
    include: {
      services: { include: { conceptType: true } },
    },
  });

  const debts = await prisma.debt.findMany({
    where: { contractId, groupId },
    orderBy: { createdAt: 'asc' },
    include: { payments: true },
  });

  const empresa = await getEmpresaData(groupId);

  // Build historial
  const historial = monthlyRecords.map((r) => ({
    periodo: `${MONTH_NAMES[r.periodMonth]} ${r.periodYear}`,
    periodMonth: r.periodMonth,
    periodYear: r.periodYear,
    mesContrato: r.monthNumber,
    alquiler: r.rentAmount,
    servicios: r.servicesTotal,
    punitorios: r.punitoryAmount,
    totalDue: r.totalDue,
    amountPaid: r.amountPaid,
    balance: r.balance,
    status: r.status,
    isPaid: r.isPaid,
  }));

  // Punitorios/pendiente EN VIVO (a hoy, compuesto) por deuda — no el valor congelado.
  const { preloadDebtDependencies } = require('./debtService');
  const debtPreloaded = debts.length > 0 ? await preloadDebtDependencies(debts) : null;
  const debtFigures = new Map();
  for (const d of debts) debtFigures.set(d.id, await liveDebtFigures(d, debtPreloaded));

  const totalPagado = monthlyRecords.reduce((sum, r) => sum + r.amountPaid, 0);
  const totalAdeudado = debts
    .filter((d) => d.status !== 'PAID')
    .reduce((sum, d) => sum + (debtFigures.get(d.id)?.pendiente || 0), 0);

  return {
    empresa,
    inquilino: {
      nombre: getTenantsName(contract),
      dni: (getPrimaryTenant(contract))?.dni || '',
    },
    propiedad: {
      direccion: contract.property.address,
    },
    propietario: {
      nombre: contract.property.owner?.name || 'Sin propietario',
    },
    contrato: {
      inicio: contract.startDate,
      duracion: contract.durationMonths,
      mesActual: contract.currentMonth,
      alquilerBase: contract.baseRent,
    },
    historial,
    resumen: {
      totalPagado,
      totalAdeudado,
      balance: totalPagado - monthlyRecords.reduce((sum, r) => sum + r.totalDue, 0),
    },
    deudas: debts.map((d) => ({
      periodo: d.periodLabel,
      original: d.originalAmount,
      pagado: d.amountPaid,
      punitorios: debtFigures.get(d.id)?.punitorios ?? d.accumulatedPunitory,
      pendiente: debtFigures.get(d.id)?.pendiente ?? d.currentTotal,
      status: d.status,
    })),
    currency: empresa.currency,
  };
};

// ============================================
// RESUMEN EJECUTIVO
// ============================================

const getResumenEjecutivoData = async (groupId, month, year) => {
  const empresa = await getEmpresaData(groupId);

  // Current month data
  const [
    activeContracts,
    totalProperties,
    occupiedProperties,
    monthlyRecordsAgg,
    statusGroups,
    debtsAgg,
  ] = await Promise.all([
    prisma.contract.count({ where: { groupId, active: true } }),
    prisma.property.count({ where: { groupId, isActive: true } }),
    prisma.contract.findMany({
      where: { groupId, active: true },
      distinct: ['propertyId'],
      select: { propertyId: true }
    }),
    prisma.monthlyRecord.aggregate({
      where: { groupId, periodMonth: month, periodYear: year },
      _sum: { amountPaid: true, totalDue: true, punitoryAmount: true },
      _count: { id: true }
    }),
    prisma.monthlyRecord.groupBy({
      by: ['status'],
      where: { groupId, periodMonth: month, periodYear: year },
      _count: { id: true }
    }),
    prisma.debt.findMany({
      where: { groupId, status: { not: 'PAID' } },
      include: { payments: true },
    }),
  ]);

  // Previous month for comparison
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthlyRecordsAgg = await prisma.monthlyRecord.aggregate({
    where: { groupId, periodMonth: prevMonth, periodYear: prevYear },
    _sum: { amountPaid: true }
  });

  const ingresosMes = monthlyRecordsAgg._sum.amountPaid || 0;
  const ingresosMesAnterior = prevMonthlyRecordsAgg._sum.amountPaid || 0;
  const totalDueMes = monthlyRecordsAgg._sum.totalDue || 0;
  const punitoryMes = monthlyRecordsAgg._sum.punitoryAmount || 0;
  const totalRecordsCount = monthlyRecordsAgg._count.id || 0;

  // Total de deuda EN VIVO (a hoy, compuesto), no el currentTotal congelado.
  const { preloadDebtDependencies } = require('./debtService');
  const debtPreloaded = debtsAgg.length > 0 ? await preloadDebtDependencies(debtsAgg) : null;
  let totalDeuda = 0;
  for (const d of debtsAgg) totalDeuda += (await liveDebtFigures(d, debtPreloaded)).pendiente;
  totalDeuda = round2(totalDeuda);
  const deudasAbiertas = debtsAgg.length;

  let pagados = 0, parciales = 0, pendientes = 0;
  for (const group of statusGroups) {
    if (group.status === 'COMPLETE') pagados = group._count.id;
    if (group.status === 'PARTIAL') parciales = group._count.id;
    if (group.status === 'PENDING') pendientes = group._count.id;
  }

  return {
    empresa,
    periodo: {
      mes: month,
      anio: year,
      label: `${MONTH_NAMES[month]} ${year}`,
    },
    kpis: {
      ingresosMes,
      ingresosMesAnterior,
      variacionIngresos: ingresosMesAnterior > 0
        ? ((ingresosMes - ingresosMesAnterior) / ingresosMesAnterior * 100).toFixed(1)
        : null,
      totalDueMes,
      cobranza: totalDueMes > 0 ? ((ingresosMes / totalDueMes) * 100).toFixed(1) : 0,
      punitoryMes,
      totalDeuda,
      deudasAbiertas,
      contratosActivos: activeContracts,
      totalPropiedades: totalProperties,
      ocupacion: totalProperties > 0
        ? ((occupiedProperties.length / totalProperties) * 100).toFixed(1)
        : 0,
    },
    estadoPagos: {
      pagados,
      parciales,
      pendientes,
      total: totalRecordsCount,
    },
    currency: empresa.currency,
  };
};

// ============================================
// CARTA DOCUMENTO
// ============================================

const getCartaDocumentoData = async (groupId, contractId) => {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, groupId },
    include: {
      tenant: true,
      contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
      property: { include: { owner: true } },
    },
  });

  if (!contract) return null;

  const debts = await prisma.debt.findMany({
    where: { contractId, groupId, status: { not: 'PAID' } },
    orderBy: { createdAt: 'asc' },
  });

  const empresa = await getEmpresaData(groupId);
  const primaryTenant = getPrimaryTenant(contract);

  // Montos EN VIVO (a hoy, compuesto) — la carta documento debe reflejar la deuda al día.
  const { preloadDebtDependencies } = require('./debtService');
  const debtPreloaded = debts.length > 0 ? await preloadDebtDependencies(debts) : null;
  const deudas = [];
  let totalDeuda = 0;
  for (const d of debts) {
    const f = await liveDebtFigures(d, debtPreloaded);
    deudas.push({ periodo: d.periodLabel, monto: f.pendiente, punitorios: f.punitorios });
    totalDeuda += f.pendiente;
  }
  totalDeuda = round2(totalDeuda);

  return {
    empresa,
    deudor: {
      nombre: getTenantsName(contract),
      dni: primaryTenant?.dni || '',
      email: primaryTenant?.email || '',
    },
    propiedad: {
      direccion: contract.property.address,
    },
    deudas,
    totalDeuda,
    fecha: new Date(),
    currency: empresa.currency,
  };
};

// ============================================
// EVOLUCION DE INGRESOS
// ============================================

const getEvolucionIngresosData = async (groupId, year) => {
  const empresa = await getEmpresaData(groupId);

  const [aggData, statusData] = await Promise.all([
    prisma.monthlyRecord.groupBy({
      by: ['periodMonth'],
      where: { groupId, periodYear: year },
      _sum: { totalDue: true, amountPaid: true },
      _count: { id: true },
    }),
    prisma.monthlyRecord.groupBy({
      by: ['periodMonth'],
      where: { groupId, periodYear: year, status: 'COMPLETE' },
      _count: { id: true },
    })
  ]);

  const aggMap = new Map();
  for (const row of aggData) {
    aggMap.set(row.periodMonth, row);
  }

  const statusMap = new Map();
  for (const row of statusData) {
    statusMap.set(row.periodMonth, row._count.id);
  }

  // Group by month
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const agg = aggMap.get(m) || { _sum: { totalDue: 0, amountPaid: 0 }, _count: { id: 0 } };
    const pagados = statusMap.get(m) || 0;

    meses.push({
      mes: m,
      label: MONTH_NAMES[m],
      totalDue: agg._sum.totalDue || 0,
      amountPaid: agg._sum.amountPaid || 0,
      contratos: agg._count.id || 0,
      pagados,
    });
  }

  const totalAnual = meses.reduce((sum, m) => sum + m.amountPaid, 0);

  return {
    empresa,
    anio: year,
    meses,
    totalAnual,
    currency: empresa.currency,
  };
};

// ============================================
// PAGO EFECTIVO (from MonthlyRecord)
// ============================================

const getPagoEfectivoFromRecord = async (groupId, monthlyRecordId, transactionId = null) => {
  const record = await prisma.monthlyRecord.findFirst({
    where: { id: monthlyRecordId, groupId },
    include: {
      contract: {
        include: {
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
          property: {
            include: {
              owner: {
                select: { id: true, name: true, dni: true, phone: true },
              },
              transferBeneficiary: {
                select: { id: true, name: true, dni: true },
              },
            },
          },
        },
      },
      services: {
        include: { conceptType: true },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { paymentDate: 'asc' },
      },
      debt: {
        include: { payments: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });

  if (!record) return null;

  const empresa = await getEmpresaData(groupId);
  const { contract } = record;
  const txs = record.transactions || [];

  // ── Si se pide un recibo de una transacción específica (2°, 3° pago parcial), ──
  // usar los concepts de esa transacción y su monto, NO los del record completo
  const targetTx = transactionId ? txs.find(t => t.id === transactionId) : null;

  let conceptos, total, fecha, paymentMethod, receiptNumber;

  if (targetTx) {
    // Recibo de UN pago específico
    fecha = targetTx.paymentDate;
    paymentMethod = targetTx.paymentMethod;
    total = targetTx.amount;

    // Usar concepto a los concepts guardados en esa transacción
    const CONCEPT_LABELS = {
      ALQUILER: 'Alquiler',
      MULTA_RESCISION: 'Multa Rescisión',
      PUNITORIOS: 'Punitorios',
      IVA: 'IVA 21%',
      A_FAVOR: 'Saldo a favor',
      SOBREPAGO: 'Pago en exceso',
    };
    const mesVencidoTx = record.periodMonth === 1 ? 12 : record.periodMonth - 1;
    const anioVencidoTx = record.periodMonth === 1 ? record.periodYear - 1 : record.periodYear;
    const serviceByName = Object.fromEntries(
      (record.services || []).map(s => [s.conceptType?.name, s.conceptType?.category])
    );
    conceptos = targetTx.concepts
      // Excluye créditos negativos del total visible (comportamiento pre-existente, sin
      // tocar). Excepción puntual: el A_FAVOR informativo que arma payDebt (amount:0,
      // "ya descontado del total a pagar") SÍ debe pasar — antes ni siquiera se creaba
      // ese concepto (síntoma: el recibo de pago de una deuda no mostraba el saldo a
      // favor aplicado). No se toca el resto de A_FAVOR (p.ej. el -previousBalance del
      // pago normal de mes, paymentTransactionService.js): ese es un problema latente
      // aparte, fuera del alcance de este fix.
      .filter(c => c.amount > 0 || (c.type === 'A_FAVOR' && c.amount === 0))
      .map(c => {
        const baseLabel = c.description || CONCEPT_LABELS[c.type] || c.type;
        const cat = serviceByName[c.type];
        const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
        return {
          concepto: showPeriodo ? `${baseLabel} | Período: ${MONTH_NAMES[mesVencidoTx]} ${anioVencidoTx}` : baseLabel,
          importe: c.amount,
        };
      });

    // Usar número de recibo de la transacción si lo tiene, sino generar uno
    receiptNumber = targetTx.receiptNumber ||
      `REC-${record.periodYear}${String(record.periodMonth).padStart(2, '0')}-${record.monthNumber}-P${txs.indexOf(targetTx) + 1}`;
  } else {
    // Recibo global del registro (comportamiento original)
    fecha = txs[txs.length - 1]?.paymentDate || new Date();
    paymentMethod = txs[txs.length - 1]?.paymentMethod || 'EFECTIVO';
    receiptNumber = `REC-${record.periodYear}${String(record.periodMonth).padStart(2, '0')}-${record.monthNumber}`;

    // Punitorio REAL del período a mostrar (no el congelado `record.punitoryAmount`):
    //  - Sin deuda: suma de los conceptos PUNITORIOS de todas las transacciones.
    //  - Con deuda: el punitorio de la deuda (fuente de verdad), igual que el enrichment
    //    de Control Mensual (monthlyRecordService): si PAID → accumulatedPunitory; si viva
    //    → unpaidAccumulatedPunitory + newPunitoryAmount (NO accumulated+new, que duplicaría).
    // `punitoryDaysLabel`: días de mora a mostrar. `record.punitoryDays` es el congelado
    // del último pago (suele quedar 0 en pagos en tandas / deuda) → mostraba "0 días" con
    // un monto grande. Usamos los días TOTALES de mora del período (desde el inicio del
    // punitorio hasta la fecha de corte). OJO: con pagos parciales el monto NO es
    // días×tasa×base (cada pago baja la base sobre la que siguen corriendo), por eso los
    // días son el tiempo transcurrido, no una reconstrucción lineal del monto.
    let truePunitory = sumPunitoryConcepts(txs);
    let punitoryDaysLabel = record.punitoryDays || 0;
    if (record.debt) {
      const debtStart = record.debt.punitoryStartDate ? new Date(record.debt.punitoryStartDate) : null;
      if (record.debt.status === 'PAID') {
        truePunitory = round2(record.debt.accumulatedPunitory || 0);
        const end = record.debt.lastPaymentDate || record.debt.closedAt;
        if (debtStart && end) punitoryDaysLabel = Math.max(diffCalendarDays(new Date(end), debtStart) + 1, 0);
      } else {
        const debtService = require('./debtService');
        // A-25: día ART correcto (string, TZ-inmune), no `new Date()` crudo del proceso.
        const live = await debtService.calculateDebtPunitory(record.debt, getTodayLocalString(), null, true);
        truePunitory = round2((live.unpaidAccumulatedPunitory || 0) + (live.newPunitoryAmount || 0));
        const end = live.endDate || getTodayLocalDate();
        if (debtStart) punitoryDaysLabel = Math.max(diffCalendarDays(new Date(end), debtStart) + 1, 0);
      }
    } else if (truePunitory > 0 && !record.punitoryDays && contract?.punitoryStartDay) {
      // Mes SIN deuda donde `record.punitoryDays` quedó en 0 (el último pago no sumó días
      // nuevos) pero SÍ se pagaron punitorios en tandas anteriores → mostraría "0 días".
      // Mostramos los días de mora transcurridos: desde el día de inicio de punitorios del
      // período hasta el último pago que imputó punitorios. (Cuando `record.punitoryDays`
      // ya es > 0 —el caso normal de un solo pago— se respeta ese valor congelado.)
      const start = new Date(record.periodYear, record.periodMonth - 1, contract.punitoryStartDay);
      const lastPunTx = [...txs].reverse().find((t) => (t.concepts || []).some((cc) => cc.type === 'PUNITORIOS'));
      // A-25: fallback al día ART correcto, no `new Date()` crudo del proceso.
      const end = lastPunTx?.paymentDate || txs[txs.length - 1]?.paymentDate || getTodayLocalDate();
      punitoryDaysLabel = Math.max(diffCalendarDays(new Date(end), start) + 1, 0);
    }

    // Total canónico = misma fórmula que liveTotalDue/totalHistorico del enrichment,
    // así el recibo y el modal (Historial / Control Mensual) muestran el MISMO número.
    const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;
    const truePunitoryForTotal = record.punitoryForgiven ? 0 : truePunitory;
    total = Math.max(
      round2(record.rentAmount + record.servicesTotal + ivaAmount + truePunitoryForTotal - record.previousBalance),
      0
    );

    conceptos = [];
    const mesLabel = MONTH_NAMES[record.periodMonth];
    if (record.rentAmount > 0) {
      const isMultaRescision = (() => {
        if (record.services?.some(s => s.conceptType?.name === 'MULTA_RESCISION')) return true;
        const rescindedAt = record.contract?.rescindedAt;
        if (!rescindedAt) return false;
        const rescDate = new Date(rescindedAt);
        let pm = rescDate.getMonth() + 2;
        let py = rescDate.getFullYear();
        if (pm > 12) { pm = 1; py++; }
        return record.periodMonth === pm && record.periodYear === py;
      })();
      conceptos.push({
        concepto: isMultaRescision
          ? `Multa Rescisión ${mesLabel} (Mes ${record.monthNumber})`
          : `Alquiler ${mesLabel} (Mes ${record.monthNumber})`,
        importe: record.rentAmount,
      });
    }

    const mesVencido = record.periodMonth === 1 ? 12 : record.periodMonth - 1;
    const anioVencido = record.periodMonth === 1 ? record.periodYear - 1 : record.periodYear;
    for (const svc of record.services) {
      const isDiscount = svc.conceptType?.category === 'DESCUENTO' || svc.conceptType?.category === 'BONIFICACION';
      const cat = svc.conceptType?.category;
      const label = formatServiceLabel(svc);
      const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
      conceptos.push({
        concepto: showPeriodo ? `${label} | Período: ${MONTH_NAMES[mesVencido]} ${anioVencido}` : label,
        importe: isDiscount ? -Math.abs(svc.amount) : svc.amount,
      });
    }

    // A-19: el TOTAL de este recibo (arriba) incluye IVA y resta el saldo a favor, pero
    // esos renglones no estaban en el detalle → la suma visible no cuadraba con el TOTAL
    // impreso. Se agregan acá con los mismos valores ya usados para calcular `total`
    // (no se recalcula nada nuevo), para que Σ renglones === TOTAL.
    if (ivaAmount > 0) {
      conceptos.push({
        concepto: 'IVA 21%',
        importe: round2(ivaAmount),
      });
    }

    if (truePunitory > 0 && !record.punitoryForgiven) {
      conceptos.push({
        concepto: `Punitorios (${punitoryDaysLabel} días)`,
        importe: truePunitory,
      });
    }

    if (record.previousBalance > 0) {
      conceptos.push({
        concepto: 'Saldo a favor',
        importe: -round2(record.previousBalance),
      });
    }
  }

  return {
    empresa,
    receiptNumber,
    fecha,
    inquilino: {
      nombre: getTenantsName(contract),
      dni: (getPrimaryTenant(contract))?.dni || '',
    },
    propiedad: {
      direccion: contract.property.address,
    },
    propietario: {
      nombre: contract.property.owner?.name || '',
      dni: contract.property.owner?.dni || '',
    },
    periodo: {
      mes: record.periodMonth,
      anio: record.periodYear,
      label: `${MONTH_NAMES[record.periodMonth]} ${record.periodYear}`,
    },
    conceptos,
    total,
    totalEnLetras: numeroATexto(total),
    paymentMethod,
    pagos: txs.map(t => ({
      fecha: t.paymentDate,
      monto: t.amount,
      metodo: t.paymentMethod === 'TRANSFERENCIA' ? 'Transferencia' : t.paymentMethod === 'EFECTIVO' ? 'Efectivo' : t.paymentMethod,
    })),
    currency: empresa.currency,
    monthlyRecordId: record.id,
  };
};

// ============================================
// AJUSTES MES
// ============================================

const getAjustesMesData = async (groupId, month, year) => {
  const empresa = await getEmpresaData(groupId);

  // Import the service function that gets contracts with adjustments
  const { getContractsWithAdjustmentInCalendar } = require('./adjustmentService');

  // Get contracts that should adjust in this calendar month
  const contractsWithAdjustments = await getContractsWithAdjustmentInCalendar(groupId, month, year);

  const ajustes = [];

  for (const contract of contractsWithAdjustments) {
    // Si tiene historial aplicado, mostrar el último ajuste aplicado para este mes
    if (contract.applied && contract.rentHistory.length > 0) {
      const lastHistory = contract.rentHistory[0]; // ya viene ordenado desc
      ajustes.push({
        contractId: contract.id,
        inquilino: getTenantsName(contract),
        propiedad: contract.property.address,
        alquilerAnterior: contract.rentBeforeAdjustment,
        indice: contract.adjustmentIndex.name,
        porcentajeAjuste: lastHistory.adjustmentPercent,
        alquilerNuevo: lastHistory.rentAmount,
        aplicado: true,
        fechaAplicacion: lastHistory.createdAt,
      });
    } else {
      // Si no tiene historial, mostrar el ajuste pendiente
      const porcentajeAjuste = contract.adjustmentIndex.currentValue;
      const alquilerNuevo = Math.round(contract.rentBeforeAdjustment * (1 + porcentajeAjuste / 100));

      ajustes.push({
        contractId: contract.id,
        inquilino: getTenantsName(contract),
        propiedad: contract.property.address,
        alquilerAnterior: contract.rentBeforeAdjustment,
        indice: contract.adjustmentIndex.name,
        porcentajeAjuste,
        alquilerNuevo,
        aplicado: false,
        fechaAplicacion: null,
      });
    }
  }

  return {
    empresa,
    periodo: {
      mes: month,
      anio: year,
      label: `${MONTH_NAMES[month]} ${year}`,
    },
    ajustes,
    currency: empresa.currency,
  };
};

// ============================================
// CONTROL MENSUAL
// ============================================

const getControlMensualData = async (groupId, month, year) => {
  const empresa = await getEmpresaData(groupId);

  const records = await prisma.monthlyRecord.findMany({
    where: { groupId, periodMonth: month, periodYear: year },
    include: {
      contract: {
        include: {
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
          property: { include: { owner: true } },
        },
      },
      services: {
        include: { conceptType: true },
      },
      transactions: {
        include: { concepts: { select: { type: true, amount: true } } },
        orderBy: { paymentDate: 'asc' },
      },
      debt: { include: { payments: true } },
    },
    orderBy: [
      { contract: { property: { address: 'asc' } } },
    ],
  });

  // Round currency to 2 decimals; zero out floating-point noise below half a cent
  const r2 = (v) => {
    const rounded = Math.round((v || 0) * 100) / 100;
    return Math.abs(rounded) < 0.005 ? 0 : rounded;
  };

  // Preload para punitorios EN VIVO de las deudas (evita N+1).
  const debtsForPreload = records.map((r) => r.debt).filter(Boolean);
  const { preloadDebtDependencies } = require('./debtService');
  const debtPreloaded = debtsForPreload.length > 0 ? await preloadDebtDependencies(debtsForPreload) : null;

  const registros = await Promise.all(records.map(async (r) => {
    const txs = r.transactions || [];

    // Punitorios y total a mostrar (consistente con el Control Mensual web):
    //  - Con deuda viva: punitorio EN VIVO (compuesto) + total = alquiler+servicios+IVA+punit−aFavor.
    //  - Con deuda PAID: el acumulado de la deuda.
    //  - Sin deuda: suma real de conceptos PUNITORIOS (no el congelado del último pago).
    let punitoriosOut, totalOut, punitoryDaysOut = r.punitoryDays || 0;
    if (r.debt && r.debt.status !== 'PAID') {
      const f = await liveDebtFigures(r.debt, debtPreloaded);
      punitoriosOut = r2(f.punitorios);
      const iva = r.includeIva ? r.ivaAmount : 0;
      totalOut = r2(r.rentAmount + r.servicesTotal + iva + f.punitorios - r.previousBalance);
      // A-25: día ART correcto (string, TZ-inmune), no `new Date()` crudo del proceso.
      if (r.debt.punitoryStartDate) punitoryDaysOut = Math.max(diffCalendarDays(getTodayLocalString(), new Date(r.debt.punitoryStartDate)) + 1, 0);
    } else if (r.debt) {
      punitoriosOut = r2(r.debt.accumulatedPunitory || 0);
      totalOut = r2(r.totalDue);
    } else {
      punitoriosOut = r2(r.punitoryForgiven ? 0 : sumPunitoryConcepts(txs));
      totalOut = r2(r.totalDue);
    }

    const fechasPago = txs.length > 0
      ? txs.map((t) => new Date(t.paymentDate).toLocaleDateString('es-AR')).join(', ')
      : r.fullPaymentDate
        ? new Date(r.fullPaymentDate).toLocaleDateString('es-AR')
        : null;

    const obsPartes = [
      r.observations,
      ...txs.filter((t) => t.observations).map((t, i) => `Pago ${i + 1}: ${t.observations}`),
    ].filter(Boolean);
    const observaciones = obsPartes.join(' | ') || null;

    // For balance-related fields: anything within $0.50 is noise → treat as 0
    const cleanBal = (v) => {
      const rounded = Math.round((v || 0) * 100) / 100;
      return Math.abs(rounded) < 0.5 ? 0 : rounded;
    };

    const balance = cleanBal(r.balance);
    const aFavorSig = balance > 0 ? balance : 0;
    const debeSig = balance < 0 ? -balance : 0;

    const serviciosDetalle = r.services.length > 0
      ? r.services.map((s) => {
        const nombre = s.conceptType?.label || s.conceptType?.name || 'Servicio';
        return `${nombre}: $${r2(s.amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }).join('\n')
      : null;

    return {
      monthlyRecordId: r.id,
      contractType: r.contract.contractType || 'INQUILINO',
      dueno: r.contract.property.owner?.name || '',
      inquilino: getTenantsName(r.contract),
      propiedad: r.contract.property.address,
      mesContrato: r.monthNumber,
      alquiler: r2(r.rentAmount),
      servicios: r2(r.servicesTotal),
      serviciosDetalle,
      iva: r2(r.includeIva ? r.ivaAmount : 0),
      aFavorAnt: r2(r.previousBalance > 0 ? r.previousBalance : 0),
      punitorios: punitoriosOut,
      punitoryDays: punitoryDaysOut,
      punitoryForgiven: r.punitoryForgiven || false,
      total: totalOut,
      fechasPago,
      pagado: r2(r.amountPaid),
      aFavorSig,
      debeSig,
      saldo: balance,
      estado: r.status,
      isPaid: r.isPaid,
      fechaPago: r.fullPaymentDate,
      cancelo: r.isCancelled,
      observaciones,
    };
  }));

  const totales = {
    alquiler: registros.reduce((s, r) => s + r.alquiler, 0),
    servicios: registros.reduce((s, r) => s + r.servicios, 0),
    iva: registros.reduce((s, r) => s + r.iva, 0),
    aFavorAnt: registros.reduce((s, r) => s + r.aFavorAnt, 0),
    punitorios: registros.reduce((s, r) => s + r.punitorios, 0),
    total: registros.reduce((s, r) => s + r.total, 0),
    pagado: registros.reduce((s, r) => s + r.pagado, 0),
    aFavorSig: registros.reduce((s, r) => s + r.aFavorSig, 0),
    debeSig: registros.reduce((s, r) => s + r.debeSig, 0),
    saldo: registros.reduce((s, r) => s + r.saldo, 0),
  };

  return {
    empresa,
    periodo: {
      mes: month,
      anio: year,
      label: `${MONTH_NAMES[month]} ${year}`,
    },
    registros,
    totales,
    currency: empresa.currency,
  };
};

// ============================================
// IMPUESTOS
// ============================================

const getImpuestosData = async (groupId, month, year, propertyIds = null, ownerId = null, contractIds = null) => {
  const empresa = await getEmpresaData(groupId);

  // Build where clause with all filters applied at DB level (avoids post-fetch in-memory filtering)
  const where = { groupId, periodMonth: month, periodYear: year };

  if (contractIds && contractIds.length > 0) {
    where.contractId = { in: contractIds };
  } else if (propertyIds && propertyIds.length > 0) {
    where.contract = { propertyId: { in: propertyIds } };
  }

  if (ownerId) {
    where.contract = { ...where.contract, property: { ownerId } };
  }

  const contractBaseInclude = {
    tenant: true,
    contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
    property: {
      include: { owner: { include: { transferBeneficiary: true } } },
    },
  };

  const records = await prisma.monthlyRecord.findMany({
    where,
    include: {
      contract: {
        include: {
          ...contractBaseInclude,
          debts: { where: { status: { not: 'PAID' } }, orderBy: { createdAt: 'asc' } },
        },
      },
      services: {
        include: {
          conceptType: true,
        },
      },
    },
  });

  // "Mes vencido" logic: the period displayed is the previous month
  const mesVencido = month === 1 ? 12 : month - 1;
  const anioVencido = month === 1 ? year - 1 : year;

  const coveredContractIds = new Set();
  const impuestos = [];

  for (const record of records) {
    const taxServices = record.services.filter(
      (s) => s.conceptType?.category === 'IMPUESTO' || s.conceptType?.category === 'SERVICIO'
    );
    const isPropietario = record.contract.contractType === 'PROPIETARIO';
    const debts = isPropietario ? (record.contract.debts || []) : [];
    if (taxServices.length === 0 && debts.length === 0) continue;

    coveredContractIds.add(record.contractId);
    const owner = record.contract.property.owner;
    const deudasVivas = await Promise.all(debts.map(async (d) => {
      const live = await liveDebtFigures(d);
      return {
        periodo: d.periodLabel,
        original: d.originalAmount,
        pagado: d.amountPaid,
        punitorios: live.punitorios,
        pendiente: live.pendiente,
        status: d.status,
      };
    }));

    impuestos.push({
      inquilino: getTenantsName(record.contract),
      propiedad: record.contract.property.address,
      propietario: owner?.name || 'Sin propietario',
      impuestos: taxServices.map((s) => ({
        concepto: `${s.conceptType?.label || s.description || 'Impuesto/Servicio'} (período ${MONTH_NAMES[mesVencido]})`,
        monto: s.amount,
      })),
      totalImpuestos: taxServices.reduce((sum, s) => sum + s.amount, 0),
      banco: resolveOwnerBank(owner) || empresa.banco,
      beneficiario: owner?.transferBeneficiary?.name || null,
      deudas: deudasVivas,
      totalDeuda: deudasVivas.reduce((sum, d) => sum + d.pendiente, 0),
    });
  }

  // Contracts with open debts but no MonthlyRecord in the current period
  const debtWhere = { groupId, status: { not: 'PAID' } };
  if (contractIds && contractIds.length > 0) {
    debtWhere.contractId = { in: contractIds };
  } else if (propertyIds && propertyIds.length > 0) {
    debtWhere.contract = { propertyId: { in: propertyIds } };
  }
  if (ownerId) {
    debtWhere.contract = { ...debtWhere.contract, property: { ownerId } };
  }
  debtWhere.contract = { ...debtWhere.contract, contractType: 'PROPIETARIO' };

  const openDebts = await prisma.debt.findMany({
    where: debtWhere,
    include: { contract: { include: contractBaseInclude } },
    orderBy: { createdAt: 'asc' },
  });

  const debtsByContract = new Map();
  for (const debt of openDebts) {
    if (coveredContractIds.has(debt.contractId)) continue;
    if (!debtsByContract.has(debt.contractId)) {
      debtsByContract.set(debt.contractId, { contract: debt.contract, debts: [] });
    }
    debtsByContract.get(debt.contractId).debts.push(debt);
  }

  for (const { contract, debts } of debtsByContract.values()) {
    const owner = contract.property.owner;
    const deudasVivas = await Promise.all(debts.map(async (d) => {
      const live = await liveDebtFigures(d);
      return {
        periodo: d.periodLabel,
        original: d.originalAmount,
        pagado: d.amountPaid,
        punitorios: live.punitorios,
        pendiente: live.pendiente,
        status: d.status,
      };
    }));

    impuestos.push({
      inquilino: getTenantsName(contract),
      propiedad: contract.property.address,
      propietario: owner?.name || 'Sin propietario',
      impuestos: [],
      totalImpuestos: 0,
      banco: resolveOwnerBank(owner) || empresa.banco,
      beneficiario: owner?.transferBeneficiary?.name || null,
      deudas: deudasVivas,
      totalDeuda: deudasVivas.reduce((sum, d) => sum + d.pendiente, 0),
    });
  }

  const grandTotal = impuestos.reduce((sum, i) => sum + i.totalImpuestos, 0);
  const grandTotalDeuda = impuestos.reduce((sum, i) => sum + i.totalDeuda, 0);
  const grandTotalAbonar = grandTotal + grandTotalDeuda;

  return {
    empresa,
    periodo: {
      mes: month,
      anio: year,
      label: `${MONTH_NAMES[month]} ${year}`,
      mesVencido,
      anioVencido,
      labelVencido: `${MONTH_NAMES[mesVencido]} ${anioVencido}`,
    },
    impuestos,
    grandTotal,
    grandTotalDeuda,
    grandTotalAbonar,
    grandTotalAbonarEnLetras: numeroATexto(grandTotalAbonar),
    grandTotalEnLetras: numeroATexto(grandTotal),
    currency: empresa.currency,
  };
};

// ============================================
// VENCIMIENTOS
// ============================================

const getVencimientosData = async (groupId) => {
  const empresa = await getEmpresaData(groupId);

  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true },
    include: {
      tenant: true,
      contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
      property: true,
    },
  });

  const now = new Date();

  const vencimientos = [];
  for (const contract of contracts) {
    const startDate = new Date(contract.startDate);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + contract.durationMonths);
    endDate.setDate(endDate.getDate() - 1);

    // Compare by month only (ignore day/time/timezone issues)
    const monthsDiff = (endDate.getFullYear() - now.getFullYear()) * 12 + (endDate.getMonth() - now.getMonth());
    if (monthsDiff <= 3) {
      vencimientos.push({
        contractId: contract.id,
        inquilino: getTenantsName(contract),
        propiedad: contract.property.address,
        inicio: contract.startDate,
        vencimiento: endDate,
        alquiler: contract.baseRent,
        diasRestantes: Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)),
      });
    }
  }

  // Sort by days remaining (most urgent first)
  vencimientos.sort((a, b) => a.diasRestantes - b.diasRestantes);

  return {
    empresa,
    fecha: now,
    vencimientos,
    currency: empresa.currency,
  };
};

module.exports = {
  getEmpresaData,
  buildLiquidacionFromRecord,
  computeGrandTotals,
  getLiquidacionData,
  getLiquidacionesAllContracts,
  getEstadoCuentasData,
  getResumenEjecutivoData,
  getCartaDocumentoData,
  getEvolucionIngresosData,
  getPagoEfectivoFromRecord,
  getAjustesMesData,
  getControlMensualData,
  getImpuestosData,
  getVencimientosData,
  resolveOwnerBank,
  MONTH_NAMES,
  findAjusteForMonth,
};
