const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire');

const contractTenantMock = {
  id: 'contract-tenant',
  groupId: 'group-1',
  startMonth: 5,
  durationMonths: 36, // 3 years tenant contract
  startDate: new Date(2024, 4, 1), // May 1st local
  active: true,
};

const contractOwnerMock = {
  id: 'contract-owner',
  groupId: 'group-1',
  startMonth: 1, // Doesn't really matter for owner
  durationMonths: 0, // Owners often have 0 or irrelevant duration
  startDate: new Date(2023, 0, 1), // Jan 1st local
  active: true,
};

let dbLog = [];

const prismaMock = {
  $transaction: async function(cb) { return await cb(this); },
  contract: {
    findUnique: async ({ where }) => {
      if (where.id === 'contract-tenant') return contractTenantMock;
      if (where.id === 'contract-owner') return contractOwnerMock;
      return null;
    }
  },
  monthlyRecord: {
    findUnique: async () => null, // force creation 
    create: async () => ({ id: 'record-created' }),
    findMany: async ({ where }) => { 
      dbLog.push({ type: 'findManyRecords', where });
      return [{ id: 'record-1', includeIva: false, rentAmount: 1000, previousBalance: 0, transactions: [] }]; 
    },
    update: async ({ where, data }) => {
      dbLog.push({ type: 'recordUpdate', where, data });
      return { id: where.id, ...data };
    }
  },
  monthlyService: {
    upsert: async ({ update, create, where }) => {
      dbLog.push({ type: 'upsert', create, update });
      return { id: 'service-id' };
    },
    deleteMany: async ({ where }) => {
      dbLog.push({ type: 'deleteMany', where });
      return { count: 2 };
    }
  },
  debt: {
    findFirst: async () => null,
  }
};

const mockRecordService = {
  recalculateMonthlyRecord: async () => { },
  recalculateMultipleRecords: async (ids, tx) => {
    dbLog.push({ type: 'batchRecalculate', ids });
    return ids.length;
  }
};

const monthlyServiceService = proxyquire('./src/services/monthlyServiceService.js', {
  '../lib/prisma': prismaMock,
  './monthlyRecordService': mockRecordService
});

test('Case 1: Tenant -> propagation March -> December (Starts in May -> 8 months)', async () => {
  dbLog = [];
  await monthlyServiceService.propagateServiceForward('group-1', 'contract-tenant', 'concept-1', 1000, 3, 2024);
  const upserts = dbLog.filter(t => t.type === 'upsert');
  assert.strictEqual(upserts.length, 8, 'Should have exactly 8 upserts because it starts in May');
});

test('Case 2: Owner -> same behavior (ignores durationMonths = 0)', async () => {
  dbLog = [];
  await monthlyServiceService.propagateServiceForward('group-1', 'contract-owner', 'concept-1', 1000, 3, 2024);
  const upserts = dbLog.filter(t => t.type === 'upsert');
  assert.strictEqual(upserts.length, 10, 'Should have exactly 10 upserts regardless of owner contract');
});

test('Case 3: Start in December -> only December affected', async () => {
  dbLog = [];
  await monthlyServiceService.propagateServiceForward('group-1', 'contract-tenant', 'concept-1', 1000, 12, 2024);
  const upserts = dbLog.filter(t => t.type === 'upsert');
  assert.strictEqual(upserts.length, 1, 'Only month 12');
});

test('Case 4: Ensure January next year is EMPTY (No cross-year)', async () => {
  dbLog = [];
  await monthlyServiceService.propagateServiceForward('group-1', 'contract-tenant', 'concept-1', 1000, 10, 2024);
  const upserts = dbLog.filter(t => t.type === 'upsert');
  assert.strictEqual(upserts.length, 3, 'Only 10, 11, 12. No January of next year.');
});

test('Case 5: Remove propagation is strictly within the same year', async () => {
  dbLog = [];

  await monthlyServiceService.removeServiceForward('group-1', 'contract-tenant', 'concept-1', 10, 2024);

  const findQuery = dbLog.find(t => t.type === 'findManyRecords');
  assert.ok(findQuery, 'Find query executed');
  
  assert.strictEqual(findQuery.where.periodYear, 2024);
  assert.deepStrictEqual(findQuery.where.periodMonth, { gte: 10 });
  assert.strictEqual(findQuery.where.OR, undefined, 'No OR crossing years');
});

test('Case 6: Should NOT propagate before contract start date', async () => {
  dbLog = [];
  // contract-tenant starts in May (5), 2024. Try to propagate from Jan (1)
  await monthlyServiceService.propagateServiceForward('group-1', 'contract-tenant', 'concept-1', 1000, 1, 2024);
  
  const upserts = dbLog.filter(t => t.type === 'upsert');
  // Should only have upserts from 5 to 12 = 8 upserts.
  assert.strictEqual(upserts.length, 8, 'Should only have 8 upserts (May to Dec)');
});

test('Case 7: Should NOT propagate after rescission date', async () => {
  dbLog = [];
  // Load mock for rescinded contract
  const contractRescindedMock = {
    id: 'contract-rescinded',
    groupId: 'group-1',
    startMonth: 1,
    durationMonths: 24,
    startDate: new Date(2024, 0, 1), // Jan 1st 2024
    rescindedAt: new Date(2024, 5, 15), // Rescinded in June 15th
    active: true
  };

  const modifiedPrisma = {
    ...prismaMock,
    contract: {
      findUnique: async () => contractRescindedMock
    }
  };

  const modifiedService = proxyquire('./src/services/monthlyServiceService.js', {
    '../lib/prisma': modifiedPrisma,
    './monthlyRecordService': mockRecordService
  });

  await modifiedService.propagateServiceForward('group-1', 'contract-rescinded', 'concept-1', 1000, 1, 2024);

  const upserts = dbLog.filter(t => t.type === 'upsert');
  // Should only have upserts from Jan to June = 6 upserts.
  assert.strictEqual(upserts.length, 6, 'Should only have 6 upserts (Jan to June)');
});
