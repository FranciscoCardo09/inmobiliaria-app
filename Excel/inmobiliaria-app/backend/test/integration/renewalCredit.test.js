/*
 * C-06 — "La renovación de contrato PIERDE el saldo a favor del inquilino": el mes 1
 * del contrato nuevo arranca en previousBalance=0 aunque el contrato viejo terminó con
 * un saldo a favor. Ver AUDITORIA_FUNCIONAL_2026-07-10.md C-06.
 *
 * SOLO demuestra el bug con un test que falla. NO se implementa ningún fix todavía.
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { createGroup, createProperty, createTenant, cleanupGroup } = require('./fixtures');
const { getOrCreateMonthlyRecords } = require('../../src/services/monthlyRecordService');

test('C-06: el mes 1 del contrato renovado debe heredar el saldo a favor final del contrato viejo', async (t) => {
  const group = await createGroup(prisma);
  const property = await createProperty(prisma, group.id);
  const tenant = await createTenant(prisma, group.id);

  try {
    // Contrato VIEJO: 3 meses, Ene-Mar 2026, ya renovado (active=false, renewedAt).
    const oldContract = await prisma.contract.create({
      data: {
        groupId: group.id, propertyId: property.id, tenantId: tenant.id,
        contractType: 'INQUILINO',
        startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 3,
        baseRent: 100000, active: false, renewedAt: new Date(2026, 2, 15),
      },
    });
    // Su último mes (marzo 2026) cerró con $50.000 de saldo a favor (sobrepago).
    await prisma.monthlyRecord.create({
      data: {
        groupId: group.id, contractId: oldContract.id,
        monthNumber: 3, periodMonth: 3, periodYear: 2026,
        rentAmount: 100000, totalDue: 100000, amountPaid: 150000, balance: 50000,
        status: 'COMPLETE', isPaid: true, isCancelled: true,
      },
    });

    // Contrato NUEVO: arranca abril 2026, vinculado al viejo vía renewedFromContractId.
    const newContract = await prisma.contract.create({
      data: {
        groupId: group.id, propertyId: property.id, tenantId: tenant.id,
        contractType: 'INQUILINO',
        startDate: new Date(2026, 3, 1), startMonth: 1, durationMonths: 24,
        baseRent: 120000, active: true,
        renewedFromContractId: oldContract.id,
      },
    });

    await getOrCreateMonthlyRecords(group.id, 4, 2026);

    const newMonth1 = await prisma.monthlyRecord.findFirst({
      where: { contractId: newContract.id, monthNumber: 1 },
    });

    assert.ok(newMonth1, 'debe haberse creado el mes 1 del contrato nuevo');
    assert.strictEqual(
      newMonth1.previousBalance,
      50000,
      `BUG C-06: el mes 1 del contrato nuevo debería heredar el saldo a favor de $50.000 ` +
      `del contrato viejo, pero previousBalance quedó en ${newMonth1.previousBalance} (se perdió)`
    );

    // Idempotencia: llamar de nuevo NO debe re-aplicar el crédito una segunda vez.
    await getOrCreateMonthlyRecords(group.id, 4, 2026);
    const newMonth1Again = await prisma.monthlyRecord.findFirst({
      where: { contractId: newContract.id, monthNumber: 1 },
    });
    assert.strictEqual(newMonth1Again.previousBalance, 50000, 'no debe duplicarse en llamadas repetidas');
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
