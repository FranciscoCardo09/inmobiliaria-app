// Report Data Service - Prisma queries for all report types
const { PrismaClient } = require('@prisma/client');
const { numeroATexto } = require('../utils/helpers');

const prisma = new PrismaClient();

const MONTH_NAMES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Helper: get tenant name(s) from contract (supports multi-tenant)
const getTenantsName = (contract) => {
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
            include: { owner: true },
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
              property: { include: { owner: true } },
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

  const { contract } = monthlyRecord;
  const empresa = await getEmpresaData(groupId);
  const owner = contract.property.owner;

  // Build conceptos
  const conceptos = [];

  // Alquiler
  conceptos.push({
    concepto: 'Alquiler',
    base: monthlyRecord.rentAmount,
    importe: monthlyRecord.rentAmount,
  });

  // Services (expensas, IVA, servicios, etc.)
  for (const svc of monthlyRecord.services) {
    const isDiscount = svc.conceptType?.category === 'DESCUENTO' || svc.conceptType?.category === 'BONIFICACION';
    conceptos.push({
      concepto: svc.conceptType?.label || svc.description || 'Servicio',
      base: null,
      importe: isDiscount ? -Math.abs(svc.amount) : svc.amount,
    });
  }

  // Punitorios
  if (monthlyRecord.punitoryAmount > 0 && !monthlyRecord.punitoryForgiven) {
    conceptos.push({
      concepto: `Punitorios (${monthlyRecord.punitoryDays} días)`,
      base: null,
      importe: monthlyRecord.punitoryAmount,
    });
  }

  // Saldo anterior
  if (monthlyRecord.previousBalance !== 0) {
    conceptos.push({
      concepto: monthlyRecord.previousBalance > 0 ? 'Saldo a favor' : 'Deuda anterior',
      base: null,
      importe: monthlyRecord.previousBalance > 0 ? -monthlyRecord.previousBalance : Math.abs(monthlyRecord.previousBalance),
    });
  }

  // "Mes vencido" logic
  const mesVencido = month === 1 ? 12 : month - 1;
  const anioVencido = month === 1 ? year - 1 : year;

  return {
    empresa,
    inquilino: {
      nombre: getTenantsName(contract),
      dni: (getPrimaryTenant(contract))?.dni || '',
      email: (getPrimaryTenant(contract))?.email || '',
      telefono: (getPrimaryTenant(contract))?.phone || '',
    },
    propiedad: {
      direccion: contract.property.address,
      piso: contract.property.floor,
      depto: contract.property.apartment,
    },
    propietario: {
      nombre: owner?.name || 'Sin propietario',
      dni: owner?.dni || '',
      banco: owner?.bankName ? {
        nombre: owner.bankName,
        titular: owner.bankHolder || '',
        cuit: owner.bankCuit || '',
        tipoCuenta: owner.bankAccountType || '',
        numeroCuenta: owner.bankAccountNumber || '',
        cbu: owner.bankCbu || '',
        alias: owner.bankAlias || '',
      } : null,
    },
    periodo: {
      mes: month,
      anio: year,
      label: `${MONTH_NAMES[month]} ${year}`,
      mesContrato: monthlyRecord.monthNumber,
      mesVencido,
      anioVencido,
      labelVencido: `${MONTH_NAMES[mesVencido]} ${anioVencido}`,
    },
    conceptos,
    total: monthlyRecord.totalDue,
    totalEnLetras: numeroATexto(monthlyRecord.totalDue),
    amountPaid: monthlyRecord.amountPaid,
    balance: monthlyRecord.balance,
    estado: monthlyRecord.status,
    isPaid: monthlyRecord.isPaid,
    fechaPago: monthlyRecord.fullPaymentDate,
    // Honorarios: base = (alquiler + punitorios) - bonificaciones
    honorarios: options.honorariosPercent > 0 ? (() => {
      const pct = options.honorariosPercent;
      const bonificaciones = monthlyRecord.services
        .filter(s => s.conceptType?.category === 'BONIFICACION' || s.conceptType?.category === 'DESCUENTO')
        .reduce((sum, s) => sum + Math.abs(s.amount), 0);
      const punitoryAmt = (monthlyRecord.punitoryAmount > 0 && !monthlyRecord.punitoryForgiven) ? monthlyRecord.punitoryAmount : 0;
      const baseHonorarios = Math.max(0, monthlyRecord.rentAmount + punitoryAmt - bonificaciones);
      const monto = Math.round(baseHonorarios * pct / 100 * 100) / 100;
      return {
        porcentaje: pct,
        monto,
        baseHonorarios,
        netoTransferir: Math.round((monthlyRecord.totalDue - monto) * 100) / 100,
      };
    })() : null,
    transacciones: monthlyRecord.transactions.map((t) => ({
      fecha: t.paymentDate,
      monto: t.amount,
      metodo: t.paymentMethod,
      inquilino: getTenantsName(contract),
      propiedad: contract.property.address,
      conceptos: t.concepts.map((c) => ({
        tipo: c.type,
        descripcion: c.description,
        monto: c.amount,
      })),
    })),
    currency: empresa.currency,
    contractId,
    monthlyRecordId: monthlyRecord.id,
  };
};

/**
 * Obtiene liquidaciones de TODOS los contratos activos para un mes/año
 * @param {string} groupId
 * @param {number} month
 * @param {number} year
 * @param {string[]} propertyIds - Opcional: IDs de propiedades para filtrar
 */
const getLiquidacionesAllContracts = async (groupId, month, year, propertyIds = null, options = {}) => {
  // Auto-create monthly records for the period before querying
  try {
    const { getOrCreateMonthlyRecords } = require('./monthlyRecordService');
    await getOrCreateMonthlyRecords(groupId, month, year);
  } catch (e) {
    // silently fail
  }

  const where = { groupId, active: true };

  // Si se proporcionan propertyIds, filtrar por ellos
  if (propertyIds && propertyIds.length > 0) {
    where.propertyId = { in: propertyIds };
  }

  const contracts = await prisma.contract.findMany({
    where,
    select: { id: true },
  });

  const liquidaciones = [];
  for (const contract of contracts) {
    const data = await getLiquidacionData(groupId, contract.id, month, year, options);
    if (data) liquidaciones.push(data);
  }

  return liquidaciones;
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
    monthlyRecords,
    debtsOpen,
  ] = await Promise.all([
    prisma.contract.count({ where: { groupId, active: true } }),
    prisma.property.count({ where: { groupId, isActive: true } }),
    prisma.contract.count({
      where: { groupId, active: true },
      distinct: ['propertyId'],
    }),
    prisma.monthlyRecord.findMany({
      where: { groupId, periodMonth: month, periodYear: year },
    }),
    prisma.debt.findMany({
      where: { groupId, status: { not: 'PAID' } },
    }),
  ]);

  // Previous month for comparison
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthlyRecords = await prisma.monthlyRecord.findMany({
    where: { groupId, periodMonth: prevMonth, periodYear: prevYear },
  });

  const ingresosMes = monthlyRecords.reduce((sum, r) => sum + r.amountPaid, 0);
  const ingresosMesAnterior = prevMonthlyRecords.reduce((sum, r) => sum + r.amountPaid, 0);
  const totalDueMes = monthlyRecords.reduce((sum, r) => sum + r.totalDue, 0);
  const punitoryMes = monthlyRecords.reduce((sum, r) => sum + r.punitoryAmount, 0);

  const totalDeuda = debtsOpen.reduce((sum, d) => sum + d.currentTotal, 0);

  const pagados = monthlyRecords.filter((r) => r.status === 'COMPLETE').length;
  const parciales = monthlyRecords.filter((r) => r.status === 'PARTIAL').length;
  const pendientes = monthlyRecords.filter((r) => r.status === 'PENDING').length;

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
      deudasAbiertas: debtsOpen.length,
      contratosActivos: activeContracts,
      totalPropiedades: totalProperties,
      ocupacion: totalProperties > 0
        ? ((occupiedProperties / totalProperties) * 100).toFixed(1)
        : 0,
    },
    estadoPagos: {
      pagados,
      parciales,
      pendientes,
      total: monthlyRecords.length,
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

  const records = await prisma.monthlyRecord.findMany({
    where: { groupId, periodYear: year },
    orderBy: [{ periodMonth: 'asc' }],
  });

  // Group by month
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const mesRecords = records.filter((r) => r.periodMonth === m);
    meses.push({
      mes: m,
      label: MONTH_NAMES[m],
      totalDue: mesRecords.reduce((sum, r) => sum + r.totalDue, 0),
      amountPaid: mesRecords.reduce((sum, r) => sum + r.amountPaid, 0),
      contratos: mesRecords.length,
      pagados: mesRecords.filter((r) => r.status === 'COMPLETE').length,
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

const getPagoEfectivoFromRecord = async (groupId, monthlyRecordId) => {
  const record = await prisma.monthlyRecord.findFirst({
    where: { id: monthlyRecordId, groupId },
    include: {
      contract: {
        include: {
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
          property: {
            include: { owner: true },
          },
        },
      },
      services: {
        include: { conceptType: true },
      },
      transactions: {
        orderBy: { paymentDate: 'desc' },
        take: 1,
      },
    },
  });

  if (!record) return null;

  const empresa = await getEmpresaData(groupId);
  const { contract } = record;

  // Build conceptos
  const conceptos = [];
  conceptos.push({
    concepto: 'Alquiler',
    importe: record.rentAmount,
  });

  for (const svc of record.services) {
    const isDiscount = svc.conceptType?.category === 'DESCUENTO' || svc.conceptType?.category === 'BONIFICACION';
    conceptos.push({
      concepto: svc.conceptType?.label || svc.description || 'Servicio',
      importe: isDiscount ? -Math.abs(svc.amount) : svc.amount,
    });
  }

  if (record.punitoryAmount > 0 && !record.punitoryForgiven) {
    conceptos.push({
      concepto: `Punitorios (${record.punitoryDays} días)`,
      importe: record.punitoryAmount,
    });
  }

  const total = record.totalDue;
  const lastTransaction = record.transactions[0];

  // Generate receipt number from record
  const receiptNumber = `REC-${record.periodYear}${String(record.periodMonth).padStart(2, '0')}-${record.monthNumber}`;

  return {
    empresa,
    receiptNumber,
    fecha: lastTransaction?.paymentDate || new Date(),
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
    paymentMethod: lastTransaction?.paymentMethod || 'EFECTIVO',
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
          property: true,
        },
      },
      services: {
        include: { conceptType: true },
      },
    },
    orderBy: [
      { contract: { property: { address: 'asc' } } },
    ],
  });

  const registros = records.map((r) => ({
    monthlyRecordId: r.id,
    inquilino: getTenantsName(r.contract),
    propiedad: r.contract.property.address,
    mesContrato: r.monthNumber,
    alquiler: r.rentAmount,
    servicios: r.servicesTotal,
    punitorios: r.punitoryAmount,
    total: r.totalDue,
    pagado: r.amountPaid,
    saldo: r.balance,
    estado: r.status,
    isPaid: r.isPaid,
    fechaPago: r.fullPaymentDate,
  }));

  const totales = {
    alquiler: registros.reduce((s, r) => s + r.alquiler, 0),
    servicios: registros.reduce((s, r) => s + r.servicios, 0),
    punitorios: registros.reduce((s, r) => s + r.punitorios, 0),
    total: registros.reduce((s, r) => s + r.total, 0),
    pagado: registros.reduce((s, r) => s + r.pagado, 0),
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

const getImpuestosData = async (groupId, month, year, propertyIds = null, ownerId = null) => {
  const empresa = await getEmpresaData(groupId);

  // Build where clause with optional filters
  const where = { groupId, periodMonth: month, periodYear: year };
  
  // Add property filter if provided
  if (propertyIds && propertyIds.length > 0) {
    where.contract = {
      propertyId: { in: propertyIds },
    };
  }
  
  // Add owner filter if provided
  if (ownerId) {
    where.contract = {
      ...where.contract,
      property: {
        ownerId: ownerId,
      },
    };
  }

  const records = await prisma.monthlyRecord.findMany({
    where,
    include: {
      contract: {
        include: {
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
          property: {
            include: { owner: true },
          },
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

  // Filter records that have services with category 'IMPUESTO'
  const impuestos = [];
  for (const record of records) {
    const taxServices = record.services.filter(
      (s) => s.conceptType?.category === 'IMPUESTO'
    );
    if (taxServices.length === 0) continue;

    const owner = record.contract.property.owner;
    impuestos.push({
      inquilino: getTenantsName(record.contract),
      propiedad: record.contract.property.address,
      propietario: owner?.name || 'Sin propietario',
      impuestos: taxServices.map((s) => ({
        concepto: s.conceptType?.label || s.description || 'Impuesto',
        monto: s.amount,
      })),
      totalImpuestos: taxServices.reduce((sum, s) => sum + s.amount, 0),
      // Owner bank data (fallback to group bank)
      banco: owner?.bankName ? {
        nombre: owner.bankName,
        titular: owner.bankHolder || '',
        cuit: owner.bankCuit || '',
        tipoCuenta: owner.bankAccountType || '',
        numeroCuenta: owner.bankAccountNumber || '',
        cbu: owner.bankCbu || '',
        alias: owner.bankAlias || '',
      } : empresa.banco,
    });
  }

  const grandTotal = impuestos.reduce((sum, i) => sum + i.totalImpuestos, 0);

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
  // Use first day of month 3 months ahead to capture any contract expiring within ~2 months
  const thresholdDate = new Date(now.getFullYear(), now.getMonth() + 3, 1);

  const vencimientos = [];
  for (const contract of contracts) {
    const startDate = new Date(contract.startDate);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + contract.durationMonths);

    if (endDate <= thresholdDate) {
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
  MONTH_NAMES,
};
