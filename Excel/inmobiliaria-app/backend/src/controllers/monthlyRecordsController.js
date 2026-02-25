// Monthly Records Controller - Phase 5
const ApiResponse = require('../utils/apiResponse');
const {
  getOrCreateMonthlyRecords,
  recalculateMonthlyRecord,
  getMonthlyRecordById,
} = require('../services/monthlyRecordService');
const {
  addService,
  updateService,
  removeService,
  getServicesForRecord,
} = require('../services/monthlyServiceService');

const prisma = require('../lib/prisma');

// GET /api/groups/:groupId/monthly-records?month=2&year=2026
const getMonthlyRecords = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year, status, search, categoryId } = req.query;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'month y year son requeridos');
    }

    let records = await getOrCreateMonthlyRecords(groupId, month, year);

    // Apply filters
    if (status) {
      records = records.filter((r) => r.status === status);
    }
    if (categoryId) {
      records = records.filter((r) => r.property?.category?.id === categoryId);
    }
    if (search) {
      const s = search.toLowerCase();
      records = records.filter(
        (r) =>
          r.tenant?.name?.toLowerCase().includes(s) ||
          r.property?.address?.toLowerCase().includes(s) ||
          r.property?.code?.toLowerCase().includes(s) ||
          r.owner?.name?.toLowerCase().includes(s)
      );
    }

    // Calculate summary
    const debtRecords = records.filter((r) => r.debtInfo && r.debtInfo.status !== 'PAID');
    const summary = {
      total: records.length,
      paid: records.filter((r) => r.status === 'COMPLETE').length,
      partial: records.filter((r) => r.status === 'PARTIAL').length,
      pending: records.filter((r) => r.status === 'PENDING').length,
      totalDue: records.reduce((sum, r) => sum + (r.liveTotalDue != null ? r.liveTotalDue : r.totalDue), 0),
      totalPaid: records.reduce((sum, r) => sum + r.amountPaid, 0),
      // Debt summary
      openDebts: debtRecords.length,
      totalDebtAmount: debtRecords.reduce((sum, r) => sum + (r.debtInfo?.liveCurrentTotal || 0), 0),
      blockedContracts: [...new Set(debtRecords.map((r) => r.contract?.id))].length,
    };

    return ApiResponse.success(res, { records, summary });
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/monthly-records/:id
const getMonthlyRecordDetail = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const record = await getMonthlyRecordById(groupId, id);

    if (!record) {
      return ApiResponse.notFound(res, 'Registro mensual no encontrado');
    }

    return ApiResponse.success(res, record);
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/monthly-records/:id
const updateMonthlyRecord = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { observations, isCancelled } = req.body;

    const existing = await prisma.monthlyRecord.findUnique({ where: { id } });
    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Registro mensual no encontrado');
    }

    const updateData = {};
    if (observations !== undefined) updateData.observations = observations;
    if (isCancelled !== undefined) updateData.isCancelled = isCancelled;

    const record = await prisma.monthlyRecord.update({
      where: { id },
      data: updateData,
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

    return ApiResponse.success(res, record, 'Registro actualizado');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/monthly-records/generate
const forceGenerate = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.body;

    if (!month || !year) {
      return ApiResponse.badRequest(res, 'month y year son requeridos');
    }

    const records = await getOrCreateMonthlyRecords(groupId, month, year);
    return ApiResponse.success(res, { count: records.length, records });
  } catch (error) {
    next(error);
  }
};

// === MONTHLY SERVICES ===

// GET /api/groups/:groupId/monthly-records/:recordId/services
const getRecordServices = async (req, res, next) => {
  try {
    const { groupId, recordId } = req.params;

    const record = await prisma.monthlyRecord.findUnique({ where: { id: recordId } });
    if (!record || record.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Registro no encontrado');
    }

    const services = await getServicesForRecord(recordId);
    return ApiResponse.success(res, services);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/monthly-records/:recordId/services
const addRecordService = async (req, res, next) => {
  try {
    const { groupId, recordId } = req.params;
    const { conceptTypeId, amount, description } = req.body;

    if (!conceptTypeId || amount === undefined) {
      return ApiResponse.badRequest(res, 'conceptTypeId y amount son requeridos');
    }

    const record = await prisma.monthlyRecord.findUnique({ where: { id: recordId } });
    if (!record || record.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Registro no encontrado');
    }

    const service = await addService(recordId, conceptTypeId, parseFloat(amount), description);
    return ApiResponse.created(res, service, 'Servicio agregado');
  } catch (error) {
    if (error.code === 'P2002') {
      return ApiResponse.conflict(res, 'Este servicio ya está asignado a este mes');
    }
    next(error);
  }
};

// PUT /api/groups/:groupId/monthly-records/:recordId/services/:serviceId
const updateRecordService = async (req, res, next) => {
  try {
    const { groupId, serviceId } = req.params;
    const { amount, description } = req.body;

    if (amount === undefined) {
      return ApiResponse.badRequest(res, 'amount es requerido');
    }

    const service = await updateService(serviceId, parseFloat(amount), description);
    return ApiResponse.success(res, service, 'Servicio actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/monthly-records/:recordId/services/:serviceId
const deleteRecordService = async (req, res, next) => {
  try {
    const { serviceId } = req.params;

    const service = await removeService(serviceId);
    if (!service) {
      return ApiResponse.notFound(res, 'Servicio no encontrado');
    }

    return ApiResponse.success(res, null, 'Servicio eliminado');
  } catch (error) {
    next(error);
  }
};

// PATCH /api/groups/:groupId/monthly-records/:recordId/iva
const toggleIva = async (req, res, next) => {
  try {
    const { groupId, recordId } = req.params;
    const { includeIva } = req.body;

    const record = await prisma.monthlyRecord.findUnique({ where: { id: recordId } });
    if (!record || record.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Registro no encontrado');
    }

    const ivaAmount = includeIva ? record.rentAmount * 0.21 : 0;

    await prisma.monthlyRecord.update({
      where: { id: recordId },
      data: { includeIva, ivaAmount },
    });

    const updated = await recalculateMonthlyRecord(recordId);
    return ApiResponse.success(res, updated, 'IVA actualizado');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/monthly-records/batch-services
const batchAddServices = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { conceptTypeId, totalAmount, description, distributions } = req.body;

    if (!conceptTypeId || !totalAmount || !distributions?.length) {
      return ApiResponse.badRequest(res, 'conceptTypeId, totalAmount y distributions son requeridos');
    }

    // Validate all records belong to this group
    const recordIds = distributions.map((d) => d.recordId);
    const records = await prisma.monthlyRecord.findMany({
      where: { id: { in: recordIds }, groupId },
    });
    if (records.length !== recordIds.length) {
      return ApiResponse.badRequest(res, 'Algunos registros no pertenecen a este grupo');
    }

    // Validate amounts sum matches total
    const amountSum = distributions.reduce((s, d) => s + d.amount, 0);
    if (Math.abs(amountSum - totalAmount) > 1) {
      return ApiResponse.badRequest(res, 'La suma de montos no coincide con el total');
    }

    const { batchAddServices: batchAdd } = require('../services/monthlyServiceService');
    const results = await batchAdd(distributions, conceptTypeId, description);
    return ApiResponse.success(res, results, 'Servicios asignados correctamente');
  } catch (error) {
    if (error.code === 'P2002') {
      return ApiResponse.conflict(res, 'Alguna propiedad ya tiene ese servicio asignado este mes');
    }
    next(error);
  }
};

module.exports = {
  getMonthlyRecords,
  getMonthlyRecordDetail,
  updateMonthlyRecord,
  forceGenerate,
  toggleIva,
  getRecordServices,
  addRecordService,
  updateRecordService,
  deleteRecordService,
  batchAddServices,
};
