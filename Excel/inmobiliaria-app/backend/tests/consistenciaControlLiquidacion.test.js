'use strict';

/**
 * Auditoría 2026-07: consistencia Control Mensual ↔ Reportes de Liquidación.
 * Ver AUDITORIA_CONTROL_LIQUIDACION_2026-07.md para el detalle de cada hallazgo.
 *
 * Pure-function tests — no database. Compara, para el MISMO MonthlyRecord:
 *   - "Control Mensual" = computeLiveRecordPunitory + liveTotalDue
 *     (misma fórmula que monthlyRecordService.js:911-925)
 *   - "Liquidación"      = buildLiquidacionFromRecord (reportDataService.js)
 *
 * Run with: cd inmobiliaria-app/backend && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildLiquidacionFromRecord } = require('../src/services/reportDataService');
const { computeLiveRecordPunitory } = require('../src/utils/punitory');

const EMPRESA = {
  nombre: 'Test Inmobiliaria', subtitulo: '', direccion: '', ciudad: '',
  telefono: '', email: '', cuit: '', currency: 'ARS', banco: {},
};

const CONTRACT = {
  id: 'c-1',
  contractType: 'INQUILINO',
  tenant: null,
  contractTenants: [{ isPrimary: true, tenant: { name: 'Juan Pérez', dni: '1', email: null, phone: null } }],
  property: {
    address: 'Av. Test 123', floor: null, apartment: null,
    owner: { name: 'María García', dni: '2', email: null, phone: null, transferBeneficiary: null },
    transferBeneficiary: null,
  },
  rentHistory: [],
  debts: [],
  punitoryStartDay: 4,
  punitoryGraceDay: 10,
  punitoryPercent: 0.006, // 0.6% diario
};

// Mirrors monthlyRecordService.js:911-925 ("Control Mensual" side of a record)
const computeControlMensualTotal = (record, contract, { isFullyPaid, calculationDate }) => {
  const livePunResult = computeLiveRecordPunitory(record, contract, [], { isFullyPaid, calculationDate });
  const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;
  const liveTotalDue = Math.max(
    record.rentAmount + record.servicesTotal + livePunResult.amount + ivaAmount - record.previousBalance,
    0
  );
  return { livePunitoryAmount: livePunResult.amount, liveTotalDue };
};

const makeRecord = (overrides = {}) => ({
  id: 'mr-1',
  monthNumber: 1,
  periodMonth: 1,
  periodYear: 2026,
  rentAmount: 100000,
  servicesTotal: 0,
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
  isPostExpiry: false,
  fullPaymentDate: null,
  services: [],
  transactions: [],
  contract: CONTRACT,
  ...overrides,
});

describe('Control Mensual vs Liquidación — mes COMPLETE (deben coincidir)', () => {
  test('punitorio congelado (Liquidación) == punitorio vivo fully-paid (Control Mensual)', async () => {
    const record = makeRecord({
      amountPaid: 102000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      punitoryAmount: 2000, // congelado, persistido por _recalculateCore (= lastTx.punitoryAmount)
      punitoryDays: 5,
      transactions: [{
        paymentDate: new Date(2026, 1, 14, 12, 0, 0),
        amount: 102000,
        punitoryAmount: 2000,
        punitoryForgiven: false,
        concepts: [
          { type: 'ALQUILER', amount: 100000 },
          { type: 'PUNITORIOS', amount: 2000 },
        ],
      }],
    });

    const controlMensual = computeControlMensualTotal(record, CONTRACT, {
      isFullyPaid: true,
      calculationDate: '2026-04-14',
    });
    const liquidacion = await buildLiquidacionFromRecord(record, EMPRESA, 1, 2026, { holidays: [] });

    assert.strictEqual(
      controlMensual.livePunitoryAmount,
      liquidacion.punitoryAmount,
      'mes saldado: punitorio vivo (fully-paid) == punitorio congelado que muestra la Liquidación'
    );
    assert.strictEqual(
      controlMensual.liveTotalDue,
      liquidacion.total,
      'mes saldado: liveTotalDue (Control Mensual) == total (Liquidación)'
    );
  });

  test('mes saldado con punitorios condonados: ambos módulos muestran 0', async () => {
    const record = makeRecord({
      amountPaid: 100000,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      punitoryAmount: 3000,
      punitoryForgiven: true,
      transactions: [{
        paymentDate: new Date(2026, 1, 14, 12, 0, 0),
        amount: 100000,
        punitoryAmount: 0,
        punitoryForgiven: true,
        concepts: [{ type: 'ALQUILER', amount: 100000 }],
      }],
    });

    const controlMensual = computeControlMensualTotal(record, CONTRACT, {
      isFullyPaid: true,
      calculationDate: '2026-04-14',
    });
    const liquidacion = await buildLiquidacionFromRecord(record, EMPRESA, 1, 2026, { holidays: [] });

    assert.strictEqual(controlMensual.livePunitoryAmount, 0);
    assert.strictEqual(liquidacion.punitoryAmount, 0);
  });
});

describe('Control Mensual vs Liquidación — mes ABIERTO en mora (deben coincidir)', () => {
  test('punitorio vivo (Control Mensual) == punitorio vivo (Liquidación), misma fecha de cálculo', async () => {
    // Enero sin ningún pago; el punitorio congelado (snapshot) quedó en 3000, pero
    // pasaron meses y el punitorio en vivo siguió corriendo. Confirmado con el usuario
    // 2026-07-15: Liquidación ya NO debe mostrar el valor congelado — debe calcular
    // en vivo igual que Control Mensual (mismo motor, misma fecha de cálculo), porque
    // esos punitorios en vivo pasan a contar para el total y el estado de pago del mes.
    const record = makeRecord({
      periodMonth: 1,
      periodYear: 2026,
      punitoryAmount: 3000, // congelado (snapshot viejo, ya no se usa para mostrar)
      amountPaid: 0,
      transactions: [],
    });

    const calculationDate = '2026-04-14'; // ~3 meses después del período
    const controlMensual = computeControlMensualTotal(record, CONTRACT, {
      isFullyPaid: false,
      calculationDate,
    });
    const liquidacion = await buildLiquidacionFromRecord(record, EMPRESA, 1, 2026, { holidays: [], calculationDate });

    assert.ok(
      liquidacion.punitoryAmount > record.punitoryAmount,
      `el punitorio en vivo (${liquidacion.punitoryAmount}) debe superar al congelado viejo (${record.punitoryAmount})`
    );
    assert.strictEqual(
      controlMensual.livePunitoryAmount,
      liquidacion.punitoryAmount,
      'Control Mensual y Liquidación deben mostrar el mismo punitorio en vivo'
    );
    assert.strictEqual(
      controlMensual.liveTotalDue,
      liquidacion.total,
      'Control Mensual y Liquidación deben mostrar el mismo total en vivo'
    );
  });
});

describe('Redondeo — sin diferencias de centavos', () => {
  test('total de Liquidación == suma exacta de sus conceptos (rentAmount con IVA fraccionario)', async () => {
    const record = makeRecord({
      rentAmount: 133333, // genera IVA con decimales: 133333*0.21 = 27999.93
      includeIva: true,
      ivaAmount: Math.round(133333 * 0.21 * 100) / 100,
      amountPaid: 0,
      balance: -(133333 + 27999.93),
    });

    const liquidacion = await buildLiquidacionFromRecord(record, EMPRESA, 1, 2026, { holidays: [] });
    const sumaConceptos = liquidacion.conceptos.reduce((s, c) => s + c.importe, 0);

    // La comparacion es A CENTAVOS, no contra la suma CRUDA. Los tres importes de este
    // fixture ya son exactos al centavo (133.333 + 27.999,93 + 191.999,52) y aun asi su
    // suma flotante da 353.332,44999999995: es aritmetica IEEE754, no un error de calculo.
    // `total` tiene que venir redondeado (es lo que se muestra y lo que suman los totales
    // generales del reporte), asi que exigir `total === sumaCruda` era insatisfacible.
    // El bug real que este test destapaba estaba del otro lado y quedo arreglado:
    // `buildLiquidacionFromRecord` no aplicaba round2 al total.
    const aCentavos = (n) => Math.round(n * 100) / 100;
    assert.strictEqual(liquidacion.total, aCentavos(sumaConceptos), 'total debe ser la suma de conceptos, al centavo');
    // Y `total` ya tiene que venir redondeado, sin arrastre de error flotante
    assert.strictEqual(aCentavos(liquidacion.total), liquidacion.total);
  });

  test('honorariosCobrado redondeado a 2 decimales, sin arrastre de flotantes', async () => {
    const record = makeRecord({
      rentAmount: 123457,
      amountPaid: 123457,
      balance: 0,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
    });

    const liquidacion = await buildLiquidacionFromRecord(record, EMPRESA, 1, 2026, { honorariosPercent: 8.5, holidays: [] });
    const rounded = Math.round(liquidacion.honorariosCobrado * 100) / 100;

    assert.strictEqual(liquidacion.honorariosCobrado, rounded, 'honorariosCobrado no debe tener error de flotante');
  });
});
