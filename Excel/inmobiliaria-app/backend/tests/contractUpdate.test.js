const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');
const { parseLocalDate } = require('../src/utils/dateUtils');

// ============================================================================
// Regresión: editar el índice de ajuste de un contrato (caso real reportado
// 2026-07-27: usuario cambia el índice porque se equivocó al crear el
// contrato, confirma la edición, y el índice viejo sigue apareciendo).
//
// Causa raíz confirmada contra Postgres real (inmobiliaria_test, no el copy
// de producción): `updateContract` no validaba `adjustmentIndexId` antes de
// escribir. Un id de OTRO grupo se aceptaba con 200 (quedaba mal asignado);
// un id inexistente hacía explotar el `prisma.contract.update` con FK
// violation A MITAD de la función (después de ya haber reemplazado
// contractTenant y remapeado RentHistory), dejando el contrato con el índice
// viejo pero otros datos ya mutados.
//
// Fixes (ver plan quiero-que-investigues-y-optimized-leaf.md):
//   D1: valida el índice ANTES de escribir nada (400 si es de otro grupo o no existe).
//   D2: el resto de las escrituras corre dentro de una única prisma.$transaction.
//   D3: si el mes actual YA es mes de ajuste y no se aplicó, nextAdjustmentMonth
//       apunta a ESE mes (antes saltaba al período siguiente).
//   D4: scheduleChanged compara valores reales, no la mera presencia del campo
//       (el form manda `currentMonth` en TODO submit) — tocar solo el índice no
//       debe disparar el remapeo de RentHistory ni repairContractRecordMonthNumbers.
//   D5: si el índice ANTERIOR ya aplicó ajustes automáticos, se avisa (no se
//       revierte solo).
//   D8: baseRent/punitoryStartDay/durationMonths en 0 ya no se descartan como "sin cambios".
//
// Nota sobre fakePrisma (igual que deleteContract.test.js): `$transaction` no
// tiene rollback real, así que la atomicidad de D2 se verifica por diseño acá
// (la validación de D1 corre y puede retornar 400 ANTES de que la transacción
// siquiera empiece) y fue confirmada aparte contra Postgres real.
// ============================================================================

function mkRes() {
  const r = {};
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// Fecha de inicio N meses atrás respecto a "ahora", en el mismo formato que
// produce parseLocalDate (mediodía UTC) — evita que el test dependa de la
// fecha real en que corre.
function monthsAgoUTC(n) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1, 12, 0, 0));
}
function monthsAgoStr(n) {
  const d = monthsAgoUTC(n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function buildEnv() {
  const prisma = makeFakePrisma();
  const adjustmentService = proxyquire('../src/services/adjustmentService', { '../lib/prisma': prisma });
  const repairSpy = { calls: 0, lastArgs: null };
  const ctrl = proxyquire('../src/controllers/contractsController', {
    '../lib/prisma': prisma,
    '../services/adjustmentService': adjustmentService,
    '../services/contractService': { enrichContract: (c) => c },
    '../services/monthlyRecordService': {
      repairContractRecordMonthNumbers: async (...args) => {
        repairSpy.calls++;
        repairSpy.lastArgs = args;
        return { updated: 0, deleted: 0, paidOrphans: [] };
      },
    },
    '../utils/asyncHandler': (fn) => fn,
  });
  return { prisma, ctrl, repairSpy };
}

// Contrato "de referencia": arrancó `durationMonths` meses atrás, dura 24 meses,
// tiene el índice IPC trimestral (mal elegido) y actualmente está en su mes de
// ajuste (mes 7, ajuste cada 3 meses -> ajustó en 4, próximo en 7).
async function seedContract(prisma, { startedMonthsAgo = 6, adjustmentIndexId = 'idx-ipc', nextAdjustmentMonth = 7 } = {}) {
  await prisma.group.create({ data: { id: 'g1', name: 'Grupo 1' } });
  await prisma.property.create({ data: { id: 'p1', groupId: 'g1', address: 'Calle Falsa 123' } });
  await prisma.tenant.create({ data: { id: 't1', groupId: 'g1', name: 'Juan Perez' } });
  await prisma.adjustmentIndex.create({ data: { id: 'idx-ipc', groupId: 'g1', name: 'IPC Trimestral', frequencyMonths: 3, currentValue: 10 } });
  await prisma.adjustmentIndex.create({ data: { id: 'idx-icl', groupId: 'g1', name: 'ICL Semestral', frequencyMonths: 6, currentValue: 20 } });
  await prisma.adjustmentIndex.create({ data: { id: 'idx-otro-grupo', groupId: 'g2', name: 'De otro grupo', frequencyMonths: 12, currentValue: 5 } });

  const startDate = monthsAgoUTC(startedMonthsAgo);
  return prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', propertyId: 'p1', tenantId: 't1', contractType: 'INQUILINO',
      startDate, startMonth: 1, currentMonth: startedMonthsAgo + 1, durationMonths: 24,
      baseRent: 100000, active: true, adjustmentIndexId, nextAdjustmentMonth,
      punitoryStartDay: 10, punitoryPercent: 0.006, pagaIva: false,
      // fakePrisma no resuelve `include` (solo `select`): embebemos las relaciones
      // literalmente en la fila, como ya hace deleteContract.test.js, para que
      // `updated.contractTenants.length` / `.tenant` no exploten en el controller.
      contractTenants: [], tenant: null, property: { id: 'p1', address: 'Calle Falsa 123' },
    },
  });
}

function baseBody({ startedMonthsAgo = 6, overrides = {} } = {}) {
  return {
    contractType: 'INQUILINO', tenantIds: ['t1'], propertyId: 'p1',
    startDate: monthsAgoStr(startedMonthsAgo), durationMonths: 24, currentMonth: startedMonthsAgo + 1,
    baseRent: 100000, punitoryStartDay: 10, punitoryPercent: 0.006,
    pagaIva: false, active: true, observations: '', comprobantes: [],
    ...overrides,
  };
}

test('cambiar a un índice VÁLIDO del mismo grupo persiste y recalcula nextAdjustmentMonth', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  const res = mkRes();

  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-icl' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  const after = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.strictEqual(after.adjustmentIndexId, 'idx-icl');
  // D3: el mes actual (7) YA es mes de ajuste bajo la frecuencia semestral (startMonth=1,
  // freq=6 -> ajusta en 7) y no hay AJUSTE_AUTOMATICO aplicado para ese mes todavía ->
  // nextAdjustmentMonth debe ser el mes actual, no saltar al siguiente (13).
  assert.strictEqual(after.nextAdjustmentMonth, 7);
});

test('índice de OTRO grupo se rechaza con 400 y no modifica el contrato', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  const res = mkRes();

  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-otro-grupo' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.message, /[íi]ndice.*inv[aá]lido/i);
  const after = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.strictEqual(after.adjustmentIndexId, 'idx-ipc', 'el índice viejo debe seguir intacto');
  assert.strictEqual(after.nextAdjustmentMonth, 7, 'nada debe haberse recalculado');
});

test('índice INEXISTENTE se rechaza con 400 y no modifica el contrato (antes: FK violation a mitad del update)', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  const res = mkRes();

  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'no-existe' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 400);
  const after = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.strictEqual(after.adjustmentIndexId, 'idx-ipc');
});

test('limpiar el índice (null) borra adjustmentIndexId y nextAdjustmentMonth', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  const res = mkRes();

  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: null } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  const after = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.strictEqual(after.adjustmentIndexId, null);
  assert.strictEqual(after.nextAdjustmentMonth, null);
});

test('editar SOLO el índice no toca RentHistory ni dispara repairContractRecordMonthNumbers (D4)', async () => {
  const { prisma, ctrl, repairSpy } = buildEnv();
  await seedContract(prisma);
  await prisma.rentHistory.create({ data: { id: 'rh1', contractId: 'c1', effectiveFromMonth: 1, rentAmount: 90000, reason: 'INICIAL' } });
  await prisma.rentHistory.create({ data: { id: 'rh2', contractId: 'c1', effectiveFromMonth: 4, rentAmount: 100000, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 11.1 } });
  const before = await prisma.rentHistory.findMany({ where: { contractId: 'c1' } });

  const res = mkRes();
  // Mismo startDate/duration/currentMonth que el contrato ya tiene: solo cambia el índice.
  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-icl' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(repairSpy.calls, 0, 'no debe llamarse a repairContractRecordMonthNumbers si el cronograma no cambió');
  const after = await prisma.rentHistory.findMany({ where: { contractId: 'c1' } });
  assert.deepStrictEqual(after, before, 'RentHistory no debe tocarse al editar solo el índice');
});

test('cambiar de índice con un AJUSTE_AUTOMATICO previo devuelve warning, sin revertir nada (D5)', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  await prisma.rentHistory.create({ data: { id: 'rh1', contractId: 'c1', effectiveFromMonth: 1, rentAmount: 90000, reason: 'INICIAL' } });
  await prisma.rentHistory.create({ data: { id: 'rh2', contractId: 'c1', effectiveFromMonth: 4, rentAmount: 100000, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 11.1 } });

  const res = mkRes();
  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-icl' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  const warnings = res.body.data.warnings || [];
  const w = warnings.find((x) => x.code === 'ADJUSTMENTS_FROM_PREVIOUS_INDEX');
  assert.ok(w, 'debe incluir el warning de ajustes del índice anterior');
  assert.strictEqual(w.records.length, 1);
  assert.strictEqual(w.records[0].effectiveFromMonth, 4);

  // No se revirtió nada: la fila AJUSTE_AUTOMATICO sigue igual.
  const history = await prisma.rentHistory.findUnique({ where: { id: 'rh2' } });
  assert.strictEqual(history.rentAmount, 100000);
  assert.strictEqual(history.reason, 'AJUSTE_AUTOMATICO');
});

// Caso Ciuro (2026-08-10, ver tests/adjustmentIndexCleanup.test.js): el aviso D5
// decía "deshacelos manualmente desde Ajustes", pero esa pantalla filtra por
// `isAdjustmentMonth` — un ajuste que quedó FUERA del cronograma nuevo no aparece
// ahí ni lo alcanza el botón Deshacer. El aviso ahora separa ese subconjunto y lo
// marca como limpiable, para que el front pueda ofrecer la limpieza.
test('cambiar a un índice de otra frecuencia marca los ajustes que quedan fuera de cronograma como limpiables', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  await prisma.rentHistory.create({ data: { id: 'rh1', contractId: 'c1', effectiveFromMonth: 1, rentAmount: 90000, reason: 'INICIAL' } });
  // Mes 4: válido con el índice viejo (freq=3 -> 4, 7, 10), inválido con el nuevo (freq=6 -> 7, 13).
  await prisma.rentHistory.create({ data: { id: 'rh2', contractId: 'c1', effectiveFromMonth: 4, rentAmount: 100000, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 11.1 } });

  const res = mkRes();
  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-icl' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  const w = (res.body.data.warnings || []).find((x) => x.code === 'ADJUSTMENTS_FROM_PREVIOUS_INDEX');
  assert.ok(w);
  assert.strictEqual(w.canCleanup, true, 'hay algo que se puede limpiar');
  assert.strictEqual(w.outOfSchedule.length, 1);
  assert.strictEqual(w.outOfSchedule[0].effectiveFromMonth, 4);
  assert.ok(w.outOfSchedule[0].calendarMonth >= 1 && w.outOfSchedule[0].calendarMonth <= 12,
    'el front necesita el período calendario para mostrarlo');
  assert.ok(w.outOfSchedule[0].calendarYear > 2000);
});

test('si los ajustes del índice anterior siguen encajando en el cronograma nuevo, no se ofrece limpiar nada', async () => {
  const { prisma, ctrl } = buildEnv();
  // Arranca en el semestral (freq=6) y pasa al trimestral (freq=3): el mes 7 es mes
  // de ajuste en AMBOS cronogramas, así que la fila no quedó huérfana.
  await seedContract(prisma, { adjustmentIndexId: 'idx-icl' });
  await prisma.rentHistory.create({ data: { id: 'rh1', contractId: 'c1', effectiveFromMonth: 1, rentAmount: 90000, reason: 'INICIAL' } });
  await prisma.rentHistory.create({ data: { id: 'rh2', contractId: 'c1', effectiveFromMonth: 7, rentAmount: 100000, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 11.1 } });

  const res = mkRes();
  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-ipc' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  const w = (res.body.data.warnings || []).find((x) => x.code === 'ADJUSTMENTS_FROM_PREVIOUS_INDEX');
  assert.ok(w, 'se sigue informando que el índice anterior había ajustado');
  assert.strictEqual(w.canCleanup, false);
  assert.deepStrictEqual(w.outOfSchedule, []);
});

test('sin ajustes automáticos previos, cambiar de índice NO agrega warning', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  const res = mkRes();

  await ctrl.updateContract(
    { params: { groupId: 'g1', id: 'c1' }, body: baseBody({ overrides: { adjustmentIndexId: 'idx-icl' } }) },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.warnings, undefined);
});

test('baseRent=0 y punitoryStartDay=0 se aplican (D8: antes se descartaban por ser falsy)', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  const res = mkRes();

  await ctrl.updateContract(
    {
      params: { groupId: 'g1', id: 'c1' },
      body: baseBody({ overrides: { adjustmentIndexId: 'idx-ipc', baseRent: 0, punitoryStartDay: 0 } }),
    },
    res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  const after = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.strictEqual(after.baseRent, 0);
  assert.strictEqual(after.punitoryStartDay, 0);
});

test('editar un contrato inactivo sin tocar `active` lo mantiene inactivo', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedContract(prisma);
  await prisma.contract.update({ where: { id: 'c1' }, data: { active: false } });
  const res = mkRes();

  const body = baseBody({ overrides: { adjustmentIndexId: 'idx-ipc' } });
  delete body.active; // simula que el campo no viaja en el body (igual que si el backend nunca lo recibe)

  await ctrl.updateContract({ params: { groupId: 'g1', id: 'c1' }, body }, res, (e) => { throw e; });

  assert.strictEqual(res.statusCode, 200);
  const after = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.strictEqual(after.active, false);
});
