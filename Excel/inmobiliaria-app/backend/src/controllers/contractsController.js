// Contracts Controller
// Handles: CRUD contracts with adjustment info, punitory fields, currentMonth

const ApiResponse = require('../utils/apiResponse');
const { calculateNextAdjustmentMonth, isAdjustmentMonth, computeCurrentMonth, findOutOfScheduleAdjustments } = require('../services/adjustmentService');

const prisma = require('../lib/prisma');

const asyncHandler = require('../utils/asyncHandler');
const { parseLocalDate } = require('../utils/dateUtils');
const contractService = require('../services/contractService');
const enrichContract = contractService.enrichContract;
const { validateRenewalStartDate } = contractService;
const { repairContractRecordMonthNumbers } = require('../services/monthlyRecordService');
const { sweepSupersededContracts } = require('../services/contractSweepService');

// GET /api/groups/:groupId/contracts
const getContracts = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { status, propertyId, tenantId, contractType, search, limit, offset } = req.query;

    // Cierra las renovaciones anticipadas ya vencidas antes de listar, para que
    // los estados/badges de la grilla estén al día.
    await sweepSupersededContracts(groupId);

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
    const expiring = await contractService.getExpiringContractsOptimized(groupId);
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

    // Verify all tenants belong to group (batch query instead of N+1)
    if (resolvedTenantIds.length > 0) {
      const tenants = await prisma.tenant.findMany({ where: { id: { in: resolvedTenantIds }, groupId } });
      if (tenants.length !== resolvedTenantIds.length) {
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
    // A-13 (AUDITORIA_FUNCIONAL_2026-07-10.md): un contrato rescindido queda
    // active=true para siempre (rescindContract nunca lo desactiva, para no
    // ocultar su historial del filtro de getOrCreateMonthlyRecords). Sin
    // `rescindedAt: null` acá, la propiedad quedaba bloqueada indefinidamente
    // tras una rescisión. Decisión del usuario (2026-07-12): ignorar
    // contratos rescindidos en el chequeo de ocupación, sin tocar `active`.
    const activeContract = await prisma.contract.findFirst({
      where: { propertyId, active: true, rescindedAt: null, contractType: resolvedContractType },
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
    if (durationMonths !== undefined) data.durationMonths = parseInt(durationMonths, 10);

    // Recalculate startMonth when relevant fields change.
    if (startDate || durationMonths !== undefined || currentMonth !== undefined) {
      const effectiveStartDate = new Date(data.startDate || contract.startDate);
      const nowForStart = new Date();
      const elapsedMonths =
        (nowForStart.getFullYear() - effectiveStartDate.getFullYear()) * 12 +
        (nowForStart.getMonth() - effectiveStartDate.getMonth());
      const userCurrentMonth = currentMonth !== undefined ? parseInt(currentMonth, 10) : (contract.currentMonth || 1);

      data.startMonth = Math.max(1, userCurrentMonth - elapsedMonths);
      if (currentMonth !== undefined) {
        data.currentMonth = parseInt(currentMonth, 10);
      }
    }

    if (baseRent !== undefined) data.baseRent = parseFloat(baseRent);
    if (punitoryStartDay !== undefined) data.punitoryStartDay = parseInt(punitoryStartDay, 10);
    if (punitoryPercent !== undefined) data.punitoryPercent = parseFloat(punitoryPercent);
    if (pagaIva !== undefined) data.pagaIva = !!pagaIva;
    if (active !== undefined) data.active = active;
    if (observations !== undefined) data.observations = observations;
    if (comprobantes !== undefined) data.comprobantes = comprobantes;

    // Verify all tenants belong to group (batch query instead of N+1). Read-only
    // validation, kept outside the transaction below.
    if (tenantIds !== undefined && tenantIds.length > 0) {
      const validTenants = await prisma.tenant.findMany({ where: { id: { in: tenantIds }, groupId } });
      if (validTenants.length !== tenantIds.length) {
        return ApiResponse.badRequest(res, 'Inquilino invalido');
      }
    }

    // Detecta si el cronograma (fecha de inicio / duración / mes actual) REALMENTE
    // cambió, comparando contra el valor efectivo actual en vez de la mera presencia
    // del campo en el body. El formulario manda `currentMonth` en TODA edición
    // (incluso al tocar solo el índice de ajuste), así que usar presencia disparaba
    // el remapeo de RentHistory y repairContractRecordMonthNumbers (que borra meses
    // fantasma) en cada guardado, aunque el cronograma no se haya tocado.
    const scheduleChanged =
      (!!startDate && parseLocalDate(startDate).getTime() !== new Date(contract.startDate).getTime()) ||
      (durationMonths !== undefined && parseInt(durationMonths, 10) !== contract.durationMonths) ||
      (currentMonth !== undefined && parseInt(currentMonth, 10) !== computeCurrentMonth(contract));

    // Recalculate nextAdjustmentMonth when adjustment index changes OR when
    // startDate/durationMonths/currentMonth actually change (which shift the
    // adjustment schedule).
    const adjIndexChanged = adjustmentIndexId !== undefined;
    const effectiveAdjIndexId = adjIndexChanged ? adjustmentIndexId : contract.adjustmentIndexId;

    if (adjIndexChanged) data.adjustmentIndexId = adjustmentIndexId || null;

    let adjIndex = null;
    if ((adjIndexChanged || scheduleChanged) && effectiveAdjIndexId) {
      // Validar el índice ANTES de escribir nada: a diferencia de createContract, esta
      // rama no rechazaba un adjustmentIndexId de otro grupo o inexistente (quedaba
      // asignado igual, o Prisma explotaba con FK violation a mitad del update dejando
      // el contrato a medio escribir). Falla rápido con 400, como en createContract.
      adjIndex = await prisma.adjustmentIndex.findUnique({ where: { id: effectiveAdjIndexId } });
      if (!adjIndex || adjIndex.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Índice de ajuste invalido');
      }

      const startM = data.startMonth || contract.startMonth;
      const dur = data.durationMonths || contract.durationMonths;
      const contractStart = new Date(data.startDate || contract.startDate);
      const nowUpdate = new Date();
      const mDiff =
        (nowUpdate.getFullYear() - contractStart.getFullYear()) * 12 +
        (nowUpdate.getMonth() - contractStart.getMonth());
      const realCurrentM = Math.max(startM, Math.min(startM + mDiff, startM + dur - 1));

      // Si el mes actual YA es mes de ajuste bajo el índice (nuevo o vigente) y todavía
      // no se aplicó un AJUSTE_AUTOMATICO para ese mes, el próximo ajuste es ESE mes,
      // no el siguiente. calculateNextAdjustmentMonth por diseño salta al período
      // siguiente cuando currentMonth ya es un múltiplo (asume que ya fue aplicado),
      // lo cual está mal recién editado el índice: la pantalla de Ajustes usa
      // nextAdjustmentMonth como fuente de verdad (getContractsWithAdjustmentThisMonth)
      // y el contrato desaparecía de "este mes" hasta el período siguiente.
      if (isAdjustmentMonth(startM, realCurrentM, adjIndex.frequencyMonths)) {
        const alreadyApplied = await prisma.rentHistory.findFirst({
          where: { contractId: id, effectiveFromMonth: realCurrentM, reason: 'AJUSTE_AUTOMATICO' },
          select: { id: true },
        });
        if (!alreadyApplied) {
          data.nextAdjustmentMonth = realCurrentM;
        } else {
          data.nextAdjustmentMonth = calculateNextAdjustmentMonth(startM, realCurrentM, adjIndex.frequencyMonths, dur);
        }
      } else {
        data.nextAdjustmentMonth = calculateNextAdjustmentMonth(startM, realCurrentM, adjIndex.frequencyMonths, dur);
      }
    } else if (adjIndexChanged && !adjustmentIndexId) {
      data.nextAdjustmentMonth = null;
    }

    // Si el usuario cambió el índice de ajuste (a otro, o lo quitó), avisar si el
    // índice ANTERIOR ya había aplicado ajustes automáticos: esos montos quedan
    // calculados con la frecuencia/valor viejos y no se revierten solos (misma
    // política que repairWarning más abajo: nunca mover plata sin avisar).
    let previousIndexWarning = null;
    if (adjIndexChanged && (adjustmentIndexId || null) !== contract.adjustmentIndexId && contract.adjustmentIndexId) {
      const priorAdjustments = await prisma.rentHistory.findMany({
        where: { contractId: id, reason: 'AJUSTE_AUTOMATICO' },
        select: { id: true, effectiveFromMonth: true, rentAmount: true, adjustmentPercent: true },
        orderBy: { effectiveFromMonth: 'asc' },
      });
      if (priorAdjustments.length > 0) {
        // Caso Ciuro (2026-08-10): de esos ajustes, los que ya NO encajan en el
        // cronograma del índice nuevo son los peligrosos — inflan el alquiler desde
        // su mes en adelante y contaminan la base del próximo ajuste. Y no se pueden
        // deshacer desde Ajustes, que filtra por `isAdjustmentMonth`. Se ofrecen para
        // limpiar (nunca se borran solos: ver POST /:id/cleanup-adjustments).
        const outOfSchedule = adjIndex
          ? await findOutOfScheduleAdjustments({
              id,
              startDate: data.startDate || contract.startDate,
              startMonth: data.startMonth || contract.startMonth,
              adjustmentIndex: { frequencyMonths: adjIndex.frequencyMonths },
            })
          : [];
        previousIndexWarning = {
          code: 'ADJUSTMENTS_FROM_PREVIOUS_INDEX',
          message: outOfSchedule.length > 0
            ? `Este contrato tenía ${outOfSchedule.length} ajuste(s) del índice anterior que no encajan en el cronograma del índice nuevo. Mientras sigan ahí, inflan el alquiler desde ese mes en adelante y el próximo ajuste parte de ese valor.`
            : `Este contrato ya tenía ${priorAdjustments.length} ajuste(s) automático(s) aplicado(s) con el índice anterior. No se revirtieron: los montos quedan calculados con el valor viejo.`,
          records: priorAdjustments,
          outOfSchedule: outOfSchedule.map((h) => ({
            id: h.id,
            effectiveFromMonth: h.effectiveFromMonth,
            calendarMonth: h.calendarMonth,
            calendarYear: h.calendarYear,
            rentAmount: h.rentAmount,
            adjustmentPercent: h.adjustmentPercent,
          })),
          canCleanup: outOfSchedule.length > 0,
        };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Handle tenantIds update
      if (tenantIds !== undefined) {
        data.tenantId = tenantIds.length > 0 ? tenantIds[0] : null;
        await tx.contractTenant.deleteMany({ where: { contractId: id } });
        if (tenantIds.length > 0) {
          await tx.contractTenant.createMany({
            data: tenantIds.map((tid, i) => ({
              contractId: id,
              tenantId: tid,
              isPrimary: i === 0,
            })),
          });
        }
      }

      // Si cambió el cronograma (startMonth se resetea a 1), REMAPEAR el historial de
      // alquileres a la numeración nueva. Sin esto, las filas quedan huérfanas (p.ej.
      // effectiveFromMonth=36 con startMonth nuevo=1) y los meses del contrato caen en
      // el fallback de baseRent → un ajuste posterior reescribe el alquiler de meses
      // pasados (caso Rezzonico).
      if (scheduleChanged && data.startMonth !== undefined) {
        const oldSm = contract.startMonth || 1;
        const newSm = data.startMonth;
        const oldStart = new Date(contract.startDate);
        const newStart = new Date(data.startDate || contract.startDate);
        const histories = await tx.rentHistory.findMany({ where: { contractId: id } });
        for (const h of histories) {
          // Mes calendario que representaba la fila con la numeración vieja
          const cal = new Date(oldStart.getFullYear(), oldStart.getMonth() + (h.effectiveFromMonth - oldSm), 1);
          const diff = (cal.getFullYear() - newStart.getFullYear()) * 12 + (cal.getMonth() - newStart.getMonth());
          // Antes del inicio nuevo → rige desde el inicio (alquiler más viejo conocido)
          const newEff = Math.max(newSm, newSm + diff);
          if (newEff !== h.effectiveFromMonth) {
            await tx.rentHistory.update({ where: { id: h.id }, data: { effectiveFromMonth: newEff } });
          }
        }
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

        // Baseline: si ningún historial cubre los meses ANTERIORES al cambio, crear la
        // fila INICIAL con el alquiler VIEJO para que esos meses no hereden el nuevo.
        if (currentMonthNumber > sm) {
          const coversBefore = await tx.rentHistory.findFirst({
            where: { contractId: id, effectiveFromMonth: { lt: currentMonthNumber } },
            select: { id: true },
          });
          if (!coversBefore) {
            await tx.rentHistory.create({
              data: {
                contractId: id,
                effectiveFromMonth: sm,
                rentAmount: contract.baseRent,
                reason: 'INICIAL',
              },
            });
          }
        }

        const existingHistory = await tx.rentHistory.findFirst({
          where: { contractId: id, effectiveFromMonth: currentMonthNumber },
        });

        if (existingHistory) {
          await tx.rentHistory.update({
            where: { id: existingHistory.id },
            data: { rentAmount: parseFloat(baseRent), reason: 'AJUSTE_MANUAL' },
          });
        } else {
          await tx.rentHistory.create({
            data: {
              contractId: id,
              effectiveFromMonth: currentMonthNumber,
              rentAmount: parseFloat(baseRent),
              reason: 'AJUSTE_MANUAL',
            },
          });
        }
      }

      const updatedContract = await tx.contract.update({
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
        const records = await tx.monthlyRecord.findMany({
          where: { contractId: id },
          select: { id: true, comprobantesStatus: true },
        });
        for (const record of records) {
          const currentStatus = Array.isArray(record.comprobantesStatus) ? record.comprobantesStatus : [];
          const statusMap = new Map(currentStatus.map(c => [c.id, c.presented]));
          const newStatus = comprobantes.map(c => ({
            ...c,
            presented: statusMap.has(c.id) ? statusMap.get(c.id) : false,
          }));
          await tx.monthlyRecord.update({
            where: { id: record.id },
            data: { comprobantesStatus: newStatus },
          });
        }
      }

      // Si cambió el cronograma (fecha de inicio / duración / mes actual), reparar los
      // monthNumber de los records existentes para que sigan dentro del rango nuevo,
      // DENTRO de la misma transacción: si esto falla, no debe quedar el contrato ya
      // actualizado con records huérfanos a mitad de reparar.
      // Esto evita los "meses fantasma" (Problema A/B): corrige numeraciones desfasadas,
      // borra meses fuera de rango sin plata y preserva los que tienen pagos (avisando).
      let repair = { paidOrphans: [] };
      if (scheduleChanged) {
        repair = await repairContractRecordMonthNumbers(updatedContract, { deletePhantoms: true, client: tx });
      }

      return { updatedContract, repair };
    });
    const { updatedContract: updated, repair } = result;

    let repairWarning = null;
    if (repair.paidOrphans.length > 0) {
      repairWarning = {
        code: 'PAID_RECORDS_OUT_OF_RANGE',
        message: `Quedaron ${repair.paidOrphans.length} mes(es) con pagos fuera del rango del contrato tras editar la fecha/duración. Revisalos para reconciliarlos (no se movió dinero automáticamente).`,
        records: repair.paidOrphans,
      };
    }

    const tenants = updated.contractTenants.length > 0
      ? updated.contractTenants.map((ct) => ct.tenant)
      : updated.tenant ? [updated.tenant] : [];

    const payload = { ...enrichContract(updated), tenants };
    const warnings = [repairWarning, previousIndexWarning].filter(Boolean);
    if (warnings.length > 0) payload.warnings = warnings;
    return ApiResponse.success(res, payload, 'Contrato actualizado');
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
        // A-12 (AUDITORIA_FUNCIONAL_2026-07-10.md): antes solo se bloqueaba con
        // deudas OPEN/PARTIAL; el `contract.delete` en cascada (schema.prisma:
        // MonthlyRecord/PaymentTransaction/Payment/Debt/DebtPayment/RentHistory)
        // borraba irreversiblemente historial de pagos y comprobantes ya
        // entregados. Decisión del usuario (2026-07-12): bloquear el borrado si
        // existe CUALQUIER historial financiero, o si el contrato es eslabón de
        // una cadena de renovación (renewedFromContractId es onDelete: SetNull,
        // así que borrar un contrato intermedio corta la cadena para expandToChain).
        debts: { select: { id: true, status: true } },
        monthlyRecords: { select: { id: true, amountPaid: true } },
        renewedFrom: { select: { id: true } },
        renewedTo: { select: { id: true } },
        tenant: { select: { name: true } },
        contractTenants: { include: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { address: true } },
      },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    if (contract.debts.length > 0) {
      return ApiResponse.badRequest(
        res,
        `No se puede eliminar: el contrato tiene ${contract.debts.length} deuda(s) registrada(s) (pagadas o abiertas). Ese historial no puede borrarse.`
      );
    }

    const paidRecords = contract.monthlyRecords.filter((r) => (r.amountPaid || 0) > 0);
    if (paidRecords.length > 0) {
      return ApiResponse.badRequest(
        res,
        `No se puede eliminar: el contrato tiene ${paidRecords.length} mes(es) con pagos registrados. Ese historial no puede borrarse.`
      );
    }

    if (contract.renewedFrom || contract.renewedTo) {
      return ApiResponse.badRequest(
        res,
        'No se puede eliminar: el contrato forma parte de una cadena de renovaciones. Borrarlo rompería el vínculo con el contrato anterior/siguiente.'
      );
    }

    const tenantName = contract.contractTenants.length > 0
      ? contract.contractTenants.map((ct) => ct.tenant.name).join(' / ')
      : contract.tenant?.name || 'Sin inquilino';

    // A esta altura el contrato está financieramente vacío: sin deudas, sin meses
    // pagados, sin renovaciones. El cascade solo borra registros mensuales vacíos.
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

    // A-13: ver comentario equivalente en createContract — ignorar rescindidos.
    const activeContract = await prisma.contract.findFirst({
      where: { propertyId, active: true, rescindedAt: null, contractType: 'INQUILINO' },
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

/** Shared: resolve effectiveRent for a contract at rescission time */
async function resolveEffectiveRent(contract, rescissionMonthNumber) {
  const lastPaidRecord = await prisma.monthlyRecord.findFirst({
    where: { contractId: contract.id, status: 'COMPLETE' },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
  });
  if (lastPaidRecord) return lastPaidRecord.rentAmount;

  const fallbackMonth = Math.max(1, rescissionMonthNumber - 1);
  let rent = contract.baseRent;
  for (const rh of contract.rentHistory) {
    if (rh.effectiveFromMonth <= fallbackMonth) { rent = rh.rentAmount; break; }
  }
  return rent;
}

/** Shared: calculate penalty amount given type, remainingMonths and rent */
function calcPenalty(penaltyType, remainingMonths, effectiveRent) {
  if (penaltyType === 'ULTIMO_ALQUILER') {
    return parseFloat(effectiveRent.toFixed(2));
  }
  // Default: PORCENTAJE (10% × meses restantes × alquiler)
  return parseFloat((remainingMonths * effectiveRent * 0.10).toFixed(2));
}

// GET /api/groups/:groupId/contracts/:id/rescission-preview?rescissionDate=YYYY-MM-DD&penaltyType=PORCENTAJE|ULTIMO_ALQUILER
const getRescissionPreview = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { rescissionDate, penaltyType = 'PORCENTAJE' } = req.query;

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

    const effectiveRent = await resolveEffectiveRent(contract, rescissionMonthNumber);
    const remainingMonths = Math.max(0, endMonth - rescissionMonthNumber);
    const rescissionPenalty = calcPenalty(penaltyType, remainingMonths, effectiveRent);

    return ApiResponse.success(res, { remainingMonths, rent: effectiveRent, penalty: rescissionPenalty, penaltyType });
  } catch (err) {
    next(err);
  }
};

// POST /api/groups/:groupId/contracts/:id/rescind
const rescindContract = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { rescissionDate, penaltyType = 'PORCENTAJE' } = req.body;

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

    // El mes de multa cae en rescissionMonth + 1, que en una renovación
    // anticipada choca con el mes 1 del contrato nuevo (dos filas para la misma
    // propiedad en un período). Hay que cancelar la renovación primero.
    if (contract.renewedAt) {
      return ApiResponse.badRequest(
        res,
        'Este contrato tiene una renovación programada. Cancelá la renovación antes de rescindirlo.'
      );
    }

    const rescDate = parseLocalDate(rescissionDate);
    const start = new Date(contract.startDate);
    const monthsDiff =
      (rescDate.getFullYear() - start.getFullYear()) * 12 +
      (rescDate.getMonth() - start.getMonth());
    const sm = contract.startMonth || 1;
    const endMonth = sm + contract.durationMonths - 1;
    const rescissionMonthNumber = Math.max(sm, Math.min(sm + monthsDiff, endMonth));

    const effectiveRent = await resolveEffectiveRent(contract, rescissionMonthNumber);
    const remainingMonths = Math.max(0, endMonth - rescissionMonthNumber);
    const rescissionPenalty = calcPenalty(penaltyType, remainingMonths, effectiveRent);

    // Check if the penalty month record already has payments
    let penaltyMonth = rescDate.getMonth() + 2;
    let penaltyYear = rescDate.getFullYear();
    if (penaltyMonth > 12) { penaltyMonth = 1; penaltyYear++; }
    const penaltyRecord = await prisma.monthlyRecord.findFirst({
      where: { contractId: id, periodMonth: penaltyMonth, periodYear: penaltyYear },
      include: { transactions: { select: { id: true } } },
    });
    if (penaltyRecord && penaltyRecord.transactions.length > 0) {
      return ApiResponse.badRequest(res, 'Ya existen pagos registrados para el mes posterior a la rescisión. No se puede rescindir el contrato.');
    }

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
// Renovar = crear un nuevo Contract vinculado al viejo. El viejo NO se borra:
// queda active=false con renewedAt, conserva sus MonthlyRecord/Debt/Payment.
// El nuevo arranca con startMonth=1 y baseRent nuevo.
const renewContract = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { startDate, durationMonths, baseRent, adjustmentIndexId, punitoryStartDay, punitoryPercent, pagaIva, observations, comprobantes } = req.body;

    if (!startDate || !durationMonths || baseRent == null || parseFloat(baseRent) <= 0) {
      return ApiResponse.badRequest(res, 'Se requieren fecha de inicio, duración y monto de alquiler');
    }

    const oldContract = await prisma.contract.findUnique({
      where: { id },
      include: { adjustmentIndex: true, contractTenants: true },
    });

    if (!oldContract || oldContract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const enriched = enrichContract(oldContract);

    if (oldContract.renewedAt) {
      return ApiResponse.badRequest(res, 'Este contrato ya fue renovado');
    }

    // Renovación anticipada: el contrato sigue vigente pero está "por vencer"
    // (2 meses o menos). El nuevo queda programado y el viejo sigue operando
    // sus meses restantes.
    const isEarly = enriched.status === 'ACTIVE' && enriched.isExpiringSoon;
    if (enriched.status !== 'EXPIRED' && !isEarly) {
      return ApiResponse.badRequest(
        res,
        'Solo se pueden renovar contratos vencidos o próximos a vencer (2 meses o menos)'
      );
    }

    // Check no other active contract of the same type on the same property
    // A-13: ver comentario equivalente en createContract — ignorar rescindidos.
    const duplicate = await prisma.contract.findFirst({
      where: {
        groupId,
        propertyId: oldContract.propertyId,
        contractType: oldContract.contractType,
        active: true,
        rescindedAt: null,
        // Un contrato con renewedAt ya tiene sucesor: es el viejo de otra
        // renovación anticipada, no una ocupación en disputa.
        renewedAt: null,
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

    // El nuevo contrato NO puede solaparse con el viejo: si se solaparan,
    // Control Mensual mostraría dos filas de la misma propiedad en el mismo
    // período. En la renovación anticipada además exigimos que arranque en el
    // mes siguiente al vencimiento, para no dejar meses en blanco.
    const dateCheck = validateRenewalStartDate(oldContract, newStartDate, { strictAdjacency: isEarly });
    if (!dateCheck.ok) {
      return ApiResponse.badRequest(res, dateCheck.message);
    }

    const newBaseRent = parseFloat(baseRent);
    const newDurationMonths = parseInt(durationMonths, 10);
    const renewedAt = new Date();

    const newContract = await prisma.$transaction(async (tx) => {
      // 1. Marcar el contrato viejo como renovado. Conserva intactos
      //    startDate/startMonth/durationMonths para que sus MonthlyRecord sigan
      //    siendo válidos dentro de su propio rango.
      //
      //    Renovación anticipada (isEarly): NO se desactiva. El contrato viejo
      //    sigue operativo hasta su vencimiento (Control Mensual, servicios,
      //    cobros, cierre de mes, ajuste por índice, punitorios); `renewedAt`
      //    solo lo marca como ya sucedido. contractSweepService lo desactiva
      //    cuando su rango termina.
      await tx.contract.update({
        where: { id },
        data: isEarly ? { renewedAt } : { active: false, renewedAt },
      });

      // 2. Crear el contrato nuevo
      const created = await tx.contract.create({
        data: {
          groupId,
          propertyId: oldContract.propertyId,
          tenantId: oldContract.tenantId,
          contractType: oldContract.contractType,
          startDate: newStartDate,
          startMonth: 1,
          currentMonth: 1,
          durationMonths: newDurationMonths,
          baseRent: newBaseRent,
          adjustmentIndexId: adjustmentIndexId || null,
          nextAdjustmentMonth,
          active: true,
          punitoryStartDay: punitoryStartDay != null ? parseInt(punitoryStartDay, 10) : oldContract.punitoryStartDay,
          punitoryGraceDay: oldContract.punitoryGraceDay,
          punitoryPercent: punitoryPercent != null ? parseFloat(punitoryPercent) : oldContract.punitoryPercent,
          pagaIva: pagaIva != null ? pagaIva : oldContract.pagaIva,
          observations: observations !== undefined ? observations : oldContract.observations,
          comprobantes: comprobantes !== undefined ? comprobantes : oldContract.comprobantes,
          renewedFromContractId: id,
        },
      });

      // 3. Clonar ContractTenants al nuevo contrato (preserva co-inquilinos)
      const oldTenants = await tx.contractTenant.findMany({
        where: { contractId: id },
        select: { tenantId: true, isPrimary: true },
      });
      if (oldTenants.length > 0) {
        await tx.contractTenant.createMany({
          data: oldTenants.map((ct) => ({
            contractId: created.id,
            tenantId: ct.tenantId,
            isPrimary: ct.isPrimary,
          })),
        });
      }

      // 4. RentHistory inicial del nuevo contrato (el viejo conserva el suyo)
      await tx.rentHistory.create({
        data: {
          contractId: created.id,
          effectiveFromMonth: 1,
          rentAmount: newBaseRent,
          reason: 'RENOVACION',
        },
      });

      return created;
    });

    // Refetch con includes completos para enrichContract
    const fullNew = await prisma.contract.findUnique({
      where: { id: newContract.id },
      include: {
        tenant: { select: { id: true, name: true } },
        contractTenants: { include: { tenant: { select: { id: true, name: true } } }, orderBy: { isPrimary: 'desc' } },
        property: { select: { id: true, address: true, owner: { select: { id: true, name: true } } } },
        adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
      },
    });

    return ApiResponse.success(res, enrichContract(fullNew));
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

// POST /api/groups/:groupId/contracts/:id/undo-renew
// Cancela una renovación PROGRAMADA: borra el contrato nuevo y le saca la marca
// de renovado al viejo. `:id` es el contrato VIEJO (el que tiene renewedAt).
//
// Existe porque la renovación anticipada se hace con meses de anticipación (más
// margen para un error de fecha o monto) y deleteContract bloquea el borrado de
// cualquier eslabón de una cadena de renovaciones: sin esto no habría salida.
const undoRenewal = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const oldContract = await prisma.contract.findUnique({ where: { id } });

    if (!oldContract || oldContract.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const newContract = await prisma.contract.findFirst({
      where: { renewedFromContractId: id },
    });

    if (!oldContract.renewedAt || !newContract) {
      return ApiResponse.badRequest(res, 'Este contrato no tiene una renovación para cancelar');
    }

    // Mismos resguardos que deleteContract: no se borra nada con historial
    // financiero.
    const debts = await prisma.debt.count({ where: { contractId: newContract.id } });
    if (debts > 0) {
      return ApiResponse.badRequest(
        res,
        'No se puede cancelar la renovación: el contrato nuevo ya tiene deudas registradas'
      );
    }

    const records = await prisma.monthlyRecord.findMany({
      where: { contractId: newContract.id },
      select: { id: true, amountPaid: true },
    });

    const paidRecords = records.filter((r) => (r.amountPaid || 0) > 0);
    if (paidRecords.length > 0) {
      return ApiResponse.badRequest(
        res,
        `No se puede cancelar la renovación: el contrato nuevo ya tiene ${paidRecords.length} mes(es) con pagos registrados`
      );
    }

    if (records.length > 0) {
      const transactions = await prisma.paymentTransaction.count({
        where: { monthlyRecordId: { in: records.map((r) => r.id) } },
      });
      if (transactions > 0) {
        return ApiResponse.badRequest(
          res,
          'No se puede cancelar la renovación: el contrato nuevo ya tiene pagos registrados'
        );
      }
    }

    const restored = await prisma.$transaction(async (tx) => {
      // El cascade borra RentHistory, ContractTenant y los MonthlyRecord vacíos.
      await tx.contract.delete({ where: { id: newContract.id } });
      return tx.contract.update({
        where: { id },
        // active: true porque si el sweep ya lo había desactivado (o fue una
        // renovación post-vencimiento) tiene que volver a quedar operativo.
        data: { renewedAt: null, active: true },
        include: {
          tenant: { select: { id: true, name: true } },
          contractTenants: { include: { tenant: { select: { id: true, name: true } } }, orderBy: { isPrimary: 'desc' } },
          property: { select: { id: true, address: true, owner: { select: { id: true, name: true } } } },
          adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
        },
      });
    });

    return ApiResponse.success(res, enrichContract(restored), 'Renovación cancelada');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/contracts/:id/cleanup-adjustments
// Limpia los AJUSTE_AUTOMATICO que quedaron fuera del cronograma vigente (los que
// dejó un índice anterior de otra frecuencia). Se dispara SOLO cuando el usuario
// confirma el aviso ADJUSTMENTS_FROM_PREVIOUS_INDEX de updateContract — nunca solo.
const cleanupContractAdjustments = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const contract = await prisma.contract.findFirst({ where: { id, groupId }, select: { id: true } });
    if (!contract) {
      return ApiResponse.notFound(res, 'Contrato no encontrado');
    }

    const result = await contractService.cleanupOutOfScheduleAdjustments(groupId, id);

    const message = result.deleted.length > 0
      ? `Se limpiaron ${result.deleted.length} ajuste(s) fuera de cronograma`
      : result.skipped.length > 0
        ? result.skipped[0].reason
        : 'No había ajustes fuera de cronograma';
    return ApiResponse.success(res, result, message);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getContracts: asyncHandler(getContracts),
  getExpiringContracts: asyncHandler(getExpiringContracts),
  getContractAdjustments: asyncHandler(getContractAdjustments),
  getContractById: asyncHandler(getContractById),
  createContract: asyncHandler(createContract),
  updateContract: asyncHandler(updateContract),
  deleteContract: asyncHandler(deleteContract),
  assignTenantToProperty: asyncHandler(assignTenantToProperty),
  getContractRentHistory: asyncHandler(getContractRentHistory),
  getRescissionPreview: asyncHandler(getRescissionPreview),
  rescindContract: asyncHandler(rescindContract),
  undoRescission: asyncHandler(undoRescission),
  renewContract: asyncHandler(renewContract),
  undoRenewal: asyncHandler(undoRenewal),
  cleanupContractAdjustments: asyncHandler(cleanupContractAdjustments),
};
