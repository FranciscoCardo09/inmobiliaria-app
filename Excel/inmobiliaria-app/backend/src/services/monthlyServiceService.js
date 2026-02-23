// Monthly Service Service - Manage services/extras for monthly records
const { PrismaClient } = require('@prisma/client');
const { recalculateMonthlyRecord } = require('./monthlyRecordService');

const prisma = new PrismaClient();

/**
 * Add a service to a monthly record
 */
const addService = async (monthlyRecordId, conceptTypeId, amount, description = null) => {
  const service = await prisma.monthlyService.create({
    data: {
      monthlyRecordId,
      conceptTypeId,
      amount,
      description,
    },
    include: {
      conceptType: { select: { id: true, name: true, label: true, category: true } },
    },
  });

  // Recalculate the monthly record totals
  await recalculateMonthlyRecord(monthlyRecordId);
  return service;
};

/**
 * Update a service amount
 */
const updateService = async (monthlyServiceId, amount, description) => {
  const service = await prisma.monthlyService.update({
    where: { id: monthlyServiceId },
    data: {
      amount,
      ...(description !== undefined && { description }),
    },
    include: {
      conceptType: { select: { id: true, name: true, label: true, category: true } },
    },
  });

  await recalculateMonthlyRecord(service.monthlyRecordId);
  return service;
};

/**
 * Remove a service from a monthly record
 */
const removeService = async (monthlyServiceId) => {
  const service = await prisma.monthlyService.findUnique({
    where: { id: monthlyServiceId },
  });

  if (!service) return null;

  await prisma.monthlyService.delete({ where: { id: monthlyServiceId } });
  await recalculateMonthlyRecord(service.monthlyRecordId);
  return service;
};

/**
 * Get services for a monthly record
 */
const getServicesForRecord = async (monthlyRecordId) => {
  return prisma.monthlyService.findMany({
    where: { monthlyRecordId },
    include: {
      conceptType: { select: { id: true, name: true, label: true, category: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
};

/**
 * Bulk assign a service to multiple months for a contract.
 * Creates MonthlyRecords if they don't exist.
 */
const bulkAssign = async (groupId, contractId, conceptTypeId, amount, months, description = null) => {
  const results = [];

  for (const { month, year } of months) {
    // Find or create the monthly record
    let record = await prisma.monthlyRecord.findUnique({
      where: {
        contractId_periodMonth_periodYear: {
          contractId,
          periodMonth: parseInt(month),
          periodYear: parseInt(year),
        },
      },
    });

    if (!record) {
      // Need to calculate monthNumber
      const contract = await prisma.contract.findUnique({ where: { id: contractId } });
      if (!contract) continue;

      const startDate = new Date(contract.startDate);
      const totalMonthsDiff = (parseInt(year) - startDate.getFullYear()) * 12 + (parseInt(month) - (startDate.getMonth() + 1));
      const monthNumber = 1 + totalMonthsDiff;

      if (monthNumber < 1 || monthNumber > contract.durationMonths) continue;

      record = await prisma.monthlyRecord.create({
        data: {
          groupId,
          contractId,
          monthNumber,
          periodMonth: parseInt(month),
          periodYear: parseInt(year),
          rentAmount: contract.baseRent,
          totalDue: contract.baseRent,
          balance: -contract.baseRent,
        },
      });
    }

    // Upsert the service
    try {
      const service = await prisma.monthlyService.upsert({
        where: {
          monthlyRecordId_conceptTypeId: {
            monthlyRecordId: record.id,
            conceptTypeId,
          },
        },
        update: { amount, description },
        create: {
          monthlyRecordId: record.id,
          conceptTypeId,
          amount,
          description,
        },
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      });

      await recalculateMonthlyRecord(record.id);
      results.push(service);
    } catch (e) {
      // Skip errors
    }
  }

  return results;
};

/**
 * Copy service configuration from one month to target months
 */
const copyConfig = async (groupId, contractId, sourceMonth, sourceYear, targetMonths) => {
  // Get source monthly record with services
  const sourceRecord = await prisma.monthlyRecord.findUnique({
    where: {
      contractId_periodMonth_periodYear: {
        contractId,
        periodMonth: parseInt(sourceMonth),
        periodYear: parseInt(sourceYear),
      },
    },
    include: {
      services: {
        include: { conceptType: true },
      },
    },
  });

  if (!sourceRecord || sourceRecord.services.length === 0) {
    return [];
  }

  const results = [];
  for (const { month, year } of targetMonths) {
    for (const service of sourceRecord.services) {
      const assigned = await bulkAssign(
        groupId,
        contractId,
        service.conceptTypeId,
        service.amount,
        [{ month, year }],
        service.description
      );
      results.push(...assigned);
    }
  }

  return results;
};

module.exports = {
  addService,
  updateService,
  removeService,
  getServicesForRecord,
  bulkAssign,
  copyConfig,
};
