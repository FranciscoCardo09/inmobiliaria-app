// Contracts Controller
// Handles: CRUD contracts with adjustment info, punitory fields, currentMonth

const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');
const { calculateNextAdjustmentMonth, isAdjustmentMonth } = require('../services/adjustmentService');

const prisma = new PrismaClient();

// Helper: parse a date string as noon UTC (avoids timezone shift issues)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).replace(/T.*/, '').split('-');
  // Use noon UTC to avoid any timezone-related day shift
  return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0));
};

// Helper: compute period label from startDate + currentMonth
const getPeriodLabel = (startDate, currentMonth) => {
  const start = new Date(startDate);
  const date = new Date(start);
  date.setMonth(date.getMonth() + currentMonth - 1);
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
};

// Helper: enrich contract with computed fields
const enrichContract = (c) => {
  const adjustmentIndex = c.adjustmentIndex;

  // Dynamically compute currentMonth from startDate vs now
  const start = new Date(c.startDate);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  // currentMonth is 1-based: month 1 = the month the contract started
  const computedCurrentMonth = Math.max(1, Math.min(monthsDiff + 1, c.durationMonths));

  const currentPeriodLabel = getPeriodLabel(c.startDate, computedCurrentMonth);

  let nextAdjustmentLabel = null;
  let nextAdjustmentIsThisMonth = false;

  if (adjustmentIndex && c.nextAdjustmentMonth) {
    nextAdjustmentIsThisMonth = computedCurrentMonth === c.nextAdjustmentMonth;
    if (nextAdjustmentIsThisMonth) {
      nextAdjustmentLabel = `Ajuste este mes (Mes ${computedCurrentMonth})`;
    } else {
      nextAdjustmentLabel = `Mes ${c.nextAdjustmentMonth} (${adjustmentIndex.name})`;
    }
  }

  // Compute end date from startDate + durationMonths
  const endDate = new Date(start);
  endDate.setMonth(endDate.getMonth() + c.durationMonths);

  // Remaining months
  const remainingMonths = Math.max(0, c.durationMonths - computedCurrentMonth);

  // Determine status string for frontend
  let status;
  if (!c.active) {
    status = 'TERMINATED';
  } else if (now > endDate) {
    status = 'EXPIRED';
  } else {
    status = 'ACTIVE';
  }

  // Is expiring soon (2 months or less remaining)
  const isExpiringSoon = status === 'ACTIVE' && remainingMonths <= 2;

  return {
    ...c,
    currentMonth: computedCurrentMonth,
    endDate,
    status,
    rentAmount: c.baseRent,
    currentPeriodLabel,
    remainingMonths,
    isExpiringSoon,
    nextAdjustmentIsThisMonth,
    nextAdjustmentLabel,
  };
};

// GET /api/groups/:groupId/contracts
const getContracts = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { status, propertyId, tenantId, search } = req.query;

    const where = { groupId };

    if (status === 'ACTIVE') where.active = true;
    else if (status === 'INACTIVE') where.active = false;

    if (propertyId) where.propertyId = propertyId;
    if (tenantId) {
      where.contractTenants = { some: { tenantId } };
    }

    if (search) {
      where.OR = [
        { contractTenants: { some: { tenant: { name: { contains: search } } } } },
        { tenant: { is: { name: { contains: search } } } },
        { property: { address: { contains: search } } },
        { observations: { contains: search } },
      ];
    }

    const contracts = await prisma.contract.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, dni: true, phone: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    // Enrich with tenants array
    const enriched = contracts.map((c) => {
      const tenants = c.contractTenants.length > 0
        ? c.contractTenants.map((ct) => ct.tenant)
        : c.tenant ? [c.tenant] : [];
      return { ...enrichContract(c), tenants };
    });

    return ApiResponse.success(res, enriched);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/contracts/expiring
const getExpiringContracts = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const contracts = await prisma.contract.findMany({
      where: { groupId, active: true },
      include: {
        tenant: { select: { id: true, name: true, dni: true, phone: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
        property: {
          select: {
            id: true, address: true,
            category: { select: { id: true, name: true, color: true } },
          },
        },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    // Filter: remaining months <= 2
    const expiring = contracts
      .map((c) => {
        const tenants = c.contractTenants.length > 0
          ? c.contractTenants.map((ct) => ct.tenant)
          : c.tenant ? [c.tenant] : [];
        return { ...enrichContract(c), tenants };
      })
      .filter((c) => c.isExpiringSoon);

    return ApiResponse.success(res, expiring);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/contracts/adjustments
const getContractAdjustments = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      getContractsWithAdjustmentThisMonth,
      getContractsWithAdjustmentNextMonth,
    } = require('../services/adjustmentService');

    const thisMonth = await getContractsWithAdjustmentThisMonth(groupId);
    const nextMonth = await getContractsWithAdjustmentNextMonth(groupId);

    return ApiResponse.success(res, {
      thisMonth: thisMonth.map(enrichContract),
      nextMonth: nextMonth.map(enrichContract),
      thisMonthCount: thisMonth.length,
      nextMonthCount: nextMonth.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/contracts/:id
const getContractById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        tenant: true,
        contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
        property: {
          include: {
            category: { select: { id: true, name: true, color: true } },
            owner: { select: { id: true, name: true, dni: true, phone: true } },
          },
        },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const tenants = contract.contractTenants.length > 0
      ? contract.contractTenants.map((ct) => ct.tenant)
      : contract.tenant ? [contract.tenant] : [];

    return ApiResponse.success(res, { ...enrichContract(contract), tenants });
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/contracts
const createContract = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      tenantId,
      tenantIds,
      propertyId,
      startDate,
      durationMonths,
      currentMonth,
      baseRent,
      adjustmentIndexId,
      punitoryStartDay,
      punitoryPercent,
      observations,
    } = req.body;

    if (!propertyId || !startDate || !baseRent || !durationMonths) {
      return ApiResponse.badRequest(
        res,
        'Propiedad, fecha inicio, duración y monto son requeridos'
      );
    }

    // Resolve tenant IDs: prefer tenantIds array, fallback to single tenantId
    const resolvedTenantIds = tenantIds && tenantIds.length > 0
      ? tenantIds
      : tenantId ? [tenantId] : [];

    // Verify all tenants belong to group
    for (const tid of resolvedTenantIds) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tid } });
      if (!tenant || tenant.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Inquilino invalido');
      }
    }

    // Verify property belongs to group
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property || property.groupId !== groupId) {
      return ApiResponse.badRequest(res, 'Propiedad invalida');
    }

    // Check no other active contract on this property
    const activeContract = await prisma.contract.findFirst({
      where: { propertyId, active: true },
    });
    if (activeContract) {
      return ApiResponse.conflict(
        res,
        'Esta propiedad ya tiene un contrato activo. Finalícelo primero.'
      );
    }

    // Verify adjustment index if provided and calculate next adjustment
    const startMonthVal = currentMonth ? parseInt(currentMonth, 10) : 1;
    let nextAdjMonth = null;
    if (adjustmentIndexId) {
      const adjIndex = await prisma.adjustmentIndex.findUnique({ where: { id: adjustmentIndexId } });
      if (!adjIndex || adjIndex.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Índice de ajuste invalido');
      }
      // CORREGIDO: usar startMonth para calcular
      nextAdjMonth = calculateNextAdjustmentMonth(
        startMonthVal,
        startMonthVal,
        adjIndex.frequencyMonths,
        parseInt(durationMonths, 10)
      );
    }

    const primaryTenantId = resolvedTenantIds.length > 0 ? resolvedTenantIds[0] : null;

    const contract = await prisma.contract.create({
      data: {
        groupId,
        tenantId: primaryTenantId,
        propertyId,
        startDate: parseLocalDate(startDate),
        startMonth: startMonthVal,
        durationMonths: parseInt(durationMonths, 10),
        currentMonth: startMonthVal,
        baseRent: parseFloat(baseRent),
        adjustmentIndexId: adjustmentIndexId || null,
        nextAdjustmentMonth: nextAdjMonth,
        punitoryStartDay: punitoryStartDay ? parseInt(punitoryStartDay, 10) : 10,
        punitoryPercent: punitoryPercent ? parseFloat(punitoryPercent) : 0.006,
        observations,
        contractTenants: resolvedTenantIds.length > 0 ? {
          create: resolvedTenantIds.map((tid, i) => ({
            tenantId: tid,
            isPrimary: i === 0,
          })),
        } : undefined,
      },
      include: {
        tenant: { select: { id: true, name: true, dni: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
    });

    // Crear registro inicial en el historial de alquileres
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: startMonthVal,
        rentAmount: parseFloat(baseRent),
        adjustmentPercent: null,
        reason: 'INICIAL',
      },
    });

    const tenants = contract.contractTenants.length > 0
      ? contract.contractTenants.map((ct) => ct.tenant)
      : contract.tenant ? [contract.tenant] : [];

    return ApiResponse.created(res, { ...enrichContract(contract), tenants }, 'Contrato creado exitosamente');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/contracts/:id
const updateContract = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const {
      startDate,
      durationMonths,
      currentMonth,
      baseRent,
      adjustmentIndexId,
      punitoryStartDay,
      punitoryPercent,
      active,
      observations,
      tenantIds,
    } = req.body;

    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const data = {};
    if (startDate) data.startDate = parseLocalDate(startDate);
    if (durationMonths) data.durationMonths = parseInt(durationMonths, 10);
    if (currentMonth) data.currentMonth = parseInt(currentMonth, 10);
    if (baseRent) data.baseRent = parseFloat(baseRent);
    if (punitoryStartDay) data.punitoryStartDay = parseInt(punitoryStartDay, 10);
    if (punitoryPercent !== undefined) data.punitoryPercent = parseFloat(punitoryPercent);
    if (active !== undefined) data.active = active;
    if (observations !== undefined) data.observations = observations;

    // Handle tenantIds update
    if (tenantIds !== undefined) {
      // Verify all tenants belong to group
      for (const tid of tenantIds) {
        const t = await prisma.tenant.findUnique({ where: { id: tid } });
        if (!t || t.groupId !== groupId) {
          return ApiResponse.badRequest(res, 'Inquilino invalido');
        }
      }
      // Update primary tenantId for backward compat
      data.tenantId = tenantIds.length > 0 ? tenantIds[0] : null;
      // Replace contractTenants
      await prisma.contractTenant.deleteMany({ where: { contractId: id } });
      if (tenantIds.length > 0) {
        await prisma.contractTenant.createMany({
          data: tenantIds.map((tid, i) => ({
            contractId: id,
            tenantId: tid,
            isPrimary: i === 0,
          })),
        });
      }
    }

    // Handle adjustment index change - LÓGICA CORREGIDA
    if (adjustmentIndexId !== undefined) {
      data.adjustmentIndexId = adjustmentIndexId || null;
      if (adjustmentIndexId) {
        const adjIndex = await prisma.adjustmentIndex.findUnique({ where: { id: adjustmentIndexId } });
        if (!adjIndex || adjIndex.groupId !== groupId) {
          return ApiResponse.badRequest(res, 'Índice de ajuste invalido');
        }
        const startM = contract.startMonth;
        const currentM = data.currentMonth || contract.currentMonth;
        const dur = data.durationMonths || contract.durationMonths;
        data.nextAdjustmentMonth = calculateNextAdjustmentMonth(startM, currentM, adjIndex.frequencyMonths, dur);
      } else {
        data.nextAdjustmentMonth = null;
      }
    }

    const updated = await prisma.contract.update({
      where: { id },
      data,
      include: {
        tenant: { select: { id: true, name: true, dni: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
    });

    const tenants = updated.contractTenants.length > 0
      ? updated.contractTenants.map((ct) => ct.tenant)
      : updated.tenant ? [updated.tenant] : [];

    return ApiResponse.success(res, { ...enrichContract(updated), tenants }, 'Contrato actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/contracts/:id
const deleteContract = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        debts: { where: { status: { in: ['OPEN', 'PARTIAL'] } } },
        tenant: { select: { name: true } },
        contractTenants: { include: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { address: true } },
      },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    // Prevent deletion if there are open debts
    if (contract.debts.length > 0) {
      return ApiResponse.badRequest(
        res,
        `No se puede eliminar: el contrato tiene ${contract.debts.length} deuda(s) abierta(s). Pague o cancele las deudas primero.`
      );
    }

    const tenantName = contract.contractTenants.length > 0
      ? contract.contractTenants.map((ct) => ct.tenant.name).join(' / ')
      : contract.tenant?.name || 'Sin inquilino';

    // Cascade will delete payments, monthly records, closed debts, etc.
    await prisma.contract.delete({ where: { id } });

    return ApiResponse.success(
      res,
      { id },
      `Contrato de ${tenantName} en ${contract.property?.address} eliminado`
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/properties/:propertyId/tenant
const assignTenantToProperty = async (req, res, next) => {
  try {
    const { groupId, propertyId } = req.params;
    const {
      tenantId,
      startDate,
      durationMonths,
      baseRent,
      adjustmentIndexId,
      punitoryStartDay,
      punitoryPercent,
      observations,
    } = req.body;

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property || property.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Propiedad no encontrada');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.groupId !== groupId) {
      return ApiResponse.badRequest(res, 'Inquilino invalido');
    }

    const activeContract = await prisma.contract.findFirst({
      where: { propertyId, active: true },
    });
    if (activeContract) {
      return ApiResponse.conflict(res, 'Esta propiedad ya tiene un contrato activo');
    }

    if (!startDate || !baseRent || !durationMonths) {
      return ApiResponse.badRequest(res, 'Fecha inicio, duración y monto son requeridos');
    }

    // CORREGIDO: usar lógica correcta de ajustes
    let nextAdjMonth = null;
    if (adjustmentIndexId) {
      const adjIndex = await prisma.adjustmentIndex.findUnique({ where: { id: adjustmentIndexId } });
      if (adjIndex) {
        nextAdjMonth = calculateNextAdjustmentMonth(1, 1, adjIndex.frequencyMonths, parseInt(durationMonths, 10));
      }
    }

    const contract = await prisma.contract.create({
      data: {
        groupId,
        tenantId,
        propertyId,
        startDate: parseLocalDate(startDate),
        startMonth: 1,
        durationMonths: parseInt(durationMonths, 10),
        currentMonth: 1,
        baseRent: parseFloat(baseRent),
        adjustmentIndexId: adjustmentIndexId || null,
        nextAdjustmentMonth: nextAdjMonth,
        punitoryStartDay: punitoryStartDay ? parseInt(punitoryStartDay, 10) : 10,
        punitoryPercent: punitoryPercent ? parseFloat(punitoryPercent) : 0.006,
        observations,
        contractTenants: {
          create: { tenantId, isPrimary: true },
        },
      },
      include: {
        tenant: { select: { id: true, name: true, dni: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
    });

    const tenants = contract.contractTenants.map((ct) => ct.tenant);

    return ApiResponse.created(res, { ...enrichContract(contract), tenants }, 'Inquilino asignado a propiedad exitosamente');
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/contracts/:id/rent-history
const getContractRentHistory = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { groupId: true },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const history = await prisma.rentHistory.findMany({
      where: { contractId: id },
      orderBy: { effectiveFromMonth: 'asc' },
    });

    return ApiResponse.success(res, history);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getContracts,
  getExpiringContracts,
  getContractAdjustments,
  getContractById,
  createContract,
  updateContract,
  deleteContract,
  assignTenantToProperty,
  getContractRentHistory,
};
