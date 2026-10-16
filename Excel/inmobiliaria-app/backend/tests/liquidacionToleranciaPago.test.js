'use strict';

/**
 * Caso real: Quevedo Andrés (Calera Ph1, octubre 2026). Debía $550.001 y pagó
 * $550.000 (redondeó). El motor de pagos (monthlyRecordService.js, computeTotals)
 * considera el mes COMPLETE con una tolerancia de $1 (`effBal >= -1`), así que
 * Control Mensual lo muestra pagado y el registro queda isCancelled=true.
 *
 * El Reporte de Liquidación clasificaba con tolerancia de $0,01 → "PAGO PARCIAL"
 * con $1 pendiente. Con el filtro "Solo con pago" (default de la pantalla) la fila
 * quedaba oculta: no se veía el detalle ni el bloque "Gastos a mi cargo" para
 * marcar el agua que paga el propietario, y los exports la trataban como impaga.
 *
 * Fix: la clasificación del reporte usa la MISMA tolerancia de $1 que el motor.
 *
 * Run: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildLiquidacionFromRecord } = require('../src/services/reportDataService');

const EMPRESA = {
  nombre: 'Test Inmobiliaria',
  subtitulo: '', direccion: '', ciudad: '', telefono: '', email: '', cuit: '',
  currency: 'ARS', banco: {},
};

const MONTH = 10;
const YEAR = 2026;

const SERVICES = [
  { id: 'svc-muni', amount: 4100, conceptType: { name: 'MUNICIPALIDAD', label: 'Impuesto Municipal', category: 'IMPUESTO' } },
  { id: 'svc-dgr', amount: 4800, conceptType: { name: 'RENTA', label: 'Impuesto Provincial DGR', category: 'IMPUESTO' } },
  { id: 'svc-agua', amount: 16392, conceptType: { name: 'AGUA', label: 'Aguas Cordobesas', category: 'SERVICIO' } },
];

// Registro de octubre 2026 tal cual está en producción.
const makeQuevedoRecord = ({ amountPaid, alquilerPagado }) => ({
  id: 'mr-quevedo-oct',
  monthNumber: 20,
  periodMonth: MONTH,
  periodYear: YEAR,
  rentAmount: 524709,
  servicesTotal: 25292,
  punitoryAmount: 0,
  punitoryDays: 0,
  punitoryForgiven: false,
  includeIva: false,
  ivaAmount: 0,
  previousBalance: 0,
  balanceForgiven: 0,
  totalDue: 550001,
  amountPaid,
  balance: amountPaid - 550001,
  status: amountPaid - 550001 >= -1 ? 'COMPLETE' : 'PARTIAL',
  isPaid: amountPaid - 550001 >= -1,
  isCancelled: amountPaid - 550001 >= -1,
  fullPaymentDate: null,
  services: SERVICES,
  transactions: [{
    paymentDate: new Date(2026, 9, 7, 12, 0, 0),
    amount: amountPaid,
    punitoryForgiven: false,
    concepts: [
      { type: 'MUNICIPALIDAD', amount: 4100 },
      { type: 'RENTA', amount: 4800 },
      { type: 'AGUA', amount: 16392 },
      { type: 'ALQUILER', amount: alquilerPagado },
    ],
  }],
  debt: null,
  contract: {
    id: 'c-quevedo',
    contractType: 'INQUILINO',
    tenant: null,
    contractTenants: [
      { isPrimary: true, tenant: { name: 'Quevedo Andres', dni: '', email: null, phone: null } },
    ],
    property: {
      address: 'Calera  Ph1', floor: null, apartment: null,
      owner: { name: 'Propietario Test', dni: '', email: null, phone: null, transferBeneficiary: null },
      transferBeneficiary: null,
    },
    debts: [],
    rentHistory: [],
  },
});

// Mismo criterio que la pantalla (ReportsPage.jsx, filtro "Solo con pago").
const visibleConSoloConPago = (d) =>
  d.paymentStatus === 'PAGADO' || d.paymentStatus === 'SALDO A FAVOR' || d.noData ||
  (d.cobradoOtrosPeriodos && d.cobradoOtrosPeriodos.total > 0);

describe('Liquidación: tolerancia de pago alineada con el motor ($1) — caso Quevedo', () => {

  test('1. pagó $1 menos (mes COMPLETE en Control Mensual) → PAGADO, sin pendiente, visible', async () => {
    const record = makeQuevedoRecord({ amountPaid: 550000, alquilerPagado: 524708 });
    const liq = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {});

    assert.equal(record.status, 'COMPLETE', 'precondición: el motor lo da por pagado');
    assert.equal(liq.paymentStatus, 'PAGADO');
    assert.equal(liq.pendingAmount, 0);
    assert.ok(visibleConSoloConPago(liq), 'la fila debe verse con el filtro "Solo con pago"');
  });

  test('2. el agua (Aguas Cordobesas) aparece disponible para "Gastos a mi cargo"', async () => {
    const record = makeQuevedoRecord({ amountPaid: 550000, alquilerPagado: 524708 });
    const liq = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {});

    const agua = liq.serviciosDisponibles.find((s) => s.id === 'svc-agua');
    assert.ok(agua, 'Aguas Cordobesas debe estar en serviciosDisponibles');
    assert.equal(agua.importe, 16392);
  });

  test('3. marcar el agua como gasto a mi cargo la suma a los honorarios', async () => {
    const record = makeQuevedoRecord({ amountPaid: 550000, alquilerPagado: 524708 });
    const liq = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {
      gastosAMiCargo: { serviceIds: ['svc-agua'], extras: [] },
    });

    assert.ok(liq.honorarios, 'debe haber bloque de honorarios');
    assert.equal(liq.honorarios.gastosAMiCargo.length, 1);
    assert.match(liq.honorarios.gastosAMiCargo[0].concepto, /Aguas Cordobesas/);
    assert.equal(liq.honorarios.totalGastos, 16392);
    assert.equal(liq.honorariosCobrado, 16392);
  });

  test('4. el mismo mes pagado completo sigue PAGADO (no regresión)', async () => {
    const record = makeQuevedoRecord({ amountPaid: 550001, alquilerPagado: 524709 });
    const liq = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {});
    assert.equal(liq.paymentStatus, 'PAGADO');
    assert.equal(liq.pendingAmount, 0);
  });

  test('5. un faltante real (> $1) sigue siendo PAGO PARCIAL con su pendiente', async () => {
    const record = makeQuevedoRecord({ amountPaid: 549000, alquilerPagado: 523708 });
    const liq = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {});

    assert.equal(record.status, 'PARTIAL', 'precondición: el motor tampoco lo da por pagado');
    assert.equal(liq.paymentStatus, 'PAGO PARCIAL');
    // $1.001 de alquiler + los punitorios vivos que genera el faltante real.
    assert.ok(liq.pendingAmount >= 1001, `pendiente ${liq.pendingAmount} debe ser >= 1001`);
  });

  test('6. invariante: para faltantes de $0 a $1 el reporte coincide con el status del motor', async () => {
    for (const faltante of [0, 0.01, 0.5, 0.99, 1]) {
      const amountPaid = 550001 - faltante;
      const record = makeQuevedoRecord({ amountPaid, alquilerPagado: 524709 - faltante });
      const liq = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, {});
      assert.equal(record.status, 'COMPLETE');
      assert.equal(liq.paymentStatus, 'PAGADO', `faltante $${faltante} → debería ser PAGADO`);
    }
  });
});
