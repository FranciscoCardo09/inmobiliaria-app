const prisma = require('../lib/prisma');
const { calculateNextAdjustmentMonth } = require('./adjustmentService');
const { getPeriodLabel, calculateCurrentContractMonth } = require('../utils/dateUtils');

const enrichContract = (c) => {
  const adjustmentIndex = c.adjustmentIndex;

  const start = new Date(c.startDate);
  const now = new Date();
  
  const computedCurrentMonth = calculateCurrentContractMonth(c.startDate, c.startMonth, c.durationMonths, now);
  const sm = c.startMonth || 1;
  const endMonth = sm + c.durationMonths - 1;

  const currentPeriodLabel = getPeriodLabel(c.startDate, computedCurrentMonth, sm);

  let nextAdjustmentLabel = null;
  let nextAdjustmentIsThisMonth = false;

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

  const endDate = new Date(start);
  endDate.setMonth(endDate.getMonth() + c.durationMonths);
  endDate.setDate(endDate.getDate() - 1);

  const remainingMonths = Math.max(0, endMonth - computedCurrentMonth);

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

const getExpiringContractsOptimized = async (groupId) => {
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

  const expiring = contracts
    .map((c) => {
      const tenants = c.contractTenants.length > 0
        ? c.contractTenants.map((ct) => ct.tenant)
        : c.tenant ? [c.tenant] : [];
      return { ...enrichContract(c), tenants };
    })
    .filter((c) => c.isExpiringSoon)
    .sort((a, b) => a.remainingMonths - b.remainingMonths || new Date(a.endDate) - new Date(b.endDate));

  return expiring;
};

module.exports = {
  enrichContract,
  getExpiringContractsOptimized,
};
