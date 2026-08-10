const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// Caso real (Ciuro Felipe — Azpeitia 1909 PB F, reportado 2026-08-10):
// el contrato estaba en ICL Cuatrimestral (freq=4 → ajustes en 5, 9, 13...).
// El lote del 23/07/2026 le grabó el AJUSTE_AUTOMATICO del mes 5 (agosto 2026).
// El 27/07 se corrigió el índice a ICL Trimestral (freq=3 → ajustes en 4, 7,
// 10...) y se aplicó el ajuste que correspondía, en el mes 4 (julio).
//
// `updateContract` recalcula `nextAdjustmentMonth` al cambiar el índice pero NO
// limpia el historial del índice viejo: la fila del mes 5 quedó viva. Como el
// alquiler se resuelve como "última fila con effectiveFromMonth <= mes"
// (monthlyRecordService.calculateRentForMonth), agosto en adelante quedó en
// $728.910 en vez de $708.240, y `getRentBeforeMonth` iba a tomar ese valor
// inflado como base del ajuste de octubre — capitalizando el error para siempre.
//
// Peor: la fila era INALCANZABLE desde la UI. El listado de Ajustes y el botón
// Deshacer (`undoAdjustmentForCalendar`) filtran con `isAdjustmentMonth(...)`;
// con freq=3 el mes 5 no es mes de ajuste, así que ni aparecía en pantalla.
//
// Decisión del usuario (2026-08-10): avisar y limpiar SOLO si confirma — nunca
// borrar solo (misma política que el resto del código: no mover plata sin avisar).
//   - `findOutOfScheduleAdjustments`: detecta las filas fuera de cronograma.
//   - `cleanupOutOfScheduleAdjustments`: las borra, resincroniza el alquiler de
//     los meses abiertos y corrige baseRent. Se aborta entero si algún mes
//     afectado ya está cobrado o cerrado (misma guarda A-09 que el undo).
// ============================================================================

const INDEX_TRIMESTRAL = { id: 'idx-tri', groupId: 'g1', name: 'ICL Trimestral', frequencyMonths: 3, currentValue: 8.96 };

function buildEnv() {
  const prisma = makeFakePrisma();
  const adjustmentService = proxyquire('../src/services/adjustmentService', { '../lib/prisma': prisma });
  // `calculateRentForMonth` REAL corriendo contra el prisma falso (es una lectura
  // pura de rentHistory). Solo se stubea la cascada de totales/saldos, que ya
  // tiene su propia cobertura en recalcConsistency.test.js.
  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    './adjustmentService': adjustmentService,
  });
  const recalcCalls = [];
  const contractService = proxyquire('../src/services/contractService', {
    '../lib/prisma': prisma,
    './adjustmentService': adjustmentService,
    './monthlyRecordService': {
      calculateRentForMonth: monthlyRecordService.calculateRentForMonth,
      recalculateMultipleRecords: async (ids, tx, inline) => { recalcCalls.push({ ids, inline }); return ids.length; },
    },
  });
  const ctrl = proxyquire('../src/controllers/contractsController', {
    '../lib/prisma': prisma,
    '../services/adjustmentService': adjustmentService,
    '../services/contractService': { ...contractService, enrichContract: (c) => c },
    '../services/monthlyRecordService': {
      repairContractRecordMonthNumbers: async () => ({ updated: 0, deleted: 0, paidOrphans: [] }),
    },
    '../utils/asyncHandler': (fn) => fn,
  });
  return { prisma, adjustmentService, contractService, ctrl, recalcCalls };
}

function mkRes() {
  const r = {};
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// Contrato tipo Ciuro: arranca hace 4 meses, ya pasado a trimestral, con la
// fila huérfana del índice cuatrimestral viejo en el mes 5.
async function seedCiuro(prisma, { orphanMonth = 5 } = {}) {
  await prisma.adjustmentIndex.create({ data: { ...INDEX_TRIMESTRAL } });
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4, 1, 12, 0, 0));
  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', propertyId: 'p1', active: true,
      startDate, startMonth: 1, durationMonths: 24,
      baseRent: 708240, adjustmentIndexId: 'idx-tri', nextAdjustmentMonth: 7,
      adjustmentIndex: { ...INDEX_TRIMESTRAL },
      property: { address: 'Azpeitia 1909 PB F' },
    },
  });
  await prisma.rentHistory.createMany({
    data: [
      { id: 'rh1', contractId: 'c1', effectiveFromMonth: 1, rentAmount: 650000, adjustmentPercent: null, reason: 'INICIAL' },
      { id: 'rh4', contractId: 'c1', effectiveFromMonth: 4, rentAmount: 708240, adjustmentPercent: 8.96, reason: 'AJUSTE_AUTOMATICO' },
      { id: 'rh-orphan', contractId: 'c1', effectiveFromMonth: orphanMonth, rentAmount: 728910, adjustmentPercent: 12.14, reason: 'AJUSTE_AUTOMATICO' },
    ],
  });
  // Meses 5 y 6 abiertos con el alquiler inflado por la fila huérfana.
  await prisma.monthlyRecord.createMany({
    data: [
      { id: 'mr5', groupId: 'g1', contractId: 'c1', monthNumber: 5, periodMonth: 8, periodYear: 2026, rentAmount: 728910, amountPaid: 0, status: 'PENDING' },
      { id: 'mr6', groupId: 'g1', contractId: 'c1', monthNumber: 6, periodMonth: 9, periodYear: 2026, rentAmount: 728910, amountPaid: 0, status: 'PENDING' },
    ],
  });
}

test('findOutOfScheduleAdjustments detecta la fila del índice viejo y respeta las que sí encajan', async () => {
  const { prisma, adjustmentService } = buildEnv();
  await seedCiuro(prisma);
  // Ruido que NO debe salir: un ajuste manual fuera de cronograma es legítimo.
  await prisma.rentHistory.create({
    data: { id: 'rh-man', contractId: 'c1', effectiveFromMonth: 6, rentAmount: 700000, reason: 'AJUSTE_MANUAL' },
  });
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });

  const found = await adjustmentService.findOutOfScheduleAdjustments(contract);

  assert.equal(found.length, 1, 'solo la fila AJUSTE_AUTOMATICO fuera de cronograma');
  assert.equal(found[0].id, 'rh-orphan');
  assert.equal(found[0].effectiveFromMonth, 5);
  assert.equal(found[0].rentAmount, 728910);
});

test('findOutOfScheduleAdjustments no devuelve nada cuando todos los ajustes encajan en el cronograma', async () => {
  const { prisma, adjustmentService } = buildEnv();
  await seedCiuro(prisma, { orphanMonth: 7 }); // 7 SÍ es mes de ajuste con freq=3
  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });

  assert.deepEqual(await adjustmentService.findOutOfScheduleAdjustments(contract), []);
});

test('cleanupOutOfScheduleAdjustments borra la fila huérfana y devuelve los meses abiertos al alquiler correcto', async () => {
  const { prisma, contractService, recalcCalls } = buildEnv();
  await seedCiuro(prisma);

  const result = await contractService.cleanupOutOfScheduleAdjustments('g1', 'c1');

  assert.equal(result.deleted.length, 1);
  assert.equal(result.deleted[0].effectiveFromMonth, 5);
  assert.equal(result.skipped.length, 0);

  assert.equal(await prisma.rentHistory.findUnique({ where: { id: 'rh-orphan' } }), null,
    'la fila huérfana debe quedar borrada');

  const mr5 = await prisma.monthlyRecord.findUnique({ where: { id: 'mr5' } });
  const mr6 = await prisma.monthlyRecord.findUnique({ where: { id: 'mr6' } });
  assert.equal(mr5.rentAmount, 708240, 'agosto vuelve al alquiler de julio');
  assert.equal(mr6.rentAmount, 708240, 'septiembre también');

  const contract = await prisma.contract.findUnique({ where: { id: 'c1' } });
  assert.equal(contract.baseRent, 708240, 'baseRent queda con el alquiler realmente vigente');

  assert.equal(recalcCalls.length, 1, 'dispara la cascada de totales/saldos una sola vez');
  assert.deepEqual(recalcCalls[0].ids, ['mr5'], 'arranca desde el primer mes afectado');
  assert.equal(recalcCalls[0].inline, true);
});

test('cleanupOutOfScheduleAdjustments NO borra nada si algún mes afectado ya está cobrado', async () => {
  const { prisma, contractService, recalcCalls } = buildEnv();
  await seedCiuro(prisma);
  // Septiembre ya cobrado: borrar la fila le bajaría el alquiler a un mes cerrado.
  await prisma.monthlyRecord.update({
    where: { id: 'mr6' }, data: { status: 'COMPLETE', amountPaid: 728910 },
  });

  const result = await contractService.cleanupOutOfScheduleAdjustments('g1', 'c1');

  assert.equal(result.deleted.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /cobrado|cerrado/i);

  assert.ok(await prisma.rentHistory.findUnique({ where: { id: 'rh-orphan' } }),
    'la fila sigue ahí: no se toca un mes ya cobrado');
  const mr5 = await prisma.monthlyRecord.findUnique({ where: { id: 'mr5' } });
  assert.equal(mr5.rentAmount, 728910, 'tampoco se reescribe el mes abierto');
  assert.equal(recalcCalls.length, 0);
});

test('POST cleanup-adjustments limpia y responde con el detalle de lo borrado', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedCiuro(prisma);
  const res = mkRes();

  await ctrl.cleanupContractAdjustments(
    { params: { groupId: 'g1', id: 'c1' } }, res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.deleted.length, 1);
  assert.strictEqual(res.body.data.deleted[0].effectiveFromMonth, 5);
  assert.strictEqual(res.body.data.recordsUpdated, 2);
  assert.strictEqual(await prisma.rentHistory.findUnique({ where: { id: 'rh-orphan' } }), null);
});

test('POST cleanup-adjustments responde 404 si el contrato no es del grupo', async () => {
  const { prisma, ctrl } = buildEnv();
  await seedCiuro(prisma);
  const res = mkRes();

  await ctrl.cleanupContractAdjustments(
    { params: { groupId: 'otro-grupo', id: 'c1' } }, res, (e) => { throw e; },
  );

  assert.strictEqual(res.statusCode, 404);
  assert.ok(await prisma.rentHistory.findUnique({ where: { id: 'rh-orphan' } }),
    'no se toca nada de otro grupo');
});
