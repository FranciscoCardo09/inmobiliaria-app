// Dashboard Controller - Phase 5+
const ApiResponse = require('../utils/apiResponse');
const {
  getContractsWithAdjustmentThisMonth,
  getContractsWithAdjustmentNextMonth,
} = require('../services/adjustmentService');
const { getDebtsSummary } = require('../services/debtService');
const { getOrCreateMonthlyRecords } = require('../services/monthlyRecordService');

const prisma = require('../lib/prisma');

// GET /api/groups/:groupId/dashboard/summary
const getSummary = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const [
      propertiesCount,
      tenantsCount,
      activeContracts,
      adjustmentsThisMonth,
      adjustmentsNextMonth,
      monthlyRecordsThisMonth,
    ] = await Promise.all([
      prisma.property.count({ where: { groupId, isActive: true } }),
      prisma.tenant.count({ where: { groupId, isActive: true } }),
      prisma.contract.findMany({
        where: { groupId, active: true },
        select: { id: true, currentMonth: true, durationMonths: true },
      }),
      getContractsWithAdjustmentThisMonth(groupId),
      getContractsWithAdjustmentNextMonth(groupId),
      getOrCreateMonthlyRecords(groupId, currentMonth, currentYear),
    ]);

    // Contratos por vencer (2 meses o menos restantes)
    const contractsExpiring = activeContracts.filter(
      (c) => (c.durationMonths - c.currentMonth) <= 2
    ).length;

    // Payment stats — getOrCreateMonthlyRecords already returns only active contracts
    const paymentsThisMonth = {
      paid: monthlyRecordsThisMonth.filter((r) => r.status === 'COMPLETE').length,
      total: monthlyRecordsThisMonth.length,
    };

    const pendingDebts = monthlyRecordsThisMonth.filter(
      (r) => r.status === 'PENDING' || r.status === 'PARTIAL'
    ).length;

    // Resumen de deudas (Fase 5+)
    const debtsSummary = await getDebtsSummary(groupId);

    return ApiResponse.success(res, {
      propertiesCount,
      tenantsCount,
      activeContracts: activeContracts.length,
      adjustmentsThisMonth: adjustmentsThisMonth.length,
      adjustmentsNextMonth: adjustmentsNextMonth.length,
      contractsExpiring,
      paymentsThisMonth,
      pendingDebts,
      // Deudas
      totalDebt: debtsSummary.totalDebt,
      openDebtsCount: debtsSummary.openDebtsCount,
      blockedContracts: debtsSummary.blockedContracts,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSummary };
