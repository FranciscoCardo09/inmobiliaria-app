const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-14 (AUDITORIA_FUNCIONAL_2026-07-10.md): el recálculo mensual es async por
// defecto (`recalculateMultipleRecords` marca dirty + `setImmediate(processDirtyRecords)`).
// `forgiveDebt` usaba la variante async (`recalculateMonthlyRecord`): el
// `findUnique` de retorno podía ver el record VIEJO, y el forzado de COMPLETE
// competía en carrera con el worker async — que podía revertirlo a PENDING
// (caso real: Amaya Nelida, mes PARTIAL con deuda ya saldada).
//
// Fix: `forgiveDebt` ahora corre TODO (update de la deuda + recálculo +
// forzado de COMPLETE) dentro de UNA transacción, con el recálculo INLINE
// (`recalculateMultipleRecords(ids, tx, true)`), eliminando la ventana de
// carrera por diseño (no hay ningún `setImmediate` de por medio).
//
// Además: no hay sweep al arrancar el server que levante `needsRecalculation`
// huérfanos tras un crash. Se agregó un barrido único en `app.js` que llama a
// `processDirtyRecords()` — se prueba acá `processDirtyRecords` directamente
// (la misma función que app.js invoca), sin bootear todo el server Express.
// ============================================================================

test('A-14: forgiveDebt deja el MonthlyRecord COMPLETE de forma estable, aunque el recálculo inline dé PENDING', async () => {
  const prisma = makeFakePrisma();

  // Simula el bug real: `_recalculateCore` (llamado vía recalculateMultipleRecords)
  // no sabe nada de "condonación" y, sin pagos reales, recalcularía PENDING.
  // Lo importante es que forgiveDebt NO se quede con ese PENDING: debe forzar
  // COMPLETE en la MISMA transacción, sin ventana para que nada más lo revierta.
  const svc = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    './monthlyRecordService': {
      recalculateMultipleRecords: async (ids, tx) => {
        await tx.monthlyRecord.update({ where: { id: ids[0] }, data: { status: 'PENDING', isPaid: false, isCancelled: false } });
        return 1;
      },
    },
  });

  await prisma.debt.create({
    data: { id: 'd1', groupId: 'g1', contractId: 'c1', status: 'OPEN', monthlyRecordId: 'mr1', amountPaid: 0 },
  });
  await prisma.monthlyRecord.create({
    data: { id: 'mr1', groupId: 'g1', contractId: 'c1', status: 'PARTIAL', amountPaid: 0 },
  });

  const result = await svc.forgiveDebt('d1', 'condonado en test');

  assert.equal(result.status, 'PAID');
  const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr1' } });
  assert.equal(record.status, 'COMPLETE', 'el mes debe quedar COMPLETE de forma estable, no revertido a PENDING');
  assert.equal(record.isPaid, true);
  assert.equal(record.isCancelled, true);
});

test('A-14: forgiveDebt no vuelve a forzar COMPLETE si el recálculo inline ya dio COMPLETE (no pisa fullPaymentDate innecesariamente)', async () => {
  const prisma = makeFakePrisma();
  const svc = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    './monthlyRecordService': {
      recalculateMultipleRecords: async (ids, tx) => {
        await tx.monthlyRecord.update({ where: { id: ids[0] }, data: { status: 'COMPLETE', isPaid: true, isCancelled: true, fullPaymentDate: new Date(2026, 0, 1) } });
        return 1;
      },
    },
  });

  await prisma.debt.create({
    data: { id: 'd1', groupId: 'g1', contractId: 'c1', status: 'OPEN', monthlyRecordId: 'mr1', amountPaid: 0 },
  });
  await prisma.monthlyRecord.create({
    data: { id: 'mr1', groupId: 'g1', contractId: 'c1', status: 'PARTIAL', amountPaid: 0 },
  });

  await svc.forgiveDebt('d1');

  const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr1' } });
  assert.equal(record.status, 'COMPLETE');
  assert.deepEqual(record.fullPaymentDate, new Date(2026, 0, 1), 'no debe reescribirse la fecha si el recálculo inline ya cerró el mes');
});

test('A-14: forgiveDebt rechaza una deuda ya PAID (fail-fast, sin abrir transacción)', async () => {
  const prisma = makeFakePrisma();
  const svc = proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    './monthlyRecordService': { recalculateMultipleRecords: async () => 1 },
  });

  await prisma.debt.create({ data: { id: 'd1', groupId: 'g1', contractId: 'c1', status: 'PAID', monthlyRecordId: null } });

  await assert.rejects(() => svc.forgiveDebt('d1'), /ya está pagada/);
});

test('A-14: processDirtyRecords levanta un registro needsRecalculation huérfano (simula un crash previo)', async () => {
  const prisma = makeFakePrisma();
  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      calculateDebtPunitory: async () => ({}),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
    },
  });

  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, startDate: new Date(2026, 0, 1), startMonth: 1,
      durationMonths: 12, baseRent: 100000, pagaIva: false,
      punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  // Registro huérfano: quedó marcado dirty por un crash entre el markDirty y
  // el setImmediate(processDirtyRecords) de una corrida anterior del server.
  // `amountPaid` lo recalcula _recalculateCore sumando las PaymentTransaction
  // reales (no toma el valor ya guardado), así que se agrega una transacción
  // real de $100.000 para que el recálculo dé un resultado financieramente
  // coherente (mes totalmente pagado) al levantar el dirty.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr1', groupId: 'g1', contractId: 'c1', monthNumber: 1, periodMonth: 1, periodYear: 2026,
      status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 0, totalDue: 100000, balance: -100000,
      punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      needsRecalculation: true, services: [],
      transactions: [{ paymentDate: new Date(2026, 0, 5, 12, 0, 0), amount: 100000, punitoryForgiven: false, punitoryAmount: 0, concepts: [{ type: 'ALQUILER', amount: 100000 }] }],
    },
  });

  await monthlyRecordService.processDirtyRecords();

  const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr1' } });
  assert.equal(record.needsRecalculation, false, 'el barrido debe procesar y limpiar el dirty huérfano');
  assert.equal(record.status, 'COMPLETE', 'con un pago real que cubre el total, el recálculo real lo deja COMPLETE');
  assert.equal(record.amountPaid, 100000);
});
