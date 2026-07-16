/*
 * C-08 (agregado 2026-07-11 a pedido del usuario) — el segundo recibo del mes debe
 * mostrar el saldo a favor como YA USADO, no repetir el descuento. Confirmado que NO
 * es un bug de concurrencia: se reproduce con pagos 100% secuenciales.
 *
 * Regla del usuario: la transacción que efectivamente consume el crédito lo muestra
 * aplicado (monto negativo); las transacciones SIGUIENTES del mismo mes deben aclarar
 * que el crédito ya fue usado, sin volver a descontarlo (monto $0).
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, cleanupGroup } = require('./fixtures');
const { flushRecalculation } = require('./flush');
const { registerPayment } = require('../../src/services/paymentTransactionService');

test('C-08: solo el PRIMER pago del mes descuenta el saldo a favor; el segundo aclara que ya se usó', async (t) => {
  const { group, monthlyRecord } = await seedScenario(prisma, {
    monthlyRecord: { rentAmount: 100000, servicesTotal: 0, previousBalance: 20000, totalDue: 80000 },
  });

  try {
    const { transaction: firstTx } = await registerPayment(group.id, monthlyRecord.id, {
      paymentDate: '2026-01-10', amount: 40000, paymentMethod: 'EFECTIVO',
    });
    await flushRecalculation(prisma, group.id);

    const { transaction: secondTx } = await registerPayment(group.id, monthlyRecord.id, {
      paymentDate: '2026-01-11', amount: 40000, paymentMethod: 'EFECTIVO',
    });
    await flushRecalculation(prisma, group.id);

    const firstConcepts = await prisma.transactionConcept.findMany({ where: { transactionId: firstTx.id, type: 'A_FAVOR' } });
    const secondConcepts = await prisma.transactionConcept.findMany({ where: { transactionId: secondTx.id, type: 'A_FAVOR' } });

    assert.strictEqual(firstConcepts.length, 1, 'el primer pago debe tener un concepto A_FAVOR');
    assert.strictEqual(firstConcepts[0].amount, -20000, 'el primer pago SÍ descuenta el crédito completo');

    assert.strictEqual(secondConcepts.length, 1, 'el segundo pago debe informar el saldo a favor (no omitirlo)');
    assert.strictEqual(
      secondConcepts[0].amount,
      0,
      `BUG C-08: el segundo pago del mismo mes NO debe volver a descontar el crédito ` +
      `(monto esperado $0, informativo), pero fue ${secondConcepts[0].amount}`
    );
    assert.match(
      secondConcepts[0].description,
      /ya (fue )?utilizad|ya (fue )?usad/i,
      'la descripción debe aclarar que el saldo a favor ya fue usado'
    );

    // amountPaid sigue sumando ambos pagos correctamente (nada de esto afecta el total real).
    const updatedRecord = await prisma.monthlyRecord.findUnique({ where: { id: monthlyRecord.id } });
    assert.strictEqual(updatedRecord.amountPaid, 80000);
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
