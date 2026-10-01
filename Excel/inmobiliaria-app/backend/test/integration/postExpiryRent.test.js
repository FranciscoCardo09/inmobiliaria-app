/*
 * El mes extra post-vencimiento NUNCA cobra alquiler ni punitorios.
 *
 * Caso real (Martinez Natalia Noemi, Alem 960, septiembre 2026). Contrato del
 * 1/9/2023 por 36 meses: el último mes con alquiler es agosto 2026 y septiembre
 * es el mes extra (mes 37 = endMonth + 1) que sólo cobra los servicios del último
 * mes, a mes vencido.
 *
 * El registro de septiembre no lo creó el generador del mes extra: lo había creado
 * el 23/04/2026 una propagación de servicios "hasta diciembre" (5 días antes de que
 * `bulkAssign` tuviera la guarda de fin de contrato, commit 83a544c), con alquiler
 * $361.000. Cuando existió el concepto de mes extra (02/07) y después la
 * re-derivación del flag (27/09), el registro quedó marcado `isPostExpiry = true`
 * pero CON alquiler: nadie ponía el alquiler en $0 si el registro ya existía, porque
 * el refresh del GET saltea los meses extra y `_recalculateCore` usaba el
 * `rentAmount` persistido. Resultado: $382.902 (alquiler + agua) en vez de $21.902.
 *
 * Y los punitorios: Control Mensual los mostraba en $0 (el flag corta la mora en
 * `computeLiveRecordPunitory`), pero el modal de pago (`calculatePunitoryPreview`)
 * y el cobro real (`registerPaymentCore`) ni siquiera leían `isPostExpiry`: calculaban
 * mora sobre los $361.000 desde el día 6.
 *
 * Además: el mes extra nacía con `previousBalance = 0` y el refresh no lo tocaba,
 * así que el saldo a favor del último mes se perdía.
 *
 * Run: bash test/integration/run.sh test/integration/postExpiryRent.test.js
 */
require('../../sim/clock.js');

const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { createGroup, createProperty, createTenant, cleanupGroup } = require('./fixtures');
const {
  getOrCreateMonthlyRecords,
  recalculateMultipleRecords,
  repairContractRecordMonthNumbers,
} = require('../../src/services/monthlyRecordService');
const { addService, updateService, removeService } = require('../../src/services/monthlyServiceService');
const { registerPayment, calculatePunitoryPreview } = require('../../src/services/paymentTransactionService');
const { closeMonth } = require('../../src/services/monthlyCloseService');

const RENT = 361000;
const AGUA_VIEJO = 20138;
const AGUA_NUEVO = 21902;

/** Contrato Alem: 1/9/2023, 36 meses → agosto 2026 = mes 36, septiembre 2026 = mes 37. */
async function seedAlem(contractOverrides = {}) {
  const group = await createGroup(prisma);
  const property = await createProperty(prisma, group.id);
  const tenant = await createTenant(prisma, group.id);
  const contract = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: property.id, tenantId: tenant.id,
      contractType: 'INQUILINO', startDate: new Date('2023-09-01T12:00:00Z'),
      startMonth: 1, durationMonths: 36, baseRent: RENT,
      punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006,
      ...contractOverrides,
    },
  });
  await prisma.rentHistory.create({ data: { contractId: contract.id, effectiveFromMonth: 1, rentAmount: RENT, reason: 'INICIAL' } });
  const agua = await prisma.conceptType.create({ data: { groupId: group.id, name: 'AGUA', label: 'Agua', category: 'SERVICIO' } });
  return { group, contract, agua };
}

/**
 * El registro de septiembre tal como lo dejó la propagación de abril: con alquiler,
 * con AGUA, y el flag como venga (`false` el de abril, `true` después del 27/09).
 */
async function seedLegacySeptember({ group, contract, agua }, { isPostExpiry = false, agua: aguaAmount = AGUA_VIEJO } = {}) {
  const r = await prisma.monthlyRecord.create({
    data: {
      groupId: group.id, contractId: contract.id, monthNumber: 37, periodMonth: 9, periodYear: 2026,
      rentAmount: RENT, servicesTotal: aguaAmount, totalDue: RENT + aguaAmount, balance: -(RENT + aguaAmount),
      isPostExpiry,
    },
  });
  const svc = await prisma.monthlyService.create({ data: { monthlyRecordId: r.id, conceptTypeId: agua.id, amount: aguaAmount } });
  return { record: r, service: svc };
}

const getRow = async (groupId, contractId, month, year = 2026) =>
  (await getOrCreateMonthlyRecords(groupId, month, year)).find((r) => r.contractId === contractId);

const dbRecord = (contractId, month, year = 2026) =>
  prisma.monthlyRecord.findFirst({ where: { contractId, periodMonth: month, periodYear: year } });

function assertServicesOnly(rec, servicesTotal, label) {
  assert.strictEqual(rec.rentAmount, 0, `${label}: el mes extra no cobra alquiler (tenía ${rec.rentAmount})`);
  assert.strictEqual(rec.ivaAmount || 0, 0, `${label}: ni IVA`);
  assert.strictEqual(rec.servicesTotal, servicesTotal, `${label}: conserva los servicios`);
  assert.strictEqual(rec.punitoryAmount || 0, 0, `${label}: ni punitorios`);
  assert.strictEqual(rec.totalDue, servicesTotal, `${label}: total = sólo servicios`);
  assert.strictEqual(rec.isPostExpiry, true, `${label}: sigue siendo el mes extra`);
}

test.afterEach(() => global.__clearNow());
test.after(async () => { await prisma.$disconnect(); });

// ─── Casos que estaban MAL ──────────────────────────────────────────────────

test('Alem exacto: el registro viejo con alquiler pierde el alquiler al abrir el Control Mensual', async () => {
  const s = await seedAlem();
  try {
    await seedLegacySeptember(s, { isPostExpiry: true, agua: AGUA_NUEVO }); // estado actual de producción
    global.__setNow(2026, 10, 1);
    const row = await getRow(s.group.id, s.contract.id, 9);

    assert.strictEqual(row.rentAmount, 0, 'la pantalla muestra alquiler $0');
    assert.strictEqual(row.livePunitoryAmount || 0, 0, 'sin punitorios en vivo');
    assert.strictEqual(row.liveTotalDue, AGUA_NUEVO, `total $${AGUA_NUEVO}, no $${RENT + AGUA_NUEVO}`);
    assertServicesOnly(await dbRecord(s.contract.id, 9), AGUA_NUEVO, 'DB tras el GET');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('Alem desde abril: flag todavía en false → el GET lo marca mes extra Y le saca el alquiler', async () => {
  const s = await seedAlem();
  try {
    await seedLegacySeptember(s, { isPostExpiry: false });
    global.__setNow(2026, 9, 28);
    await getRow(s.group.id, s.contract.id, 9);
    assertServicesOnly(await dbRecord(s.contract.id, 9), AGUA_VIEJO, 'DB tras el GET');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('editar el servicio del mes extra NO levanta el alquiler ni la mora (sin pasar antes por el GET)', async () => {
  const s = await seedAlem();
  try {
    const { service } = await seedLegacySeptember(s, { isPostExpiry: true });
    global.__setNow(2026, 9, 28);
    await updateService(service.id, AGUA_NUEVO);
    assertServicesOnly(await dbRecord(s.contract.id, 9), AGUA_NUEVO, 'tras editar el servicio');

    global.__setNow(2026, 10, 20); // muy pasado el vencimiento del día 10
    await recalculateMultipleRecords([(await dbRecord(s.contract.id, 9)).id], null, true);
    assertServicesOnly(await dbRecord(s.contract.id, 9), AGUA_NUEVO, 'recalculado 40 días después');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('agregar y borrar servicios del mes extra mantiene alquiler $0', async () => {
  const s = await seedAlem();
  try {
    const { record, service } = await seedLegacySeptember(s, { isPostExpiry: true });
    const luz = await prisma.conceptType.create({ data: { groupId: s.group.id, name: 'LUZ', label: 'Luz', category: 'SERVICIO' } });
    global.__setNow(2026, 9, 28);
    await addService(record.id, luz.id, 5000);
    assertServicesOnly(await dbRecord(s.contract.id, 9), AGUA_VIEJO + 5000, 'tras agregar LUZ');
    await removeService(service.id);
    assertServicesOnly(await dbRecord(s.contract.id, 9), 5000, 'tras borrar AGUA');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('el modal de pago no calcula mora sobre el alquiler en el mes extra', async () => {
  const s = await seedAlem();
  try {
    const { record } = await seedLegacySeptember(s, { isPostExpiry: true });
    global.__setNow(2026, 10, 1);
    const preview = await calculatePunitoryPreview(record.id, '2026-10-01');
    assert.strictEqual(preview.amount, 0, `el preview daba mora sobre $${RENT} desde el 6/9: ${preview.amount}`);
    assert.strictEqual(preview.unpaidRentForPunitory, 0, 'base de punitorios 0');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('cobrar el mes extra tarde: el pago imputa sólo servicios, sin PUNITORIOS ni ALQUILER, y salda', async () => {
  const s = await seedAlem();
  try {
    const { record } = await seedLegacySeptember(s, { isPostExpiry: true, agua: AGUA_NUEVO });
    global.__setNow(2026, 10, 15);
    await registerPayment(s.group.id, record.id, { paymentDate: '2026-10-15', amount: AGUA_NUEVO });

    const tx = await prisma.paymentTransaction.findFirst({ where: { monthlyRecordId: record.id }, include: { concepts: true } });
    assert.strictEqual(tx.punitoryAmount || 0, 0, 'la transacción no congela punitorios');
    assert.ok(!tx.concepts.some((c) => c.type === 'PUNITORIOS'), 'sin concepto PUNITORIOS');
    assert.ok(!tx.concepts.some((c) => c.type === 'ALQUILER'), 'sin concepto ALQUILER');
    const after = await dbRecord(s.contract.id, 9);
    assert.strictEqual(after.rentAmount, 0);
    assert.strictEqual(after.balance, 0, 'el pago de los servicios salda el mes');
    assert.strictEqual(after.status, 'COMPLETE');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('el mes extra hereda el saldo a favor del último mes (al crearse)', async () => {
  const s = await seedAlem();
  try {
    global.__setNow(2026, 8, 5);
    const ago = await getRow(s.group.id, s.contract.id, 8);
    await addService(ago.id, s.agua.id, AGUA_VIEJO);
    await registerPayment(s.group.id, ago.id, { paymentDate: '2026-08-05', amount: RENT + AGUA_VIEJO + 10000 });

    global.__setNow(2026, 9, 2);
    await getRow(s.group.id, s.contract.id, 9);
    const sep = await dbRecord(s.contract.id, 9);
    assert.strictEqual(sep.isPostExpiry, true);
    assert.strictEqual(sep.previousBalance, 10000, 'los $10.000 de más de agosto pasan a septiembre');
    assert.strictEqual(sep.totalDue, AGUA_VIEJO - 10000, 'y se descuentan de los servicios');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('el mes extra toma el saldo a favor aunque el pago del último mes llegue DESPUÉS de crearlo', async () => {
  const s = await seedAlem();
  try {
    global.__setNow(2026, 8, 5);
    const ago = await getRow(s.group.id, s.contract.id, 8);
    global.__setNow(2026, 9, 2);
    await getRow(s.group.id, s.contract.id, 9); // septiembre ya existe, sin crédito
    // Pago de agosto con $50.000 de más, cargado tarde (con fecha en término).
    await registerPayment(s.group.id, ago.id, { paymentDate: '2026-08-05', amount: RENT + 50000 });
    await getRow(s.group.id, s.contract.id, 9);
    const sep = await dbRecord(s.contract.id, 9);
    assert.strictEqual(sep.previousBalance, 50000);
    assert.strictEqual(sep.status, 'COMPLETE', 'el crédito cubre los servicios del mes extra');
    assert.strictEqual(sep.balance, 50000 - sep.servicesTotal);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

// ─── Casos que estaban BIEN y tienen que seguir igual ──────────────────────

test('mes extra generado normalmente: alquiler $0, servicios copiados del último mes, sin mora', async () => {
  const s = await seedAlem();
  try {
    global.__setNow(2026, 8, 5);
    const ago = await getRow(s.group.id, s.contract.id, 8);
    await addService(ago.id, s.agua.id, AGUA_VIEJO);
    global.__setNow(2026, 9, 25);
    await getRow(s.group.id, s.contract.id, 9);
    assertServicesOnly(await dbRecord(s.contract.id, 9), AGUA_VIEJO, 'mes extra recién generado');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('el ÚLTIMO mes real (agosto) sigue cobrando alquiler y devengando mora si está impago', async () => {
  const s = await seedAlem();
  try {
    global.__setNow(2026, 8, 5);
    const ago = await getRow(s.group.id, s.contract.id, 8);
    await addService(ago.id, s.agua.id, AGUA_VIEJO);
    global.__setNow(2026, 8, 20);
    const row = await getRow(s.group.id, s.contract.id, 8);
    assert.strictEqual(row.rentAmount, RENT, 'agosto conserva su alquiler');
    assert.strictEqual(row.isPostExpiry, false);
    // 6/8 → 20/8 ambos inclusive = 15 días × 0,6% × 361.000
    assert.strictEqual(row.livePunitoryAmount, Math.round(RENT * 0.006 * 15 * 100) / 100, 'agosto impago devenga mora sobre el alquiler');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('el cierre mensual sigue sin generar Deuda para el mes extra', async () => {
  const s = await seedAlem();
  try {
    await seedLegacySeptember(s, { isPostExpiry: true });
    global.__setNow(2026, 10, 2);
    await getRow(s.group.id, s.contract.id, 9);
    await closeMonth(s.group.id, 9, 2026);
    const debts = await prisma.debt.count({ where: { contractId: s.contract.id } });
    assert.strictEqual(debts, 0);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('si el contrato se extiende, el ex-mes extra vuelve a ser mes real y RECUPERA el alquiler', async () => {
  const s = await seedAlem();
  try {
    global.__setNow(2026, 9, 2);
    await getRow(s.group.id, s.contract.id, 9);
    assert.strictEqual((await dbRecord(s.contract.id, 9)).rentAmount, 0);

    const extended = await prisma.contract.update({ where: { id: s.contract.id }, data: { durationMonths: 37 } });
    await repairContractRecordMonthNumbers(extended);
    await getRow(s.group.id, s.contract.id, 9);
    const sep = await dbRecord(s.contract.id, 9);
    assert.strictEqual(sep.isPostExpiry, false);
    assert.strictEqual(sep.rentAmount, RENT, 'septiembre pasa a ser el mes 37 de 37 y cobra alquiler');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('un mes extra con alquiler YA SALDADO (COMPLETE) no se toca: A-06, nunca reabrir un mes cobrado', async () => {
  const s = await seedAlem();
  try {
    const { record } = await seedLegacySeptember(s, { isPostExpiry: true });
    await prisma.monthlyRecord.update({
      where: { id: record.id },
      data: { status: 'COMPLETE', isPaid: true, isCancelled: true, amountPaid: RENT + AGUA_VIEJO, balance: 0 },
    });
    global.__setNow(2026, 10, 1);
    await getRow(s.group.id, s.contract.id, 9);
    const after = await dbRecord(s.contract.id, 9);
    assert.strictEqual(after.rentAmount, RENT, 'lo cobrado queda como se cobró');
    assert.strictEqual(after.status, 'COMPLETE');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('contrato rescindido: el mes de penalidad sigue cobrando la multa (no es un mes extra)', async () => {
  const s = await seedAlem({ rescindedAt: new Date('2026-05-15T12:00:00Z'), rescissionPenalty: 200000 });
  try {
    global.__setNow(2026, 6, 3);
    const row = await getRow(s.group.id, s.contract.id, 6);
    assert.strictEqual(row.isPostExpiry || false, false);
    assert.strictEqual(row.rentAmount, 200000, 'la multa va en el lugar del alquiler');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

// ─── Bordes ────────────────────────────────────────────────────────────────

test('pago PARCIAL del mes extra: lo que queda de servicios no devenga mora, ni al cobrar ni en vivo', async () => {
  const s = await seedAlem();
  try {
    const { record } = await seedLegacySeptember(s, { isPostExpiry: true, agua: AGUA_NUEVO });
    global.__setNow(2026, 9, 20);
    await registerPayment(s.group.id, record.id, { paymentDate: '2026-09-20', amount: 10000 });

    global.__setNow(2026, 10, 25);
    const preview = await calculatePunitoryPreview(record.id, '2026-10-25');
    assert.strictEqual(preview.amount, 0, 'el saldo de servicios no genera mora en el modal');
    const row = await getRow(s.group.id, s.contract.id, 9);
    assert.strictEqual(row.livePunitoryAmount || 0, 0, 'ni en Control Mensual');
    await registerPayment(s.group.id, record.id, { paymentDate: '2026-10-25', amount: AGUA_NUEVO - 10000 });
    const after = await dbRecord(s.contract.id, 9);
    assert.strictEqual(after.balance, 0, 'el segundo pago salda justo, sin mora agregada');
    assert.strictEqual(after.status, 'COMPLETE');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('registro viejo con IVA tildado: el mes extra pierde también el IVA', async () => {
  const s = await seedAlem({ pagaIva: true });
  try {
    const { record } = await seedLegacySeptember(s, { isPostExpiry: true });
    await prisma.monthlyRecord.update({ where: { id: record.id }, data: { includeIva: true, ivaAmount: RENT * 0.21 } });
    global.__setNow(2026, 10, 1);
    await getRow(s.group.id, s.contract.id, 9);
    const after = await dbRecord(s.contract.id, 9);
    assert.strictEqual(after.includeIva, false);
    assertServicesOnly(after, AGUA_VIEJO, 'con IVA');
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('contrato que paga IVA: el último mes real lo conserva, el mes extra nace sin IVA', async () => {
  const s = await seedAlem({ pagaIva: true });
  try {
    global.__setNow(2026, 8, 5);
    await getRow(s.group.id, s.contract.id, 8);
    const ago = await dbRecord(s.contract.id, 8);
    assert.strictEqual(ago.includeIva, true);
    assert.strictEqual(ago.ivaAmount, RENT * 0.21);
    global.__setNow(2026, 9, 5);
    await getRow(s.group.id, s.contract.id, 9);
    const sep = await dbRecord(s.contract.id, 9);
    assert.strictEqual(sep.includeIva, false);
    assert.strictEqual(sep.ivaAmount, 0);
  } finally { await cleanupGroup(prisma, s.group.id); }
});

test('contrato renovado: no hay mes extra y su registro viejo fuera de rango no se toca', async () => {
  const s = await seedAlem({ active: false, renewedAt: new Date('2026-08-20T12:00:00Z') });
  try {
    const { record } = await seedLegacySeptember(s, { isPostExpiry: false });
    global.__setNow(2026, 10, 1);
    const row = await getRow(s.group.id, s.contract.id, 9);
    assert.strictEqual(row, undefined, 'el renovado no muestra mes extra');
    const after = await prisma.monthlyRecord.findUnique({ where: { id: record.id } });
    assert.strictEqual(after.rentAmount, RENT, 'el histórico del renovado queda intacto');
  } finally { await cleanupGroup(prisma, s.group.id); }
});
