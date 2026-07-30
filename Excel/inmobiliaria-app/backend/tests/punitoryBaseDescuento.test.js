'use strict';

/**
 * Cobertura de tests: punitorios + descuentos/bonificaciones (caso Godoy)
 *
 * Bug real (2026-07-23, Godoy Fernando Alberto, Los Pinos 4031 Torre 2 1B,
 * julio 2026): computePunitoryBase (src/utils/punitory.js) y sus 5
 * call-sites pre-recortaban servicesTotal con Math.max(servicesTotal, 0)
 * antes de comparar lo pagado contra el total adeudado. Un mes con un
 * descuento/bonificación real (servicesTotal negativo, ej. "Cocina cuota 2
 * de 3": -$123.333) que cubría parte del alquiler nunca podía saldarse del
 * todo: el pago del total NETO exacto seguía comparándose contra el
 * alquiler BRUTO sin descuento, dejando un saldo fantasma que devengaba
 * mora en vivo contra la fecha de HOY (crecía cada día que el pago tardara
 * en registrarse). Fix (commit 0ebc81b): si lo pagado ya cubre el total
 * NETO, la base de punitorio es 0.
 *
 * Ver spec: docs/superpowers/specs/2026-07-23-punitory-discount-tests-design.md
 *
 * Run: cd inmobiliaria-app/backend && npm run test:unit
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { getTodayLocalString } = require('../src/utils/dateUtils');
const { makeFakePrisma } = require('./helpers/fakePrisma');

const { round2 } = realPunitory;

const { computePunitoryBase, computeLiveRecordPunitory } = realPunitory;

// ─── A. computePunitoryBase — matriz de casos puros ────────────────────────

describe('A. computePunitoryBase — descuento/bonificación que deja el neto pagado', () => {
  test('A1: descuento parcial + pago exacto del neto → base = 0 (regresión directa, caso Godoy)', () => {
    // rentAmount=100000, descuento=-30000 → neto=70000; paga exactamente 70000.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 70000 });
    assert.equal(base, 0);
  });

  test('A2: descuento parcial + pago parcial (menor al neto) → base = alquiler bruto − pagado (la tasa NO usa el descuento)', () => {
    // neto=70000 pero solo pagó 50000 (sigue debiendo). Base = rentAmount(100000, servicesTotal clampeado a 0) − 50000 = 50000.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 50000 });
    assert.equal(base, 50000);
  });

  test('A3: descuento parcial + sobrepago → base = 0', () => {
    // neto=70000, pagó 80000 (de más).
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 80000 });
    assert.equal(base, 0);
  });

  test('A4: descuento que EXCEDE el alquiler bruto + nada pagado → base = solo alquiler (no negativa, no cero)', () => {
    // servicesTotal=-150000 (bonificación mayor al alquiler) → neto negativo, pero sin ningún pago
    // real la regla "sin pago, base = solo alquiler" no cambia.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -150000, ivaAmount: 0, amountPaid: 0 });
    assert.equal(base, 100000);
  });

  test('A5 (control, sin descuento): servicios positivos + pago exacto del neto → base = 0', () => {
    // Confirma que el camino SIN descuento (ya cubierto por tests/punitory.test.js) sigue igual.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 0, amountPaid: 130000 });
    assert.equal(base, 0);
  });

  test('A6: con IVA + descuento parcial + pago exacto del neto (alquiler+servicios+IVA) → base = 0', () => {
    // neto = 100000 - 30000 + 21000 = 91000.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 21000, amountPaid: 91000 });
    assert.equal(base, 0);
  });

  test('A7: pago exacto MENOS un margen → base > 0 (la tolerancia de redondeo no debe tapar un pendiente real)', () => {
    // neto=70000, pagó 69999 (1 peso de menos, bien afuera de la tolerancia de $0,01).
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 69999 });
    assert.ok(base > 0, `esperaba base > 0 (todavía pendiente $1), dio ${base}`);
    assert.equal(base, 30001); // 100000 (clampeado) - 69999
  });

  test('A8: pago exacto MÁS un centavo → base = 0 (la tolerancia de $0,01 sí cubre diferencias de redondeo)', () => {
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 70000.01 });
    assert.equal(base, 0);
  });
});

// ─── B. computeLiveRecordPunitory — mismo caso a través de la función de más
// alto nivel (usa la fecha real de "hoy" como calculationDate por defecto) ──

describe('B. computeLiveRecordPunitory — no hay mora fantasma aunque pasen muchos días', () => {
  const CONTRACT = { punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  // Período fijo y seguro en el pasado (nunca queda "en el futuro" sin importar
  // cuándo corra este test): 2020, muy anterior a la fecha real del sistema.
  const PERIOD_MONTH = 3;
  const PERIOD_YEAR = 2020;

  test('B1: descuento parcial + pago exacto del neto → amount = 0 sin importar los días transcurridos', () => {
    const record = {
      rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, includeIva: false,
      amountPaid: 70000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, isPostExpiry: false,
      transactions: [{
        paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0),
        punitoryForgiven: false, concepts: [{ type: 'ALQUILER', amount: 70000 }],
      }],
    };
    const result = computeLiveRecordPunitory(record, CONTRACT, [], { isFullyPaid: false });
    assert.equal(result.amount, 0);
    assert.equal(result.days, 0);
  });

  test('B2 (control, sin descuento): servicios positivos + pago exacto del neto → amount = 0', () => {
    const record = {
      rentAmount: 100000, servicesTotal: 30000, ivaAmount: 0, includeIva: false,
      amountPaid: 130000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, isPostExpiry: false,
      transactions: [{
        paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0),
        punitoryForgiven: false, concepts: [{ type: 'ALQUILER', amount: 130000 }],
      }],
    };
    const result = computeLiveRecordPunitory(record, CONTRACT, [], { isFullyPaid: false });
    assert.equal(result.amount, 0);
  });

  test('B3: descuento parcial + pago GENUINAMENTE parcial → amount > 0 (la regla de tasa bruta sigue vigente)', () => {
    const record = {
      rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, includeIva: false,
      amountPaid: 50000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, isPostExpiry: false,
      transactions: [{
        paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0),
        punitoryForgiven: false, concepts: [{ type: 'ALQUILER', amount: 50000 }],
      }],
    };
    const result = computeLiveRecordPunitory(record, CONTRACT, [], { isFullyPaid: false });
    assert.ok(result.amount > 0, `esperaba mora > 0 (pago genuinamente parcial), dio ${result.amount}`);
  });
});

// ─── C. Flujo completo: monthlyRecordService.recalculateMultipleRecords REAL,
// contra un MonthlyRecord con las transacciones ya embebidas (mismo patrón que
// el resto de la suite: fakePrisma no resuelve relaciones `include`, así que
// se arma el estado final -o el estado de un punto intermedio- directamente,
// en vez de encadenar llamadas reales a registerPayment). ─────────────────

describe('C. Convergencia real (monthlyRecordService.recalculateMultipleRecords)', () => {
  function makeMonthlyRecordService(prisma) {
    return proxyquire('../src/services/monthlyRecordService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
      './debtService': { calculateDebtPunitory: async () => ({}) },
      './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
    });
  }

  // Caso real Godoy, a escala real: alquiler $680.000, descuento "Cocina cuota
  // 2 de 3" -$123.333, dos impuestos ($8.740 + $28.760) → servicesTotal neto
  // = -85.833; total neto adeudado = 594.167.
  const RENT = 680000;
  const SERVICES = [
    { amount: 123333, conceptType: { category: 'DESCUENTO' } },
    { amount: 8740, conceptType: { category: 'IMPUESTO' } },
    { amount: 28760, conceptType: { category: 'IMPUESTO' } },
  ];
  const NET_TOTAL = 594167; // 680000 - 123333 + 8740 + 28760
  const CONTRACT = { punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const PERIOD_MONTH = 3;
  const PERIOD_YEAR = 2020; // bien en el pasado: siempre "vencido", sin importar cuándo corra el test

  function makeTx(amount, day) {
    const date = new Date(PERIOD_YEAR, PERIOD_MONTH - 1, day, 12, 0, 0);
    return {
      amount, paymentDate: date, createdAt: date,
      punitoryForgiven: false, punitoryAmount: 0,
      concepts: [{ type: 'ALQUILER', amount }],
    };
  }

  async function makeRecord(prisma, id, transactions, overrides = {}) {
    // NOTA (corregida 2026-07-30, caso Biassi): esta nota decía que en producción
    // `servicesTotal` y `amountPaid` ya llegan sincronizados con
    // `services[]`/`transactions[]`. Era FALSO, y esa premisa es justo lo que dejó
    // pasar el bug: `registerPaymentCore` crea la PaymentTransaction y recalcula
    // ANTES de persistir `amountPaid`, y `updateService` escribe la fila del
    // servicio y recién después recalcula — así que `_recalculateCore` recibe el
    // registro desincronizado en sus dos caminos principales. Desde el fix,
    // `_recalculateCore` le pasa a `computeLiveRecordPunitory` los valores que
    // acaba de recomputar, no los del `record` crudo. Ver
    // tests/punitoryStaleRecalc.test.js. Este fixture arranca consistente sólo
    // porque estos casos apuntan a otra cosa (descuentos/bonificaciones).
    const amountPaid = transactions.reduce((s, t) => s + t.amount, 0);
    await prisma.monthlyRecord.create({
      data: {
        id, groupId: 'g1', contractId: 'c1',
        monthNumber: 2, periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR,
        status: 'PENDING', isPaid: false, isCancelled: false,
        rentAmount: RENT, servicesTotal: -85833,
        includeIva: false, ivaAmount: 0,
        previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
        balanceForgiven: 0, amountPaid, totalDue: 0, balance: 0,
        fullPaymentDate: null, needsRecalculation: false,
        services: SERVICES,
        transactions,
        contract: CONTRACT,
        ...overrides,
      },
    });
  }

  test('C1: caso Godoy exacto — un solo pago cubre el neto exacto → COMPLETE, balance 0, sin mora', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);
    await makeRecord(prisma, 'mr-c1', [makeTx(NET_TOTAL, 9)]);

    await monthlyRecordService.recalculateMultipleRecords(['mr-c1'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c1' } });

    assert.equal(updated.totalDue, NET_TOTAL);
    assert.equal(updated.amountPaid, NET_TOTAL);
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.punitoryAmount, 0);
  });

  test('C2: 20 pagos parciales que suman EXACTO el neto → converge a COMPLETE/$0, sin importar la fragmentación', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);

    // 19 pagos de $30.000 + 1 pago final de $24.167 = $594.167 (NET_TOTAL exacto).
    const transactions = [];
    for (let i = 0; i < 19; i++) transactions.push(makeTx(30000, 1));
    transactions.push(makeTx(24167, 28));
    assert.equal(transactions.reduce((s, t) => s + t.amount, 0), NET_TOTAL, 'sanity check de la suma de las 20 cuotas');

    await makeRecord(prisma, 'mr-c2', transactions);
    await monthlyRecordService.recalculateMultipleRecords(['mr-c2'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c2' } });

    assert.equal(updated.amountPaid, NET_TOTAL);
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.punitoryAmount, 0);
  });

  test('C2b: a mitad de camino (19 de los 20 pagos) sigue PARTIAL con mora real, no se zanja antes de tiempo', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);

    const transactions = [];
    for (let i = 0; i < 19; i++) transactions.push(makeTx(30000, 1)); // suma 570000, faltan 24167

    await makeRecord(prisma, 'mr-c2b', transactions);
    await monthlyRecordService.recalculateMultipleRecords(['mr-c2b'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c2b' } });

    assert.equal(updated.amountPaid, 570000);
    assert.equal(updated.status, 'PARTIAL');
    assert.ok(updated.balance < 0, `esperaba saldo pendiente negativo, dio ${updated.balance}`);

    // La mora VIVA se refleja en `totalDue`, NO en el campo `punitoryAmount`: ese
    // guarda el CONGELADO del último pago (acá $0, porque los fixtures no cobran
    // punitorios) y otros consumidores —creación de deudas, recibos— dependen de
    // esa semántica. Antes este test afirmaba `punitoryAmount > 0`, que en este
    // camino no puede darse nunca. Se despeja la mora del total:
    //   totalDue = alquiler + servicios + mora − saldo a favor
    const moraEnTotalDue = round2(
      updated.totalDue - (RENT + updated.servicesTotal - updated.previousBalance)
    );
    assert.ok(moraEnTotalDue > 0, `con pago genuinamente parcial la mora debe seguir corriendo, dio ${moraEnTotalDue}`);

    // Y sobre la TASA BRUTA: la base es alquiler − pagado = 110.000, sin descontar
    // la bonificación. Si el descuento bajara la base, sería 594.167 − 570.000 =
    // 24.167 — que es justo el bug que cubre este archivo.
    const baseBruta = RENT - 570000;
    assert.equal(baseBruta, 110000, 'sanity check de la base bruta esperada');
    const esperado = realPunitory.calculatePunitoryV2(
      getTodayLocalString(), PERIOD_MONTH, PERIOD_YEAR, baseBruta,
      CONTRACT.punitoryStartDay, CONTRACT.punitoryGraceDay, CONTRACT.punitoryPercent,
      [], new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 1, 12, 0, 0)
    ).amount;
    assert.equal(moraEnTotalDue, esperado, 'la mora se calcula sobre el alquiler bruto, no sobre el neto del descuento');
  });

  test('C3: sobrepago (la cuota 20 se pasa del neto) → balance positivo (saldo a favor), sin mora', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);

    const transactions = [];
    for (let i = 0; i < 19; i++) transactions.push(makeTx(30000, 1)); // 570000
    transactions.push(makeTx(30000, 28)); // última cuota de $30.000 en vez de $24.167 → paga $600.000 (de más)

    await makeRecord(prisma, 'mr-c3', transactions);
    await monthlyRecordService.recalculateMultipleRecords(['mr-c3'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c3' } });

    assert.equal(updated.amountPaid, 600000);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.balance, 5833); // 600000 - 594167
    assert.equal(updated.punitoryAmount, 0);
  });

  test('C4 (control, SIN descuento): pagos parciales fragmentados sin ningún descuento → sigue funcionando igual que antes', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);
    const noDiscountServices = [{ amount: 20000, conceptType: { category: 'IMPUESTO' } }];
    const netNoDiscount = 100000 + 20000; // rentAmount fijo de este test = 100000

    await prisma.monthlyRecord.create({
      data: {
        id: 'mr-c4', groupId: 'g1', contractId: 'c1',
        monthNumber: 2, periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR,
        status: 'PENDING', isPaid: false, isCancelled: false,
        rentAmount: 100000, servicesTotal: 20000, // ya sincronizado con noDiscountServices (misma razón que arriba)
        includeIva: false, ivaAmount: 0,
        previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
        balanceForgiven: 0, amountPaid: netNoDiscount, totalDue: 0, balance: 0, // ya sincronizado con transactions[]
        fullPaymentDate: null, needsRecalculation: false,
        services: noDiscountServices,
        transactions: [makeTx(60000, 1), makeTx(60000, 28)], // 2 pagos de 60000 = 120000 = netNoDiscount
        contract: CONTRACT,
      },
    });

    await monthlyRecordService.recalculateMultipleRecords(['mr-c4'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c4' } });

    assert.equal(updated.amountPaid, netNoDiscount);
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.punitoryAmount, 0);
  });
});

// ─── D. debtService.js — mismos call-sites con el clamp original ──────────

describe('D. debtService: descuento que deja el neto pagado no crea/mantiene deuda fantasma', () => {
  const CONTRACT = { id: 'c1', groupId: 'g1', punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const PERIOD_MONTH = 3;
  const PERIOD_YEAR = 2020;
  const RENT = 680000;
  const SERVICES_TOTAL_NET = -85833; // mismo descuento neto que el caso Godoy (Sección C)
  const NET_TOTAL = 594167;

  test('D1: createDebtFromMonthlyRecord — no crea deuda fantasma cuando el descuento deja el neto pagado', async () => {
    const prisma = makeFakePrisma();
    const { createDebtFromMonthlyRecord } = proxyquire('../src/services/debtService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    });

    const monthlyRecord = {
      id: 'mr-d1', periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, monthNumber: 2,
      rentAmount: RENT, servicesTotal: SERVICES_TOTAL_NET, ivaAmount: 0,
      punitoryAmount: 0, previousBalance: 0, amountPaid: NET_TOTAL,
      status: 'PARTIAL', // aún no marcado COMPLETE en el momento del cierre de mes
      punitoryForgiven: false,
      transactions: [{ paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0) }],
    };

    const debt = await createDebtFromMonthlyRecord(monthlyRecord, CONTRACT);
    assert.equal(debt, null, 'no debe crear ninguna deuda: el descuento ya deja el neto pagado');
  });

  test('D2: recalculateDebtFromMonthlyRecord — una deuda con punitorio fantasma se corrige a $0/PAID cuando el descuento deja el neto pagado', async () => {
    const prisma = makeFakePrisma();
    const { recalculateDebtFromMonthlyRecord } = proxyquire('../src/services/debtService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    });

    await prisma.monthlyRecord.create({
      data: {
        id: 'mr-d2', periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, monthNumber: 2,
        rentAmount: RENT, servicesTotal: SERVICES_TOTAL_NET, ivaAmount: 0,
        punitoryAmount: 0, amountPaid: NET_TOTAL, status: 'PARTIAL', punitoryForgiven: false,
        transactions: [{ paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0) }],
      },
    });
    await prisma.contract.create({ data: CONTRACT });
    await prisma.debt.create({
      data: {
        id: 'debt-d2', contractId: 'c1', monthlyRecordId: 'mr-d2', status: 'OPEN',
        amountPaid: 0, appliedCredit: 0,
        accumulatedPunitory: 50000, // valor fantasma ya persistido antes de este recálculo
        punitoryStartDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 1),
        originalAmount: 0, unpaidRentAmount: 0, unpaidServicesAmount: 0, currentTotal: 50000,
      },
    });

    const updatedDebt = await recalculateDebtFromMonthlyRecord('debt-d2', 'mr-d2');
    assert.equal(updatedDebt.accumulatedPunitory, 0);
    assert.equal(updatedDebt.currentTotal, 0);
    assert.equal(updatedDebt.status, 'PAID');

    const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-d2' } });
    assert.equal(record.status, 'COMPLETE', 'el MonthlyRecord debe sincronizarse a COMPLETE cuando la deuda queda saldada');
  });
});