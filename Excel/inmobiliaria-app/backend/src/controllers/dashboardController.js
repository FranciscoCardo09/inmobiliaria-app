// Dashboard Controller - Phase 3.5
const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');
const {
  getContractsWithAdjustmentThisMonth,
  getContractsWithAdjustmentNextMonth,
} = require('../services/adjustmentService');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/dashboard/summary
const getSummary = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const [
      propertiesCount,
      tenantsCount,
      activeContracts,
      adjustmentsThisMonth,
      adjustmentsNextMonth,
    ] = await Promise.all([
      prisma.property.count({ where: { groupId, isActive: true } }),
      prisma.tenant.count({ where: { groupId, isActive: true } }),
      prisma.contract.findMany({
        where: { groupId, active: true },
        select: { currentMonth: true, durationMonths: true },
      }),
      getContractsWithAdjustmentThisMonth(groupId),
      getContractsWithAdjustmentNextMonth(groupId),
    ]);

    // Contratos por vencer (2 meses o menos restantes)
    const contractsExpiring = activeContracts.filter(
      (c) => (c.durationMonths - c.currentMonth) <= 2
    ).length;

    return ApiResponse.success(res, {
      propertiesCount,
      tenantsCount,
      activeContracts: activeContracts.length,
      adjustmentsThisMonth: adjustmentsThisMonth.length,
      adjustmentsNextMonth: adjustmentsNextMonth.length,
      contractsExpiring,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSummary };
