const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// Unitarios de src/services/unclosedMonths.js (meses terminados sin Deuda que deben). Cada
// condición de la definición se prueba por separado; el flujo completo contra la base real
// está en test/integration/mesesSinCerrar.test.js (caso Gutiérrez agosto 2026).
//
// Cobertura exigida al 100% (npm run test:huerfanos).

const GROUP = 'g1';
const TODAY = '2026-10-20';

function load(prisma, overrides = {}) {
  const calls = { create: [], draft: [] };
  const debtService = {
    computeDebtDraft: async (record) => {
      calls.draft.push(record.id);
      return { owes: record.__owes ?? 1000, record };
    },
    // buildDebtData real se prueba en integración; acá: null si no debe más de $1.
    buildDebtData: (draft) => (draft.owes > 1
      ? { periodLabel: `P${draft.record.periodMonth}`, monthlyRecordId: draft.record.id, currentTotal: draft.owes }
      : null),
    createDebtFromMonthlyRecord: async (record) => {
      calls.create.push(record.id);
      return record.__createReturnsNull ? null : { id: `d-${record.id}`, periodLabel: `P${record.periodMonth}` };
    },
    expandToChain: async (id) => [id],
    ...overrides.debtService,
  };
  const svc = proxyquire('../src/services/unclosedMonths', {
    '../lib/prisma': prisma,
    './debtService': debtService,
    './monthlyRecordService': {
      isContractInRangeForMonth: (c, n) => n >= c.startMonth && n <= c.startMonth + c.durationMonths - 1,
    },
    './monthlyCloseService': {
      // Cerrable: cualquier período anterior a octubre 2026.
      isMonthClosable: (m, y) => y * 12 + m < 2026 * 12 + 10,
    },
  });
  return { svc, calls };
}

const contract = (id, extra = {}) => ({ id, groupId: GROUP, renewedFromContractId: null, startMonth: 1, durationMonths: 24, ...extra });

async function seed(prisma, { contracts = [contract('c1')], records = [], debts = [] } = {}) {
  for (const c of contracts) await prisma.contract.create({ data: c });
  const byId = new Map(contracts.map((c) => [c.id, c]));
  for (const r of records) {
    await prisma.monthlyRecord.create({
      data: {
        groupId: GROUP, contractId: 'c1', periodYear: 2026, amountPaid: 0, balanceForgiven: 0,
        ...r,
        contract: byId.get(r.contractId || 'c1'),
      },
    });
  }
  for (const d of debts) {
    await prisma.debt.create({ data: { groupId: GROUP, contractId: 'c1', periodYear: 2026, ...d } });
  }
}

// ─── periodKey / lastClosedKey / chainRoots ──────────────────────────────────

test('periodKey: año*12 + mes', () => {
  const { svc } = load(makeFakePrisma());
  assert.strictEqual(svc.periodKey({ periodMonth: 8, periodYear: 2026 }), 2026 * 12 + 8);
});

test('lastClosedKey: sin ninguna Deuda en el grupo → null', async () => {
  const { svc } = load(makeFakePrisma());
  assert.strictEqual(await svc.lastClosedKey(GROUP, TODAY), null);
});

test('lastClosedKey: el período más nuevo con Deuda', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, { debts: [{ periodMonth: 7, monthlyRecordId: 'x' }, { periodMonth: 9, monthlyRecordId: 'y' }] });
  const { svc } = load(prisma);
  assert.strictEqual(await svc.lastClosedKey(GROUP, TODAY), 2026 * 12 + 9);
});

test('lastClosedKey: una Deuda de un mes que todavía no terminó no habilita cerrar por adelantado', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, { debts: [{ periodMonth: 2, periodYear: 2027, monthlyRecordId: 'x' }] });
  const { svc } = load(prisma);
  assert.strictEqual(await svc.lastClosedKey(GROUP, TODAY, prisma), 2026 * 12 + 9);
});

test('chainRoots: cadena de renovación, padre fuera del conjunto y ciclo', () => {
  const { svc } = load(makeFakePrisma());
  const roots = svc.chainRoots([
    { id: 'a', renewedFromContractId: null },
    { id: 'b', renewedFromContractId: 'a' },
    { id: 'c', renewedFromContractId: 'b' },
    { id: 'z', renewedFromContractId: 'fuera' }, // el padre no se cargó → raíz = él mismo
    { id: 'x', renewedFromContractId: 'y' },
    { id: 'y', renewedFromContractId: 'x' }, // ciclo corrupto: no se cuelga
  ]);
  assert.strictEqual(roots.get('c'), 'a');
  assert.strictEqual(roots.get('b'), 'a');
  assert.strictEqual(roots.get('a'), 'a');
  assert.strictEqual(roots.get('z'), 'z');
  assert.ok(['x', 'y'].includes(roots.get('x')));
});

// ─── findUnclosedOwingRecords: cada condición ────────────────────────────────

const baseScenario = () => ({
  contracts: [contract('c1')],
  debts: [{ periodMonth: 9, monthlyRecordId: 'r9' }], // el grupo cerró hasta septiembre
  records: [
    { id: 'r6', periodMonth: 6, monthNumber: 6, amountPaid: 100 }, // primer movimiento
    { id: 'r7', periodMonth: 7, monthNumber: 7 },
    { id: 'r8', periodMonth: 8, monthNumber: 8 },
    { id: 'r9', periodMonth: 9, monthNumber: 9 },
    { id: 'r10', periodMonth: 10, monthNumber: 10 },
  ],
});

test('caso base: meses cerrados, sin Deuda, que deben → del más viejo al más nuevo', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, baseScenario());
  const { svc } = load(prisma);
  const found = await svc.findUnclosedOwingRecords({ groupId: GROUP, today: TODAY });
  assert.deepStrictEqual(found.map((f) => f.record.id), ['r6', 'r7', 'r8']);
  assert.deepStrictEqual(found[0].data, { periodLabel: 'P6', monthlyRecordId: 'r6', currentTotal: 1000 });
  assert.ok(found[0].draft);
});

test('sin cierres en el grupo → nada', async () => {
  const prisma = makeFakePrisma();
  const s = baseScenario();
  await seed(prisma, { ...s, debts: [] });
  const { svc } = load(prisma);
  assert.deepStrictEqual(await svc.findUnclosedOwingRecords({ groupId: GROUP, today: TODAY }), []);
});

test('contractIds que no existen → nada', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, baseScenario());
  const { svc } = load(prisma);
  assert.deepStrictEqual(await svc.findUnclosedOwingRecords({ groupId: GROUP, contractIds: ['nope'], today: TODAY }), []);
});

test('beforeKey: sólo períodos anteriores', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, baseScenario());
  const { svc } = load(prisma);
  const found = await svc.findUnclosedOwingRecords({ groupId: GROUP, contractIds: ['c1'], beforeKey: 2026 * 12 + 8, today: TODAY });
  assert.deepStrictEqual(found.map((f) => f.record.id), ['r6', 'r7']);
});

test('piso de actividad: los meses anteriores al primer movimiento no son obligaciones', async () => {
  const prisma = makeFakePrisma();
  const s = baseScenario();
  s.records[0].amountPaid = 0; // junio sin pago
  s.records[2].amountPaid = 50; // el primer movimiento pasa a agosto
  await seed(prisma, s);
  const { svc } = load(prisma);
  const found = await svc.findUnclosedOwingRecords({ groupId: GROUP, today: TODAY });
  assert.deepStrictEqual(found.map((f) => f.record.id), ['r8']);
});

test('piso de actividad: también cuenta una Deuda de la cadena (y la cadena es la de renovación)', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, {
    contracts: [contract('old', { durationMonths: 3 }), contract('new', { renewedFromContractId: 'old' })],
    debts: [{ contractId: 'new', periodMonth: 9, monthlyRecordId: 'n9' }],
    records: [
      { id: 'o5', contractId: 'old', periodMonth: 5, monthNumber: 0 }, // fuera de rango
      { id: 'o6', contractId: 'old', periodMonth: 6, monthNumber: 1 },
      { id: 'o8', contractId: 'old', periodMonth: 8, monthNumber: 3 },
      { id: 'n9', contractId: 'new', periodMonth: 9, monthNumber: 1 },
    ],
  });
  const { svc } = load(prisma);
  // El piso de la cadena old→new es septiembre (la Deuda del contrato nuevo): junio y agosto
  // del viejo son anteriores → afuera.
  assert.deepStrictEqual(await svc.findUnclosedOwingRecords({ groupId: GROUP, today: TODAY }), []);
  await prisma.monthlyRecord.update({ where: { id: 'o6' }, data: { amountPaid: 1 } });
  const found = await svc.findUnclosedOwingRecords({ groupId: GROUP, today: TODAY });
  assert.deepStrictEqual(found.map((f) => f.record.id), ['o6', 'o8']);
});

test('excluye: con Deuda, posterior al último cierre, condonado, saldado, fuera de rango, que no debe', async () => {
  const prisma = makeFakePrisma();
  const s = baseScenario();
  // Un mes SALDADO para el motor mensual no es huérfano aunque el borrador diga que debe
  // (caso Russo abril 2026, ver unclosedMonths.js).
  s.records.push({ id: 'r5', periodMonth: 5, monthNumber: 5, amountPaid: 900, status: 'COMPLETE', __owes: 36112.83 });
  s.records[1].balanceForgiven = 5000; // julio condonado
  s.records[2].monthNumber = 30; // agosto fuera de rango
  s.records[0].__owes = 1; // junio: neto ≤ $1
  await seed(prisma, s);
  const { svc, calls } = load(prisma);
  assert.deepStrictEqual(await svc.findUnclosedOwingRecords({ groupId: GROUP, today: TODAY }), []);
  // Sólo se calculó la plata de junio (los demás se descartan antes, por estructura).
  assert.deepStrictEqual(calls.draft, ['r6']);
});

test('toVirtualDebt: la Deuda que se crearía, sin id y marcada pendingClose', () => {
  const { svc } = load(makeFakePrisma());
  assert.deepStrictEqual(
    svc.toVirtualDebt({ data: { periodMonth: 8, unpaidRentAmount: 900000 } }),
    { periodMonth: 8, unpaidRentAmount: 900000, id: null, pendingClose: true, payments: [] },
  );
});

// ─── Escrituras ──────────────────────────────────────────────────────────────

test('ensureDebtsForUnclosedMonths crea una Deuda por mes huérfano', async () => {
  const prisma = makeFakePrisma();
  const s = baseScenario();
  s.records[1].__createReturnsNull = true; // carrera: otro la creó y no devolvió nada
  await seed(prisma, s);
  const { svc, calls } = load(prisma);
  const created = await svc.ensureDebtsForUnclosedMonths({ groupId: GROUP, contractIds: ['c1'], today: TODAY });
  assert.deepStrictEqual(calls.create, ['r6', 'r7', 'r8']);
  assert.deepStrictEqual(created.map((d) => d.id), ['d-r6', 'd-r8']);
});

test('ensureDebtsAfterMutation: expande la cadena y crea', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, baseScenario());
  const { svc, calls } = load(prisma);
  const created = await svc.ensureDebtsAfterMutation({ groupId: GROUP, contractId: 'c1', today: TODAY });
  assert.strictEqual(created.length, 3);
  assert.deepStrictEqual(calls.create, ['r6', 'r7', 'r8']);
});

test('ensureDebtsAfterMutation: un error no se propaga (la mutación ya se confirmó)', async () => {
  const { svc } = load(makeFakePrisma(), {
    debtService: { expandToChain: async () => { throw new Error('boom'); } },
  });
  const original = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    assert.deepStrictEqual(await svc.ensureDebtsAfterMutation({ groupId: GROUP, contractId: 'c1', today: TODAY }), []);
  } finally { console.error = original; }
  assert.match(String(logged[0][0]), /no se pudo pasar a deuda/);
});

test('ensureDebtsAfterRecordMutation: sin ids no hace nada; un contrato se procesa una vez', async () => {
  const prisma = makeFakePrisma();
  await seed(prisma, baseScenario());
  const { svc, calls } = load(prisma);
  assert.deepStrictEqual(await svc.ensureDebtsAfterRecordMutation([], TODAY), []);
  assert.deepStrictEqual(await svc.ensureDebtsAfterRecordMutation(undefined, TODAY), []);
  const created = await svc.ensureDebtsAfterRecordMutation(['r7', 'r8', 'r8', null], TODAY);
  assert.deepStrictEqual(created.map((d) => d.id), ['d-r6', 'd-r7', 'd-r8']);
  assert.strictEqual(calls.create.length, 3, 'dos meses del mismo contrato → un solo barrido');
});
