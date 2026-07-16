/*
 * C-04/C-03 — atomicidad de payDebt / registerPayment bajo concurrencia real
 * (2 llamadas en paralelo contra Postgres real; el fake in-memory no puede
 * ejercitar esto). Ver AUDITORIA_FUNCIONAL_2026-07-10.md C-03/C-04 y plan
 * Bloque 1, casos 6.6 #35/#36.
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, cleanupGroup } = require('./fixtures');
const { flushRecalculation } = require('./flush');
const { payDebt } = require('../../src/services/debtService');
const { registerPayment, deleteTransaction } = require('../../src/services/paymentTransactionService');


async function seedOpenDebt(overrides = {}) {
  const { group, contract, monthlyRecord } = await seedScenario(prisma, {
    monthlyRecord: { status: 'PARTIAL', amountPaid: 0 },
    ...overrides,
  });
  const debt = await prisma.debt.create({
    data: {
      groupId: group.id,
      contractId: contract.id,
      monthlyRecordId: monthlyRecord.id,
      periodLabel: 'Enero 2026',
      periodMonth: 1,
      periodYear: 2026,
      originalAmount: 200000,
      unpaidRentAmount: 200000,
      unpaidServicesAmount: 0,
      accumulatedPunitory: 0,
      currentTotal: 200000,
      amountPaid: 0,
      punitoryPercent: 0.006,
      punitoryStartDate: new Date(2026, 0, 1),
      status: 'OPEN',
    },
  });
  return { group, contract, monthlyRecord, debt };
}

test('C-04: dos payDebt concurrentes sobre la MISMA deuda no deben perder ningún pago', async (t) => {
  const { group, debt } = await seedOpenDebt();

  try {
    // Dos pagos parciales de $50.000 cada uno, en paralelo, sobre una deuda de $200.000.
    // Ninguno la salda solo, así que ambos deben quedar reflejados sin importar el orden.
    await Promise.all([
      payDebt(debt.id, 50000, '2026-01-10', 'EFECTIVO', 'pago A'),
      payDebt(debt.id, 50000, '2026-01-10', 'EFECTIVO', 'pago B'),
    ]);

    const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
    const sumPayments = payments.reduce((s, p) => s + p.amount, 0);
    const updatedDebt = await prisma.debt.findUnique({ where: { id: debt.id } });

    assert.strictEqual(payments.length, 2, 'ambos DebtPayment deben existir');
    assert.strictEqual(sumPayments, 100000, 'la suma de los DebtPayment debe ser 100000');
    assert.strictEqual(
      updatedDebt.amountPaid,
      sumPayments,
      `INVARIANTE 6.9 #53 violada: Debt.amountPaid (${updatedDebt.amountPaid}) debe ser exactamente ` +
      `Σ DebtPayment.amount (${sumPayments}) — si difieren, un pago concurrente se perdió (lost update)`
    );
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test('C-03: dos registerPayment concurrentes sobre el MISMO mes no deben perder ningún pago', async (t) => {
  // Sin previousBalance (para no mezclar con el hallazgo aparte de A_FAVOR repetido,
  // reportado por separado — ver nota en el checkpoint). Dos pagos de $40.000 en
  // paralelo sobre un alquiler de $100.000: ninguno cubre el total solo, así que
  // ambos deben quedar reflejados en amountPaid sin importar el orden/concurrencia.
  const { group, monthlyRecord } = await seedScenario(prisma, {
    monthlyRecord: { rentAmount: 100000, servicesTotal: 0, previousBalance: 0, totalDue: 100000 },
  });

  try {
    await Promise.all([
      registerPayment(group.id, monthlyRecord.id, { paymentDate: '2026-01-10', amount: 40000, paymentMethod: 'EFECTIVO' }),
      registerPayment(group.id, monthlyRecord.id, { paymentDate: '2026-01-10', amount: 40000, paymentMethod: 'EFECTIVO' }),
    ]);
    await flushRecalculation(prisma, group.id);

    const transactions = await prisma.paymentTransaction.findMany({ where: { monthlyRecordId: monthlyRecord.id } });
    const sumTransactions = transactions.reduce((s, t) => s + t.amount, 0);
    const updatedRecord = await prisma.monthlyRecord.findUnique({ where: { id: monthlyRecord.id } });

    assert.strictEqual(transactions.length, 2, 'ambas PaymentTransaction deben existir');
    assert.strictEqual(sumTransactions, 80000, 'la suma de las transacciones debe ser 80000');
    assert.strictEqual(
      updatedRecord.amountPaid,
      sumTransactions,
      `INVARIANTE 6.9 #54 violada: MonthlyRecord.amountPaid (${updatedRecord.amountPaid}) debe ser ` +
      `exactamente Σ PaymentTransaction.amount (${sumTransactions}) — si difieren, un pago concurrente ` +
      `se perdió (lost update)`
    );
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test('C-05: deleteTransaction NO debe tragar el error de cancelDebtPayment (regla LIFO)', async (t) => {
  const { group, debt } = await seedOpenDebt();

  try {
    // Dos pagos secuenciales sobre la deuda (no la saldan, ambos quedan como DebtPayment).
    const { payment: firstDebtPayment } = await payDebt(debt.id, 50000, '2026-01-10', 'EFECTIVO', 'primer pago');
    await payDebt(debt.id, 50000, '2026-01-15', 'EFECTIVO', 'segundo pago');

    // La PaymentTransaction del PRIMER pago: NO es el último → la regla LIFO debe bloquearlo.
    const firstTransaction = await prisma.paymentTransaction.findFirst({
      where: { monthlyRecordId: debt.monthlyRecordId, amount: 50000, paymentDate: firstDebtPayment.paymentDate },
      orderBy: { createdAt: 'asc' },
    });
    assert.ok(firstTransaction, 'debe existir la transacción del primer pago');

    const beforeDebt = await prisma.debt.findUnique({ where: { id: debt.id } });
    const beforePaymentsCount = (await prisma.debtPayment.findMany({ where: { debtId: debt.id } })).length;
    const beforeTxCount = (await prisma.paymentTransaction.findMany({ where: { monthlyRecordId: debt.monthlyRecordId } })).length;

    await assert.rejects(
      () => deleteTransaction(group.id, firstTransaction.id),
      /último pago|LIFO/i,
      'debe rechazar borrar la transacción del pago que NO es el último (regla LIFO), no tragarse el error'
    );

    const afterDebt = await prisma.debt.findUnique({ where: { id: debt.id } });
    const afterPaymentsCount = (await prisma.debtPayment.findMany({ where: { debtId: debt.id } })).length;
    const afterTxCount = (await prisma.paymentTransaction.findMany({ where: { monthlyRecordId: debt.monthlyRecordId } })).length;

    assert.strictEqual(afterPaymentsCount, beforePaymentsCount, 'ningún DebtPayment debe borrarse (rollback completo)');
    assert.strictEqual(
      afterTxCount,
      beforeTxCount,
      'BUG C-05: ninguna PaymentTransaction debe borrarse cuando cancelDebtPayment falla — ' +
      'si el conteo bajó, el error se tragó y la deuda quedó "cobrada" con plata inexistente'
    );
    assert.strictEqual(afterDebt.amountPaid, beforeDebt.amountPaid, 'Debt.amountPaid no debe cambiar');
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test('C-05: deleteTransaction SÍ debe revertir ambos libros cuando es el último pago (camino feliz)', async (t) => {
  const { group, debt } = await seedOpenDebt();

  try {
    const { payment: firstDebtPayment } = await payDebt(debt.id, 50000, '2026-01-10', 'EFECTIVO', 'primer pago');
    const { payment: lastDebtPayment } = await payDebt(debt.id, 50000, '2026-01-15', 'EFECTIVO', 'segundo pago');

    const lastTransaction = await prisma.paymentTransaction.findFirst({
      where: { monthlyRecordId: debt.monthlyRecordId, amount: 50000, paymentDate: lastDebtPayment.paymentDate },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(lastTransaction, 'debe existir la transacción del último pago');

    const deleted = await deleteTransaction(group.id, lastTransaction.id);
    assert.ok(deleted, 'debe borrar la transacción del último pago sin error');

    const remainingPayments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
    const remainingTx = await prisma.paymentTransaction.findMany({ where: { monthlyRecordId: debt.monthlyRecordId } });
    const updatedDebt = await prisma.debt.findUnique({ where: { id: debt.id } });

    assert.strictEqual(remainingPayments.length, 1, 'solo debe quedar el primer DebtPayment');
    assert.strictEqual(remainingPayments[0].id, firstDebtPayment.id);
    assert.strictEqual(remainingTx.length, 1, 'solo debe quedar la primera PaymentTransaction');
    assert.strictEqual(updatedDebt.amountPaid, 50000, 'Debt.amountPaid debe reflejar solo el primer pago');
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
