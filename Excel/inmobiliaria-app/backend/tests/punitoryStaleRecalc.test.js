'use strict';

/**
 * Cobertura de tests: punitorios fantasma por estado rancio en _recalculateCore
 *
 * Bug real (2026-07-30, Biassi Gonzalo Amir, Av. Figueroa Alcorta 482 Dto 5,
 * julio 2026). El mes cancelaba justo — cargos $768.478 (alquiler $648.823 +
 * servicios $119.655), pagados con $767.918 en efectivo el 08/07 más $560 de
 * saldo a favor de junio — pero tras borrar y volver a cargar el pago quedó con
 * `totalDue = 857.455,57` y saldo `-89.537,57`. Dos defectos encadenados:
 *
 *  1. `_recalculateCore` (monthlyRecordService.js) recomputa `servicesTotal`,
 *     `amountPaid` y el `previousBalance` en cadena, los escribe en la DB… pero
 *     le pasa a `computeLiveRecordPunitory` el objeto `record` CRUDO de la base.
 *     `registerPaymentCore` crea la transacción y recalcula ANTES de que
 *     `amountPaid` se haya persistido, así que la base de punitorios veía
 *     "sin ningún pago" → alquiler completo × 0,6% × 23 días = $89.537,57.
 *     Lo mismo con `servicesTotal` cuando se edita un servicio (`updateService`
 *     escribe la fila y recién después recalcula).
 *
 *  2. `computePunitoryBase` comparaba SOLO el efectivo contra los cargos, así
 *     que los $560 cubiertos con saldo a favor quedaban como base impaga y
 *     devengaban mora todos los días. Regla definida por el usuario: el saldo a
 *     favor se computa como si fuera plata del PRIMER pago (una sola vez, sólo
 *     internamente) — nunca se escribe en `amountPaid` ni en los conceptos: el
 *     recibo tiene que seguir mostrando el efectivo real.
 *
 * Run: cd inmobiliaria-app/backend && npm run test:unit
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ─── Caso Biassi, números reales de producción ─────────────────────────────
const RENT = 648823;
const SERVICES = [
  { amount: 19400, conceptType: { category: 'IMPUESTO' } },   // MUNICIPALIDAD
  { amount: 84510, conceptType: { category: 'SERVICIO' } },   // EXPENSAS
  { amount: 15745, conceptType: { category: 'IMPUESTO' } },   // RENTA
];
const SERVICES_TOTAL = 119655;
const CREDIT = 560;              // saldo a favor de junio
const CASH = 767918;             // efectivo del 08/07 (= 648823 + 119655 - 560)
const CHARGES = RENT + SERVICES_TOTAL; // 768478

const PERIOD_MONTH = 7;
const PERIOD_YEAR = 2026;
const TODAY = '2026-07-30';      // día en que se re-cargó el pago
const CONTRACT = { punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006 };

// El punitorio fantasma que producía el bug 1: alquiler entero × 0,6% × 23 días
// (del 08/07 al 30/07, ambos inclusive).
const PHANTOM_PUNITORY = 89537.57;

/**
 * `punitory.js` con "hoy" congelado en TODAY, para que los montos del test no
 * dependan de la fecha en que se corra. El módulo pide dateUtils por dos rutas
 * distintas (una arriba, otra lazy dentro de computeLiveRecordPunitory), así
 * que hay que stubear ambas.
 */
function makePunitory() {
  const realDateUtils = require('../src/utils/dateUtils');
  const frozen = {
    ...realDateUtils,
    getTodayLocalString: () => TODAY,
    getTodayLocalDate: () => new Date(2026, 6, 30),
  };
  return proxyquire('../src/utils/punitory', {
    './dateUtils': frozen,
    '../utils/dateUtils': frozen,
    '../lib/prisma': makeFakePrisma(),
  });
}

function makeMonthlyRecordService(prisma, punitory) {
  return proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...punitory, getHolidaysForYear: async () => [] },
    './debtService': { calculateDebtPunitory: async () => ({}) },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });
}

function makeTx(amount, day, concepts) {
  const date = new Date(PERIOD_YEAR, PERIOD_MONTH - 1, day, 12, 0, 0);
  return {
    amount, paymentDate: date, createdAt: date,
    punitoryForgiven: false, punitoryAmount: 0,
    concepts: concepts || [{ type: 'ALQUILER', amount }],
  };
}

/**
 * Crea el registro. `overrides` permite desincronizar a propósito los campos
 * agregados (`amountPaid`, `servicesTotal`) respecto de `transactions[]` /
 * `services[]` — que es exactamente el estado en que `_recalculateCore` recibe
 * el registro cuando lo llama `registerPaymentCore` o `updateService`.
 */
async function makeRecord(prisma, id, transactions, overrides = {}) {
  const amountPaid = transactions.reduce((s, t) => s + t.amount, 0);
  await prisma.monthlyRecord.create({
    data: {
      id, groupId: 'g1', contractId: 'c1',
      monthNumber: 6, periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR,
      status: 'PENDING', isPaid: false, isCancelled: false,
      rentAmount: RENT, servicesTotal: SERVICES_TOTAL,
      includeIva: false, ivaAmount: 0,
      previousBalance: CREDIT, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      balanceForgiven: 0, amountPaid, totalDue: 0, balance: 0,
      fullPaymentDate: null, needsRecalculation: false,
      services: SERVICES,
      transactions,
      contract: CONTRACT,
      ...overrides,
    },
  });
}

// ─── A. Bug 1 — estado rancio al recalcular ────────────────────────────────

describe('A. _recalculateCore usa los valores frescos, no los del record crudo', () => {
  test('A1: caso Biassi exacto — amountPaid rancio en 0 con la transacción ya creada → cancela justo, sin mora', async () => {
    const prisma = makeFakePrisma();
    const punitory = makePunitory();
    const monthlyRecordService = makeMonthlyRecordService(prisma, punitory);

    // Estado exacto que ve _recalculateCore desde registerPaymentCore: la
    // PaymentTransaction ya existe, pero `amountPaid` todavía es el que dejó el
    // borrado del pago anterior (0).
    await makeRecord(prisma, 'mr-a1', [makeTx(CASH, 8)], { amountPaid: 0 });

    await monthlyRecordService.recalculateMultipleRecords(['mr-a1'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-a1' } });

    assert.equal(updated.amountPaid, CASH, 'amountPaid debe reconstruirse desde las transacciones');
    assert.equal(updated.punitoryAmount, 0, `no debe inventarse mora (el bug daba ${PHANTOM_PUNITORY})`);
    assert.equal(updated.totalDue, CHARGES - CREDIT, `totalDue = cargos - saldo a favor (el bug daba ${CHARGES - CREDIT + PHANTOM_PUNITORY})`);
    assert.equal(updated.balance, 0, 'cancela justo');
    assert.equal(updated.status, 'COMPLETE');
  });

  test('A2: servicesTotal rancio (lo que deja updateService) → la mora sale de los servicios frescos', async () => {
    const prisma = makeFakePrisma();
    const punitory = makePunitory();
    const monthlyRecordService = makeMonthlyRecordService(prisma, punitory);

    // `updateService` escribe la fila de monthly_services y RECIÉN DESPUÉS
    // recalcula: services[] ya suma 119.655 pero el agregado guarda el valor
    // viejo (aquí, mucho más alto, como si se hubiera cargado mal y revertido).
    await makeRecord(prisma, 'mr-a2', [makeTx(CASH, 8)], { servicesTotal: 400000 });

    await monthlyRecordService.recalculateMultipleRecords(['mr-a2'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-a2' } });

    assert.equal(updated.servicesTotal, SERVICES_TOTAL, 'servicesTotal debe reconstruirse desde services[]');
    assert.equal(updated.punitoryAmount, 0, 'el servicio viejo no debe dejar una base de mora fantasma');
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
  });
});

// ─── B. Bug 2 — el saldo a favor cuenta como plata del primer pago ─────────

describe('B. computePunitoryBase — el saldo a favor cubre como si fuera del primer pago', () => {
  test('B1: efectivo + saldo a favor cubren los cargos exactos → base 0', () => {
    const { computePunitoryBase } = makePunitory();
    const base = computePunitoryBase({
      rentAmount: RENT, servicesTotal: SERVICES_TOTAL, ivaAmount: 0,
      amountPaid: CASH, appliedCredit: CREDIT,
    });
    assert.equal(base, 0, `sin esto quedan ${CHARGES - CASH} de base fantasma devengando mora todos los días`);
  });

  test('B2: el crédito se suma UNA sola vez, no por cada pago', () => {
    const { computePunitoryBase } = makePunitory();
    // Mismo total en dos pagos en vez de uno: el resultado no puede cambiar.
    const base = computePunitoryBase({
      rentAmount: RENT, servicesTotal: SERVICES_TOTAL, ivaAmount: 0,
      amountPaid: CASH - 100000, appliedCredit: CREDIT,
    });
    assert.equal(base, 100000, 'la base es lo que falta, con el crédito contado una vez');
  });

  test('B3: el crédito NO cancela la mora si el mes sigue impago', () => {
    const { computePunitoryBase } = makePunitory();
    // Alquiler 100.000, sin servicios, crédito 10.000, cero efectivo.
    const base = computePunitoryBase({
      rentAmount: 100000, servicesTotal: 0, ivaAmount: 0,
      amountPaid: 0, appliedCredit: 10000,
    });
    assert.equal(base, 90000, 'el crédito descuenta como plata cobrada, pero el resto sigue devengando');
  });

  test('B4: sin crédito el comportamiento no cambia (callers de deudas usan el default)', () => {
    const { computePunitoryBase } = makePunitory();
    assert.equal(computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 21000, amountPaid: 0 }), 100000);
    assert.equal(computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 21000, amountPaid: 10000 }), 141000);
    assert.equal(computePunitoryBase({ rentAmount: 100000, servicesTotal: 0, ivaAmount: 0, amountPaid: 100000 }), 0);
  });

  test('B5: sin el bug 1 de por medio, el mes de Biassi igual cierra en 0', async () => {
    const prisma = makeFakePrisma();
    const punitory = makePunitory();
    const monthlyRecordService = makeMonthlyRecordService(prisma, punitory);

    // amountPaid YA sincronizado: aquí sólo puede fallar el bug 2 (quedaban -77,28).
    await makeRecord(prisma, 'mr-b5', [makeTx(CASH, 8)]);

    await monthlyRecordService.recalculateMultipleRecords(['mr-b5'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-b5' } });

    assert.equal(updated.punitoryAmount, 0, 'los 560 del saldo a favor no son una deuda impaga');
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
  });
});

// ─── C. El crédito es interno: no contamina lo cobrado ─────────────────────

describe('C. El saldo a favor no se escribe en lo cobrado', () => {
  test('C1: tras el recálculo, amountPaid sigue siendo el efectivo y los conceptos no cambian', async () => {
    const prisma = makeFakePrisma();
    const punitory = makePunitory();
    const monthlyRecordService = makeMonthlyRecordService(prisma, punitory);

    const concepts = [
      { type: 'A_FAVOR', amount: -CREDIT },
      { type: 'MUNICIPALIDAD', amount: 18840 },
      { type: 'EXPENSAS', amount: 84510 },
      { type: 'RENTA', amount: 15745 },
      { type: 'ALQUILER', amount: RENT },
    ];
    await makeRecord(prisma, 'mr-c1', [makeTx(CASH, 8, concepts)], { amountPaid: 0 });

    await monthlyRecordService.recalculateMultipleRecords(['mr-c1'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c1' } });

    assert.equal(updated.amountPaid, CASH, 'el recibo muestra el efectivo real, no efectivo + crédito');
    assert.notEqual(updated.amountPaid, CASH + CREDIT);
    assert.deepEqual(updated.transactions[0].concepts, concepts, 'los conceptos de la transacción no se tocan');
  });
});

// ─── D. Guardas: la mora real sigue corriendo ──────────────────────────────

// El punitorio VIVO vive en `totalDue`, no en el campo `punitoryAmount` (que
// guarda el CONGELADO del último pago — semántica que otros consumidores, como
// la creación de deudas y los recibos, dan por sentada). Para auditar la mora
// que efectivamente se está cobrando hay que despejarla del total.
const punitoryInTotalDue = (record) =>
  Math.round((record.totalDue - (record.rentAmount + record.servicesTotal - record.previousBalance)) * 100) / 100;

describe('D. La mora genuina no se pierde', () => {
  test('D1: pago genuinamente parcial → sigue PARTIAL y con mora', async () => {
    const prisma = makeFakePrisma();
    const punitory = makePunitory();
    const monthlyRecordService = makeMonthlyRecordService(prisma, punitory);

    // Paga 400.000 el 08/07. Al 30/07 la mora tiene que haber corrido sobre el
    // saldo restante: (768.478 − 400.000 − 560) × 0,6% × 23 días.
    await makeRecord(prisma, 'mr-d1', [makeTx(400000, 8)], { amountPaid: 0 });

    await monthlyRecordService.recalculateMultipleRecords(['mr-d1'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-d1' } });

    assert.equal(updated.amountPaid, 400000);
    assert.equal(updated.status, 'PARTIAL');
    const remaining = CHARGES - 400000 - CREDIT;
    assert.equal(punitoryInTotalDue(updated), Math.round(remaining * 0.006 * 23 * 100) / 100);
    assert.ok(updated.balance < 0, `debe quedar saldo pendiente, dio ${updated.balance}`);
  });

  test('D2: sin efectivo, el crédito descuenta pero NO arrastra los servicios a la base', async () => {
    const prisma = makeFakePrisma();
    const punitory = makePunitory();
    const monthlyRecordService = makeMonthlyRecordService(prisma, punitory);

    await makeRecord(prisma, 'mr-d2', []);

    await monthlyRecordService.recalculateMultipleRecords(['mr-d2'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-d2' } });

    assert.equal(updated.amountPaid, 0);
    assert.equal(updated.status, 'PENDING');
    // Del día 6 (punitoryStartDay) al 30, ambos inclusive = 25 días. La base es
    // alquiler − crédito: los $119.655 de servicios impagos NO entran, porque sin
    // un pago REAL el saldo a favor no activa la base ampliada (regla confirmada
    // 2026-07-11). Si entraran, la mora saltaría de $97.239,45 a $115.187,70.
    assert.equal(punitoryInTotalDue(updated), Math.round((RENT - CREDIT) * 0.006 * 25 * 100) / 100);
  });

  test('D3: sin efectivo NI crédito, la base es el alquiler completo (regla intacta)', () => {
    const { computePunitoryBase } = makePunitory();
    assert.equal(computePunitoryBase({ rentAmount: RENT, servicesTotal: SERVICES_TOTAL, ivaAmount: 0, amountPaid: 0, appliedCredit: 0 }), RENT);
    // Espejo de A4 en punitoryBaseDescuento.test.js: una bonificación mayor al
    // alquiler tampoco baja la base mientras no haya nada cobrado.
    assert.equal(computePunitoryBase({ rentAmount: 100000, servicesTotal: -150000, ivaAmount: 0, amountPaid: 0 }), 100000);
  });
});
