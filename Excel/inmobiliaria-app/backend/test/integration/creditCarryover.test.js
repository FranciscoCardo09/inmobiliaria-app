/*
 * C-01 — "El saldo a favor que supera el total del mes SE DESTRUYE": si
 * previousBalance > (alquiler+servicios+punitorios+IVA), el excedente de crédito
 * desaparece sin arrastrarse al mes siguiente. Ver AUDITORIA_FUNCIONAL_2026-07-10.md C-01.
 *
 * SOLO demuestra el bug con un test que falla. NO se implementa ningún fix todavía.
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, cleanupGroup } = require('./fixtures');
const { flushRecalculation } = require('./flush');
const { recalculateMonthlyRecord } = require('../../src/services/monthlyRecordService');

test('C-01: crédito que supera el total del mes debe sobrevivir (no clampear el balance a $0)', async (t) => {
  // Mes con un saldo a favor arrastrado ($200.000) mucho mayor al alquiler de este mes
  // ($100.000), sin ningún pago nuevo. El excedente ($100.000) debe seguir apareciendo
  // como crédito (balance positivo) para arrastrarse al mes siguiente — no desaparecer.
  const { group, monthlyRecord } = await seedScenario(prisma, {
    // punitoryForgiven=true aísla el bug de arrastre de crédito del cálculo de
    // punitorios en vivo (C-02) — no depende de la fecha "hoy" del entorno de test.
    monthlyRecord: {
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      rentAmount: 100000, servicesTotal: 0, previousBalance: 200000,
      amountPaid: 0, totalDue: 0, punitoryForgiven: true,
    },
  });

  try {
    await recalculateMonthlyRecord(monthlyRecord.id);
    await flushRecalculation(prisma, group.id);

    const updatedRecord = await prisma.monthlyRecord.findUnique({ where: { id: monthlyRecord.id } });

    assert.strictEqual(updatedRecord.totalDue, 0, 'totalDue persistido no puede ser negativo (se clampea a 0)');
    assert.strictEqual(
      updatedRecord.balance,
      100000,
      `BUG C-01: el excedente de crédito ($100.000 = $200.000 crédito − $100.000 alquiler) ` +
      `debe sobrevivir como balance positivo para arrastrarse al mes siguiente, pero balance ` +
      `quedó en ${updatedRecord.balance} (se perdió el excedente al clampear totalDue a 0 antes de restar)`
    );
  } finally {
    await flushRecalculation(prisma, group.id);
    await cleanupGroup(prisma, group.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
