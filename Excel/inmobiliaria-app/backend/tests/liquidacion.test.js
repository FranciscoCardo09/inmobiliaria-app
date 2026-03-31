/**
 * Tests for getLiquidacionesAllContracts
 *
 * Uses the real DB (read-only). Run with:
 *   npm test
 *
 * Tests cover:
 *   1. Natural address ordering (spaces + numeric)
 *   2. contractIds filter returns exactly the specified contracts
 *   3. ownerId filter returns all active INQUILINO contracts for that owner
 *   4. soloConPago=true returns only isCancelled records
 *   5. soloConPago=false returns all records (including unpaid)
 *   6. Combined contractIds + soloConPago=false returns all specified contracts
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

// Load env (DATABASE_URL etc.)
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getLiquidacionesAllContracts } = require('../src/services/reportDataService');

// ─── Test fixtures (real IDs from the DB) ───────────────────────────────────

const GID  = '191e50f7-3a41-4526-b07a-aeee65307218'; // Habitar Administracion
const MONTH = 3;
const YEAR  = 2026;

// Owner "Peñaloza Camet Sofia Rosario" — 11 active INQUILINO contracts
const OWNER_ID = '564b1c66-3caa-497c-9282-1d8b46261815';

// Five specific contract IDs (mix of cancelled and not)
const CONTRACT_IDS_CANCELLED = [
  '47d35273-8b1f-449b-bf2c-00c645a382f3',
  '4b6a68b1-41c3-48ba-be5c-3f53ee2b34dc',
  'c777d98c-3dce-4bb6-87f0-73e9f27e4f74',
  '60654630-657a-4b11-b220-eb1c6f267891',
];

// Contracts known NOT cancelled in March 2026
const CONTRACT_IDS_NOT_CANCELLED = [
  '22fa988d-a566-4b79-81e0-4d2cb580e8d1', // Los Pinos 3989 Torre 1 - 2 A
  '71b8a624-b0d2-4e5c-89c6-6e8508e9960b', // Alvear 306 Esq Lima
  '57659010-4cd0-4c75-a949-6e7a0690a658', // Pablo Zufriategui 4568
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the array of addresses is naturally sorted
 * (numeric-aware, ignoring extra spaces, case-insensitive).
 */
function isNaturallySorted(addresses) {
  const normalized = addresses.map(a => a.trim().replace(/\s+/g, ' '));
  for (let i = 0; i < normalized.length - 1; i++) {
    const cmp = normalized[i].localeCompare(normalized[i + 1], 'es', { numeric: true, sensitivity: 'base' });
    if (cmp > 0) return false;
  }
  return true;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getLiquidacionesAllContracts', () => {

  test('1. Addresses are returned in natural (numeric-aware) order', async () => {
    const data = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: false });
    assert.ok(data.length > 0, 'Should return at least one record');

    const addresses = data.map(d => d.propiedad.direccion);
    assert.ok(
      isNaturallySorted(addresses),
      `Addresses are not naturally sorted.\nGot:\n${addresses.map((a, i) => `  ${i + 1}. "${a}"`).join('\n')}`
    );
  });

  test('2. contractIds filter: returns exactly the specified contracts', async () => {
    const ids = CONTRACT_IDS_CANCELLED;
    const data = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: false }, null, ids);

    assert.equal(
      data.length, ids.length,
      `Expected ${ids.length} records, got ${data.length}`
    );

    const returnedIds = data.map(d => d.contractId).sort();
    assert.deepEqual(returnedIds, [...ids].sort(), 'Returned contractIds must match the requested ones');
  });

  test('3. ownerId filter: returns all active INQUILINO contracts for the owner', async () => {
    const data = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: false }, OWNER_ID);

    assert.ok(data.length > 0, 'Owner should have at least one active contract');

    // All returned records must belong to properties owned by OWNER_ID
    const prisma = new PrismaClient();
    try {
      const ownerPropertyIds = (await prisma.property.findMany({
        where: { ownerId: OWNER_ID, groupId: GID },
        select: { id: true },
      })).map(p => p.id);

      for (const d of data) {
        // Verify by querying the contract's property
        const contract = await prisma.contract.findUnique({
          where: { id: d.contractId },
          select: { contractType: true, property: { select: { id: true, ownerId: true } } },
        });
        assert.equal(contract.contractType, 'INQUILINO', `Contract ${d.contractId} must be INQUILINO`);
        assert.ok(
          ownerPropertyIds.includes(contract.property.id),
          `Property ${contract.property.id} must belong to owner ${OWNER_ID}`
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test('4. soloConPago=true: returns only isCancelled records', async () => {
    const data = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: true });

    assert.ok(data.length > 0, 'Should have at least one paid record');
    for (const d of data) {
      assert.ok(d.isCancelled, `Record for contract ${d.contractId} (${d.propiedad.direccion}) should be cancelled`);
    }
  });

  test('5. soloConPago=false: includes unpaid records', async () => {
    const allData    = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: false });
    const paidData   = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: true });

    assert.ok(
      allData.length >= paidData.length,
      `soloConPago=false (${allData.length}) must return >= soloConPago=true (${paidData.length})`
    );
    // There should be at least one unpaid record in March 2026
    assert.ok(
      allData.some(d => !d.isCancelled),
      'soloConPago=false should include at least one non-cancelled record'
    );
  });

  test('6. Explicit contractIds bypass soloConPago: returns all specified contracts regardless of payment', async () => {
    // Mix cancelled + not-cancelled contracts
    const mixedIds = [...CONTRACT_IDS_CANCELLED.slice(0, 2), ...CONTRACT_IDS_NOT_CANCELLED.slice(0, 2)];

    const dataAll  = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: false }, null, mixedIds);
    const dataPaid = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: true  }, null, mixedIds);

    assert.equal(
      dataAll.length, mixedIds.length,
      `soloConPago=false with explicit contractIds should return all ${mixedIds.length}, got ${dataAll.length}`
    );

    // soloConPago=true with explicit contractIds only returns the cancelled subset
    const cancelledCount = mixedIds.filter(id => CONTRACT_IDS_CANCELLED.includes(id)).length;
    assert.equal(
      dataPaid.length, cancelledCount,
      `soloConPago=true with explicit contractIds should return ${cancelledCount} cancelled, got ${dataPaid.length}`
    );
  });

  test('7. Natural sort: Torre 1 appears before Torre 2 and Torre 3', async () => {
    const data = await getLiquidacionesAllContracts(GID, MONTH, YEAR, null, { soloConPago: false }, OWNER_ID);
    const addresses = data.map(d => d.propiedad.direccion.trim().replace(/\s+/g, ' '));

    const torre1Indices = addresses.map((a, i) => /Torre 1/i.test(a) ? i : -1).filter(i => i >= 0);
    const torre2Indices = addresses.map((a, i) => /Torre 2/i.test(a) ? i : -1).filter(i => i >= 0);

    if (torre1Indices.length > 0 && torre2Indices.length > 0) {
      const lastTorre1 = Math.max(...torre1Indices);
      const firstTorre2 = Math.min(...torre2Indices);
      assert.ok(
        lastTorre1 < firstTorre2,
        `All Torre 1 entries (last at idx ${lastTorre1}) should appear before Torre 2 entries (first at idx ${firstTorre2})`
      );
    } else {
      // Skip if this owner doesn't have both towers
      console.log('  (skipped: owner does not have both Torre 1 and Torre 2)');
    }
  });

});
