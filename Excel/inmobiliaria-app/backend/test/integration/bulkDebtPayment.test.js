/*
 * "Pagar varias" (pago de varios meses adeudados de una vez) contra la base real, con
 * el flujo real: los meses se crean con getOrCreateMonthlyRecords, se cierran con
 * closeMonth (que genera las Deudas), los servicios se tocan con add/update/removeService
 * y se cobra con payDebtsBulk.
 *
 * Qué garantiza:
 *   - el preview (lo que muestra el modal mes por mes) no escribe nada en la base;
 *   - cada mes del preview es el mismo monto que el modal de UNA deuda (no hay dos números);
 *   - editar / agregar / borrar un servicio de un mes ya en deuda cambia el monto del preview;
 *   - cerrar un mes más agrega esa deuda a la lista y al total;
 *   - el reparto que muestra la pantalla (cancela / parcial / no cubre) es lo que el cobro
 *     real hace después;
 *   - los casos inválidos se rechazan SIN dejar nada a medio escribir.
 *
 * Run: bash test/integration/run.sh test/integration/bulkDebtPayment.test.js
 */
require('../../sim/clock.js');

const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { createGroup, createProperty, createTenant, cleanupGroup } = require('./fixtures');
const { snapshotGroup } = require('./snapshot');
const { flushRecalculation } = require('./flush');
const { getOrCreateMonthlyRecords } = require('../../src/services/monthlyRecordService');
const { addService, updateService, removeService } = require('../../src/services/monthlyServiceService');
const { closeMonth } = require('../../src/services/monthlyCloseService');
const {
  previewBulkDebtPayment, payDebtsBulk, canPayCurrentMonth, calculateDebtPunitory,
} = require('../../src/services/debtService');

const RENT = 100000;
const LUZ = 20000;
const PAY_DATE = '2026-10-05';

const near = (a, b, msg, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/**
 * Contrato desde julio 2026. Cada mes de `debtMonths` se crea, se le carga LUZ y se cierra
 * impago (→ Deuda). El mes siguiente al último queda abierto (mes actual).
 */
async function seed({ debtMonths = [7, 8, 9] } = {}) {
  const group = await createGroup(prisma);
  const property = await createProperty(prisma, group.id);
  const tenant = await createTenant(prisma, group.id);
  const contract = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: property.id, tenantId: tenant.id,
      contractType: 'INQUILINO', startDate: new Date('2026-07-01T12:00:00Z'),
      startMonth: 1, durationMonths: 24, baseRent: RENT,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  await prisma.rentHistory.create({ data: { contractId: contract.id, effectiveFromMonth: 1, rentAmount: RENT, reason: 'INICIAL' } });
  const luz = await prisma.conceptType.create({ data: { groupId: group.id, name: 'LUZ', label: 'Luz', category: 'SERVICIO' } });
  const services = {};
  for (const m of debtMonths) {
    await openMonth(group.id, m);
    const rec = await record(contract.id, m);
    services[m] = await addService(rec.id, luz.id, LUZ);
    await closeMonthAt(group.id, m);
  }
  const last = debtMonths[debtMonths.length - 1];
  await openMonth(group.id, last + 1);
  global.__setNow(2026, 10, 5);
  return { group, contract, luz, services };
}

async function openMonth(groupId, m) {
  global.__setNow(2026, m, 1);
  await getOrCreateMonthlyRecords(groupId, m, 2026);
  await flushRecalculation(prisma, groupId);
}

async function closeMonthAt(groupId, m) {
  global.__setNow(2026, m + 1, 1);
  await closeMonth(groupId, m, 2026);
  await flushRecalculation(prisma, groupId);
}

const record = (contractId, m) => prisma.monthlyRecord.findFirst({ where: { contractId, periodMonth: m, periodYear: 2026 } });
const openDebts = (contractId) => prisma.debt.findMany({
  where: { contractId, status: { not: 'PAID' } }, orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
});
const ids = (debts) => debts.map((d) => d.id);
const byMonth = (preview, m) => preview.debts.find((it) => it.periodMonth === m);

test.afterEach(() => global.__clearNow());
test.after(async () => { await prisma.$disconnect(); });

// ─── Lo que muestra el modal ────────────────────────────────────────────────

test('el cierre genera una deuda por mes y el preview las lista de la más vieja a la más nueva', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    assert.deepStrictEqual(debts.map((d) => d.periodMonth), [7, 8, 9]);
    // Se manda desordenado: el backend tiene que reordenar.
    const preview = await previewBulkDebtPayment(s.group.id, ids(debts).reverse(), PAY_DATE);
    assert.deepStrictEqual(preview.debts.map((it) => it.periodMonth), [7, 8, 9]);
    for (const it of preview.debts) {
      assert.strictEqual(it.remainingRent, RENT, `${it.periodLabel}: alquiler`);
      assert.strictEqual(it.remainingServices, LUZ, `${it.periodLabel}: servicios`);
      assert.ok(it.punitory > 0 && it.punitoryDays > 0, `${it.periodLabel}: tiene mora con días`);
      near(it.remainingRent + it.remainingServices + it.iva + it.punitory, it.totalToPay, `${it.periodLabel}: las líneas suman el total`);
    }
    // Julio tiene más días de mora que septiembre.
    assert.ok(byMonth(preview, 7).punitoryDays > byMonth(preview, 9).punitoryDays);
    near(preview.total, preview.debts.reduce((a, it) => a + it.totalToPay, 0), 'total = suma de meses');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('el preview NO escribe nada en la base (abrir el modal no cambia montos)', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const before = await snapshotGroup(prisma, s.group.id);
    await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    await previewBulkDebtPayment(s.group.id, ids(debts), '2026-12-31'); // otra fecha
    const current = await record(s.contract.id, 10);
    await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE, current.id);
    await flushRecalculation(prisma, s.group.id);
    assert.deepStrictEqual(await snapshotGroup(prisma, s.group.id), before);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('cada mes del pago múltiple da lo mismo que el modal de esa deuda sola', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const preview = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    for (const d of debts) {
      const single = await calculateDebtPunitory(
        await prisma.debt.findUnique({ where: { id: d.id }, include: { payments: true } }),
        new Date(`${PAY_DATE}T12:00:00`), null, true
      );
      const it = byMonth(preview, d.periodMonth);
      near(it.totalToPay, single.remainingDebt + (single.unpaidAccumulatedPunitory || 0) + single.amount, `${d.periodLabel}: total`);
      assert.strictEqual(it.punitoryDays, single.days, `${d.periodLabel}: días`);
    }
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('cambiar la fecha de pago recalcula días y punitorios (más tarde = más mora)', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const early = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    const late = await previewBulkDebtPayment(s.group.id, ids(debts), '2026-11-05');
    for (const m of [7, 8, 9]) {
      assert.ok(byMonth(late, m).punitoryDays > byMonth(early, m).punitoryDays, `mes ${m}: más días`);
      assert.ok(byMonth(late, m).punitory > byMonth(early, m).punitory, `mes ${m}: más punitorio`);
      assert.strictEqual(byMonth(late, m).remainingRent, byMonth(early, m).remainingRent, `mes ${m}: el alquiler no cambia`);
    }
  } finally { await cleanupGroup(prisma, s.group.id); }
});

// ─── Cambios en los datos se reflejan ───────────────────────────────────────

test('editar el servicio de un mes en deuda actualiza el monto de ese mes (y solo de ese)', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const before = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);

    await updateService(s.services[8].id, 35000);
    await flushRecalculation(prisma, s.group.id);
    const after = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);

    assert.strictEqual(byMonth(after, 8).remainingServices, 35000);
    near(byMonth(after, 8).totalToPay, byMonth(before, 8).totalToPay + 15000, 'agosto sube 15.000');
    near(byMonth(after, 7).totalToPay, byMonth(before, 7).totalToPay, 'julio no cambia', 0.01);
    near(byMonth(after, 9).totalToPay, byMonth(before, 9).totalToPay, 'septiembre no cambia', 0.01);
    near(after.total, before.total + 15000, 'el total sube 15.000');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('borrar el servicio de un mes en deuda lo baja; agregar uno nuevo lo sube', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const before = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);

    await removeService(s.services[7].id);
    await flushRecalculation(prisma, s.group.id);
    const removed = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    assert.strictEqual(byMonth(removed, 7).remainingServices, 0);
    near(byMonth(removed, 7).totalToPay, byMonth(before, 7).totalToPay - LUZ, 'julio baja la LUZ');

    const agua = await prisma.conceptType.create({ data: { groupId: s.group.id, name: 'AGUA', label: 'Agua', category: 'SERVICIO' } });
    await addService((await record(s.contract.id, 9)).id, agua.id, 8000);
    await flushRecalculation(prisma, s.group.id);
    const added = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    assert.strictEqual(byMonth(added, 9).remainingServices, LUZ + 8000);
    near(byMonth(added, 9).totalToPay, byMonth(before, 9).totalToPay + 8000, 'septiembre sube el AGUA');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('cerrar un mes más agrega esa deuda a la lista y al total', async () => {
  const s = await seed({ debtMonths: [7, 8] });
  try {
    // Lo que usa la pantalla para armar la lista: canPayCurrentMonth(...).debts
    let check = await canPayCurrentMonth(s.group.id, s.contract.id, { periodMonth: 9, periodYear: 2026 });
    assert.deepStrictEqual(check.debts.map((d) => d.periodMonth), [7, 8]);
    const before = await previewBulkDebtPayment(s.group.id, check.debts.map((d) => d.id), PAY_DATE);

    // Septiembre (abierto) recibe su LUZ y se cierra impago.
    await addService((await record(s.contract.id, 9)).id, s.luz.id, LUZ);
    await closeMonthAt(s.group.id, 9);
    global.__setNow(2026, 10, 5);

    check = await canPayCurrentMonth(s.group.id, s.contract.id, { periodMonth: 10, periodYear: 2026 });
    assert.deepStrictEqual(check.debts.map((d) => d.periodMonth), [7, 8, 9]);
    const after = await previewBulkDebtPayment(s.group.id, check.debts.map((d) => d.id), PAY_DATE);
    assert.strictEqual(after.debts.length, 3);
    near(after.total, before.total + byMonth(after, 9).totalToPay, 'el total suma septiembre');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

// ─── El cobro real hace lo que mostró la pantalla ───────────────────────────

test('dos meses y medio: cancela julio y agosto, septiembre queda debiendo lo que decía el preview', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const preview = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    const [jul, ago, sep] = [7, 8, 9].map((m) => byMonth(preview, m).totalToPay);
    const amount = Math.round(jul + ago + sep / 2);

    await payDebtsBulk(s.group.id, ids(debts), amount, PAY_DATE);
    await flushRecalculation(prisma, s.group.id);

    const after = await prisma.debt.findMany({ where: { contractId: s.contract.id }, include: { payments: true }, orderBy: { periodMonth: 'asc' } });
    assert.deepStrictEqual(after.map((d) => d.status), ['PAID', 'PAID', 'PARTIAL']);
    near(after.reduce((a, d) => a + d.payments.reduce((x, p) => x + p.amount, 0), 0), amount, 'se cobró exactamente el monto');

    const left = await previewBulkDebtPayment(s.group.id, [after[2].id], PAY_DATE);
    near(left.debts[0].totalToPay, jul + ago + sep - amount, 'lo que queda de septiembre = lo que mostraba la pantalla');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('monto exacto: cancela todo y ninguna deuda queda con saldo a favor', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const preview = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE);
    await payDebtsBulk(s.group.id, ids(debts), preview.total, PAY_DATE);
    await flushRecalculation(prisma, s.group.id);
    assert.strictEqual((await openDebts(s.contract.id)).length, 0);
    const sobrepagos = await prisma.transactionConcept.count({ where: { type: 'SOBREPAGO', transaction: { groupId: s.group.id } } });
    assert.strictEqual(sobrepagos, 0);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('menos que el primer mes: julio parcial, agosto y septiembre intactos', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    await payDebtsBulk(s.group.id, ids(debts), 50000, PAY_DATE);
    await flushRecalculation(prisma, s.group.id);
    const after = await prisma.debt.findMany({ where: { contractId: s.contract.id }, include: { payments: true }, orderBy: { periodMonth: 'asc' } });
    assert.deepStrictEqual(after.map((d) => d.status), ['PARTIAL', 'OPEN', 'OPEN']);
    assert.deepStrictEqual(after.map((d) => d.payments.length), [1, 0, 0]);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('con el mes actual de cola: el excedente va al mes actual, nunca a una deuda', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    const current = await record(s.contract.id, 10);
    const preview = await previewBulkDebtPayment(s.group.id, ids(debts), PAY_DATE, current.id);
    assert.strictEqual(preview.debts[preview.debts.length - 1].type, 'RECORD', 'el mes actual va último');
    const debtsTotal = preview.debts.filter((it) => it.type === 'DEBT').reduce((a, it) => a + it.totalToPay, 0);

    await payDebtsBulk(s.group.id, ids(debts), Math.round(debtsTotal + 30000), PAY_DATE, 'EFECTIVO', null, current.id);
    await flushRecalculation(prisma, s.group.id);

    assert.strictEqual((await openDebts(s.contract.id)).length, 0, 'todas las deudas pagas');
    const debtSobrepago = await prisma.transactionConcept.count({
      where: { type: 'SOBREPAGO', transaction: { groupId: s.group.id, monthlyRecordId: { not: current.id } } },
    });
    assert.strictEqual(debtSobrepago, 0, 'ninguna deuda con saldo a favor');
    near((await record(s.contract.id, 10)).amountPaid, 30000, 'el resto quedó en el mes actual', 2);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

// ─── Casos inválidos: se rechazan y no cambia nada ──────────────────────────

async function assertRejectedWithoutChanges(s, fn, match) {
  const before = await snapshotGroup(prisma, s.group.id);
  await assert.rejects(fn, match);
  await flushRecalculation(prisma, s.group.id);
  assert.deepStrictEqual(await snapshotGroup(prisma, s.group.id), before, 'la base quedó igual');
}

test('saltear un mes (julio + septiembre sin agosto) se rechaza', async () => {
  const s = await seed();
  try {
    const [jul, , sep] = await openDebts(s.contract.id);
    await assertRejectedWithoutChanges(s, () => previewBulkDebtPayment(s.group.id, [jul.id, sep.id], PAY_DATE), /Agosto/);
    await assertRejectedWithoutChanges(s, () => payDebtsBulk(s.group.id, [jul.id, sep.id], 500000, PAY_DATE), /Agosto/);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('no incluir el mes más viejo (agosto + septiembre sin julio) se rechaza', async () => {
  const s = await seed();
  try {
    const [, ago, sep] = await openDebts(s.contract.id);
    await assertRejectedWithoutChanges(s, () => payDebtsBulk(s.group.id, [ago.id, sep.id], 500000, PAY_DATE), /Julio/);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('monto 0, negativo o vacío se rechaza', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    for (const amount of [0, -1000, '', null]) {
      await assertRejectedWithoutChanges(s, () => payDebtsBulk(s.group.id, ids(debts), amount, PAY_DATE), /Monto inválido/);
    }
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('sin deudas seleccionadas, con una deuda ya paga o con una que no existe se rechaza', async () => {
  const s = await seed();
  try {
    const debts = await openDebts(s.contract.id);
    await assertRejectedWithoutChanges(s, () => payDebtsBulk(s.group.id, [], 1000, PAY_DATE), /al menos una deuda/);
    await assertRejectedWithoutChanges(s, () => payDebtsBulk(s.group.id, [...ids(debts), '00000000-0000-0000-0000-000000000000'], 1000, PAY_DATE), /no existe/);

    const preview = await previewBulkDebtPayment(s.group.id, [debts[0].id], PAY_DATE);
    await payDebtsBulk(s.group.id, [debts[0].id], preview.total, PAY_DATE);
    await flushRecalculation(prisma, s.group.id);
    await assertRejectedWithoutChanges(s, () => payDebtsBulk(s.group.id, ids(debts), 1000, PAY_DATE), /ya está pagada/);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('deudas de otro grupo o de otro inquilino se rechazan', async () => {
  const a = await seed({ debtMonths: [7] });
  const b = await seed({ debtMonths: [7] });
  try {
    const [debtA] = await openDebts(a.contract.id);
    const [debtB] = await openDebts(b.contract.id);
    await assertRejectedWithoutChanges(a, () => payDebtsBulk(a.group.id, [debtB.id], 1000, PAY_DATE), /no pertenece a este grupo/);
    // Mismo grupo, otro contrato: se mueve la deuda B al grupo A para simularlo.
    await prisma.debt.update({ where: { id: debtB.id }, data: { groupId: a.group.id } });
    await assertRejectedWithoutChanges(a, () => payDebtsBulk(a.group.id, [debtA.id, debtB.id], 1000, PAY_DATE), /mismo inquilino/);
  } finally {
    await cleanupGroup(prisma, a.group.id);
    await cleanupGroup(prisma, b.group.id);
  }
});
