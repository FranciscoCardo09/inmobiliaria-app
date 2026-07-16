/*
 * Regression tests for "meses fantasma" repair (Problema A / B).
 * Run against the LOCAL copy:
 *   DATABASE_URL=postgresql://postgres:sim@localhost:55432/simdb node --test test/repair.test.js
 *
 * Creates throwaway data, exercises repairContractRecordMonthNumbers, and cleans up.
 */
const test = require('node:test');
const assert = require('node:assert');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { repairContractRecordMonthNumbers, getMonthNumber } = require('../src/services/monthlyRecordService');

async function makeRecord(contractId, groupId, monthNumber, periodMonth, periodYear, amountPaid = 0) {
  return prisma.monthlyRecord.create({
    data: {
      groupId, contractId, monthNumber, periodMonth, periodYear,
      rentAmount: 100000, totalDue: 100000, amountPaid, balance: amountPaid - 100000,
      status: amountPaid > 0 ? 'PARTIAL' : 'PENDING',
    },
  });
}

test('repairContractRecordMonthNumbers: corrige, borra fantasmas y preserva pagos', async (t) => {
  const group = await prisma.group.findFirst({ select: { id: true } });
  const property = await prisma.property.create({ data: { groupId: group.id, address: '__SIM_TEST__ repair' } });
  // Contrato: arranca 2026-04, 24 meses => rango monthNumber 1..24
  const contract = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: property.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 3, 1), startMonth: 1, currentMonth: 1, durationMonths: 24, baseRent: 100000,
    },
  });

  const ids = {};
  try {
    // (a) en rango pero monthNumber desfasado: 2026-04 deberia ser mN=1, lo ponemos 99
    ids.stale = (await makeRecord(contract.id, group.id, 99, 4, 2026, 0)).id;
    // (b) fuera de rango SIN plata (antes del inicio): 2026-03 mN=36 -> debe BORRARSE
    ids.phantom = (await makeRecord(contract.id, group.id, 36, 3, 2026, 0)).id;
    // (c) fuera de rango CON plata (antes del inicio): 2026-02 mN=35 -> debe PRESERVARSE
    ids.paidOrphan = (await makeRecord(contract.id, group.id, 35, 2, 2026, 50000)).id;
    // (d) en rango y correcto: 2026-05 mN=2 -> intacto
    ids.ok = (await makeRecord(contract.id, group.id, 2, 5, 2026, 0)).id;

    const res = await repairContractRecordMonthNumbers(contract, { deletePhantoms: true });

    await t.test('borra 1 mes fantasma sin plata', () => assert.strictEqual(res.deleted, 1));
    await t.test('corrige 1 monthNumber desfasado', () => assert.strictEqual(res.updated, 1));
    await t.test('preserva y reporta 1 mes con pagos', () => {
      assert.strictEqual(res.paidOrphans.length, 1);
      assert.strictEqual(res.paidOrphans[0].periodMonth, 2);
      assert.strictEqual(res.paidOrphans[0].amountPaid, 50000);
    });

    const stale = await prisma.monthlyRecord.findUnique({ where: { id: ids.stale } });
    const phantom = await prisma.monthlyRecord.findUnique({ where: { id: ids.phantom } });
    const paidOrphan = await prisma.monthlyRecord.findUnique({ where: { id: ids.paidOrphan } });
    const ok = await prisma.monthlyRecord.findUnique({ where: { id: ids.ok } });

    await t.test('record desfasado quedo con monthNumber correcto (=1)', () => {
      assert.strictEqual(stale.monthNumber, getMonthNumber(contract, 4, 2026));
      assert.strictEqual(stale.monthNumber, 1);
    });
    await t.test('mes fantasma fue borrado', () => assert.strictEqual(phantom, null));
    await t.test('mes con pagos NO fue borrado', () => assert.ok(paidOrphan !== null));
    await t.test('record ya correcto quedo intacto', () => assert.strictEqual(ok.monthNumber, 2));

    // idempotencia: correr de nuevo no cambia nada
    const res2 = await repairContractRecordMonthNumbers(contract, { deletePhantoms: true });
    await t.test('idempotente (segunda corrida no toca nada)', () => {
      assert.strictEqual(res2.deleted, 0);
      assert.strictEqual(res2.updated, 0);
      assert.strictEqual(res2.paidOrphans.length, 1);
    });
  } finally {
    await prisma.monthlyRecord.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.property.delete({ where: { id: property.id } });
  }
});

test('Problema B: borra meses despues del fin sin plata', async (t) => {
  const group = await prisma.group.findFirst({ select: { id: true } });
  const property = await prisma.property.create({ data: { groupId: group.id, address: '__SIM_TEST__ end' } });
  const contract = await prisma.contract.create({
    data: { groupId: group.id, propertyId: property.id, contractType: 'INQUILINO',
      startDate: new Date(2024, 6, 1), startMonth: 1, currentMonth: 1, durationMonths: 24, baseRent: 100000 },
  }); // rango 1..24, termina 2026-06
  try {
    await makeRecord(contract.id, group.id, 24, 6, 2026, 0);  // ultimo mes valido
    await makeRecord(contract.id, group.id, 25, 7, 2026, 0);  // pasado el fin -> borrar
    await makeRecord(contract.id, group.id, 26, 8, 2026, 0);  // pasado el fin -> borrar
    const res = await repairContractRecordMonthNumbers(contract, { deletePhantoms: true });
    await t.test('borra los 2 meses pasados el fin', () => assert.strictEqual(res.deleted, 2));
    const remaining = await prisma.monthlyRecord.count({ where: { contractId: contract.id } });
    await t.test('queda solo el ultimo mes valido', () => assert.strictEqual(remaining, 1));
  } finally {
    await prisma.monthlyRecord.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.property.delete({ where: { id: property.id } });
  }
});

test.after(async () => { await prisma.$disconnect(); });
