'use strict';

/**
 * Regresión (2026-08-26): el cierre le generaba DEUDA a un inquilino cuyo saldo a favor
 * arrastrado ya cubría el alquiler del mes.
 *
 * Causa: `createDebtFromMonthlyRecord` calculaba los punitorios del catch-up llamando a
 * `computePunitoryBase` SIN pasarle `appliedCredit`, mientras Control Mensual
 * (`computeLiveRecordPunitory`) SÍ se lo pasa. Las dos capas contestaban distinto sobre el
 * mismo mes: la pantalla mostraba $0 de mora y "le sobran $5.000", y el cierre cobraba mora
 * sobre el alquiler COMPLETO y armaba una deuda de $8.200.
 *
 * Regla confirmada por el usuario (2026-08-26): **si el saldo a favor arrastrado cubre el
 * alquiler, NO se devengan punitorios.** Control Mensual tenía razón.
 *
 * Matriz reproducida con el código real (alquiler $100.000, sin pagos nuevos, cierre al
 * 31/07 → 22 días de mora = $13.200 si se cobrara sobre el alquiler completo):
 *
 *   crédito 120.000 → el mes decía "sobran 20.000" / el cierre decía "debe 0"
 *   crédito 113.200 → "sobran 13.200" / "debe 0"
 *   crédito 105.000 → "sobran 5.000"  / "debe 8.200"  ← deuda fantasma
 *   crédito 100.000 → "sobran 0"      / "debe 13.200" ← deuda fantasma
 *
 * Run: cd inmobiliaria-app/backend && npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const CONTRACT = {
  id: 'c1', groupId: 'g1', active: true, startMonth: 1, durationMonths: 24,
  startDate: new Date(2026, 6, 1), rescindedAt: null, baseRent: 100000,
  punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006,
};

function buildDebtService(prisma) {
  return proxyquire('../src/services/debtService', {
    '../lib/prisma': prisma,
    '../utils/dateUtils': {
      ...require('../src/utils/dateUtils'),
      // Cierre "al 31/07/2026", para que el test no dependa del día de corrida.
      getTodayLocalString: () => '2026-07-31',
      getTodayLocalDate: () => new Date(2026, 6, 31),
    },
    '../utils/punitory': {
      ...require('../src/utils/punitory'),
      getHolidaysForYear: async () => [],
    },
  });
}

async function cerrarConCredito(credito) {
  const prisma = makeFakePrisma();
  const debtService = buildDebtService(prisma);

  const record = {
    id: `mr-${credito}`, groupId: 'g1', contractId: 'c1',
    periodMonth: 7, periodYear: 2026, monthNumber: 1,
    status: 'PENDING', rentAmount: 100000, servicesTotal: 0, includeIva: false, ivaAmount: 0,
    previousBalance: credito, amountPaid: 0, punitoryAmount: 0, punitoryDays: 0,
    punitoryForgiven: false, balanceForgiven: 0, isPostExpiry: false,
    services: [], transactions: [],
  };

  const debt = await debtService.createDebtFromMonthlyRecord(record, CONTRACT);
  return debt ? debt.currentTotal : 0;
}

test('el crédito arrastrado que cubre el alquiler NO devenga punitorios ni genera deuda', async () => {
  // Los cuatro escenarios de la matriz: en ninguno se debe crear deuda, porque el crédito
  // cubre el alquiler y sin base no hay mora.
  for (const credito of [120000, 113200, 105000, 100000]) {
    const total = await cerrarConCredito(credito);
    assert.strictEqual(total, 0,
      `con crédito ${credito} sobre un alquiler de 100.000 el cierre no debe crear deuda (creó ${total})`);
  }
});

test('si el crédito NO alcanza a cubrir el alquiler, sí hay mora y sí hay deuda', async () => {
  // Crédito de 40.000 sobre 100.000: la base de mora es 100.000 − 40.000 = 60.000, y el
  // cierre al 31/07 cuenta 22 días (día 1 al 31 no: sin pagos arranca el día 1 del período
  // para un mes ya pasado... acá el período ES julio y "hoy" es 31/07, mes corriente →
  // desde punitoryStartDay=10 hasta el 31 inclusive = 22 días).
  const total = await cerrarConCredito(40000);
  const moraEsperada = Math.round(60000 * 0.006 * 22 * 100) / 100; // 7.920
  // currentTotal = alquiler + mora − crédito
  assert.strictEqual(total, Math.round((100000 + moraEsperada - 40000) * 100) / 100,
    'la mora se cobra sobre el alquiler NETO del crédito, y el crédito se resta del total');
  assert.ok(total > 1, 'con el crédito insuficiente sí corresponde deuda');
});

test('sin crédito, la mora va sobre el alquiler completo (no cambia el comportamiento base)', async () => {
  const total = await cerrarConCredito(0);
  const moraEsperada = Math.round(100000 * 0.006 * 22 * 100) / 100; // 13.200
  assert.strictEqual(total, Math.round((100000 + moraEsperada) * 100) / 100);
});
