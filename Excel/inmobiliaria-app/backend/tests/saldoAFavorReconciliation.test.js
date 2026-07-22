'use strict';

/**
 * Caso real: Cazaux Pedro (Rondeau 551 Torre II, 2026-07-22). Un servicio de
 * descuento/bonificación (~$310.992) estaba cargado en el mes al momento de
 * registrar un pago; el motor de pagos (paymentTransactionService.js) usó ese
 * servicesTotal para calcular la cascada servicios→alquiler y dejó un
 * TransactionConcept SOBREPAGO "fantasma" en la transacción. Días después el
 * servicio se corrigió/borró (el inquilino solo debía alquiler), y el total
 * del mes (`monthlyRecord.balance`) se recalculó bien ($39 real), pero el
 * concepto ya registrado quedó congelado con el reparto viejo — Liquidación
 * seguía mostrando "Saldo a Favor: $311.031" mientras Control Mensual (que
 * lee `record.balance` directo) mostraba correctamente $39.
 *
 * Fix: `buildLiquidacionFromRecord` reconcilia saldoAFavor (derivado de sumar
 * los conceptos SOBREPAGO reales) contra `monthlyRecord.balance` (fuente
 * autoritativa, la misma que usa Control Mensual). Cualquier diferencia se
 * devuelve/resta de paidAlquiler — el único balde que este tipo de bug
 * corrompe (nunca servicios/punitorios).
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

const MONTH = 7;
const YEAR = 2026;

const makeRecord = (overrides = {}) => ({
  id: 'mr-1',
  monthNumber: 10,
  rentAmount: 977344,
  punitoryAmount: 0,
  punitoryDays: 0,
  punitoryForgiven: false,
  includeIva: false,
  ivaAmount: 0,
  previousBalance: 0,
  amountPaid: 0,
  balance: 0,
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
      { isPrimary: true, tenant: { name: 'Cazaux Pedro', dni: '46320455', email: null, phone: null } },
    ],
    property: {
      address: 'Rondeau 551 Torre II', floor: null, apartment: null,
      owner: { name: 'Propietario Test', dni: '', email: null, phone: null, transferBeneficiary: null },
      transferBeneficiary: null,
    },
    rentHistory: [],
  },
  ...overrides,
});

describe('Reconciliación saldoAFavor vs monthlyRecord.balance (caso real Cazaux Pedro)', () => {

  test('1. SOBREPAGO fantasma (concepto corrupto) se recorta al balance real; el excedente vuelve a paidAlquiler', async () => {
    // Reproduce el caso real (escala real): rentAmount=977344, previousBalance=39
    // (crédito real del mes anterior, ya consumido explícitamente vía A_FAVOR).
    // La transacción 2 quedó con un reparto viejo (ALQUILER=588126, SOBREPAGO=311031)
    // de un momento en que había un servicio de descuento ya borrado — balance real = 39.
    const record = makeRecord({
      previousBalance: 39,
      amountPaid: 977344,
      totalDue: 977305,
      balance: 39, // fuente autoritativa: solo $39 de verdadero saldo a favor
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [
        {
          paymentDate: new Date(2026, 6, 11, 12, 0, 0),
          amount: 78187,
          punitoryForgiven: false,
          concepts: [
            { type: 'A_FAVOR', amount: -39 },
            { type: 'ALQUILER', amount: 78187 },
          ],
        },
        {
          paymentDate: new Date(2026, 6, 11, 12, 0, 0),
          amount: 899157,
          punitoryForgiven: false,
          concepts: [
            { type: 'A_FAVOR', amount: -39 },
            { type: 'ALQUILER', amount: 588126 }, // reparto congelado, corrupto
            { type: 'SOBREPAGO', amount: 311031 }, // fantasma
          ],
        },
      ],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { holidays: [] });

    assert.strictEqual(result.saldoAFavor, 39, 'saldoAFavor debe coincidir con record.balance (fuente autoritativa), no con el SOBREPAGO fantasma');
    assert.strictEqual(result.paidAlquiler, 977344, 'el excedente fantasma (310992) se devuelve a paidAlquiler: 666352 + 310992 = 977344 = rentAmount completo');
    assert.strictEqual(result.paymentStatus, 'SALDO A FAVOR');
  });

  test('2. Sin mismatch (saldoAFavor real coincide con balance): no se toca nada (regresión)', async () => {
    // Sobrepago LEGÍTIMO: pagó 100 de más y balance también dice 100. No debe alterarse.
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 100100,
      balance: 100,
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [{
        paymentDate: new Date(2026, 6, 10, 12, 0, 0),
        amount: 100100,
        punitoryForgiven: false,
        concepts: [
          { type: 'ALQUILER', amount: 100000 },
          { type: 'SOBREPAGO', amount: 100 },
        ],
      }],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { holidays: [] });

    assert.strictEqual(result.saldoAFavor, 100, 'saldoAFavor legítimo, sin cambios');
    assert.strictEqual(result.paidAlquiler, 100000, 'paidAlquiler legítimo, sin cambios');
  });

  test('3. Caso simétrico: saldoAFavor derivado de conceptos es MENOR al balance real → se resta de paidAlquiler', async () => {
    // Escenario sintético: balance real dice 5000 de saldo a favor, pero los
    // conceptos (por algún desfasaje histórico similar) solo muestran 1000 de
    // SOBREPAGO. La reconciliación debe subir saldoAFavor a 5000 y bajar
    // paidAlquiler en la diferencia (4000).
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 105000,
      balance: 5000, // fuente autoritativa: 5000 de verdad
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [{
        paymentDate: new Date(2026, 6, 10, 12, 0, 0),
        amount: 105000,
        punitoryForgiven: false,
        concepts: [
          { type: 'ALQUILER', amount: 104000 },
          { type: 'SOBREPAGO', amount: 1000 }, // subestimado respecto al balance real
        ],
      }],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { holidays: [] });

    assert.strictEqual(result.saldoAFavor, 5000, 'saldoAFavor se ajusta hacia arriba para coincidir con balance');
    assert.strictEqual(result.paidAlquiler, 100000, 'paidAlquiler se ajusta hacia abajo en la diferencia (104000 - 4000)');
  });

  test('4. Mes sin pagos (NO COBRADO): sin transacciones, sin mismatch, todo en 0', async () => {
    const record = makeRecord({
      rentAmount: 100000,
      amountPaid: 0,
      balance: -100000,
      status: 'PENDING',
      isPaid: false,
      isCancelled: false,
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { holidays: [] });

    assert.strictEqual(result.saldoAFavor, 0);
    assert.strictEqual(result.paymentStatus, 'NO COBRADO');
  });

  test('5. Caso real Mayo 2026 (mismo contrato, mismo bug a menor escala): dos SOBREPAGO sueltos ($9.995 + $10.000) se reconcilian al balance real ($10.000)', async () => {
    const record = makeRecord({
      monthNumber: 8,
      rentAmount: 913064,
      services: [{ id: 's1', amount: 125848, conceptType: { category: 'BONIFICACION', label: 'Bonificación', name: 'BONIFICACION' } }],
      previousBalance: 0,
      amountPaid: 797216,
      totalDue: 787216,
      balance: 10000, // fuente autoritativa real (confirmado contra prod)
      status: 'COMPLETE',
      isPaid: true,
      isCancelled: true,
      transactions: [
        {
          paymentDate: new Date(2026, 4, 11, 12, 0, 0),
          amount: 164161,
          punitoryForgiven: false,
          concepts: [
            { type: 'ALQUILER', amount: 154166 },
            { type: 'SOBREPAGO', amount: 9995 },
          ],
        },
        {
          paymentDate: new Date(2026, 4, 11, 12, 0, 0),
          amount: 70055,
          punitoryForgiven: false,
          concepts: [
            { type: 'ALQUILER', amount: 60055 },
            { type: 'SOBREPAGO', amount: 10000 },
          ],
        },
      ],
    });

    const result = await buildLiquidacionFromRecord(record, EMPRESA, MONTH, YEAR, { holidays: [] });

    assert.strictEqual(result.saldoAFavor, 10000, 'reconciliado al balance real, no a la suma de los dos SOBREPAGO sueltos (19995)');
  });

});
