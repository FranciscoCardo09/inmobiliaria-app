// Report Data Service - Prisma queries for all report types
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const MONTH_NAMES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ============================================
// LIQUIDACION (Prioridad #1)
// ============================================

/**
 * Obtiene datos de liquidación para un contrato en un mes/año
 */
const getLiquidacionData = async (groupId, contractId, month, year) => {
  const monthlyRecord = await prisma.monthlyRecord.findFirst({
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

  if (!monthlyRecord) return null;

  const { contract } = monthlyRecord;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, currency: true },
  });

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
    conceptos.push({
      concepto: svc.conceptType?.label || svc.description || 'Servicio',
      base: null,
      importe: svc.amount,
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

  return {
    empresa: {
      nombre: group?.name || 'H&H Inmobiliaria',
      direccion: 'Av. Marcelo T. de Alvear 1234',
      ciudad: 'Córdoba, Argentina',
      telefono: '(351) 555-0100',
      cuit: '30-12345678-9',
    },
    inquilino: {
      nombre: contract.tenant.name,
      dni: contract.tenant.dni,
      email: contract.tenant.email,
      telefono: contract.tenant.phone,
    },
    propiedad: {
      direccion: contract.property.address,
      codigo: contract.property.code,
      piso: contract.property.floor,
      depto: contract.property.apartment,
    },
    propietario: {
      nombre: contract.property.owner?.name || 'Sin propietario',
    },
    periodo: {
      mes: month,
      anio: year,
      label: `${MONTH_NAMES[month]} ${year}`,
      mesContrato: monthlyRecord.monthNumber,
    },
    conceptos,
    total: monthlyRecord.totalDue,
    amountPaid: monthlyRecord.amountPaid,
    balance: monthlyRecord.balance,
    estado: monthlyRecord.status,
    isPaid: monthlyRecord.isPaid,
    fechaPago: monthlyRecord.fullPaymentDate,
    transacciones: monthlyRecord.transactions.map((t) => ({
      fecha: t.paymentDate,
      monto: t.amount,
      metodo: t.paymentMethod,
    })),
    currency: group?.currency || 'ARS',
    contractId,
    monthlyRecordId: monthlyRecord.id,
  };
};

/**
 * Obtiene liquidaciones de TODOS los contratos activos para un mes/año
 */
const getLiquidacionesAllContracts = async (groupId, month, year) => {
  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true },
    select: { id: true },
  });

  const liquidaciones = [];
  for (const contract of contracts) {
    const data = await getLiquidacionData(groupId, contract.id, month, year);
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

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, currency: true },
  });

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
    empresa: {
      nombre: group?.name || 'H&H Inmobiliaria',
      direccion: 'Av. Marcelo T. de Alvear 1234',
      ciudad: 'Córdoba, Argentina',
      telefono: '(351) 555-0100',
      cuit: '30-12345678-9',
    },
    inquilino: {
      nombre: contract.tenant.name,
      dni: contract.tenant.dni,
    },
    propiedad: {
      direccion: contract.property.address,
      codigo: contract.property.code,
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
    currency: group?.currency || 'ARS',
  };
};

// ============================================
// RESUMEN EJECUTIVO
// ============================================

const getResumenEjecutivoData = async (groupId, month, year) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, currency: true },
  });

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
    empresa: {
      nombre: group?.name || 'H&H Inmobiliaria',
    },
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
    currency: group?.currency || 'ARS',
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
      property: { include: { owner: true } },
    },
  });

  if (!contract) return null;

  const debts = await prisma.debt.findMany({
    where: { contractId, groupId, status: { not: 'PAID' } },
    orderBy: { createdAt: 'asc' },
  });

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, currency: true },
  });

  return {
    empresa: {
      nombre: group?.name || 'H&H Inmobiliaria',
      direccion: 'Av. Marcelo T. de Alvear 1234',
      ciudad: 'Córdoba, Argentina',
      cuit: '30-12345678-9',
    },
    deudor: {
      nombre: contract.tenant.name,
      dni: contract.tenant.dni,
      email: contract.tenant.email,
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
    currency: group?.currency || 'ARS',
  };
};

// ============================================
// EVOLUCION DE INGRESOS
// ============================================

const getEvolucionIngresosData = async (groupId, year) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, currency: true },
  });

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
    empresa: {
      nombre: group?.name || 'H&H Inmobiliaria',
    },
    anio: year,
    meses,
    totalAnual,
    currency: group?.currency || 'ARS',
  };
};

module.exports = {
  getLiquidacionData,
  getLiquidacionesAllContracts,
  getEstadoCuentasData,
  getResumenEjecutivoData,
  getCartaDocumentoData,
  getEvolucionIngresosData,
  MONTH_NAMES,
};
