/*
 * Meses terminados sin Deuda que deben ("meses huérfanos") — caso Gutiérrez Juan Rodrigo
 * (Miguel Cervantes 581), reportado 2026-10-20: debía agosto (saldo $130.685,41 después de que
 * julio sobrepagado dejara $809.497,64 a favor), septiembre (Deuda) y octubre (mes actual). Al
 * cobrar Octubre con "Pagar varios meses" se sumaban Septiembre y Octubre y Agosto no aparecía:
 * el cierre de agosto lo había salteado (flag post-vencimiento rancio) y, sin pagos propios, nada
 * lo veía. Ver src/services/unclosedMonths.js.
 *
 * Contra la base real descartable, con el flujo real (getOrCreateMonthlyRecords, registerPayment,
 * closeMonth, payDebt, payDebtsBulk, servicios, anular pago, condonación, edición de contrato).
 *
 * Run: bash test/integration/run.sh test/integration/mesesSinCerrar.test.js
 */
require('../../sim/clock.js');

const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { createGroup, createProperty, createTenant, cleanupGroup } = require('./fixtures');
const { snapshotGroup } = require('./snapshot');
const { flushRecalculation } = require('./flush');
const { getOrCreateMonthlyRecords } = require('../../src/services/monthlyRecordService');
const { addService } = require('../../src/services/monthlyServiceService');
const { closeMonth, previewCloseMonth } = require('../../src/services/monthlyCloseService');
const { registerPayment, deleteTransaction } = require('../../src/services/paymentTransactionService');
const {
  previewBulkDebtPayment, payDebtsBulk, payDebt, canPayCurrentMonth, calculateDebtPunitory,
  createDebtFromMonthlyRecord, getDebtsSummary, getOpenDebts,
} = require('../../src/services/debtService');
const { findUnclosedOwingRecords, ensureDebtsForUnclosedMonths } = require('../../src/services/unclosedMonths');

const RENT = 900000;
const CREDIT = 809497.64; // lo que le sobró a julio (caso real)
const TODAY = [2026, 10, 20];
const TODAY_STR = '2026-10-20';

const near = (a, b, msg, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const key = (m, y = 2026) => y * 12 + m;

test.afterEach(() => global.__clearNow());
test.after(async () => { await prisma.$disconnect(); });

const setNow = (y, m, d) => global.__setNow(y, m, d);

async function openMonth(groupId, m) {
  setNow(2026, m, 1);
  await getOrCreateMonthlyRecords(groupId, m, 2026);
  await flushRecalculation(prisma, groupId);
}

const recordOf = (contractId, m) => prisma.monthlyRecord.findFirst({ where: { contractId, periodMonth: m, periodYear: 2026 } });
const debtOf = (contractId, m) => prisma.debt.findFirst({ where: { contractId, periodMonth: m, periodYear: 2026 } });

/**
 * El cierre de ANTES de este arreglo: crea la Deuda de los meses del período pedido y nada más
 * (sin el barrido de meses anteriores). Así se arma el estado real que dejó el cierre viejo.
 */
async function legacyClose(groupId, m) {
  setNow(2026, m + 1, 1);
  const recs = await prisma.monthlyRecord.findMany({
    where: { groupId, periodMonth: m, periodYear: 2026, isPostExpiry: false },
    include: {
      contract: true,
      services: { include: { conceptType: { select: { category: true } } } },
      transactions: { orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }], include: { concepts: { select: { type: true, amount: true } } } },
    },
  });
  for (const r of recs) await createDebtFromMonthlyRecord(r, r.contract);
}

async function pay(groupId, recordId, amount, [y, m, d]) {
  setNow(y, m, d);
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const res = await registerPayment(groupId, recordId, { paymentDate: date, amount, paymentMethod: 'TRANSFERENCIA' });
  await flushRecalculation(prisma, groupId);
  return res;
}

/**
 * Gutiérrez: contrato A jun–ago 2026 (3 meses) renovado por B desde sep 2026.
 * Junio pagado, julio sobrepagado (+$809.497,64), agosto sin pagos y SIN Deuda (el cierre lo
 * salteó), septiembre en Deuda, octubre mes actual. Reloj: 20/10/2026.
 */
async function seedGutierrez() {
  const group = await createGroup(prisma);
  const property = await createProperty(prisma, group.id);
  const tenant = await createTenant(prisma, group.id);
  const terms = { punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const A = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: property.id, tenantId: tenant.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 3, baseRent: RENT, ...terms,
    },
  });
  await prisma.rentHistory.create({ data: { contractId: A.id, effectiveFromMonth: 1, rentAmount: RENT, reason: 'INICIAL' } });

  await openMonth(group.id, 6);
  await pay(group.id, (await recordOf(A.id, 6)).id, RENT, [2026, 6, 5]);
  await openMonth(group.id, 7);
  await pay(group.id, (await recordOf(A.id, 7)).id, RENT + CREDIT, [2026, 7, 5]);
  await openMonth(group.id, 8);
  await legacyClose(group.id, 6);
  await legacyClose(group.id, 7);
  // Agosto: el cierre viejo lo salteó (flag post-vencimiento rancio). No se cierra.

  setNow(2026, 8, 28);
  await prisma.contract.update({ where: { id: A.id }, data: { active: false, renewedAt: new Date(2026, 7, 28, 12) } });
  const B = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: property.id, tenantId: tenant.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 8, 1, 12), startMonth: 1, durationMonths: 24, baseRent: RENT,
      renewedFromContractId: A.id, ...terms,
    },
  });
  await prisma.rentHistory.create({ data: { contractId: B.id, effectiveFromMonth: 1, rentAmount: RENT, reason: 'INICIAL' } });

  await openMonth(group.id, 9);
  await legacyClose(group.id, 9);
  await openMonth(group.id, 10);
  setNow(...TODAY);
  return { group, A, B };
}

const withSeed = (fn) => async () => {
  const s = await seedGutierrez();
  try { await fn(s); } finally { await cleanupGroup(prisma, s.group.id); }
};

// ─── El estado del caso real ─────────────────────────────────────────────────

test('estado de partida = caso Gutiérrez: agosto debe, sin Deuda y sin pagos propios', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  near(aug.previousBalance, CREDIT, 'agosto arrastra el sobrante de julio');
  assert.strictEqual(aug.amountPaid, 0);
  assert.strictEqual(await debtOf(A.id, 8), null, 'agosto no tiene Deuda');
  assert.ok(await debtOf(B.id, 9), 'septiembre sí está en Deuda');
}));

// ─── Lecturas: el mes huérfano se ve, sin escribir ───────────────────────────

test('cobrar Octubre: bloquea por Agosto y la lista trae Agosto + Septiembre', withSeed(async ({ A, B }) => {
  const res = await canPayCurrentMonth(B.groupId, B.id, { periodMonth: 10, periodYear: 2026 });
  assert.strictEqual(res.canPay, false);
  assert.strictEqual(res.blockingPeriod.periodMonth, 8);
  assert.strictEqual(res.blockingPeriod.type, 'PENDING_DEBT');
  assert.strictEqual(res.blockingPeriod.virtualDebt, undefined, 'la Deuda virtual no sale por la API');
  assert.deepStrictEqual(res.debts.map((d) => [d.periodMonth, d.type]), [[8, 'PENDING_DEBT'], [9, 'DEBT']]);
  const aug = res.debts[0];
  assert.strictEqual(aug.id, null);
  assert.strictEqual(aug.pendingClose, true);
  assert.strictEqual(aug.monthlyRecordId, (await recordOf(A.id, 8)).id);
  assert.ok(aug.total > RENT - CREDIT, 'agosto debe el neto + mora');
}));

test('cobrar la Deuda de Septiembre también bloquea por Agosto', withSeed(async ({ B }) => {
  const res = await canPayCurrentMonth(B.groupId, B.id, { periodMonth: 9, periodYear: 2026 });
  assert.strictEqual(res.canPay, false);
  assert.strictEqual(res.blockingPeriod.periodMonth, 8);
}));

test('legacy (sin período): un mes sin cerrar alcanza para bloquear', withSeed(async ({ A, B }) => {
  // Septiembre condonado (PAID): sólo queda agosto. La Deuda sigue existiendo (el grupo cerró sep).
  await prisma.debt.updateMany({ where: { contractId: B.id }, data: { status: 'PAID' } });
  const res = await canPayCurrentMonth(B.groupId, B.id);
  assert.strictEqual(res.canPay, false);
  assert.strictEqual(res.debts.length, 1);
  assert.strictEqual(res.debts[0].monthlyRecordId, (await recordOf(A.id, 8)).id);
}));

test('"Pagar varios" desde Octubre: Agosto + Septiembre + Octubre, y el total es la suma', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  const preview = await previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id, [aug.id]);
  assert.deepStrictEqual(preview.debts.map((it) => it.periodMonth), [8, 9, 10]);
  const [a, , o] = preview.debts;
  assert.strictEqual(a.pendingClose, true);
  assert.strictEqual(a.monthlyRecordId, aug.id);
  assert.strictEqual(a.id, null);
  assert.strictEqual(o.type, 'RECORD');
  near(preview.total, preview.debts.reduce((s, it) => s + it.totalToPay, 0), 'total = suma');
  // El mes huérfano, como Deuda: alquiler completo, crédito restado del total, mora sobre el
  // alquiler completo (regla 2026-10-20) — igual que la Deuda de septiembre.
  assert.strictEqual(a.remainingRent, RENT);
  near(a.totalToPay, RENT - CREDIT + a.punitory, 'agosto: alquiler − crédito + mora');
  assert.ok(a.punitoryDays > 60, `agosto lleva más de 60 días de mora (${a.punitoryDays})`);
  near(a.punitory, a.punitoryDays * 0.006 * RENT, 'mora = días × 0,6% × alquiler completo', 2);
}));

test('"Pagar varios" sin Agosto se rechaza nombrándolo (nunca se omite en silencio)', withSeed(async ({ B }) => {
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  await assert.rejects(
    previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id),
    (e) => e.code === 'ORDER_BLOCK' && /Agosto 2026/.test(e.message) && e.blockingPeriod.virtualDebt === undefined,
  );
  await assert.rejects(
    payDebtsBulk(B.groupId, [sep.id], 5000000, TODAY_STR, 'EFECTIVO', null, oct.id),
    (e) => e.code === 'ORDER_BLOCK' && /Agosto 2026/.test(e.message),
  );
  assert.strictEqual(await prisma.debt.count({ where: { groupId: B.groupId } }), 1, 'el rechazo no creó nada');
}));

test('las lecturas no escriben (canPay, preview de "Pagar varios", preview del cierre)', withSeed(async ({ A, B }) => {
  const before = await snapshotGroup(prisma, B.groupId);
  const aug = await recordOf(A.id, 8);
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  await canPayCurrentMonth(B.groupId, B.id, { periodMonth: 10, periodYear: 2026 });
  await previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id, [aug.id]);
  await previewBulkDebtPayment(B.groupId, [], TODAY_STR, null, [aug.id]);
  setNow(2026, 10, 31);
  const prev = await previewCloseMonth(B.groupId, 10, 2026);
  assert.deepStrictEqual(prev.previousUnclosed.map((u) => u.periodLabel), ['Agosto 2026']);
  assert.strictEqual(prev.previousUnclosed[0].monthlyRecordId, aug.id);
  assert.strictEqual(prev.summary.previousUnclosed, 1);
  await flushRecalculation(prisma, B.groupId);
  assert.deepStrictEqual(await snapshotGroup(prisma, B.groupId), before);
}));

// ─── Escrituras: el mes huérfano pasa a Deuda ────────────────────────────────

test('pagar todo con "Pagar varios": crea la Deuda de Agosto y salda los tres meses', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  const preview = await previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id, [aug.id]);
  const res = await payDebtsBulk(B.groupId, [sep.id], preview.total, TODAY_STR, 'EFECTIVO', null, oct.id, false, [aug.id]);
  await flushRecalculation(prisma, B.groupId);

  const augDebt = await debtOf(A.id, 8);
  assert.ok(augDebt, 'se creó la Deuda de agosto');
  assert.strictEqual(augDebt.status, 'PAID');
  near(augDebt.appliedCredit, CREDIT, 'el crédito de julio queda como crédito aplicado');
  near(res.results[0].allocated, preview.debts[0].totalToPay, 'agosto cobró lo que mostraba el preview');
  assert.strictEqual((await debtOf(B.id, 9)).status, 'PAID');
  assert.strictEqual((await recordOf(B.id, 10)).status, 'COMPLETE');
  assert.deepStrictEqual(res.results.map((r) => r.periodLabel), ['Agosto 2026', 'Septiembre 2026']);
}));

test('pago parcial que cubre sólo Agosto: Agosto saldado, Septiembre y Octubre intactos', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  const preview = await previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id, [aug.id]);
  const augTotal = preview.debts[0].totalToPay;
  await payDebtsBulk(B.groupId, [sep.id], augTotal, TODAY_STR, 'EFECTIVO', null, oct.id, false, [aug.id]);
  await flushRecalculation(prisma, B.groupId);
  assert.strictEqual((await debtOf(A.id, 8)).status, 'PAID');
  assert.strictEqual((await debtOf(B.id, 9)).amountPaid, 0);
  assert.strictEqual((await recordOf(B.id, 10)).amountPaid, 0);
}));

test('sólo meses sin cerrar (sin debtIds ni mes actual) también se cobran', withSeed(async ({ A, B }) => {
  await prisma.debt.updateMany({ where: { contractId: B.id }, data: { status: 'PAID' } });
  const aug = await recordOf(A.id, 8);
  const preview = await previewBulkDebtPayment(B.groupId, [], TODAY_STR, null, [aug.id]);
  assert.deepStrictEqual(preview.debts.map((it) => it.periodMonth), [8]);
  await payDebtsBulk(B.groupId, [], preview.total, TODAY_STR, 'EFECTIVO', null, null, false, [aug.id]);
  assert.strictEqual((await debtOf(A.id, 8)).status, 'PAID');
}));

test('condonando punitorios: Agosto se topea sin mora y el resto va al mes siguiente', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  await payDebtsBulk(B.groupId, [sep.id], RENT - CREDIT, TODAY_STR, 'EFECTIVO', null, oct.id, true, [aug.id]);
  await flushRecalculation(prisma, B.groupId);
  const augDebt = await debtOf(A.id, 8);
  assert.strictEqual(augDebt.status, 'PAID');
  assert.strictEqual((await debtOf(B.id, 9)).amountPaid, 0, 'nada se fue a septiembre');
}));

test('el mes que pasó a Deuda entre el preview y el cobro se cobra igual (por su Deuda)', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  const sep = await debtOf(B.id, 9);
  const oct = await recordOf(B.id, 10);
  const preview = await previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id, [aug.id]);
  await ensureDebtsForUnclosedMonths({ groupId: B.groupId, contractIds: [B.id, A.id], today: TODAY_STR }); // otro camino lo cerró
  // El preview ya con la Deuda real: mismo número que la virtual.
  const again = await previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, oct.id, [aug.id]);
  near(again.debts[0].totalToPay, preview.debts[0].totalToPay, 'virtual ≡ real');
  assert.strictEqual(again.debts[0].pendingClose, false);
  await payDebtsBulk(B.groupId, [sep.id], preview.total, TODAY_STR, 'EFECTIVO', null, oct.id, false, [aug.id]);
  assert.strictEqual((await debtOf(A.id, 8)).status, 'PAID');
  assert.strictEqual(await prisma.debt.count({ where: { monthlyRecordId: aug.id } }), 1);
}));

test('un mes ya saldado no se puede mandar como "sin cerrar"', withSeed(async ({ A, B }) => {
  const jul = await recordOf(A.id, 7);
  const sep = await debtOf(B.id, 9);
  await assert.rejects(
    previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, null, [jul.id]),
    (e) => e.code === 'PAYMENT_INPUT' && /ya no adeuda/.test(e.message),
  );
  await assert.rejects(
    previewBulkDebtPayment(B.groupId, [sep.id], TODAY_STR, null, ['no-existe']),
    (e) => e.code === 'PAYMENT_INPUT' && /no existe/.test(e.message),
  );
  const other = await createGroup(prisma);
  try {
    await assert.rejects(
      previewBulkDebtPayment(other.id, [], TODAY_STR, null, [jul.id]),
      (e) => e.code === 'PAYMENT_INPUT' && /no pertenece/.test(e.message),
    );
  } finally { await cleanupGroup(prisma, other.id); }
}));

test('cobrar Octubre solo: pasa Agosto a Deuda y bloquea (pagá primero Agosto)', withSeed(async ({ A, B }) => {
  const oct = await recordOf(B.id, 10);
  await assert.rejects(
    registerPayment(B.groupId, oct.id, { paymentDate: TODAY_STR, amount: 100000, paymentMethod: 'EFECTIVO' }),
    (e) => e.code === 'DEBT_BLOCK' && /Agosto 2026/.test(e.message),
  );
  const augDebt = await debtOf(A.id, 8);
  assert.ok(augDebt && augDebt.status === 'OPEN', 'agosto quedó como Deuda');
  assert.strictEqual((await recordOf(B.id, 10)).amountPaid, 0);
}));

test('cobrar Agosto desde el Control Mensual: pasa a Deuda y avisa que se cobra desde Deudas', withSeed(async ({ A, B }) => {
  const aug = await recordOf(A.id, 8);
  await assert.rejects(
    registerPayment(B.groupId, aug.id, { paymentDate: TODAY_STR, amount: 100000, paymentMethod: 'EFECTIVO' }),
    (e) => e.code === 'PAYMENT_BLOCKED' && /Agosto 2026 ya pasó a deuda/.test(e.message),
  );
  assert.ok(await debtOf(A.id, 8));
}));

test('pagar la Deuda de Septiembre sola: pasa Agosto a Deuda y bloquea por orden', withSeed(async ({ A, B }) => {
  const sep = await debtOf(B.id, 9);
  await assert.rejects(
    payDebt(sep.id, 100000, TODAY_STR, 'EFECTIVO'),
    (e) => e.code === 'ORDER_BLOCK' && /Agosto 2026/.test(e.message) && e.blockingPeriod.virtualDebt === undefined,
  );
  assert.ok(await debtOf(A.id, 8));
  // Y la Deuda nueva de agosto sí se puede pagar (es la más vieja).
  const augDebt = await debtOf(A.id, 8);
  await payDebt(augDebt.id, 1000, TODAY_STR, 'EFECTIVO');
  assert.strictEqual((await debtOf(A.id, 8)).status, 'PARTIAL');
}));

test('el próximo "Cerrar mes" pasa Agosto a Deuda (red de seguridad mensual)', withSeed(async ({ A, B }) => {
  setNow(2026, 10, 31);
  const res = await closeMonth(B.groupId, 10, 2026);
  assert.deepStrictEqual(res.previousMonthsClosed, ['Agosto 2026']);
  assert.ok(await debtOf(A.id, 8));
  assert.ok(await debtOf(B.id, 10), 'y octubre se cerró normalmente');
  // Idempotente.
  const again = await closeMonth(B.groupId, 10, 2026);
  assert.deepStrictEqual(again.previousMonthsClosed, []);
  assert.strictEqual(await prisma.debt.count({ where: { monthlyRecordId: (await recordOf(A.id, 8)).id } }), 1);
}));

test('después de pasar a Deuda, Agosto entra en Deudas y en el dashboard', withSeed(async ({ A, B }) => {
  const before = await getDebtsSummary(B.groupId);
  await ensureDebtsForUnclosedMonths({ groupId: B.groupId, contractIds: [B.id, A.id], today: TODAY_STR });
  const after = await getDebtsSummary(B.groupId);
  assert.strictEqual(after.openDebtsCount, before.openDebtsCount + 1);
  assert.ok(after.totalDebt > before.totalDebt + (RENT - CREDIT));
  const list = await getOpenDebts(B.groupId, B.id);
  assert.deepStrictEqual(list.map((d) => d.periodMonth), [8, 9]);
}));

test('virtual ≡ real: la Deuda creada da el mismo total que se mostraba antes de crearla', withSeed(async ({ A, B }) => {
  const res = await canPayCurrentMonth(B.groupId, B.id, { periodMonth: 10, periodYear: 2026 });
  const shown = res.debts[0].total;
  await ensureDebtsForUnclosedMonths({ groupId: B.groupId, contractIds: [B.id, A.id], today: TODAY_STR });
  const augDebt = await prisma.debt.findFirst({ where: { contractId: A.id, periodMonth: 8 }, include: { payments: true } });
  const live = await calculateDebtPunitory(augDebt, TODAY_STR, null, true);
  near(live.remainingDebt + (live.unpaidAccumulatedPunitory || 0) + live.amount, shown, 'mismo total');
}));

test('cierre tardío ≡ cierre a tiempo: la mora de Agosto al 20/10 no depende de cuándo se creó la Deuda', async () => {
  const late = await seedGutierrez();
  const onTime = await seedGutierrez();
  try {
    // A tiempo: el cierre de agosto el 1/9 (como debió pasar).
    await legacyClose(onTime.group.id, 8);
    setNow(...TODAY);
    // Tarde: hoy.
    await ensureDebtsForUnclosedMonths({ groupId: late.group.id, contractIds: [late.B.id, late.A.id], today: TODAY_STR });
    const total = async (s) => {
      const d = await prisma.debt.findFirst({ where: { contractId: s.A.id, periodMonth: 8 }, include: { payments: true } });
      const r = await calculateDebtPunitory(d, TODAY_STR, null, true);
      return { total: r.remainingDebt + (r.unpaidAccumulatedPunitory || 0) + r.amount, days: r.days };
    };
    const a = await total(onTime);
    const b = await total(late);
    near(b.total, a.total, 'mismo total');
    assert.strictEqual(b.days, a.days);
  } finally {
    await cleanupGroup(prisma, late.group.id);
    await cleanupGroup(prisma, onTime.group.id);
  }
});

test('concurrencia: dos escritores a la vez crean UNA sola Deuda', withSeed(async ({ A, B }) => {
  const args = { groupId: B.groupId, contractIds: [B.id, A.id], today: TODAY_STR };
  await Promise.all([ensureDebtsForUnclosedMonths(args), ensureDebtsForUnclosedMonths(args), ensureDebtsForUnclosedMonths(args)]);
  assert.strictEqual(await prisma.debt.count({ where: { contractId: A.id, periodMonth: 8 } }), 1);
}));

// ─── Cómo nacen los huérfanos: cada camino lo deja como Deuda ────────────────

/** Contrato simple desde junio, pagado al día, con meses cerrados. */
async function seedPaidMonths() {
  const group = await createGroup(prisma);
  const property = await createProperty(prisma, group.id);
  const tenant = await createTenant(prisma, group.id);
  const C = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: property.id, tenantId: tenant.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 24, baseRent: 100000,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  await prisma.rentHistory.create({ data: { contractId: C.id, effectiveFromMonth: 1, rentAmount: 100000, reason: 'INICIAL' } });
  // Otro inquilino que debe junio, para que el grupo tenga cierres (Deudas) hasta septiembre.
  const t2 = await createTenant(prisma, group.id);
  const p2 = await createProperty(prisma, group.id);
  const D = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: p2.id, tenantId: t2.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 24, baseRent: 50000,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  await prisma.rentHistory.create({ data: { contractId: D.id, effectiveFromMonth: 1, rentAmount: 50000, reason: 'INICIAL' } });
  for (const m of [6, 7, 8, 9]) {
    await openMonth(group.id, m);
    await pay(group.id, (await recordOf(C.id, m)).id, 100000, [2026, m, 5]);
    setNow(2026, m + 1, 1);
    await closeMonth(group.id, m, 2026);
    await flushRecalculation(prisma, group.id);
  }
  await openMonth(group.id, 10);
  setNow(...TODAY);
  return { group, C, D };
}

const withPaid = (fn) => async () => {
  const s = await seedPaidMonths();
  try { await fn(s); } finally { await cleanupGroup(prisma, s.group.id); }
};

test('origen: el cierre ya NO saltea un mes con flag post-vencimiento rancio (en rango)', async () => {
  const group = await createGroup(prisma);
  try {
    const property = await createProperty(prisma, group.id);
    const tenant = await createTenant(prisma, group.id);
    const C = await prisma.contract.create({
      data: {
        groupId: group.id, propertyId: property.id, tenantId: tenant.id, contractType: 'INQUILINO',
        startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 3, baseRent: 100000,
        punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
      },
    });
    await prisma.rentHistory.create({ data: { contractId: C.id, effectiveFromMonth: 1, rentAmount: 100000, reason: 'INICIAL' } });
    await openMonth(group.id, 8);
    const aug = await recordOf(C.id, 8);
    await prisma.monthlyRecord.update({ where: { id: aug.id }, data: { isPostExpiry: true } }); // flag rancio
    setNow(2026, 9, 1);
    await closeMonth(group.id, 8, 2026);
    assert.ok(await debtOf(C.id, 8), 'agosto (mes 3 de 3) genera su Deuda aunque el flag diga post-vencimiento');
    // El mes extra REAL (septiembre = mes 4, endMonth + 1) sigue sin generar Deuda.
    await openMonth(group.id, 9);
    const sep = await recordOf(C.id, 9);
    assert.ok(sep.isPostExpiry);
    setNow(2026, 10, 1);
    await closeMonth(group.id, 9, 2026);
    assert.strictEqual(await debtOf(C.id, 9), null);
  } finally { await cleanupGroup(prisma, group.id); }
});

test('origen: anular el pago de un mes cerrado y saldado lo pasa a Deuda', withPaid(async ({ group, C }) => {
  const jul = await recordOf(C.id, 7);
  const tx = await prisma.paymentTransaction.findFirst({ where: { monthlyRecordId: jul.id } });
  // LIFO por contrato: se anulan de la más nueva a la más vieja.
  for (const m of [9, 8]) {
    const t = await prisma.paymentTransaction.findFirst({ where: { monthlyRecordId: (await recordOf(C.id, m)).id } });
    await deleteTransaction(group.id, t.id);
  }
  await deleteTransaction(group.id, tx.id);
  await flushRecalculation(prisma, group.id);
  const months = (await prisma.debt.findMany({ where: { contractId: C.id }, orderBy: { periodMonth: 'asc' } })).map((d) => d.periodMonth);
  assert.deepStrictEqual(months, [7, 8, 9]);
}));

test('origen: agregar un servicio a un mes cerrado y saldado lo pasa a Deuda', withPaid(async ({ group, C }) => {
  const luz = await prisma.conceptType.create({ data: { groupId: group.id, name: 'LUZ', label: 'Luz', category: 'SERVICIO' } });
  const aug = await recordOf(C.id, 8);
  await addService(aug.id, luz.id, 20000);
  await flushRecalculation(prisma, group.id);
  const d = await debtOf(C.id, 8);
  assert.ok(d, 'agosto pasó a Deuda');
  near(d.unpaidServicesAmount + d.unpaidRentAmount - d.appliedCredit, 20000, 'debe exactamente el servicio');
}));

test('origen: revertir la condonación de un mes cerrado lo pasa a Deuda', withPaid(async ({ group, C }) => {
  const { forgiveBalance } = require('../../src/controllers/monthlyRecordsController');
  const jul = await recordOf(C.id, 7);
  // Mes de julio con saldo condonado (sin pagos): se borra el pago y se condona a mano.
  for (const m of [9, 8, 7]) {
    const t = await prisma.paymentTransaction.findFirst({ where: { monthlyRecordId: (await recordOf(C.id, m)).id } });
    if (m === 7) {
      await prisma.debt.deleteMany({ where: { contractId: C.id } });
      await prisma.transactionConcept.deleteMany({ where: { transactionId: t.id } });
      await prisma.paymentTransaction.delete({ where: { id: t.id } });
    } else {
      await deleteTransaction(group.id, t.id);
    }
  }
  await prisma.debt.deleteMany({ where: { contractId: C.id } });
  await prisma.monthlyRecord.update({ where: { id: jul.id }, data: { amountPaid: 0, balanceForgiven: 100000, balanceForgivenAt: new Date() } });
  // Mientras está condonado no es un huérfano.
  let found = await findUnclosedOwingRecords({ groupId: group.id, contractIds: [C.id], today: TODAY_STR });
  assert.ok(!found.some((f) => f.record.id === jul.id));
  const res = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => res) });
  await forgiveBalance({ params: { groupId: group.id, recordId: jul.id }, body: { forgive: false } }, res, (e) => { throw e; });
  assert.ok(await debtOf(C.id, 7), 'julio pasó a Deuda al revertir la condonación');
}));

test('origen: editar el cronograma que mete en rango un mes ya terminado lo pasa a Deuda', async () => {
  const group = await createGroup(prisma);
  try {
    const property = await createProperty(prisma, group.id);
    const tenant = await createTenant(prisma, group.id);
    const C = await prisma.contract.create({
      data: {
        groupId: group.id, propertyId: property.id, tenantId: tenant.id, contractType: 'INQUILINO',
        startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 2, baseRent: 100000,
        punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
      },
    });
    await prisma.rentHistory.create({ data: { contractId: C.id, effectiveFromMonth: 1, rentAmount: 100000, reason: 'INICIAL' } });
    for (const m of [6, 7, 8, 9]) {
      await openMonth(group.id, m);
      const r = await recordOf(C.id, m);
      if (r && m <= 7) await pay(group.id, r.id, 100000, [2026, m, 5]);
      setNow(2026, m + 1, 1);
      await closeMonth(group.id, m, 2026);
      await flushRecalculation(prisma, group.id);
    }
    // Para que el grupo tenga cierres hasta septiembre (la Deuda de otro inquilino).
    const t2 = await createTenant(prisma, group.id);
    const p2 = await createProperty(prisma, group.id);
    const D = await prisma.contract.create({
      data: {
        groupId: group.id, propertyId: p2.id, tenantId: t2.id, contractType: 'INQUILINO',
        startDate: new Date(2026, 8, 1, 12), startMonth: 1, durationMonths: 24, baseRent: 50000,
      },
    });
    const r9 = await prisma.monthlyRecord.create({
      data: { groupId: group.id, contractId: D.id, monthNumber: 1, periodMonth: 9, periodYear: 2026, rentAmount: 50000, totalDue: 50000 },
    });
    await prisma.debt.create({
      data: {
        groupId: group.id, contractId: D.id, monthlyRecordId: r9.id, periodLabel: 'Septiembre 2026', periodMonth: 9, periodYear: 2026,
        originalAmount: 50000, unpaidRentAmount: 50000, currentTotal: 50000, punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 8, 1),
      },
    });
    setNow(...TODAY);
    // Antes de editar: agosto (mes 3) está fuera de un contrato de 2 meses → no es huérfano.
    let found = await findUnclosedOwingRecords({ groupId: group.id, contractIds: [C.id], today: TODAY_STR });
    assert.deepStrictEqual(found.map((f) => f.record.periodMonth), []);

    const { updateContract } = require('../../src/controllers/contractsController');
    const calls = [];
    const res = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => { calls.push([k, a]); return res; }) });
    let failure = null;
    // `asyncHandler` no devuelve la promesa: se espera a que el controller responda.
    updateContract(
      { params: { groupId: group.id, id: C.id }, body: { durationMonths: 24 }, user: { id: 'u' } },
      res,
      (e) => { failure = e; },
    );
    for (let i = 0; i < 500 && calls.length === 0 && !failure; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.some(([k]) => k === 'status' || k === 'json'), 'el controller respondió');
    assert.strictEqual(failure, null, failure && failure.message);
    await flushRecalculation(prisma, group.id);
    // Agosto había nacido como mes extra post-vencimiento (alquiler $0). La edición le corrige el
    // flag; el alquiler lo devuelve el refresh del Control Mensual (un GET, que no crea Deudas).
    await getOrCreateMonthlyRecords(group.id, 8, 2026);
    await flushRecalculation(prisma, group.id);
    assert.strictEqual((await recordOf(C.id, 8)).rentAmount, 100000);
    assert.strictEqual(await debtOf(C.id, 8), null, 'el GET no escribe Deudas');
    // Desde ya se ve en el cobro…
    const check = await canPayCurrentMonth(group.id, C.id, { periodMonth: 10, periodYear: 2026 });
    assert.strictEqual(check.blockingPeriod.periodMonth, 8);
    // …y el primer cobro lo pasa a Deuda.
    await getOrCreateMonthlyRecords(group.id, 10, 2026);
    await flushRecalculation(prisma, group.id);
    await assert.rejects(
      registerPayment(group.id, (await recordOf(C.id, 10)).id, { paymentDate: TODAY_STR, amount: 1000, paymentMethod: 'EFECTIVO' }),
      (e) => e.code === 'DEBT_BLOCK' && /Agosto 2026/.test(e.message),
    );
    assert.ok(await debtOf(C.id, 8), 'agosto quedó en rango y debe: pasó a Deuda');
  } finally { await cleanupGroup(prisma, group.id); }
});

// ─── Lo que NO es un mes huérfano ────────────────────────────────────────────

test('exclusiones: meses fantasma previos al primer movimiento, meses que el grupo no cerró, saldados', withPaid(async ({ group, C }) => {
  // C está todo pagado hasta septiembre → nada.
  assert.deepStrictEqual(await findUnclosedOwingRecords({ groupId: group.id, contractIds: [C.id], today: TODAY_STR }), []);
  // Un mes de C sin pagar pero que el grupo todavía no cerró (octubre) no cuenta.
  assert.ok(await recordOf(C.id, 10));

  // E: meses PENDING autogenerados para el tiempo anterior al uso del sistema (jun–sep), sin
  // ningún movimiento. No son obligaciones: ni sin actividad, ni cuando empieza a pagar en octubre.
  const tE = await createTenant(prisma, group.id);
  const pE = await createProperty(prisma, group.id);
  const E = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: pE.id, tenantId: tE.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 24, baseRent: 70000,
    },
  });
  for (const m of [6, 7, 8, 9, 10]) {
    await prisma.monthlyRecord.create({
      data: { groupId: group.id, contractId: E.id, monthNumber: m - 5, periodMonth: m, periodYear: 2026, rentAmount: 70000, totalDue: 70000, balance: -70000 },
    });
  }
  assert.deepStrictEqual(await findUnclosedOwingRecords({ groupId: group.id, contractIds: [E.id], today: TODAY_STR }), []);
  await prisma.monthlyRecord.updateMany({ where: { contractId: E.id, periodMonth: 10 }, data: { amountPaid: 1000 } });
  assert.deepStrictEqual(await findUnclosedOwingRecords({ groupId: group.id, contractIds: [E.id], today: TODAY_STR }), []);
  // Pero si el movimiento es de agosto, septiembre (posterior, ya cerrado, impago) sí es huérfano.
  await prisma.monthlyRecord.updateMany({ where: { contractId: E.id, periodMonth: 8 }, data: { amountPaid: 70000, status: 'COMPLETE' } });
  const found = await findUnclosedOwingRecords({ groupId: group.id, contractIds: [E.id], today: TODAY_STR });
  assert.deepStrictEqual(found.map((f) => f.record.periodMonth), [9]);
}));

test('exclusiones: grupo sin ningún cierre, mes posterior a la rescisión, neto ≤ $1', async () => {
  const group = await createGroup(prisma);
  try {
    const property = await createProperty(prisma, group.id);
    const tenant = await createTenant(prisma, group.id);
    const C = await prisma.contract.create({
      data: {
        groupId: group.id, propertyId: property.id, tenantId: tenant.id, contractType: 'INQUILINO',
        startDate: new Date(2026, 5, 1, 12), startMonth: 1, durationMonths: 24, baseRent: 100000,
        punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
      },
    });
    await prisma.rentHistory.create({ data: { contractId: C.id, effectiveFromMonth: 1, rentAmount: 100000, reason: 'INICIAL' } });
    for (const m of [6, 7, 8]) await openMonth(group.id, m);
    setNow(...TODAY);
    await pay(group.id, (await recordOf(C.id, 6)).id, 50000, [2026, 6, 5]);
    setNow(...TODAY);
    // Sin ningún cierre en el grupo no hay huérfanos posibles.
    assert.deepStrictEqual(await findUnclosedOwingRecords({ groupId: group.id, today: TODAY_STR }), []);

    // Con un cierre de agosto (el cierre VIEJO, sin barrido): junio (pago parcial) y julio
    // quedan debiendo sin Deuda. (El cierre de hoy los pasaría a Deuda: test de arriba.)
    await legacyClose(group.id, 8);
    setNow(...TODAY);
    let found = await findUnclosedOwingRecords({ groupId: group.id, today: TODAY_STR });
    assert.deepStrictEqual(found.map((f) => f.record.periodMonth), [6, 7]);

    // Neto ≤ $1: julio con crédito casi completo.
    const jul = await recordOf(C.id, 7);
    await prisma.monthlyRecord.update({ where: { id: jul.id }, data: { previousBalance: 99999.5 } });
    found = await findUnclosedOwingRecords({ groupId: group.id, today: TODAY_STR });
    assert.deepStrictEqual(found.map((f) => f.record.periodMonth), [6]);

    // Rescisión en junio: julio en adelante queda fuera de rango.
    await prisma.monthlyRecord.update({ where: { id: jul.id }, data: { previousBalance: 0 } });
    await prisma.contract.update({ where: { id: C.id }, data: { rescindedAt: new Date(2026, 5, 20, 12) } });
    found = await findUnclosedOwingRecords({ groupId: group.id, today: TODAY_STR });
    assert.deepStrictEqual(found.map((f) => f.record.periodMonth), [6]);
    assert.ok(found[0].data.previousRecordPayment === 50000, 'el pago parcial queda registrado (ancla = pago)');
    near(found[0].data.punitoryStartDate.getTime(), new Date('2026-06-05T12:00:00').getTime(), 'ancla = fecha del pago', 86400000);
  } finally { await cleanupGroup(prisma, group.id); }
});
