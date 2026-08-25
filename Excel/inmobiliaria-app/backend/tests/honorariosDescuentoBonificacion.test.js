'use strict';

/**
 * Regla de negocio (INVERTIDA 2026-08-17 por decisión del usuario; de 2026-07-22
 * a esa fecha era al revés): la base de honorarios se calcula sobre el ALQUILER,
 * con una única distinción entre las dos categorías de ajuste que puede tener un mes:
 *
 *   - DESCUENTO → SÍ reduce la base de honorarios (se cobra sobre lo
 *     efectivamente cobrado).
 *   - BONIFICACION → NO reduce la base de honorarios (se cobra sobre el alquiler
 *     completo, como si la bonificación no existiera). Única excepción: el
 *     descuento MANUAL cargado a mano en la UI (options.descuentosAlquiler)
 *     sigue restando siempre — es un ajuste aparte, no ligado a la categoría.
 *
 * La regla vive en UN solo lugar: las constantes CATEGORIA_QUE_RESTA_HONORARIOS /
 * CATEGORIA_QUE_NO_RESTA_HONORARIOS al tope de reportDataService.js. Para volver
 * a invertirla alcanza con darlas vuelta ahí (y actualizar estos tests).
 *
 * Bug corregido: el motor de pagos (paymentTransactionService.js) no distingue
 * DESCUENTO de BONIFICACION al armar el concepto ALQUILER de cada pago — ambas
 * categorías reducen el mismo `servicesTotal`, y por lo tanto el monto que
 * queda tageado como ALQUILER siempre viene neto de las dos combinadas. Antes
 * de este fix, `reportDataService.js` restaba el descuento OTRA VEZ (double
 * count) y nunca devolvía la bonificación — el resultado era peor que si no
 * hiciera ningún ajuste.
 *
 * Caso real reportado por el usuario ("Godoy"): alquiler $680.000, un servicio
 * de categoría DESCUENTO de $85.833 → paga $594.167 completo. Con la regla
 * invertida los honorarios ahora se calculan sobre los $594.167 efectivamente
 * cobrados, no sobre los $680.000 (test 1).
 *
 * Estos son pure-function tests (sin DB), mismo patrón que reportTotals.test.js.
 * Run: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLiquidacionFromRecord,
  computeGrandTotals,
} = require('../src/services/reportDataService');

const EMPRESA = {
  nombre: 'Test Inmobiliaria',
  subtitulo: '', direccion: '', ciudad: '', telefono: '', email: '', cuit: '',
  currency: 'ARS', banco: {},
};

const MONTH = 7;
const YEAR = 2026;

/** Mismo fixture helper que tests/reportTotals.test.js. */
const makeRecord = (overrides = {}, contractOverrides = {}) => ({
  id: 'mr-1',
  monthNumber: 5,
  rentAmount: 100000,
  punitoryAmount: 0,
  punitoryDays: 0,
  punitoryForgiven: false,
  includeIva: false,
  ivaAmount: 0,
  previousBalance: 0,
  amountPaid: 0,
  balance: -100000,
  status: 'PENDING',
  isPaid: false,
  isCancelled: false,
  fullPaymentDate: null,
  services: [],
  transactions: [],
  contract: {
    id: 'c-1',
    contractType: 'INQUILINO',
    tenant: null,
    contractTenants: [
      { isPrimary: true, tenant: { name: 'Juan Pérez', dni: '12345678', email: 'j@test.com', phone: null } },
    ],
    property: {
      address: 'Av. Test 123', floor: null, apartment: null,
      owner: { name: 'María García', dni: '20123456', email: null, phone: null, transferBeneficiary: null },
      transferBeneficiary: null,
    },
    rentHistory: [],
    ...contractOverrides,
  },
  ...overrides,
});

/** Servicio DESCUENTO o BONIFICACION del mes (MonthlyService). */
const makeAjusteService = (category, amount, id = `svc-${category.toLowerCase()}`) => ({
  id, amount, conceptType: { category, label: category === 'DESCUENTO' ? 'Descuento' : 'Bonificación', name: category },
});

/** Transacción con un único concepto ALQUILER (lo que graba el motor de pagos real). */
const makeAlquilerTx = (amount, extraConcepts = []) => ({
  paymentDate: new Date(YEAR, MONTH - 1, 10, 12, 0, 0),
  amount: amount + extraConcepts.reduce((s, c) => s + c.amount, 0),
  punitoryForgiven: false,
  concepts: [{ type: 'ALQUILER', amount }, ...extraConcepts],
});

describe('Honorarios: DESCUENTO resta la base, BONIFICACION no (regla 2026-08-17)', () => {

  test('1. DESCUENTO puro, pago completo (caso real Godoy): base = alquiler NETO cobrado', async () => {
    const record = makeRecord({
      rentAmount: 680000,
      services: [makeAjusteService('DESCUENTO', 85833)],
      amountPaid: 594167, // 680000 - 85833, lo que efectivamente debe y paga el inquilino
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(594167)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'PAGADO');
    assert.strictEqual(result.subtotalAlquileresCobrado, 594167, 'DESCUENTO sí debe restar: base = alquiler neto');
    assert.strictEqual(result.honorariosCobrado, 59416.7, '10% de 594167');
  });

  test('2. BONIFICACION pura, pago completo: base = alquiler BRUTO (bonificación no resta)', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)],
      amountPaid: 90000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(90000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 100000, 'BONIFICACION no debe restar: base = alquiler completo');
    assert.strictEqual(result.honorariosCobrado, 10000, '10% de 100000');
  });

  test('3. Mixto (DESCUENTO + BONIFICACION), pago completo: solo el descuento reduce la base', async () => {
    const record = makeRecord({
      rentAmount: 680000,
      services: [
        makeAjusteService('DESCUENTO', 20000),
        makeAjusteService('BONIFICACION', 85833),
      ],
      amountPaid: 574167, // 680000 - 20000 - 85833
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(574167)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 660000, '680000 - 20000 (bonificación ignorada)');
  });

  test('4. Sin descuentos ni bonificaciones (regresión): base = alquiler completo, sin cambios', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 100000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(100000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 100000);
    assert.strictEqual(result.honorariosCobrado, 10000);
  });

  test('5. Pago PARCIAL, BONIFICACION pura: el gross-up escala proporcionalmente (no de golpe)', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)], // neto debido = 90000
      amountPaid: 45000, // 50% del neto
      balance: -45000,
      status: 'PARTIAL',
      isPaid: false,
      isCancelled: false,
      transactions: [makeAlquilerTx(45000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'PAGO PARCIAL');
    // 45000 pagado = 50% del neto (90000) → 50% del alquiler bruto (100000) = 50000
    assert.strictEqual(result.subtotalAlquileresCobrado, 50000, 'bonificación pura: gross-up proporcional al % pagado');
  });

  test('6. Pago PARCIAL, DESCUENTO puro: escala linealmente con el efectivo (ratio=1)', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('DESCUENTO', 10000)], // neto debido = 90000
      amountPaid: 45000, // 50% del neto
      balance: -45000,
      status: 'PARTIAL',
      isPaid: false,
      isCancelled: false,
      transactions: [makeAlquilerTx(45000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 45000, 'descuento puro: 1:1 con el efectivo cobrado');
  });

  test('7. NO COBRADO (amountPaid=0) con bonificación: honorariosCobrado=0 pase lo que pase', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)],
      amountPaid: 0,
      balance: -90000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: false,
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'NO COBRADO');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0);
    assert.strictEqual(result.honorariosCobrado, 0, 'no se cobran honorarios si no se cobró nada');
    assert.ok(result.honorarios !== null, 'honorarios object sigue presente para mostrar el % en preview');
  });

  test('8. Descuento MANUAL (UI) + BONIFICACION combinados: el manual sigue restando aparte', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      services: [makeAjusteService('BONIFICACION', 10000)], // neto debido = 90000
      amountPaid: 90000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(90000)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {
      honorariosPercent: 10,
      descuentosAlquiler: 5000, // manual, siempre resta
      holidays: [],
    });

    // subtotalAlquileresCobrado (display) NO se toca por el manual — la bonificación
    // no resta, así que queda en el alquiler bruto (100000).
    assert.strictEqual(result.subtotalAlquileresCobrado, 100000);
    // pero la BASE de honorarios sí resta el manual: 100000 - 5000 = 95000
    assert.strictEqual(result.honorarios.baseHonorarios, 95000);
    assert.strictEqual(result.honorariosCobrado, 9500, '10% de 95000');
  });

  test('9. Edge case: BONIFICACION cubre exactamente todo el alquiler (netRentDueReal=0) — sin NaN/negativos', async () => {
    const record = makeRecord({
      rentAmount: 50000,
      services: [makeAjusteService('BONIFICACION', 50000)], // neto debido = 0
      amountPaid: 0,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [], // nada que cobrar en efectivo, la bonificación cubre todo
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.ok(Number.isFinite(result.subtotalAlquileresCobrado), 'no debe dar NaN/Infinity');
    assert.ok(result.subtotalAlquileresCobrado >= 0, 'no debe dar negativo');
    assert.strictEqual(result.subtotalAlquileresCobrado, 0, 'bonificación total → base de alquiler queda en 0');
  });

  test('10. Rama fallback (sin TransactionConcept reales, legacy/test): mismo resultado que la rama real', async () => {
    // Idéntico a test 1 (Godoy) pero SIN transactions — ejercita la rama fallback.
    const record = makeRecord({
      rentAmount: 680000,
      services: [makeAjusteService('DESCUENTO', 85833)],
      amountPaid: 594167,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      // sin transactions → sawConcepts=false → rama fallback
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.subtotalAlquileresCobrado, 594167, 'rama fallback debe dar el mismo resultado que la rama real (test 1)');
    assert.strictEqual(result.honorariosCobrado, 59416.7);
  });

  /**
   * Fixture EXACTO de producción — Godoy Fernando Alberto, Los Pinos 4031 Torre 2 1B,
   * agosto 2026 (contrato 5025cf6b-2604-4d02-9196-6ec13f69645c). Los tests 1-11 usan
   * un único concepto ALQUILER limpio; este mes real mezcla un ajuste negativo con
   * impuestos positivos y DOS transacciones, que es donde el gross-up se puede romper
   * sin que nadie lo note.
   *
   * Datos verificados contra la DB de prod el 2026-08-25:
   *   rent_amount 680.000 · Cocina cuota 2 de 3 123.333 · Municipal 8.740 · DGR 28.757
   *   services_total -85.836 · total_due 594.164 · amount_paid 594.164 · COMPLETE
   *   transaction_concepts: ALQUILER 556.667 + ALQUILER 37.497  (sí, los impuestos
   *   también salen etiquetados ALQUILER — ver el test 14).
   */
  const makeGodoyAgosto = (categoriaAjuste) => makeRecord({
    monthNumber: 3,
    rentAmount: 680000,
    services: [
      makeAjusteService(categoriaAjuste, 123333, 'svc-cocina'),
      { id: 'svc-muni', amount: 8740, conceptType: { category: 'IMPUESTO', label: 'Impuesto Municipal', name: 'MUNICIPALIDAD' } },
      { id: 'svc-dgr', amount: 28757, conceptType: { category: 'IMPUESTO', label: 'Impuesto Provincial DGR', name: 'RENTA' } },
    ],
    amountPaid: 594164,
    balance: 0,
    status: 'COMPLETE',
    isPaid: true,
    isCancelled: true,
    transactions: [makeAlquilerTx(556667), makeAlquilerTx(37497)],
  });

  test('12. Caso real Godoy agosto 2026 con DESCUENTO: base = 680.000 - 123.333', async () => {
    const result = await buildLiquidacionFromRecord(makeGodoyAgosto('DESCUENTO'), EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'PAGADO');
    assert.strictEqual(result.subtotalAlquileresCobrado, 556667, 'DESCUENTO resta: el tope neto (556.667) capa al paidAlquiler crudo (594.164)');
    assert.strictEqual(result.honorariosCobrado, 55666.7, '10% de 556.667');
  });

  test('13. Caso real Godoy agosto 2026 con BONIFICACION: base = alquiler completo (680.000)', async () => {
    const result = await buildLiquidacionFromRecord(makeGodoyAgosto('BONIFICACION'), EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.strictEqual(result.paymentStatus, 'PAGADO');
    assert.strictEqual(result.subtotalAlquileresCobrado, 680000, 'BONIFICACION no resta: gross-up hasta el alquiler completo');
    assert.strictEqual(result.honorariosCobrado, 68000, '10% de 680.000');
  });

  test('14. Los mismos datos con las dos categorías NO pueden dar el mismo número', async () => {
    // Regresión del reporte del usuario (2026-08-25): "tanto con descuento como con
    // bonificación me lo descuenta". Contra estos mismos datos el backend siempre
    // diferenció; lo que no se refrescaba era el reporte en pantalla (ver la
    // invalidación de ['report'] en frontend/src/main.jsx). Este test deja clavada
    // la diferencia acá, del lado del cálculo, para poder descartarlo de una.
    const conDescuento = await buildLiquidacionFromRecord(makeGodoyAgosto('DESCUENTO'), EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });
    const conBonificacion = await buildLiquidacionFromRecord(makeGodoyAgosto('BONIFICACION'), EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });

    assert.notStrictEqual(conDescuento.subtotalAlquileresCobrado, conBonificacion.subtotalAlquileresCobrado);
    assert.strictEqual(
      conBonificacion.subtotalAlquileresCobrado - conDescuento.subtotalAlquileresCobrado,
      123333,
      'la diferencia entre ambas categorías es exactamente el monto del ajuste'
    );

    // CARACTERIZACIÓN de un bug conocido y NO arreglado (decisión del usuario,
    // 2026-08-25): cuando el ajuste negativo supera a los servicios reales,
    // record.servicesTotal queda negativo y paymentTransactionService clampea
    // remainingServicesOwed a 0 → los $37.497 de impuestos nunca reciben su propio
    // TransactionConcept y viajan dentro de ALQUILER. Por eso "Servicios cobrados"
    // muestra $0 aunque el propietario sí los cobró.
    // Si algún día se arregla la imputación, este assert va a fallar: es la señal
    // para revisar también la base de honorarios en meses con PAGO PARCIAL, donde
    // hoy se cobra de más (300.000 en vez de 262.503 sobre este mismo mes).
    assert.strictEqual(conDescuento.paidServicios, 0, 'bug conocido: los impuestos vienen etiquetados como ALQUILER');
    assert.strictEqual(conDescuento.paidAlquiler, 594164, 'paidAlquiler incluye los $37.497 de impuestos');
  });

  test('11. computeGrandTotals: grandAlquilerCobrado y grandSubtotalAlquileres coinciden (unificación de totales)', async () => {
    // Fixture con BONIFICACION (la categoría que NO resta) para que el gross-up sea
    // visible: paidAlquiler crudo = 594167, pero ambos totales deben dar 680000.
    const record = makeRecord({
      rentAmount: 680000,
      services: [makeAjusteService('BONIFICACION', 85833)],
      amountPaid: 594167,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [makeAlquilerTx(594167)],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { honorariosPercent: 10, holidays: [] });
    const grand = computeGrandTotals([result]);

    // Sin punitorios en este fixture, ambos totales deben coincidir exactamente.
    assert.strictEqual(grand.grandSubtotalAlquileres, 680000);
    assert.strictEqual(grand.grandAlquilerCobrado, 680000, 'con paidAlquiler crudo hubiera dado 594167');
    assert.strictEqual(grand.grandSubtotalAlquileres, grand.grandAlquilerCobrado, 'los dos totales de "alquiler cobrado" deben coincidir');
  });

});
