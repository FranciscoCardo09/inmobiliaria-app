'use strict';

/**
 * Auditoría 2026-07 — Modelo de CAJA deseado para el Reporte de Liquidación
 * (confirmado con el usuario 2026-07-14, ver AUDITORIA_CONTROL_LIQUIDACION_2026-07.md).
 *
 * Escenario "Juan": enero y febrero quedan impagos; en marzo paga $250.000 de una
 * sola vez (con 3 transacciones el mismo día) que cancelan enero completo, febrero
 * completo, y una parte de marzo.
 *
 *   Enero:  alquiler 100.000 + punitorios  5.000 (congelados, saldados) = 105.000
 *   Febrero: alquiler 100.000 + punitorios 3.000 (congelados, saldados) = 103.000
 *   Marzo:  alquiler 100.000, paga 42.000 (parcial, sin punitorios propios aún)
 *   Total cobrado EN MARZO (caja) = 105.000 + 103.000 + 42.000 = 250.000
 *
 * Regla de negocio (P1): el Reporte de Liquidación de MARZO debe reflejar los
 * 250.000 cobrados en marzo, con desglose por mes de origen y por concepto.
 * Regla de negocio (P2): los punitorios de enero/feb son los CONGELADOS al pagarse
 * (ya no crecen); los de marzo son los PAGADOS a la fecha del pago (no el valor a
 * la fecha en que se genera el reporte).
 * Regla de negocio (agrupado): 3 pagos el mismo día deben aparecer en el detalle
 * como UN solo renglón sumado.
 *
 * PARTE 1 — documenta el comportamiento ACTUAL de getLiquidacionesAllContracts
 * (período de deuda + bloque secundario de caja) → expone los Hallazgos #1/#2/#4.
 * PARTE 2 — especifica el modelo DESEADO mediante un agregador de referencia que
 * opera sobre los mismos datos crudos (PaymentTransaction + TransactionConcept),
 * sirviendo de documentación ejecutable para el fix propuesto.
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const GROUP = 'g1';
const CONTRACT_ID = 'c-1';
const MARCH_14 = new Date(2026, 2, 14, 12, 0, 0);
const APRIL_10 = new Date(2026, 3, 10, 12, 0, 0);

function buildReportService(prisma) {
  return proxyquire('../src/services/reportDataService', {
    '../lib/prisma': prisma,
    // getLiquidacionesAllContracts auto-crea registros del período global antes de
    // consultar; en este test los registros ya existen (construidos a mano), así
    // que lo dejamos como no-op para no arrastrar todo el motor de recálculo.
    './monthlyRecordService': { getOrCreateMonthlyRecords: async () => {} },
  });
}

const CONTRACT_OBJ = {
  id: CONTRACT_ID,
  active: true,
  renewedAt: null,
  contractType: 'INQUILINO',
  tenant: null,
  contractTenants: [{ isPrimary: true, tenant: { name: 'Juan Pérez', dni: '1', email: null, phone: null } }],
  property: {
    address: 'Av. Test 123', floor: null, apartment: null,
    owner: { name: 'María García', dni: '2', email: null, phone: null, transferBeneficiary: null },
    transferBeneficiary: null,
  },
  rentHistory: [],
  debts: [], // enero/feb ya saldadas (status PAID → excluidas por status:{not:'PAID'}); marzo aún no cerró (no hay Debt)
};

function makeMonthlyRecordRow({ id, periodMonth, periodYear, rentAmount, punitoryAmount, amountPaid, totalDue, status, isCancelled, tx }) {
  return {
    id, groupId: GROUP, contractId: CONTRACT_ID,
    monthNumber: periodMonth, periodMonth, periodYear,
    rentAmount, servicesTotal: 0, previousBalance: 0,
    punitoryAmount, punitoryDays: 0, punitoryForgiven: false,
    includeIva: false, ivaAmount: 0,
    totalDue, amountPaid, balance: amountPaid - totalDue,
    status, isPaid: status === 'COMPLETE', isCancelled, isPostExpiry: false,
    fullPaymentDate: isCancelled ? tx.paymentDate : null,
    services: [],
    transactions: [tx],
    contract: CONTRACT_OBJ,
  };
}

function makeTx({ id, monthlyRecordId, periodMonth, periodYear, amount, alquiler, punitorios, paymentDate }) {
  const concepts = [];
  if (alquiler > 0) concepts.push({ type: 'ALQUILER', amount: alquiler });
  if (punitorios > 0) concepts.push({ type: 'PUNITORIOS', amount: punitorios });
  return {
    id, groupId: GROUP, monthlyRecordId, paymentDate, amount,
    punitoryAmount: punitorios, punitoryForgiven: false,
    concepts,
    // Embebido para que el bloque "cobrosByContract" (query separada sobre
    // paymentTransaction) pueda resolver el período/contrato sin joins reales.
    monthlyRecord: { groupId: GROUP, periodMonth, periodYear, contractId: CONTRACT_ID, contract: CONTRACT_OBJ },
  };
}

async function seedJuanEscenario(prisma) {
  const txJan = makeTx({ id: 'tx-jan', monthlyRecordId: 'mr-jan', periodMonth: 1, periodYear: 2026, amount: 105000, alquiler: 100000, punitorios: 5000, paymentDate: MARCH_14 });
  const txFeb = makeTx({ id: 'tx-feb', monthlyRecordId: 'mr-feb', periodMonth: 2, periodYear: 2026, amount: 103000, alquiler: 100000, punitorios: 3000, paymentDate: MARCH_14 });
  const txMar = makeTx({ id: 'tx-mar', monthlyRecordId: 'mr-mar', periodMonth: 3, periodYear: 2026, amount: 42000, alquiler: 42000, punitorios: 0, paymentDate: MARCH_14 });

  const mrJan = makeMonthlyRecordRow({ id: 'mr-jan', periodMonth: 1, periodYear: 2026, rentAmount: 100000, punitoryAmount: 5000, amountPaid: 105000, totalDue: 105000, status: 'COMPLETE', isCancelled: true, tx: txJan });
  const mrFeb = makeMonthlyRecordRow({ id: 'mr-feb', periodMonth: 2, periodYear: 2026, rentAmount: 100000, punitoryAmount: 3000, amountPaid: 103000, totalDue: 103000, status: 'COMPLETE', isCancelled: true, tx: txFeb });
  const mrMar = makeMonthlyRecordRow({ id: 'mr-mar', periodMonth: 3, periodYear: 2026, rentAmount: 100000, punitoryAmount: 0, amountPaid: 42000, totalDue: 100000, status: 'PARTIAL', isCancelled: false, tx: txMar });

  for (const mr of [mrJan, mrFeb, mrMar]) prisma.monthlyRecord._rows.push(mr);
  for (const tx of [txJan, txFeb, txMar]) prisma.paymentTransaction._rows.push(tx);

  return { txJan, txFeb, txMar, mrJan, mrFeb, mrMar };
}

// ============================================================================
// PARTE 1 — comportamiento ACTUAL (documenta los Hallazgos #1, #2, #4)
// ============================================================================

describe('Liquidación de MARZO — comportamiento ACTUAL (período de deuda)', () => {
  test('Hallazgo #1: la fila principal de marzo NO incluye lo cobrado de enero/febrero', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);

    const marchRow = result.find((r) => r.monthlyRecordId === 'mr-mar');
    assert.ok(marchRow, 'debe existir la fila de marzo');
    // BUG: el modelo de caja pide 250000 (ene+feb+mar); el código actual solo
    // muestra lo propio de marzo porque selecciona por periodMonth/periodYear.
    assert.strictEqual(marchRow.amountPaid, 42000, 'FALLA EL MODELO DE CAJA — hoy solo muestra el amountPaid propio del período');
    assert.notStrictEqual(marchRow.amountPaid, 250000, 'el modelo deseado (P1) pide 250000 — hoy no se cumple, ver Hallazgo #1');
  });

  test('el bloque secundario "cobradoOtrosPeriodos" SÍ captura ene+feb (parcialmente cubre el criterio de caja)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);

    const marchRow = result.find((r) => r.monthlyRecordId === 'mr-mar');
    assert.ok(marchRow.cobradoOtrosPeriodos, 'debe traer el bloque de cobros de otros períodos');
    assert.strictEqual(marchRow.cobradoOtrosPeriodos.total, 208000, 'ene(105000)+feb(103000) cobrados en marzo');
    assert.strictEqual(marchRow.cobradoOtrosPeriodos.detalle.length, 2, 'un renglón por período de origen (ene y feb)');
  });

  test('Hallazgo #4: computeGrandTotals del reporte de marzo NO suma cobradoOtrosPeriodos → subestima la caja real', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
    const grand = svc.computeGrandTotals(result);

    // Caja real de marzo = 250000; el header del reporte hoy muestra solo 42000.
    assert.strictEqual(grand.grandTotal, 42000, 'FALLA EL MODELO DE CAJA — grandTotal ignora los 208000 cobrados de ene/feb');
  });

  test('el detalle de transacciones de la fila de marzo NO agrupa los pagos de ene/feb (viven en otro registro)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
    const marchRow = result.find((r) => r.monthlyRecordId === 'mr-mar');

    assert.strictEqual(marchRow.transacciones.length, 1, 'solo ve su propia transacción (42000), no las 3 del día 14/03');
    assert.strictEqual(marchRow.transacciones[0].monto, 42000);
  });
});

// ============================================================================
// PARTE 2 — modelo DESEADO (spec ejecutable, documenta el fix de Entregable 2)
// ============================================================================

/**
 * Agregador de referencia para el modelo de CAJA deseado (P1/P2/agrupado).
 * NO es código de producción — documenta, sobre los mismos datos crudos
 * (PaymentTransaction + TransactionConcept), qué debería devolver el fix del
 * Hallazgo #1+#2 (ver AUDITORIA_CONTROL_LIQUIDACION_2026-07.md).
 */
function aggregateCajaDelMes(transactions, month, year) {
  const inMonth = transactions.filter((t) => {
    const d = t.paymentDate;
    return d.getMonth() + 1 === month && d.getFullYear() === year;
  });

  const totalCobrado = inMonth.reduce((s, t) => s + t.amount, 0);
  const alquilerCobrado = inMonth.reduce((s, t) => s + t.concepts.filter((c) => c.type === 'ALQUILER').reduce((a, c) => a + c.amount, 0), 0);
  const punitoriosCobrados = inMonth.reduce((s, t) => s + t.concepts.filter((c) => c.type === 'PUNITORIOS').reduce((a, c) => a + c.amount, 0), 0);

  const porMesOrigen = new Map();
  for (const t of inMonth) {
    const key = `${t.monthlyRecord.periodMonth}/${t.monthlyRecord.periodYear}`;
    porMesOrigen.set(key, (porMesOrigen.get(key) || 0) + t.amount);
  }

  const porFecha = new Map();
  for (const t of inMonth) {
    const key = t.paymentDate.toDateString();
    porFecha.set(key, (porFecha.get(key) || 0) + t.amount);
  }

  return { totalCobrado, alquilerCobrado, punitoriosCobrados, porMesOrigen, porFecha };
}

describe('Liquidación de MARZO — modelo DESEADO (caja, spec de referencia)', () => {
  test('total cobrado en marzo = 250.000 (ene completo + feb completo + parte de marzo)', async () => {
    const { txJan, txFeb, txMar } = await seedJuanEscenario(makeFakePrisma());
    const spec = aggregateCajaDelMes([txJan, txFeb, txMar], 3, 2026);

    assert.strictEqual(spec.totalCobrado, 250000);
  });

  test('punitorios cobrados en marzo = 8.000 (5.000 congelados de ene + 3.000 congelados de feb + 0 de marzo)', async () => {
    const { txJan, txFeb, txMar } = await seedJuanEscenario(makeFakePrisma());
    const spec = aggregateCajaDelMes([txJan, txFeb, txMar], 3, 2026);

    assert.strictEqual(spec.punitoriosCobrados, 8000, 'P2: punitorios = lo efectivamente pagado, no el valor vivo a la fecha del reporte');
  });

  test('alquiler cobrado en marzo = 242.000 (100.000 + 100.000 + 42.000)', async () => {
    const { txJan, txFeb, txMar } = await seedJuanEscenario(makeFakePrisma());
    const spec = aggregateCajaDelMes([txJan, txFeb, txMar], 3, 2026);

    assert.strictEqual(spec.alquilerCobrado, 242000);
  });

  test('desglose por mes de origen: 1/2026=105000, 2/2026=103000, 3/2026=42000', async () => {
    const { txJan, txFeb, txMar } = await seedJuanEscenario(makeFakePrisma());
    const spec = aggregateCajaDelMes([txJan, txFeb, txMar], 3, 2026);

    assert.strictEqual(spec.porMesOrigen.get('1/2026'), 105000);
    assert.strictEqual(spec.porMesOrigen.get('2/2026'), 103000);
    assert.strictEqual(spec.porMesOrigen.get('3/2026'), 42000);
    assert.strictEqual(spec.porMesOrigen.size, 3);
  });

  test('detalle de pagos agrupado por fecha: 3 pagos el mismo día → UN solo renglón de 250.000', async () => {
    const { txJan, txFeb, txMar } = await seedJuanEscenario(makeFakePrisma());
    const spec = aggregateCajaDelMes([txJan, txFeb, txMar], 3, 2026);

    assert.strictEqual(spec.porFecha.size, 1, 'un único renglón de fecha para el 14/03/2026');
    assert.strictEqual(spec.porFecha.get(MARCH_14.toDateString()), 250000);
  });

  test('saldo pendiente de marzo tras el pago parcial = 58.000', async () => {
    const { mrMar } = await seedJuanEscenario(makeFakePrisma());
    assert.strictEqual(mrMar.totalDue - mrMar.amountPaid, 58000);
  });

  test('liquidación total: si en abril se cancela el saldo de marzo + alquiler de abril, el pendiente queda en 0', async () => {
    const prisma = makeFakePrisma();
    const { txJan, txFeb, txMar } = await seedJuanEscenario(prisma);

    // Abril: paga los 58000 pendientes de marzo + 100000 de abril = 158000, un solo pago.
    const txAbrRemanenteMarzo = makeTx({ id: 'tx-abr-mar', monthlyRecordId: 'mr-mar', periodMonth: 3, periodYear: 2026, amount: 58000, alquiler: 58000, punitorios: 0, paymentDate: APRIL_10 });
    const txAbr = makeTx({ id: 'tx-abr', monthlyRecordId: 'mr-abr', periodMonth: 4, periodYear: 2026, amount: 100000, alquiler: 100000, punitorios: 0, paymentDate: APRIL_10 });

    const specAbril = aggregateCajaDelMes([txJan, txFeb, txMar, txAbrRemanenteMarzo, txAbr], 4, 2026);

    assert.strictEqual(specAbril.totalCobrado, 158000, 'liquidación total de abril = saldo de marzo + alquiler de abril');
    assert.strictEqual(specAbril.porMesOrigen.get('3/2026'), 58000, 'marzo queda completamente saldado en el reporte de abril');
    assert.strictEqual(specAbril.porMesOrigen.get('4/2026'), 100000);

    // Saldo pendiente final de marzo = totalDue(100000) - (amountPaid propio 42000 + este pago 58000) = 0
    const marzoTotalPagado = 42000 + 58000;
    assert.strictEqual(100000 - marzoTotalPagado, 0, 'marzo queda en 0 tras la liquidación total');
  });
});
