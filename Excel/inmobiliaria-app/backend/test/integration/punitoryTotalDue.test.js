/*
 * C-02 — "Punitorios impagos se auto-condonan": pagar solo el alquiler marca el mes
 * COMPLETE aunque queden punitorios sin cobrar. Ver AUDITORIA_FUNCIONAL_2026-07-10.md C-02.
 *
 * SOLO demuestra el bug con un test que falla. NO se implementa ningún fix todavía —
 * el fix se discute con el usuario antes de tocar _recalculateCore (guardrail punitorios).
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, cleanupGroup } = require('./fixtures');
const { flushRecalculation } = require('./flush');
const { registerPayment } = require('../../src/services/paymentTransactionService');

test('C-02: pagar solo el alquiler en mora NO debe marcar el mes COMPLETE (punitorio impago debe sobrevivir)', async (t) => {
  // Período marzo 2026, se paga el 5 de abril 2026 → 36 días de mora (misma convención
  // que tests/punitory.test.js: punitoryStartDay=4, punitoryGraceDay=10, 0.6% diario).
  // Punitorio realmente adeudado = round(100000 * 0.006 * 36) = $21.600.
  const { group, contract, monthlyRecord } = await seedScenario(prisma, {
    contract: { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006 },
    monthlyRecord: {
      periodMonth: 3, periodYear: 2026, monthNumber: 3,
      rentAmount: 100000, servicesTotal: 0, previousBalance: 0, totalDue: 100000,
    },
  });

  try {
    // Paga EXACTAMENTE el alquiler "redondo" — nada alcanza para los punitorios.
    const { transaction } = await registerPayment(group.id, monthlyRecord.id, {
      paymentDate: '2026-04-05',
      amount: 100000,
      paymentMethod: 'EFECTIVO',
    });

    await flushRecalculation(prisma, group.id);

    const updatedRecord = await prisma.monthlyRecord.findUnique({ where: { id: monthlyRecord.id } });
    const punitoryConcepts = await prisma.transactionConcept.findMany({
      where: { transactionId: transaction.id, type: 'PUNITORIOS' },
    });

    // El punitorio SÍ se calculó y quedó registrado en la transacción (aunque no se
    // haya cobrado en efectivo) — confirma que el bug no es "no calculó el punitorio",
    // sino "no lo mantiene en totalDue/balance/status una vez que no se pagó".
    assert.ok(transaction.punitoryAmount > 0, `debe haber calculado un punitorio > 0 (fue ${transaction.punitoryAmount})`);
    assert.strictEqual(punitoryConcepts.length, 0, 'el pago no alcanzó para cubrir punitorios (sin concepto PUNITORIOS)');

    assert.notStrictEqual(
      updatedRecord.status,
      'COMPLETE',
      `BUG C-02: el mes quedó COMPLETE con un punitorio de $${transaction.punitoryAmount} sin cobrar ` +
      `(totalDue=${updatedRecord.totalDue}, balance=${updatedRecord.balance}, amountPaid=${updatedRecord.amountPaid}) — ` +
      `el cierre mensual (que solo mira PENDING/PARTIAL) nunca generaría la deuda por esos punitorios`
    );
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test('REGRESIÓN (no romper): punitorio pagado en DOS tandas no debe generar saldo a favor falso', async (t) => {
  // Mismo escenario (36 días de mora, punitorio $21.600), pero ahora en DOS pagos:
  // 1) $100.000 cubre el alquiler (igual que arriba, punitorio queda impago).
  // 2) $21.600 más tarde, mismo día, cubre EXACTAMENTE el punitorio pendiente.
  // Al final: amountPaid=121.600, totalDue debe ser 121.600, balance=0 — NO un saldo a
  // favor falso (memoria punitory-totaldue-concept-rule, confirmado 2026-06-29).
  const { group, contract, monthlyRecord } = await seedScenario(prisma, {
    contract: { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006 },
    monthlyRecord: {
      periodMonth: 3, periodYear: 2026, monthNumber: 3,
      rentAmount: 100000, servicesTotal: 0, previousBalance: 0, totalDue: 100000,
    },
  });

  try {
    await registerPayment(group.id, monthlyRecord.id, {
      paymentDate: '2026-04-05', amount: 100000, paymentMethod: 'EFECTIVO',
    });
    await flushRecalculation(prisma, group.id);

    const { transaction: secondTx } = await registerPayment(group.id, monthlyRecord.id, {
      paymentDate: '2026-04-05', amount: 21600, paymentMethod: 'EFECTIVO',
    });
    await flushRecalculation(prisma, group.id);

    const punitoryConcepts = await prisma.transactionConcept.findMany({
      where: { transactionId: secondTx.id, type: 'PUNITORIOS' },
    });
    assert.ok(punitoryConcepts.length > 0, 'el segundo pago debe generar un concepto PUNITORIOS');

    const updatedRecord = await prisma.monthlyRecord.findUnique({ where: { id: monthlyRecord.id } });
    assert.strictEqual(updatedRecord.amountPaid, 121600, 'amountPaid debe sumar ambos pagos');
    assert.strictEqual(updatedRecord.status, 'COMPLETE', 'con ambos pagos el mes debe quedar COMPLETE');
    assert.ok(
      updatedRecord.balance <= 0.01,
      `NO debe generarse saldo a favor falso: balance debería ser ~0, fue ${updatedRecord.balance} ` +
      `(totalDue=${updatedRecord.totalDue}, amountPaid=${updatedRecord.amountPaid})`
    );
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
