// Contracts Controller
// Handles: CRUD contracts with adjustment info, punitory fields, currentMonth

const ApiResponse = require('../utils/apiResponse');
const { calculateNextAdjustmentMonth, isAdjustmentMonth } = require('../services/adjustmentService');

const prisma = require('../lib/prisma');

// Helper: parse a date string as noon UTC (avoids timezone shift issues)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).replace(/T.*/, '').split('-');
  // Use noon UTC to avoid any timezone-related day shift
  return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0));
};

// Helper: compute period label from startDate + currentMonth
// startMonth maps to startDate, so offset = currentMonth - startMonth
const getPeriodLabel = (startDate, currentMonth, startMonth = 1) => {
  const start = new Date(startDate);
  const date = new Date(start);
  date.setMonth(date.getMonth() + currentMonth - startMonth);
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
  // When startMonth > 1, contract was loaded mid-way: current = startMonth + elapsed
  const start = new Date(c.startDate);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  const sm = c.startMonth || 1;
  const endMonth = sm + c.durationMonths - 1;
  let computedCurrentMonth = Math.max(sm, Math.min(sm + monthsDiff, endMonth));
  // Safety net: never display a month number greater than durationMonths
  // (can happen with legacy data where startMonth was set too high)
  computedCurrentMonth = Math.min(computedCurrentMonth, c.durationMonths);

  const currentPeriodLabel = getPeriodLabel(c.startDate, computedCurrentMonth, sm);

  let nextAdjustmentLabel = null;
  let nextAdjustmentIsThisMonth = false;

  // Recalcular nextAdjustmentMonth si el valor de DB quedó en el pasado
  let effectiveNextAdj = c.nextAdjustmentMonth;
  if (adjustmentIndex && effectiveNextAdj && effectiveNextAdj < computedCurrentMonth) {
    effectiveNextAdj = calculateNextAdjustmentMonth(
      c.startMonth, computedCurrentMonth, adjustmentIndex.frequencyMonths, c.durationMonths
    );
  }

  if (adjustmentIndex && effectiveNextAdj) {
    nextAdjustmentIsThisMonth = computedCurrentMonth === effectiveNextAdj;
    if (nextAdjustmentIsThisMonth) {
      nextAdjustmentLabel = `Ajuste este mes (Mes ${computedCurrentMonth})`;
    } else {
      const adjLabel = getPeriodLabel(c.startDate, effectiveNextAdj, sm);
      nextAdjustmentLabel = `${adjLabel} (${adjustmentIndex.name})`;
    }
  }

  // Compute end date from startDate + durationMonths (last day of contract, not first day after)
  const endDate = new Date(start);
  endDate.setMonth(endDate.getMonth() + c.durationMonths);
  endDate.setDate(endDate.getDate() - 1);

  // Remaining months
  const remainingMonths = Math.max(0, endMonth - computedCurrentMonth);

  // Determine status string for frontend
  let status;
  if (!c.active) {
    status = 'TERMINATED';
  } else if (c.rescindedAt) {
    status = 'RESCINDED';
  } else if (now > endDate) {
    status = 'EXPIRED';
  } else {
    status = 'ACTIVE';
  }

  // Is expiring soon (2 months or less remaining)
  const isExpiringSoon = status === 'ACTIVE' && remainingMonths <= 2;

  return {
    ...c,
    contractType: c.contractType || 'INQUILINO',
    currentMonth: computedCurrentMonth,
    nextAdjustmentMonth: effectiveNextAdj,
    endDate,
    status,
    rentAmount: c.baseRent,
    currentPeriodLabel,
    remainingMonths,
    isExpiringSoon,
    nextAdjustmentIsThisMonth,
    nextAdjustmentLabel,
    rescindedAt: c.rescindedAt || null,
    rescissionPenalty: c.rescissionPenalty || null,
  };
};

// GET /api/groups/:groupId/contracts
const getContracts = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { status, propertyId, tenantId, contractType, search, limit, offset } = req.query;

    const where = { groupId };

    if (status === 'ACTIVE') where.active = true;
    else if (status === 'INACTIVE') where.active = false;

    if (contractType) where.contractType = contractType;

    if (propertyId) where.propertyId = propertyId;
    if (tenantId) {
      where.contractTenants = { some: { tenantId } };
    }

    if (search) {
      where.OR = [
        { contractTenants: { some: { tenant: { name: { contains: search, mode: 'insensitive' } } } } },
        { tenant: { is: { name: { contains: search, mode: 'insensitive' } } } },
        { property: { address: { contains: search, mode: 'insensitive' } } },
        { observations: { contains: search, mode: 'insensitive' } },
      ];
    }

    const contracts = await prisma.contract.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, dni: true, phone: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
        property: {
          select: {
            id: true, address: true,
            owner: { select: { id: true, name: true } },
          },
        },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
      },
      orderBy: { startDate: 'desc' },
      take: limit ? parseInt(limit) : 500,
      skip: offset ? parseInt(offset) : 0,
    });

    // Enrich with tenants array
    const enriched = contracts.map((c) => {
      const tenants = c.contractTenants.length > 0
        ? c.contractTenants.map((ct) => ct.tenant)
        : c.tenant ? [c.tenant] : [];
      return { ...enrichContract(c), tenants, ownerName: c.property?.owner?.name || null };
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

    // Filter: remaining months <= 2, ordered by nearest expiration first
    const expiring = contracts
      .map((c) => {
        const tenants = c.contractTenants.length > 0
          ? c.contractTenants.map((ct) => ct.tenant)
          : c.tenant ? [c.tenant] : [];
        return { ...enrichContract(c), tenants };
      })
      .filter((c) => c.isExpiringSoon)
      .sort((a, b) => a.remainingMonths - b.remainingMonths || new Date(a.endDate) - new Date(b.endDate));

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
        tenant: { select: { id: true, name: true, dni: true, phone: true, email: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, phone: true, email: true } } }, orderBy: { isPrimary: 'desc' } },
        property: {
          select: {
            id: true, address: true,
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
      contractType,
      startDate,
      durationMonths,
      currentMonth,
      baseRent,
      adjustmentIndexId,
      punitoryStartDay,
      punitoryPercent,
      pagaIva,
      observations,
      comprobantes,
    } = req.body;

    const resolvedContractType = contractType === 'PROPIETARIO' ? 'PROPIETARIO' : 'INQUILINO';

    if (!propertyId) {
      return ApiResponse.badRequest(res, 'Propiedad es requerida');
    }

    // For INQUILINO, startDate and durationMonths are required
    if (resolvedContractType === 'INQUILINO') {
      if (!startDate || !durationMonths) {
        return ApiResponse.badRequest(
          res,
          'Fecha inicio y duración son requeridos para contratos de inquilino'
        );
      }
      if (!baseRent || parseFloat(baseRent) <= 0) {
        return ApiResponse.badRequest(
          res,
          'Monto de alquiler es requerido para contratos de inquilino'
        );
      }
    }

    // For PROPIETARIO, auto-default startDate and durationMonths
    const resolvedStartDate = startDate || new Date().toISOString().split('T')[0];
    const resolvedDurationMonths = durationMonths ? parseInt(durationMonths, 10) : 120;

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

    // Check no other active contract of the SAME TYPE on this property
    // (allows 1 INQUILINO + 1 PROPIETARIO active simultaneously)
    const activeContract = await prisma.contract.findFirst({
      where: { propertyId, active: true, contractType: resolvedContractType },
    });
    if (activeContract) {
      const typeLabel = resolvedContractType === 'PROPIETARIO' ? 'obligación de propietario' : 'contrato de inquilino';
      return ApiResponse.conflict(
        res,
        `Esta propiedad ya tiene un/a ${typeLabel} activo/a. Finalícelo primero.`
      );
    }

    // Derive startMonth: user provides "current month of contract today",
    // we subtract elapsed months since startDate to get what month the contract
    // was at when it started.  This prevents double-counting in enrichContract().
    const parsedStartDate = parseLocalDate(resolvedStartDate);
    const nowForStart = new Date();
    const elapsedMonths =
      (nowForStart.getFullYear() - parsedStartDate.getFullYear()) * 12 +
      (nowForStart.getMonth() - parsedStartDate.getMonth());
    const userCurrentMonth = currentMonth ? parseInt(currentMonth, 10) : 1;
    const startMonthVal = Math.max(1, userCurrentMonth - elapsedMonths);

    let nextAdjMonth = null;
    if (adjustmentIndexId) {
      const adjIndex = await prisma.adjustmentIndex.findUnique({ where: { id: adjustmentIndexId } });
      if (!adjIndex || adjIndex.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Índice de ajuste invalido');
      }
      const realCurrentMonth = Math.max(startMonthVal, Math.min(startMonthVal + elapsedMonths, startMonthVal + resolvedDurationMonths - 1));

      nextAdjMonth = calculateNextAdjustmentMonth(
        startMonthVal,
        realCurrentMonth,
        adjIndex.frequencyMonths,
        resolvedDurationMonths
      );
    }

    const primaryTenantId = resolvedTenantIds.length > 0 ? resolvedTenantIds[0] : null;
    const resolvedBaseRent = resolvedContractType === 'PROPIETARIO' ? 0 : parseFloat(baseRent);
    const resolvedPagaIva = resolvedContractType === 'PROPIETARIO' ? false : !!pagaIva;

    const contract = await prisma.contract.create({
      data: {
        groupId,
        tenantId: primaryTenantId,
        propertyId,
        contractType: resolvedContractType,
        startDate: parsedStartDate,
        startMonth: startMonthVal,
        durationMonths: resolvedDurationMonths,
        currentMonth: startMonthVal,
        baseRent: resolvedBaseRent,
        adjustmentIndexId: adjustmentIndexId || null,
        nextAdjustmentMonth: nextAdjMonth,
        punitoryStartDay: punitoryStartDay ? parseInt(punitoryStartDay, 10) : 10,
        punitoryPercent: punitoryPercent ? parseFloat(punitoryPercent) : 0.006,
        pagaIva: resolvedPagaIva,
        observations,
        comprobantes: comprobantes || [],
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
        rentAmount: resolvedBaseRent,
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
      pagaIva,
      active,
      observations,
      tenantIds,
      comprobantes,
    } = req.body;

    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    // NOTE: contractType is intentionally not mutable after creation
    const data = {};
    if (startDate) data.startDate = parseLocalDate(startDate);
    if (durationMonths) data.durationMonths = parseInt(durationMonths, 10);

    // Recalculate startMonth when relevant fields change.
    // startMonth represents the contract month corresponding to startDate.
    // For virtually all contracts, startDate IS the real start, so startMonth = 1.
    // The only exception is when creating a mid-way contract (handled in createContract).
    // On edit, we always reset startMonth to 1 because enrichContract() computes
    // the correct display month dynamically from startDate + elapsed time.
    if (startDate || durationMonths || currentMonth) {
      data.startMonth = 1;
      if (currentMonth) {
        data.currentMonth = parseInt(currentMonth, 10);
      }
    }

    if (baseRent) data.baseRent = parseFloat(baseRent);
    if (punitoryStartDay) data.punitoryStartDay = parseInt(punitoryStartDay, 10);
    if (punitoryPercent !== undefined) data.punitoryPercent = parseFloat(punitoryPercent);
    if (pagaIva !== undefined) data.pagaIva = !!pagaIva;
    if (active !== undefined) data.active = active;
    if (observations !== undefined) data.observations = observations;
    if (comprobantes !== undefined) data.comprobantes = comprobantes;

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

    // Recalculate nextAdjustmentMonth when adjustment index changes OR when
    // startDate/durationMonths change (which shift the adjustment schedule)
    const adjIndexChanged = adjustmentIndexId !== undefined;
    const scheduleChanged = startDate || durationMonths || currentMonth;
    const effectiveAdjIndexId = adjIndexChanged ? adjustmentIndexId : contract.adjustmentIndexId;

    if ((adjIndexChanged || scheduleChanged) && effectiveAdjIndexId) {
      if (adjIndexChanged) data.adjustmentIndexId = adjustmentIndexId || null;
      const adjIndex = await prisma.adjustmentIndex.findUnique({ where: { id: effectiveAdjIndexId } });
      if (adjIndex && adjIndex.groupId === groupId) {
        const startM = data.startMonth || contract.startMonth;
        const dur = data.durationMonths || contract.durationMonths;
        const contractStart = new Date(data.startDate || contract.startDate);
        const nowUpdate = new Date();
        const mDiff =
          (nowUpdate.getFullYear() - contractStart.getFullYear()) * 12 +
          (nowUpdate.getMonth() - contractStart.getMonth());
        const realCurrentM = Math.max(startM, Math.min(startM + mDiff, startM + dur - 1));
        data.nextAdjustmentMonth = calculateNextAdjustmentMonth(startM, realCurrentM, adjIndex.frequencyMonths, dur);
      } else if (adjIndexChanged && !adjustmentIndexId) {
        data.adjustmentIndexId = null;
        data.nextAdjustmentMonth = null;
      }
    } else if (adjIndexChanged && !adjustmentIndexId) {
      data.adjustmentIndexId = null;
      data.nextAdjustmentMonth = null;
    }

    // If baseRent changed, create/update a RentHistory entry for the current contract month
    // so that getBatchedRentForMonth() picks up the new value instead of stale history
    if (baseRent && parseFloat(baseRent) !== contract.baseRent) {
      const effectiveStartDate = new Date(data.startDate || contract.startDate);
      const now = new Date();
      const monthsDiff = (now.getFullYear() - effectiveStartDate.getFullYear()) * 12 +
        (now.getMonth() - effectiveStartDate.getMonth());
      const sm = data.startMonth || contract.startMonth || 1;
      const dur = data.durationMonths || contract.durationMonths;
      const endMonth = sm + dur - 1;
      const currentMonthNumber = Math.max(sm, Math.min(sm + monthsDiff, endMonth));

      const existingHistory = await prisma.rentHistory.findFirst({
        where: { contractId: id, effectiveFromMonth: currentMonthNumber },
      });

      if (existingHistory) {
        await prisma.rentHistory.update({
          where: { id: existingHistory.id },
          data: { rentAmount: parseFloat(baseRent), reason: 'AJUSTE_MANUAL' },
        });
      } else {
        await prisma.rentHistory.create({
          data: {
            contractId: id,
            effectiveFromMonth: currentMonthNumber,
            rentAmount: parseFloat(baseRent),
            reason: 'AJUSTE_MANUAL',
          },
        });
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

    // Sincronizar comprobantes con los MonthlyRecords existentes
    if (comprobantes !== undefined) {
      const records = await prisma.monthlyRecord.findMany({
        where: { contractId: id }
      });
      for (const record of records) {
        const currentStatus = Array.isArray(record.comprobantesStatus) ? record.comprobantesStatus : [];
        const statusMap = new Map(currentStatus.map(c => [c.id, c.presented]));
        
        const newStatus = comprobantes.map(c => ({
          ...c,
          presented: statusMap.has(c.id) ? statusMap.get(c.id) : false
        }));

        await prisma.monthlyRecord.update({
          where: { id: record.id },
          data: { comprobantesStatus: newStatus }
        });
      }
    }

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
      where: { propertyId, active: true, contractType: 'INQUILINO' },
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

// GET /api/groups/:groupId/contracts/:id/rescission-preview?rescissionDate=YYYY-MM-DD
const getRescissionPreview = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { rescissionDate } = req.query;

    if (!rescissionDate) {
      return ApiResponse.badRequest(res, 'Se requiere rescissionDate');
    }

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { rentHistory: { orderBy: { effectiveFromMonth: 'desc' } } },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const rescDate = parseLocalDate(rescissionDate);
    const start = new Date(contract.startDate);
    const monthsDiff =
      (rescDate.getFullYear() - start.getFullYear()) * 12 +
      (rescDate.getMonth() - start.getMonth());
    const sm = contract.startMonth || 1;
    const endMonth = sm + contract.durationMonths - 1;
    const rescissionMonthNumber = Math.max(sm, Math.min(sm + monthsDiff, endMonth));

    // Same logic as rescindContract: use last paid record's rentAmount
    let effectiveRent = null;
    const lastPaidRecord = await prisma.monthlyRecord.findFirst({
      where: { contractId: id, status: 'COMPLETE' },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });

    if (lastPaidRecord) {
      effectiveRent = lastPaidRecord.rentAmount;
    } else {
      const fallbackMonth = Math.max(1, rescissionMonthNumber - 1);
      effectiveRent = contract.baseRent;
      for (const rh of contract.rentHistory) {
        if (rh.effectiveFromMonth <= fallbackMonth) {
          effectiveRent = rh.rentAmount;
          break;
        }
      }
    }

    const remainingMonths = Math.max(0, endMonth - rescissionMonthNumber);
    const rescissionPenalty = parseFloat((remainingMonths * effectiveRent * 0.10).toFixed(2));

    return ApiResponse.success(res, { remainingMonths, rent: effectiveRent, penalty: rescissionPenalty });
  } catch (err) {
    next(err);
  }
};

// POST /api/groups/:groupId/contracts/:id/rescind
const rescindContract = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { rescissionDate } = req.body;

    if (!rescissionDate) {
      return ApiResponse.badRequest(res, 'Se requiere la fecha de rescisión');
    }

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { rentHistory: { orderBy: { effectiveFromMonth: 'desc' } } },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    if (!contract.active) {
      return ApiResponse.badRequest(res, 'El contrato ya está inactivo');
    }

    if (contract.rescindedAt) {
      return ApiResponse.badRequest(res, 'El contrato ya está rescindido');
    }

    // Calculate the contract month number at the rescission date
    const rescDate = parseLocalDate(rescissionDate);
    const start = new Date(contract.startDate);
    const monthsDiff =
      (rescDate.getFullYear() - start.getFullYear()) * 12 +
      (rescDate.getMonth() - start.getMonth());
    const sm = contract.startMonth || 1;
    const endMonth = sm + contract.durationMonths - 1;
    const rescissionMonthNumber = Math.max(sm, Math.min(sm + monthsDiff, endMonth));

    // Get rent from last month paid (COMPLETE)
    let effectiveRent = null;
    const lastPaidRecord = await prisma.monthlyRecord.findFirst({
      where: { contractId: id, status: 'COMPLETE' },
      orderBy: [
        { periodYear: 'desc' },
        { periodMonth: 'desc' }
      ]
    });

    if (lastPaidRecord) {
      effectiveRent = lastPaidRecord.rentAmount;
    } else {
      // Fallback: rent at the month BEFORE rescission (last contractual price)
      const fallbackMonth = Math.max(1, rescissionMonthNumber - 1);
      effectiveRent = contract.baseRent;
      for (const rh of contract.rentHistory) {
        if (rh.effectiveFromMonth <= fallbackMonth) {
          effectiveRent = rh.rentAmount;
          break;
        }
      }
    }

    // Penalty = remaining months * rent * 10%
    const remainingMonths = Math.max(0, endMonth - rescissionMonthNumber);
    const rescissionPenalty = parseFloat((remainingMonths * effectiveRent * 0.10).toFixed(2));

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        rescindedAt: rescDate,
        rescissionPenalty,
      },
      include: {
        tenant: { select: { id: true, name: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true, owner: { select: { id: true, name: true } } } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
      },
    });

    return ApiResponse.success(res, enrichContract(updated));
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/contracts/:id/renew
const renewContract = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { startDate, durationMonths, baseRent, adjustmentIndexId, punitoryStartDay, punitoryPercent, pagaIva, observations, comprobantes } = req.body;

    if (!startDate || !durationMonths || baseRent == null || parseFloat(baseRent) <= 0) {
      return ApiResponse.badRequest(res, 'Se requieren fecha de inicio, duración y monto de alquiler');
    }

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { adjustmentIndex: true },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const enriched = enrichContract(contract);
    if (enriched.status !== 'EXPIRED') {
      return ApiResponse.badRequest(res, 'Solo se pueden renovar contratos vencidos');
    }

    // Check no other active contract of the same type on the same property
    const duplicate = await prisma.contract.findFirst({
      where: {
        groupId,
        propertyId: contract.propertyId,
        contractType: contract.contractType,
        active: true,
        id: { not: id },
      },
    });
    if (duplicate) {
      return ApiResponse.badRequest(res, 'Ya existe otro contrato activo del mismo tipo para esta propiedad');
    }

    // Validate adjustment index
    let nextAdjustmentMonth = null;
    if (adjustmentIndexId) {
      const index = await prisma.adjustmentIndex.findUnique({ where: { id: adjustmentIndexId } });
      if (!index || index.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Índice de ajuste no válido');
      }
      nextAdjustmentMonth = calculateNextAdjustmentMonth(1, 1, index.frequencyMonths, parseInt(durationMonths, 10));
    }

    const newStartDate = parseLocalDate(startDate);
    const newBaseRent = parseFloat(baseRent);
    const newDurationMonths = parseInt(durationMonths, 10);

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        startDate: newStartDate,
        startMonth: 1,
        currentMonth: 1,
        durationMonths: newDurationMonths,
        baseRent: newBaseRent,
        adjustmentIndexId: adjustmentIndexId || null,
        nextAdjustmentMonth,
        active: true,
        rescindedAt: null,
        rescissionPenalty: null,
        punitoryStartDay: punitoryStartDay != null ? parseInt(punitoryStartDay, 10) : contract.punitoryStartDay,
        punitoryPercent: punitoryPercent != null ? parseFloat(punitoryPercent) : contract.punitoryPercent,
        pagaIva: pagaIva != null ? pagaIva : contract.pagaIva,
        observations: observations !== undefined ? observations : contract.observations,
        comprobantes: comprobantes !== undefined ? comprobantes : contract.comprobantes,
      },
      include: {
        tenant: { select: { id: true, name: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true, owner: { select: { id: true, name: true } } } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
      },
    });

    await prisma.rentHistory.create({
      data: {
        contractId: id,
        effectiveFromMonth: 1,
        rentAmount: newBaseRent,
        reason: 'RENOVACION',
      },
    });

    return ApiResponse.success(res, enrichContract(updated));
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/contracts/:id/undo-rescind
const undoRescission = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const contract = await prisma.contract.findUnique({ where: { id } });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    if (!contract.rescindedAt) {
      return ApiResponse.badRequest(res, 'El contrato no está rescindido');
    }

    // Remove the penalty month record if it exists and has no payments
    const rescDate = new Date(contract.rescindedAt);
    const penaltyMonth = rescDate.getMonth() === 11 ? 1 : rescDate.getMonth() + 2;
    const penaltyYear = rescDate.getMonth() === 11 ? rescDate.getFullYear() + 1 : rescDate.getFullYear();

    const penaltyRecord = await prisma.monthlyRecord.findFirst({
      where: { contractId: id, periodMonth: penaltyMonth, periodYear: penaltyYear },
      include: { transactions: true },
    });

    if (penaltyRecord && penaltyRecord.transactions.length > 0) {
      return ApiResponse.badRequest(res, 'No se puede deshacer la rescisión: ya hay pagos registrados en el mes de multa');
    }

    if (penaltyRecord) {
      await prisma.monthlyRecord.delete({ where: { id: penaltyRecord.id } });
    }

    const updated = await prisma.contract.update({
      where: { id },
      data: { rescindedAt: null, rescissionPenalty: null },
      include: {
        tenant: { select: { id: true, name: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true, owner: { select: { id: true, name: true } } } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
      },
    });

    return ApiResponse.success(res, enrichContract(updated));
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
  getRescissionPreview,
  rescindContract,
  undoRescission,
  renewContract,
};
