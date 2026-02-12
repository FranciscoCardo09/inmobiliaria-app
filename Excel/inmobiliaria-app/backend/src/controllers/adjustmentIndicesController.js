// AdjustmentIndices Controller
// Handles: CRUD adjustment indices per group

const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/adjustment-indices
const getIndices = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const indices = await prisma.adjustmentIndex.findMany({
      where: { groupId },
      include: {
        _count: { select: { contracts: true } },
      },
      orderBy: { name: 'asc' },
    });

    return ApiResponse.success(res, indices);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/adjustment-indices/:id
const getIndexById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const index = await prisma.adjustmentIndex.findUnique({
      where: { id },
      include: {
        contracts: {
          where: { active: true },
          select: {
            id: true,
            currentMonth: true,
            durationMonths: true,
            nextAdjustmentMonth: true,
            tenant: { select: { name: true } },
            property: { select: { address: true } },
          },
        },
      },
    });

    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    return ApiResponse.success(res, index);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustment-indices
const createIndex = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, frequencyMonths, currentValue } = req.body;

    if (!name || !frequencyMonths) {
      return ApiResponse.badRequest(res, 'Nombre y frecuencia son requeridos');
    }

    const freq = parseInt(frequencyMonths, 10);
    if (![1, 2, 3, 4, 6, 12].includes(freq)) {
      return ApiResponse.badRequest(res, 'Frecuencia debe ser 1, 2, 3, 4, 6 o 12 meses');
    }

    const existing = await prisma.adjustmentIndex.findUnique({
      where: { groupId_name: { groupId, name } },
    });

    if (existing) {
      return ApiResponse.conflict(res, 'Ya existe un índice con ese nombre en este grupo');
    }

    const index = await prisma.adjustmentIndex.create({
      data: {
        groupId,
        name,
        frequencyMonths: freq,
        currentValue: currentValue ? parseFloat(currentValue) : 0,
      },
      include: { _count: { select: { contracts: true } } },
    });

    return ApiResponse.created(res, index, 'Índice de ajuste creado');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/adjustment-indices/:id
const updateIndex = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { name, frequencyMonths, currentValue } = req.body;

    const index = await prisma.adjustmentIndex.findUnique({ where: { id } });
    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    if (name && name !== index.name) {
      const existing = await prisma.adjustmentIndex.findUnique({
        where: { groupId_name: { groupId, name } },
      });
      if (existing) {
        return ApiResponse.conflict(res, 'Ya existe un índice con ese nombre');
      }
    }

    const data = {};
    if (name) data.name = name;
    if (frequencyMonths) {
      const freq = parseInt(frequencyMonths, 10);
      if (![1, 2, 3, 4, 6, 12].includes(freq)) {
        return ApiResponse.badRequest(res, 'Frecuencia debe ser 1, 2, 3, 4, 6 o 12 meses');
      }
      data.frequencyMonths = freq;
    }
    if (currentValue !== undefined) {
      data.currentValue = parseFloat(currentValue);
      data.lastUpdated = new Date();
    }

    const updated = await prisma.adjustmentIndex.update({
      where: { id },
      data,
      include: { _count: { select: { contracts: true } } },
    });

    return ApiResponse.success(res, updated, 'Índice actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/adjustment-indices/:id
const deleteIndex = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const index = await prisma.adjustmentIndex.findUnique({
      where: { id },
      include: { _count: { select: { contracts: true } } },
    });

    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice no encontrado');
    }

    if (index._count.contracts > 0) {
      return ApiResponse.badRequest(
        res,
        'No se puede eliminar un índice con contratos asociados'
      );
    }

    await prisma.adjustmentIndex.delete({ where: { id } });
    return ApiResponse.success(res, null, 'Índice eliminado');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustment-indices/:id/apply
// Apply adjustment to all contracts with this index that adjust next month
const applyAdjustment = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { percentageIncrease } = req.body;

    if (percentageIncrease === undefined || percentageIncrease === null) {
      return ApiResponse.badRequest(res, 'Porcentaje de aumento es requerido');
    }

    const index = await prisma.adjustmentIndex.findUnique({ where: { id } });
    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    const percentage = parseFloat(percentageIncrease);

    // Update the index currentValue
    await prisma.adjustmentIndex.update({
      where: { id },
      data: {
        currentValue: percentage,
        lastUpdated: new Date(),
      },
    });

    // Apply to contracts
    const { applyAdjustmentToNextMonthContracts } = require('../services/adjustmentService');
    const results = await applyAdjustmentToNextMonthContracts(groupId, id, percentage);

    return ApiResponse.success(
      res,
      {
        index: {
          id: index.id,
          name: index.name,
          currentValue: percentage,
        },
        contractsAdjusted: results.length,
        details: results,
      },
      `Ajuste del ${percentage}% aplicado a ${results.length} contrato(s)`
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustments/apply-all-next-month
const applyAllNextMonth = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { applyAllNextMonthAdjustments } = require('../services/adjustmentService');

    const results = await applyAllNextMonthAdjustments(groupId);

    const totalContracts = results.reduce((sum, r) => sum + r.contractsAdjusted, 0);

    return ApiResponse.success(
      res,
      {
        indicesApplied: results.length,
        totalContractsAdjusted: totalContracts,
        details: results,
      },
      `${results.length} indice(s) aplicado(s) a ${totalContracts} contrato(s)`
    );
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/adjustments/contracts-by-month/:targetMonth
const getContractsByMonth = async (req, res, next) => {
  try {
    const { groupId, targetMonth } = req.params;
    const month = parseInt(targetMonth, 10);

    if (isNaN(month) || month < 1) {
      return ApiResponse.badRequest(res, 'Mes inválido');
    }

    const { getContractsWithAdjustmentInMonth } = require('../services/adjustmentService');
    const contracts = await getContractsWithAdjustmentInMonth(groupId, month);

    return ApiResponse.success(res, contracts);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/adjustments/contracts-by-calendar
const getContractsByCalendar = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { month, year } = req.query;
    
    const calendarMonth = parseInt(month, 10);
    const calendarYear = parseInt(year, 10);

    if (isNaN(calendarMonth) || calendarMonth < 1 || calendarMonth > 12) {
      return ApiResponse.badRequest(res, 'Mes inválido');
    }
    
    if (isNaN(calendarYear)) {
      return ApiResponse.badRequest(res, 'Año inválido');
    }

    const { getContractsWithAdjustmentInCalendar } = require('../services/adjustmentService');
    const contracts = await getContractsWithAdjustmentInCalendar(groupId, calendarMonth, calendarYear);

    return ApiResponse.success(res, contracts);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustment-indices/:id/apply-to-month
const applyAdjustmentToMonth = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { percentageIncrease, targetMonth } = req.body;

    if (percentageIncrease === undefined || percentageIncrease === null) {
      return ApiResponse.badRequest(res, 'Porcentaje de aumento es requerido');
    }

    if (!targetMonth || isNaN(parseInt(targetMonth, 10))) {
      return ApiResponse.badRequest(res, 'Mes objetivo es requerido');
    }

    const index = await prisma.adjustmentIndex.findUnique({ where: { id } });
    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    const percentage = parseFloat(percentageIncrease);
    const month = parseInt(targetMonth, 10);

    // Update the index currentValue
    await prisma.adjustmentIndex.update({
      where: { id },
      data: {
        currentValue: percentage,
        lastUpdated: new Date(),
      },
    });

    // Apply to contracts for specific month
    const { applyAdjustmentToSpecificMonth } = require('../services/adjustmentService');
    const results = await applyAdjustmentToSpecificMonth(groupId, id, percentage, month);

    return ApiResponse.success(
      res,
      {
        index: {
          id: index.id,
          name: index.name,
          currentValue: percentage,
        },
        targetMonth: month,
        contractsAdjusted: results.length,
        details: results,
      },
      `Ajuste del ${percentage}% aplicado a ${results.length} contrato(s) para el mes ${month}`
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustment-indices/:id/undo-month
const undoAdjustmentForMonth = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { targetMonth } = req.body;

    if (!targetMonth || isNaN(parseInt(targetMonth, 10))) {
      return ApiResponse.badRequest(res, 'Mes objetivo es requerido');
    }

    const index = await prisma.adjustmentIndex.findUnique({ where: { id } });
    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    const month = parseInt(targetMonth, 10);

    // Undo adjustments for specific month
    const { undoAdjustmentForMonth: undoService } = require('../services/adjustmentService');
    const results = await undoService(groupId, id, month);

    return ApiResponse.success(
      res,
      {
        index: {
          id: index.id,
          name: index.name,
        },
        targetMonth: month,
        contractsReverted: results.length,
        details: results,
      },
      `Ajuste revertido para ${results.length} contrato(s) del mes ${month}`
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustment-indices/:id/apply-to-calendar
const applyAdjustmentToCalendar = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { percentageIncrease, calendarMonth, calendarYear } = req.body;

    if (percentageIncrease === undefined || percentageIncrease === null) {
      return ApiResponse.badRequest(res, 'Porcentaje de aumento es requerido');
    }

    if (!calendarMonth || isNaN(parseInt(calendarMonth, 10))) {
      return ApiResponse.badRequest(res, 'Mes es requerido');
    }
    
    if (!calendarYear || isNaN(parseInt(calendarYear, 10))) {
      return ApiResponse.badRequest(res, 'Año es requerido');
    }

    const index = await prisma.adjustmentIndex.findUnique({ where: { id } });
    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    const percentage = parseFloat(percentageIncrease);
    const month = parseInt(calendarMonth, 10);
    const year = parseInt(calendarYear, 10);

    // Update the index currentValue
    await prisma.adjustmentIndex.update({
      where: { id },
      data: {
        currentValue: percentage,
        lastUpdated: new Date(),
      },
    });

    // Apply to contracts for specific calendar month
    const { applyAdjustmentToCalendar } = require('../services/adjustmentService');
    const results = await applyAdjustmentToCalendar(groupId, id, percentage, month, year);

    return ApiResponse.success(
      res,
      {
        index: {
          id: index.id,
          name: index.name,
          currentValue: percentage,
        },
        calendarMonth: month,
        calendarYear: year,
        contractsAdjusted: results.length,
        details: results,
      },
      `Ajuste del ${percentage}% aplicado a ${results.length} contrato(s)`
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/adjustment-indices/:id/undo-calendar
const undoAdjustmentForCalendar = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { calendarMonth, calendarYear } = req.body;

    if (!calendarMonth || isNaN(parseInt(calendarMonth, 10))) {
      return ApiResponse.badRequest(res, 'Mes es requerido');
    }
    
    if (!calendarYear || isNaN(parseInt(calendarYear, 10))) {
      return ApiResponse.badRequest(res, 'Año es requerido');
    }

    const index = await prisma.adjustmentIndex.findUnique({ where: { id } });
    if (!index || index.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Índice de ajuste no encontrado');
    }

    const month = parseInt(calendarMonth, 10);
    const year = parseInt(calendarYear, 10);

    // Undo adjustments for specific calendar month
    const { undoAdjustmentForCalendar } = require('../services/adjustmentService');
    const results = await undoAdjustmentForCalendar(groupId, id, month, year);

    return ApiResponse.success(
      res,
      {
        index: {
          id: index.id,
          name: index.name,
        },
        calendarMonth: month,
        calendarYear: year,
        contractsReverted: results.length,
        details: results,
      },
      `Ajuste revertido para ${results.length} contrato(s)`
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getIndices,
  getIndexById,
  createIndex,
  updateIndex,
  deleteIndex,
  applyAdjustment,
  applyAllNextMonth,
  getContractsByMonth,
  getContractsByCalendar,
  applyAdjustmentToMonth,
  applyAdjustmentToCalendar,
  undoAdjustmentForMonth,
  undoAdjustmentForCalendar,
};
