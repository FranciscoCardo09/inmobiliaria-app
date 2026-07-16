/*
 * Minimal fixture builders for integration tests against the disposable test DB.
 * Kept intentionally small: only the fields Bloque 1 (payments/debts) needs.
 */
const { randomUUID } = require('crypto');

async function createGroup(prisma, overrides = {}) {
  return prisma.group.create({
    data: {
      name: '__TEST__ Group',
      slug: `test-group-${randomUUID()}`,
      punitoryRate: 0.006,
      ...overrides,
    },
  });
}

async function createProperty(prisma, groupId, overrides = {}) {
  return prisma.property.create({
    data: {
      groupId,
      address: '__TEST__ property',
      ...overrides,
    },
  });
}

async function createTenant(prisma, groupId, overrides = {}) {
  return prisma.tenant.create({
    data: {
      groupId,
      name: '__TEST__ tenant',
      dni: `test-${randomUUID().slice(0, 8)}`,
      ...overrides,
    },
  });
}

// Contract starting exactly on periodMonth/periodYear's 1st, so monthNumber 1 == that period.
async function createContract(prisma, { groupId, propertyId, tenantId }, overrides = {}) {
  const startDate = overrides.startDate || new Date(2026, 0, 1);
  return prisma.contract.create({
    data: {
      groupId,
      propertyId,
      tenantId,
      contractType: 'INQUILINO',
      startDate,
      startMonth: 1,
      durationMonths: 24,
      baseRent: 100000,
      punitoryStartDay: 4,
      punitoryGraceDay: 10,
      punitoryPercent: 0.006,
      ...overrides,
    },
  });
}

async function createMonthlyRecord(prisma, { groupId, contractId }, overrides = {}) {
  const rentAmount = overrides.rentAmount ?? 100000;
  const servicesTotal = overrides.servicesTotal ?? 0;
  const previousBalance = overrides.previousBalance ?? 0;
  const totalDue = overrides.totalDue ?? Math.max(rentAmount + servicesTotal - previousBalance, 0);
  return prisma.monthlyRecord.create({
    data: {
      groupId,
      contractId,
      monthNumber: 1,
      periodMonth: 1,
      periodYear: 2026,
      rentAmount,
      servicesTotal,
      previousBalance,
      totalDue,
      ...overrides,
    },
  });
}

// Builds a full minimal scenario: group -> property -> tenant -> contract -> monthlyRecord.
async function seedScenario(prisma, overrides = {}) {
  const group = await createGroup(prisma, overrides.group);
  const property = await createProperty(prisma, group.id, overrides.property);
  const tenant = await createTenant(prisma, group.id, overrides.tenant);
  const contract = await createContract(prisma, { groupId: group.id, propertyId: property.id, tenantId: tenant.id }, overrides.contract);
  const monthlyRecord = await createMonthlyRecord(prisma, { groupId: group.id, contractId: contract.id }, overrides.monthlyRecord);
  return { group, property, tenant, contract, monthlyRecord };
}

// Deletes everything under a group (cascades handle the rest per schema onDelete: Cascade).
async function cleanupGroup(prisma, groupId) {
  await prisma.group.delete({ where: { id: groupId } }).catch(() => {});
}

module.exports = {
  createGroup,
  createProperty,
  createTenant,
  createContract,
  createMonthlyRecord,
  seedScenario,
  cleanupGroup,
};
