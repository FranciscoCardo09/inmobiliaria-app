/*
 * Trivial harness smoke test: proves the disposable Postgres is reachable,
 * schema is pushed, fixtures work, and a real service (not mocked) runs
 * against it end to end. Not a Bloque 1 regression test itself.
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, cleanupGroup } = require('./fixtures');
const { snapshotGroup } = require('./snapshot');
const { flushRecalculation } = require('./flush');

test('harness: seed + snapshot + real registerPayment against disposable Postgres', async (t) => {
  const { registerPayment } = require('../../src/services/paymentTransactionService');
  const { group, monthlyRecord } = await seedScenario(prisma);

  try {
    const before = await snapshotGroup(prisma, group.id);
    assert.strictEqual(before.counts.transactions, 0);

    const { transaction } = await registerPayment(group.id, monthlyRecord.id, {
      paymentDate: '2026-01-05',
      amount: 100000,
      paymentMethod: 'EFECTIVO',
    });

    assert.ok(transaction.id);
    await flushRecalculation(prisma, group.id);
    const after = await snapshotGroup(prisma, group.id);
    assert.strictEqual(after.counts.transactions, 1, 'un pago real produjo exactamente una transacción');
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
