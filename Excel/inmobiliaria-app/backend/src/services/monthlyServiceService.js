// Monthly Service Service - Manage services/extras for monthly records
const { recalculateMonthlyRecord, recalculateMultipleRecords } = require('./monthlyRecordService');

const prisma = require('../lib/prisma');

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
const bulkAssign = async (groupId, contractId, conceptTypeId, amount, months, description = null, tx = null) => {
  const execute = async (client) => {
    const results = [];
    const affectedRecordIds = new Set();

    for (const { month, year } of months) {
      // Find or create the monthly record
      let record = await client.monthlyRecord.findUnique({
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
        const contract = await client.contract.findUnique({ where: { id: contractId } });
        if (!contract) continue;

        const startDate = new Date(contract.startDate);
        const totalMonthsDiff = (parseInt(year) - startDate.getFullYear()) * 12 + (parseInt(month) - (startDate.getMonth() + 1));
        const monthNumber = contract.startMonth + totalMonthsDiff;

        // MINIMAL SAFE FIX: Prevent creation strictly before the start date or if explicitly inactive
        if (monthNumber < contract.startMonth) continue;
        if (!contract.active) continue;

        if (contract.rescindedAt) {
          const rescDate = new Date(contract.rescindedAt);
          const rescMonthNumber = contract.startMonth + ((rescDate.getFullYear() - startDate.getFullYear()) * 12) + (rescDate.getMonth() + 1 - (startDate.getMonth() + 1));
          if (monthNumber > rescMonthNumber) continue;
        }

        record = await client.monthlyRecord.create({
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
        const service = await client.monthlyService.upsert({
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

        results.push(service);
        affectedRecordIds.add(record.id);
      } catch (e) {
        console.error(`[bulkAssign] Error upserting service for record ${record.id}:`, e.message);
      }
    }

    if (affectedRecordIds.size > 0) {
      await recalculateMultipleRecords(Array.from(affectedRecordIds), client);
    }

    return results;
  };

  if (tx) {
    return await execute(tx);
  } else {
    return await prisma.$transaction(async (newTx) => await execute(newTx), { timeout: 30000 });
  }
};

/**
 * Copy service configuration from one month to target months
 */
const copyConfig = async (groupId, contractId, sourceMonth, sourceYear, targetMonths) => {
  return await prisma.$transaction(async (tx) => {
    // Get source services
    const sourceRecord = await tx.monthlyRecord.findUnique({
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
    // Efficiency fix: Group months by service, not service by month
    for (const service of sourceRecord.services) {
      const assigned = await bulkAssign(
        groupId,
        contractId,
        service.conceptTypeId,
        service.amount,
        targetMonths,
        service.description,
        tx
      );
      results.push(...assigned);
    }

    return results;
  });
};

/**
 * Add the same service type to multiple monthly records with different amounts.
 * Used for distributing a total amount across multiple properties.
 */
const batchAddServices = async (distributions, conceptTypeId, description = null) => {
  const results = [];

  await prisma.$transaction(async (tx) => {
    const recordIds = distributions.map(d => d.recordId);
    
    for (const { recordId, amount } of distributions) {
      const service = await tx.monthlyService.create({
        data: {
          monthlyRecordId: recordId,
          conceptTypeId,
          amount,
          description,
        },
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      });
      results.push(service);
    }

    await recalculateMultipleRecords(recordIds, tx);
  });

  return results;
};

/**
 * Bulk assign a service to multiple months for multiple contracts.
 * Applies the same amount uniformly to every contract+month combination.
 */
const bulkAssignMultiContract = async (groupId, contractIds, conceptTypeId, amount, months, description = null) => {
  // Validate conceptType belongs to this group
  const conceptType = await prisma.conceptType.findFirst({
    where: { id: conceptTypeId, groupId, isActive: true },
  });
  if (!conceptType) throw new Error('Tipo de concepto no encontrado o inactivo');

  // Validate all contracts belong to this group
  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds }, groupId },
    select: { id: true },
  });
  if (contracts.length !== contractIds.length) {
    throw new Error('Algunos contratos no pertenecen a este grupo');
  }

  let totalAssigned = 0;
  const errors = [];

  // Implement Safe Chunking
  const CHUNK_SIZE = 50;
  for (let i = 0; i < contractIds.length; i += CHUNK_SIZE) {
    const chunkIds = contractIds.slice(i, i + CHUNK_SIZE);
    
    try {
      await prisma.$transaction(async (tx) => {
        for (const contractId of chunkIds) {
          try {
            const results = await bulkAssign(groupId, contractId, conceptTypeId, amount, months, description, tx);
            totalAssigned += results.length;
          } catch (e) {
            errors.push({ contractId, error: e.message });
          }
        }
      });
    } catch (chunkError) {
      for (const contractId of chunkIds) {
        errors.push({ contractId, error: `Error en lote: ${chunkError.message}` });
      }
    }
  }

  return { totalAssigned, errors };
};

/**
 * Propagate a service forward from a given month to December of the same year.
 * Uses bulkAssign (upsert) so existing services are updated, missing ones are created.
 */
const propagateServiceForward = async (groupId, contractId, conceptTypeId, amount, fromMonth, fromYear, description = null) => {
  const months = [];
  const startM = parseInt(fromMonth);
  const fixedY = parseInt(fromYear);

  // Generate strictly up to month 12 of the SAME year
  for (let m = startM; m <= 12; m++) {
    months.push({ month: m, year: fixedY });
  }

  return bulkAssign(groupId, contractId, conceptTypeId, amount, months, description);
};

/**
 * Remove a service for a contract from a given month through December of the same year.
 */
const removeServiceForward = async (groupId, contractId, conceptTypeId, fromMonth, fromYear) => {
  return await prisma.$transaction(async (tx) => {
    // Find all monthly records for this contract strictly in the same year from fromMonth
    const records = await tx.monthlyRecord.findMany({
      where: {
        groupId,
        contractId,
        periodYear: parseInt(fromYear),
        periodMonth: { gte: parseInt(fromMonth) },
      },
      select: { id: true },
    });

    const recordIds = records.map((r) => r.id);
    if (recordIds.length === 0) return;

    await tx.monthlyService.deleteMany({
      where: {
        monthlyRecordId: { in: recordIds },
        conceptTypeId,
      },
    });

    await recalculateMultipleRecords(recordIds, tx);
  });
};

module.exports = {
  addService,
  updateService,
  removeService,
  getServicesForRecord,
  bulkAssign,
  bulkAssignMultiContract,
  copyConfig,
  batchAddServices,
  propagateServiceForward,
  removeServiceForward,
};
