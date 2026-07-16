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
 * PARTE 1 — verifica el comportamiento CORRECTO (post-fix) de
 * getLiquidacionesAllContracts: la fila de marzo conserva su documento de
 * período (amountPaid propio, conceptos, total, pendiente — decisión del
 * usuario 2026-07-14: esa estructura no se toca), pero la CAJA del mes
 * (computeGrandTotals, cobradoOtrosPeriodos, transacciones) ahora refleja los
 * 250.000 reales cobrados en marzo. Antes del fix estas mismas aserciones
 * documentaban los Hallazgos #1/#2/#4 (ver git history de este archivo).
 * PARTE 2 — especifica el modelo DESEADO mediante un agregador de referencia que
 * opera sobre los mismos datos crudos (PaymentTransaction + TransactionConcept),
 * sirviendo de documentación ejecutable del fix — y de spec contra la que se
 * verifica PARTE 1.
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
// PARTE 1 — comportamiento CORRECTO post-fix (Hallazgos #1, #2, #4, #5)
// ============================================================================

describe('Liquidación de MARZO — comportamiento CORRECTO (criterio de caja)', () => {
  test('la fila principal de marzo conserva su documento de período (amountPaid propio = 42000)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);

    const marchRow = result.find((r) => r.monthlyRecordId === 'mr-mar');
    assert.ok(marchRow, 'debe existir la fila de marzo');
    // Decisión del usuario (2026-07-14): el documento del período (conceptos, total,
    // pendiente, amountPaid propio) NO se toca — solo se corrige la CAJA del mes
    // (cobradoOtrosPeriodos / computeGrandTotals / transacciones, abajo).
    assert.strictEqual(marchRow.amountPaid, 42000, 'amountPaid sigue siendo el propio del período de marzo');
  });

  test('"cobradoOtrosPeriodos" captura ene+feb con desglose por concepto (alquiler/punitorios)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);

    const marchRow = result.find((r) => r.monthlyRecordId === 'mr-mar');
    assert.ok(marchRow.cobradoOtrosPeriodos, 'debe traer el bloque de cobros de otros períodos');
    assert.strictEqual(marchRow.cobradoOtrosPeriodos.total, 208000, 'ene(105000)+feb(103000) cobrados en marzo');
    assert.strictEqual(marchRow.cobradoOtrosPeriodos.detalle.length, 2, 'un renglón por período de origen (ene y feb)');
    // Hallazgo #2: desglose leído de los TransactionConcept reales (ene 100000 alq +
    // 5000 punit; feb 100000 alq + 3000 punit), no re-derivado.
    assert.strictEqual(marchRow.cobradoOtrosPeriodos.alquiler, 200000);
    assert.strictEqual(marchRow.cobradoOtrosPeriodos.punitorios, 8000);
  });

  test('FIX Hallazgo #4: computeGrandTotals del reporte de marzo suma cobradoOtrosPeriodos → refleja la caja real (250000)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
    const grand = svc.computeGrandTotals(result);

    assert.strictEqual(grand.grandTotal, 250000, 'caja real de marzo = 42000 propio + 208000 de ene/feb');
    assert.strictEqual(grand.grandPunitoriosCobrado, 8000, 'punitorios cobrados = 0 (propio marzo) + 8000 (ene/feb congelados)');
    assert.strictEqual(grand.grandAlquilerCobrado, 242000, 'alquiler cobrado = 42000 (propio) + 200000 (ene/feb)');
  });

  test('FIX Hallazgo #5: el detalle de transacciones de marzo agrupa ene+feb+mar en UN renglón de 250000 (mismo día)', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);
    await seedJuanEscenario(prisma);

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
    const marchRow = result.find((r) => r.monthlyRecordId === 'mr-mar');

    assert.strictEqual(marchRow.transacciones.length, 1, '3 pagos el mismo día (14/03) se agrupan en un solo renglón');
    assert.strictEqual(marchRow.transacciones[0].monto, 250000);
    assert.strictEqual(new Date(marchRow.transacciones[0].fecha).toDateString(), MARCH_14.toDateString());
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

// ============================================================================
// PARTE 3 — "Deuda saldada" con desglose real (2026-07-14): debtService.payDebt()
// graba los conceptos de una deuda vieja como ALQUILER_DEUDA / SERVICIOS_DEUDA
// (no ALQUILER/SERVICIOS, que son los tipos del mes corriente). El fixture de
// PARTE 1/2 usa 'ALQUILER' también para los pagos de ene/feb, lo cual no refleja
// la producción real. Este bloque reproduce el escenario real reportado por el
// usuario: "si pago 3 meses con deuda, Total Alquileres Cobrados debería sumar
// el alquiler de esos 3 meses" (antes daba $0 porque ALQUILER_DEUDA caía en el
// bucket 'servicios').
// ============================================================================

function makeTxRealista({ id, monthlyRecordId, periodMonth, periodYear, alquilerDeuda, serviciosDeuda, punitorios, paymentDate, recOverrides = {} }) {
  const concepts = [];
  if (alquilerDeuda > 0) concepts.push({ type: 'ALQUILER_DEUDA', description: 'Pago deuda alquiler', amount: alquilerDeuda });
  if (serviciosDeuda > 0) concepts.push({ type: 'SERVICIOS_DEUDA', description: 'Pago deuda servicios', amount: serviciosDeuda });
  if (punitorios > 0) concepts.push({ type: 'PUNITORIOS', description: 'Punitorios por mora', amount: punitorios });
  const amount = alquilerDeuda + serviciosDeuda + punitorios;
  return {
    id, groupId: GROUP, monthlyRecordId, paymentDate, amount,
    punitoryAmount: punitorios, punitoryForgiven: false,
    concepts,
    // Incluye `id` porque el código real ahora selecciona monthlyRecord.id para
    // resolver el status del Debt asociado (flag "saldada"). monthNumber/rentAmount/
    // services/includeIva/ivaAmount: para reconstruir etiquetas ricas en "Deudas
    // Pagadas" (buildConceptosDeudaPagada) — sin servicios en el fixture, así que
    // el desglose de servicios cae al fallback genérico "Pago deuda servicios".
    // `rentAmount` por defecto = alquilerDeuda de ESTE pago (caso de un solo pago que
    // cubre todo); `recOverrides.rentAmount` permite fijar el alquiler ORIGINAL real
    // cuando la deuda se paga en VARIOS pagos parciales (cada uno cubre una porción).
    monthlyRecord: {
      id: monthlyRecordId, groupId: GROUP, periodMonth, periodYear, contractId: CONTRACT_ID, contract: CONTRACT_OBJ,
      monthNumber: periodMonth, rentAmount: alquilerDeuda, includeIva: false, ivaAmount: 0, services: [],
      ...recOverrides,
    },
  };
}

describe('Deuda saldada — tipos reales ALQUILER_DEUDA/SERVICIOS_DEUDA de debtService.payDebt()', () => {
  test('BUG: ALQUILER_DEUDA debe contar como alquiler (no caer en "servicios")', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);

    // Enero: deuda de 100.000 alquiler + 20.000 servicios + 5.000 punitorios, saldada en marzo.
    const txJan = makeTxRealista({ id: 'tx-jan', monthlyRecordId: 'mr-jan', periodMonth: 1, periodYear: 2026, alquilerDeuda: 100000, serviciosDeuda: 20000, punitorios: 5000, paymentDate: MARCH_14 });
    const mrJan = makeMonthlyRecordRow({ id: 'mr-jan', periodMonth: 1, periodYear: 2026, rentAmount: 100000, punitoryAmount: 5000, amountPaid: 125000, totalDue: 125000, status: 'COMPLETE', isCancelled: true, tx: txJan });
    prisma.monthlyRecord._rows.push(mrJan);
    prisma.paymentTransaction._rows.push(txJan);
    prisma.debt._rows.push({ id: 'debt-jan', monthlyRecordId: 'mr-jan', status: 'PAID' });

    // Marzo: sin liquidación propia, solo cobró la deuda de enero (fila sintética "SOLO DEUDAS ANTERIORES").
    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true, honorariosPercent: 10 }, null, null);
    const row = result.find((r) => r.contractId === CONTRACT_ID);
    assert.ok(row, 'debe existir la fila sintética del contrato');
    assert.strictEqual(row.paymentStatus, 'SOLO DEUDAS ANTERIORES');

    // Antes del fix: alquiler=0, servicios=120000 (alquiler mal cayendo en servicios).
    assert.strictEqual(row.cobradoOtrosPeriodos.alquiler, 100000, 'ALQUILER_DEUDA debe contarse como alquiler');
    assert.strictEqual(row.cobradoOtrosPeriodos.servicios, 20000, 'SERVICIOS_DEUDA se mantiene como servicios (payDebt no desglosa IVA)');
    assert.strictEqual(row.cobradoOtrosPeriodos.punitorios, 5000);

    // "Total Alquileres Cobrados" (subtotalAlquileresCobrado): antes daba $0 en este caso.
    assert.strictEqual(row.subtotalAlquileresCobrado, 105000, 'alquiler(100000) + punitorios(5000) de la deuda saldada');

    // TOTAL HONORARIOS = 10% de (alquiler + punitorios cobrados, incluida la deuda).
    assert.strictEqual(row.honorariosCobrado, 10500, '10% de subtotalAlquileresCobrado (105000)');

    // Desglose línea por línea + estado de la deuda.
    const det = row.cobradoOtrosPeriodos.detalle[0];
    assert.strictEqual(det.saldada, true, 'Debt.status = PAID → deuda saldada');
    // Etiquetas ricas (2026-07-15): alquiler con mes/período, servicios sin
    // itemizar (el fixture no define servicios originales para reconciliar).
    const labels = det.conceptos.map((c) => c.label);
    assert.deepStrictEqual(labels, ['Pago deuda Alquiler Enero 2026 (Mes 1)', 'Pago deuda servicios', 'Punitorios pagados']);
    assert.strictEqual(det.conceptos[0].monto, 100000);
  });

  test('Pago parcial de deuda: Debt.status distinto de PAID → saldada = false', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);

    const txJan = makeTxRealista({ id: 'tx-jan', monthlyRecordId: 'mr-jan', periodMonth: 1, periodYear: 2026, alquilerDeuda: 50000, serviciosDeuda: 0, punitorios: 0, paymentDate: MARCH_14 });
    const mrJan = makeMonthlyRecordRow({ id: 'mr-jan', periodMonth: 1, periodYear: 2026, rentAmount: 100000, punitoryAmount: 5000, amountPaid: 50000, totalDue: 105000, status: 'PARTIAL', isCancelled: true, tx: txJan });
    prisma.monthlyRecord._rows.push(mrJan);
    prisma.paymentTransaction._rows.push(txJan);
    prisma.debt._rows.push({ id: 'debt-jan', monthlyRecordId: 'mr-jan', status: 'PARTIAL' });

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
    const row = result.find((r) => r.contractId === CONTRACT_ID);

    assert.strictEqual(row.cobradoOtrosPeriodos.detalle[0].saldada, false, 'Debt.status = PARTIAL → no saldada');
  });
});

describe('Crédito aplicado a una deuda vieja pagada en VARIOS pagos (caso C21_credit_to_debt real)', () => {
  test('el crédito se reparte en cascada servicios→alquiler→punitorios sobre el TOTAL de todos los pagos del período', async () => {
    const prisma = makeFakePrisma();
    const svc = buildReportService(prisma);

    // Deuda de Enero: alquiler original 200.000, sin servicios, punitorio final
    // acumulado 50.000 (total adeudado = 250.000). Crédito aplicado: 100.000.
    // Se paga en DOS pagos distintos, el mismo mes de reporte:
    //   Pago 1: 80.000 → tageado 100% alquiler.
    //   Pago 2: 70.000 → 20.000 alquiler + 50.000 punitorios (cubre TODO el punitorio).
    // Cash total: 100.000 alquiler + 50.000 punitorios = 150.000.
    // Al crédito (100.000) ya no le queda punitorio pendiente (cubierto por cash),
    // así que va ENTERO a alquiler: 100.000(cash) + 100.000(crédito) = 200.000.
    const recOverrides = { rentAmount: 200000, services: [] };
    const txJan1 = makeTxRealista({
      id: 'tx-jan-1', monthlyRecordId: 'mr-jan', periodMonth: 1, periodYear: 2026,
      alquilerDeuda: 80000, serviciosDeuda: 0, punitorios: 0,
      paymentDate: new Date(2026, 2, 14, 10, 0, 0), recOverrides,
    });
    const txJan2 = makeTxRealista({
      id: 'tx-jan-2', monthlyRecordId: 'mr-jan', periodMonth: 1, periodYear: 2026,
      alquilerDeuda: 20000, serviciosDeuda: 0, punitorios: 50000,
      paymentDate: new Date(2026, 2, 14, 11, 0, 0), recOverrides,
    });
    const mrJan = makeMonthlyRecordRow({
      id: 'mr-jan', periodMonth: 1, periodYear: 2026, rentAmount: 200000, punitoryAmount: 50000,
      amountPaid: 150000, totalDue: 250000, status: 'COMPLETE', isCancelled: true, tx: txJan1,
    });
    prisma.monthlyRecord._rows.push(mrJan);
    prisma.paymentTransaction._rows.push(txJan1, txJan2);
    prisma.debt._rows.push({
      id: 'debt-jan', monthlyRecordId: 'mr-jan', status: 'PAID',
      appliedCredit: 100000, accumulatedPunitory: 50000,
    });

    const result = await svc.getLiquidacionesAllContracts(GROUP, 3, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
    const row = result.find((r) => r.contractId === CONTRACT_ID);
    const det = row.cobradoOtrosPeriodos.detalle[0];

    assert.strictEqual(det.saldada, true);
    assert.strictEqual(det.alquiler, 200000, 'cash (100.000) + crédito (100.000, todo a alquiler) = 200.000');
    assert.strictEqual(det.punitorios, 50000, 'ya cubierto 100% por cash; el crédito no le agrega nada');
    assert.strictEqual(det.servicios, 0);
    assert.strictEqual(det.debtTotal, 250000, 'alquiler(200.000) + punitorios(50.000) = total real de la deuda');
    assert.strictEqual(det.sobrepago, 0, 'cash + crédito (250.000) cubren exacto, sin sobrepago');

    // También debe reflejarse en los totales agregados del contrato (usados para
    // "Total Alquileres Cobrados" y Honorarios), no solo en el detalle por período.
    assert.strictEqual(row.cobradoOtrosPeriodos.alquiler, 200000);
    assert.strictEqual(row.cobradoOtrosPeriodos.punitorios, 50000);
  });
});
