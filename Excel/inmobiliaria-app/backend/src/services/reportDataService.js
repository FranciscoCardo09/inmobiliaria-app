// Report Data Service - Prisma queries for all report types
const { numeroATexto } = require('../utils/helpers');
const { MONTH_NAMES } = require('../utils/constants');

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
const buildLiquidacionFromRecord = (monthlyRecord, empresa, month, year, options = {}) => {
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
      const label = svc.conceptType?.label || svc.description || 'Servicio';
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
  const ajusteEstesMes = (contract.rentHistory || []).find(
    h => h.effectiveFromMonth === monthlyRecord.monthNumber && h.reason !== 'INICIAL' && h.adjustmentPercent != null
  );

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
      alquilerLabel += ` Ajuste ${pctStr}%`;
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
    const label = svc.conceptType?.label || svc.description || 'Servicio';
    const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
    conceptos.push({
      concepto: showPeriodo ? `${label} (período ${MONTH_NAMES[mesVencido]} ${anioVencido})` : label,
      base: null,
      importe: isDiscount ? -Math.abs(svc.amount) : svc.amount,
      serviceId: svc.id,
      isService: true,
    });
  }

  if (monthlyRecord.includeIva && monthlyRecord.ivaAmount > 0) {
    conceptos.push({ concepto: 'IVA (21%)', base: monthlyRecord.rentAmount, importe: monthlyRecord.ivaAmount });
  }

  const punitoryAmt = (monthlyRecord.punitoryAmount > 0 && !monthlyRecord.punitoryForgiven) ? monthlyRecord.punitoryAmount : 0;
  if (punitoryAmt > 0) {
    conceptos.push({ concepto: `Punitorios (${monthlyRecord.punitoryDays} días)`, base: null, importe: punitoryAmt });
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
  // SEQUENTIAL PAYMENT ALLOCATION (strict order)
  // 1. Services + IVA first
  // 2. Punitorios second
  // ================================================================
  // 3. Rent (Alquiler) and Punitorios Allocation
  // ================================================================
  // We use current payment + previous credit as the "purchasing power"
  const amtPaid = monthlyRecord.amountPaid || 0;
  const previousBalance = monthlyRecord.previousBalance || 0;
  let remaining = amtPaid + previousBalance;

  // Calculate gross amounts for each bucket
  const serviciosTotal = conceptos
    .filter(c => c.isService)
    .reduce((s, c) => s + c.importe, 0);
  const ivaTotal = (monthlyRecord.includeIva && monthlyRecord.ivaAmount > 0) ? monthlyRecord.ivaAmount : 0;
  const serviciosIvaTotal = Math.max(0, serviciosTotal + ivaTotal);
  const alquilerTotal = monthlyRecord.rentAmount;

  // Step 1: Services + IVA (Highest priority)
  const paidServicios = Math.min(remaining, serviciosIvaTotal);
  remaining -= paidServicios;

  // Step 2: Rent (Prioritized over Punitorios)
  const paidAlquiler = Math.min(remaining, alquilerTotal);
  remaining -= paidAlquiler;

  // Step 3: Punitorios (Late fees)
  const paidPunitorios = Math.min(remaining, punitoryAmt);
  remaining -= paidPunitorios;

  // Overpayment / saldo a favor
  const saldoAFavor = remaining > 0 ? remaining : 0;

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

  // DISPLAY TOTALS: "Total Alquileres Cobrados" = alquiler pagado + punitorios pagados - saldo a favor
  const prevCredit = Math.max(0, previousBalance); // previousBalance > 0 = credit from prior month
  const subtotalAlquileresCobrado = paidAlquiler + paidPunitorios - prevCredit;

  // HONORARIOS: pct% of subtotalAlquileresCobrado (same base as Total Alquileres Cobrados)
  const honPct = options.honorariosPercent || 0;
  const honorariosAlquilerCobrado = honPct > 0
    ? Math.round(subtotalAlquileresCobrado * honPct / 100 * 100) / 100
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
    punitoryAmount: (monthlyRecord.punitoryAmount > 0 && !monthlyRecord.punitoryForgiven) ? monthlyRecord.punitoryAmount : 0,
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
    deudas: (contract.debts || []).map(d => ({
      periodo: d.periodLabel,
      original: d.originalAmount,
      pagado: d.amountPaid,
      punitorios: d.accumulatedPunitory,
      pendiente: d.currentTotal,
      status: d.status,
    })),
    totalDeuda: (contract.debts || []).reduce((sum, d) => sum + d.currentTotal, 0),
    transacciones: monthlyRecord.transactions.map((t) => ({
      fecha: t.paymentDate, monto: t.amount, metodo: t.paymentMethod,
      inquilino: getTenantsName(contract), propiedad: contract.property.address,
      conceptos: t.concepts.map((c) => ({ tipo: c.type, descripcion: c.description, monto: c.amount })),
    })),
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
    grandTotal: dataArray.reduce((s, d) => s + (d.amountPaid || 0), 0),
    grandPending: dataArray.reduce((s, d) => s + (d.pendingAmount || 0), 0),
    grandHonorarios: dataArray.reduce((s, d) => s + (d.honorariosCobrado || 0), 0),
    // Allocation breakdown totals
    grandServiciosCobrado: dataArray.reduce((s, d) => s + (d.paidServicios || 0), 0),
    grandPunitoriosCobrado: dataArray.reduce((s, d) => s + (d.paidPunitorios || 0), 0),
    grandAlquilerCobrado: dataArray.reduce((s, d) => s + (d.paidAlquiler || 0), 0),
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
  // Auto-create monthly records for the period before querying
  try {
    const { getOrCreateMonthlyRecords } = require('./monthlyRecordService');
    await getOrCreateMonthlyRecords(groupId, month, year);
  } catch (e) {
    // silently fail
  }

  const empresa = await getEmpresaData(groupId);

  // Build where clause for a single batch query
  const soloConPago = options.soloConPago !== false; // default true: only show cancelled (paid) records
  const where = {
    groupId,
    periodMonth: month,
    periodYear: year,
    contract: { active: true },
  };
  if (soloConPago) {
    where.isCancelled = true;
  }

  // contractIds takes priority over propertyIds
  if (contractIds && contractIds.length > 0) {
    where.contractId = { in: contractIds };
  } else if (propertyIds && propertyIds.length > 0) {
    where.contract.propertyId = { in: propertyIds };
  }

  if (ownerId) {
    where.contract.property = { ownerId };
    where.contract.contractType = 'INQUILINO';
  }

  const records = await prisma.monthlyRecord.findMany({
    where,
    include: {
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
    },
    orderBy: { contract: { property: { address: 'asc' } } },
  });

  const result = records.map((record) => {
    // Route per-contract gastosAMiCargo if provided as a map { [contractId]: {...} }
    const contractOptions = { ...options };
    if (options.gastosAMiCargo && typeof options.gastosAMiCargo === 'object' && !Array.isArray(options.gastosAMiCargo)) {
      contractOptions.gastosAMiCargo = options.gastosAMiCargo[record.contractId] || null;
    }
    if (options.descuentosAlquiler && typeof options.descuentosAlquiler === 'object') {
      contractOptions.descuentosAlquiler = options.descuentosAlquiler[record.contractId] || 0;
    }
    return buildLiquidacionFromRecord(record, empresa, month, year, contractOptions);
  });

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

  const totalPagado = monthlyRecords.reduce((sum, r) => sum + r.amountPaid, 0);
  const totalAdeudado = debts
    .filter((d) => d.status !== 'PAID')
    .reduce((sum, d) => sum + d.currentTotal, 0);

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
      punitorios: d.accumulatedPunitory,
      pendiente: d.currentTotal,
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
    prisma.debt.aggregate({
      where: { groupId, status: { not: 'PAID' } },
      _sum: { currentTotal: true },
      _count: { id: true }
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

  const totalDeuda = debtsAgg._sum.currentTotal || 0;
  const deudasAbiertas = debtsAgg._count.id || 0;

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
    deudas: debts.map((d) => ({
      periodo: d.periodLabel,
      monto: d.currentTotal,
      punitorios: d.accumulatedPunitory,
    })),
    totalDeuda: debts.reduce((sum, d) => sum + d.currentTotal, 0),
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
      A_FAVOR: 'Saldo a favor',
      SOBREPAGO: 'Pago en exceso',
    };
    conceptos = targetTx.concepts
      .filter(c => c.amount > 0) // excluir créditos negativos del total visible
      .map(c => ({
        concepto: c.description || CONCEPT_LABELS[c.type] || c.type,
        importe: c.amount,
      }));

    // Usar número de recibo de la transacción si lo tiene, sino generar uno
    receiptNumber = targetTx.receiptNumber ||
      `REC-${record.periodYear}${String(record.periodMonth).padStart(2, '0')}-${record.monthNumber}-P${txs.indexOf(targetTx) + 1}`;
  } else {
    // Recibo global del registro (comportamiento original)
    fecha = txs[txs.length - 1]?.paymentDate || new Date();
    paymentMethod = txs[txs.length - 1]?.paymentMethod || 'EFECTIVO';
    total = record.totalDue;
    receiptNumber = `REC-${record.periodYear}${String(record.periodMonth).padStart(2, '0')}-${record.monthNumber}`;

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
      const label = svc.conceptType?.label || svc.description || 'Servicio';
      const showPeriodo = cat === 'IMPUESTO' || cat === 'SERVICIO';
      conceptos.push({
        concepto: showPeriodo ? `${label} | Período: ${MONTH_NAMES[mesVencido]} ${anioVencido}` : label,
        importe: isDiscount ? -Math.abs(svc.amount) : svc.amount,
      });
    }

    if (record.punitoryAmount > 0 && !record.punitoryForgiven) {
      conceptos.push({
        concepto: `Punitorios (${record.punitoryDays} días)`,
        importe: record.punitoryAmount,
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
        orderBy: { paymentDate: 'asc' },
      },
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

  const registros = records.map((r) => {
    const txs = r.transactions || [];

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
      punitorios: r2(r.punitoryAmount),
      punitoryDays: r.punitoryDays || 0,
      punitoryForgiven: r.punitoryForgiven || false,
      total: r2(r.totalDue),
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
  });

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
      deudas: debts.map((d) => ({
        periodo: d.periodLabel,
        original: d.originalAmount,
        pagado: d.amountPaid,
        punitorios: d.accumulatedPunitory,
        pendiente: d.currentTotal,
        status: d.status,
      })),
      totalDeuda: debts.reduce((sum, d) => sum + d.currentTotal, 0),
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
    impuestos.push({
      inquilino: getTenantsName(contract),
      propiedad: contract.property.address,
      propietario: owner?.name || 'Sin propietario',
      impuestos: [],
      totalImpuestos: 0,
      banco: resolveOwnerBank(owner) || empresa.banco,
      beneficiario: owner?.transferBeneficiary?.name || null,
      deudas: debts.map((d) => ({
        periodo: d.periodLabel,
        original: d.originalAmount,
        pagado: d.amountPaid,
        punitorios: d.accumulatedPunitory,
        pendiente: d.currentTotal,
        status: d.status,
      })),
      totalDeuda: debts.reduce((sum, d) => sum + d.currentTotal, 0),
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
};
