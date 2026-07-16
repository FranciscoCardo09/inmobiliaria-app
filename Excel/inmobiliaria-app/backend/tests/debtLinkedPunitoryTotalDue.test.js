const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// Regresión (2026-07-13, caso real: Ponce Emilia Roxana / Los Pinos 4171 PB D,
// Mayo 2026): un pago de deuda PARCIAL que alcanza para cubrir alquiler+servicios
// pero deja punitorios sin pagar generaba un saldo a favor FALSO en el
// MonthlyRecord (Control Mensual), por el monto exacto de los punitorios
// realmente pagados/adeudados — mientras la Deuda seguía (correctamente)
// reclamando el resto. Ver memoria `punitory-totaldue-concept-rule`: el mismo
// bug de fondo (el punitorio no entra en `totalDue` cuando debería), pero en
// DOS caminos que ese fix anterior no cubría:
//   (1) `_recalculateCore`: nunca puede marcar COMPLETE un mes con Deuda
//       abierta, así que la rama que usa `sumPunitoryConcepts` no se dispara.
//   (2) `getOrCreateMonthlyRecords` (corre en CADA GET a Control Mensual):
//       tiene su PROPIA copia del mismo cálculo (refresh persistido) Y su
//       propia lógica de enriquecimiento para display (`totalHistorico`,
//       `aFavorNextMonth`, `debeNextMonth`) — ambas independientes de (1) y
//       con el mismo bug (o uno relacionado: usar `newPunitoryAmount` en vez
//       de `amount`/`liveAccumulatedPunitory` en la rama "base agotada" de
//       `calculateDebtPunitory`, donde esos dos valores difieren).
// ============================================================================

test('getOrCreateMonthlyRecords: mes con Deuda PARTIAL no genera saldo a favor falso (refresh + display)', async (t) => {
  const prisma = makeFakePrisma();

  const monthlyRecordService = proxyquire('../src/services/monthlyRecordService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './debtService': {
      // Reproduce exactamente lo que devuelve `calculateDebtPunitory` real en la
      // rama "base agotada" (remainingBase<=0) cuando el pago cubrió alquiler+
      // servicios pero quedan $90.390,30 de punitorios sin pagar de un total
      // acumulado de $304.800,67 (caso real Ponce Emilia Roxana, Mayo 2026):
      // `amount` es el NETO impago, `newPunitoryAmount` es solo el incremento
      // desde el último pago (0, cero días transcurridos) y `unpaidAccumulatedPunitory`
      // queda hardcodeado en 0 en esa rama.
      calculateDebtPunitory: async () => ({
        amount: 90390.3, days: 0, newPunitoryAmount: 0,
        accumulatedPunitory: 304800.67, unpaidAccumulatedPunitory: 0,
        grossPunitoryToDate: 304800.67,
        remainingDebt: 0, remainingServices: 0, remainingRent: 0,
        startDate: null, endDate: null,
      }),
      preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }),
    },
    './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
  });

  await prisma.contract.create({
    data: {
      id: 'c1', groupId: 'g1', active: true, renewedAt: null, renewedFromContractId: null,
      startDate: new Date(2026, 2, 1), startMonth: 28, durationMonths: 36,
      rescindedAt: null, baseRent: 686488, pagaIva: false, contractType: 'INQUILINO',
      punitoryStartDay: 6, punitoryGraceDay: 10, punitoryPercent: 0.006,
      adjustmentIndexId: null, adjustmentIndex: null, nextAdjustmentMonth: null,
      comprobantes: [], tenant: { id: 't1', name: 'Ponce Emilia Roxana' },
      contractTenants: [], property: { id: 'p1', address: 'Los Pinos 4171 PB D', owner: { id: 'o1', name: 'Carlos López' } },
    },
  });

  // Abril (mes anterior): saldo a favor real de $30.898,37 que se arrastra a Mayo.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-abr', groupId: 'g1', contractId: 'c1',
      periodMonth: 4, periodYear: 2026, monthNumber: 29,
      status: 'COMPLETE', rentAmount: 686488, servicesTotal: 0, includeIva: false,
      previousBalance: 22187.04, amountPaid: 1000000, totalDue: 969101.63, balance: 30898.37,
      punitoryAmount: 304800.67, punitoryDays: 0,
    },
  });

  // Mayo: pagaron $870.000 de una deuda de ~$960.390 (alquiler $686.488 + punitorios
  // $304.800,67 − crédito $30.898,37). previousBalance queda intencionalmente STALE
  // (0 en vez de 30898.37) para forzar el refresh de getOrCreateMonthlyRecords.
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-may', groupId: 'g1', contractId: 'c1',
      periodMonth: 5, periodYear: 2026, monthNumber: 30,
      status: 'PARTIAL', rentAmount: 686488, servicesTotal: 0, includeIva: false,
      previousBalance: 0, amountPaid: 870000, totalDue: 0, balance: 0,
      punitoryAmount: 214410.37, punitoryDays: 0, punitoryForgiven: false,
      balanceForgiven: 0, isPostExpiry: false,
      services: [],
      transactions: [{
        paymentDate: new Date(2026, 6, 13, 12, 0, 0), amount: 870000,
        punitoryForgiven: false, punitoryAmount: 214410.37,
        concepts: [
          { type: 'ALQUILER_DEUDA', amount: 655589.63 },
          { type: 'PUNITORIOS', amount: 214410.37 },
        ],
      }],
      debt: {
        id: 'd-may', groupId: 'g1', contractId: 'c1', monthlyRecordId: 'mr-may',
        periodLabel: 'Mayo 2026', periodMonth: 5, periodYear: 2026,
        originalAmount: 991288.67, unpaidRentAmount: 686488, unpaidServicesAmount: 0,
        previousRecordPayment: 0, appliedCredit: 30898.37, accumulatedPunitory: 304800.67,
        currentTotal: 90390.3, amountPaid: 870000, punitoryPercent: 0.006,
        punitoryStartDate: new Date(2026, 4, 1), lastPaymentDate: new Date(2026, 6, 13),
        status: 'PARTIAL', payments: [],
      },
    },
  });

  const records = await monthlyRecordService.getOrCreateMonthlyRecords('g1', 5, 2026);

  const persisted = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-may' } });
  assert.strictEqual(persisted.totalDue, 960390.3, 'totalDue persistido debe incluir el punitorio vivo de la Deuda, no $0');
  assert.strictEqual(persisted.balance, -90390.3, 'balance persistido no debe mostrar saldo a favor falso; debe reflejar la deuda real');
  assert.strictEqual(persisted.status, 'PARTIAL', 'un mes con Deuda abierta nunca pasa a COMPLETE en el refresh');

  const enriched = records.find((r) => r.id === 'mr-may');
  assert.strictEqual(enriched.totalHistorico, 960390.3, 'totalHistorico (lo que muestra la columna TOTAL) debe incluir los punitorios reales');
  assert.strictEqual(enriched.aFavorNextMonth, 0, 'aFavorNextMonth (columna "A Favor Sig.") no debe mostrar saldo a favor falso');
  assert.ok(Math.abs(enriched.debeNextMonth - 90390.3) < 0.01, `debeNextMonth debe reflejar la deuda real de punitorios pendiente (fue ${enriched.debeNextMonth})`);
});
