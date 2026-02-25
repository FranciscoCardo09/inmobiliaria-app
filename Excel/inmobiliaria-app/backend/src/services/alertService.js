// Alert Service
// Detects contracts expiring within N months (default: 2)


const prisma = require('../lib/prisma');

/**
 * Get contracts expiring within a number of months for a group
 * @param {string} groupId
 * @param {number} months - Alert threshold in months (default: 2)
 * @returns {Array} contracts expiring soon
 */
const getExpiringContracts = async (groupId, months = 2) => {
  const now = new Date();
  const limitDate = new Date();
  limitDate.setMonth(limitDate.getMonth() + months);

  const contracts = await prisma.contract.findMany({
    where: {
      groupId,
      status: 'ACTIVE',
      endDate: {
        gte: now,
        lte: limitDate,
      },
    },
    include: {
      tenant: {
        select: { id: true, name: true, dni: true, phone: true },
      },
      property: {
        select: {
          id: true,
          address: true,
          code: true,
          category: { select: { id: true, name: true, color: true } },
        },
      },
    },
    orderBy: { endDate: 'asc' },
  });

  return contracts.map((c) => {
    const endDate = new Date(c.endDate);
    const startDate = new Date(c.startDate);
    const remainingDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
    const remainingMonths = Math.max(
      0,
      Math.ceil((endDate - now) / (1000 * 60 * 60 * 24 * 30.44))
    );
    const elapsedMonths = Math.max(
      0,
      (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth())
    );
    const currentMonth = Math.min(elapsedMonths + 1, c.durationMonths);

    return {
      ...c,
      currentMonth,
      remainingDays,
      remainingMonths,
      progressPercent: Math.round((currentMonth / c.durationMonths) * 100),
    };
  });
};

/**
 * Auto-expire contracts past their end date
 * @param {string} groupId
 * @returns {number} count of expired contracts
 */
const autoExpireContracts = async (groupId) => {
  const now = new Date();

  const result = await prisma.contract.updateMany({
    where: {
      groupId,
      status: 'ACTIVE',
      endDate: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });

  return result.count;
};

module.exports = {
  getExpiringContracts,
  autoExpireContracts,
};
