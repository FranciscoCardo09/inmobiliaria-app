/*
 * Before/after snapshot helper for a single group's financial tables.
 * Used to assert invariants like "a GET never writes" or "one payment == one effect"
 * under concurrency, without hand-listing every field.
 */
async function snapshotGroup(prisma, groupId) {
  const [monthlyRecords, transactions, concepts, debts, debtPayments] = await Promise.all([
    prisma.monthlyRecord.findMany({ where: { groupId }, orderBy: { id: 'asc' } }),
    prisma.paymentTransaction.findMany({ where: { groupId }, orderBy: { id: 'asc' } }),
    prisma.transactionConcept.findMany({
      where: { transaction: { groupId } },
      orderBy: { id: 'asc' },
    }),
    prisma.debt.findMany({ where: { groupId }, orderBy: { id: 'asc' } }),
    prisma.debtPayment.findMany({ where: { debt: { groupId } }, orderBy: { id: 'asc' } }),
  ]);

  return {
    counts: {
      monthlyRecords: monthlyRecords.length,
      transactions: transactions.length,
      concepts: concepts.length,
      debts: debts.length,
      debtPayments: debtPayments.length,
    },
    monthlyRecords,
    transactions,
    concepts,
    debts,
    debtPayments,
  };
}

module.exports = { snapshotGroup };
