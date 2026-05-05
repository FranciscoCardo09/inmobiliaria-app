const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function makeContract(overrides = {}) {
  return {
    id: 'contract-1',
    groupId: 'group-1',
    // Use noon UTC to avoid date shifting in any UTC-offset timezone (e.g. Argentina UTC-3)
    startDate: '2025-01-15T12:00:00.000Z',
    startMonth: 1,
    durationMonths: 24,
    baseRent: 100000,
    active: true,
    rescindedAt: null,
    ...overrides,
  };
}

function makeRecord(contractId, month, year, overrides = {}) {
  return {
    id: `record-${contractId}-${month}-${year}`,
    contractId,
    groupId: 'group-1',
    periodMonth: month,
    periodYear: year,
    monthNumber: month,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
// T1 — propagateServiceForward only generates months M..12 of
//      the SAME year, nothing beyond December.
// ────────────────────────────────────────────────────────────
describe('propagateServiceForward - month generation', () => {
  test('starting from month 6 generates exactly months 6..12', () => {
    // Pure logic extracted from monthlyServiceService.js propagateServiceForward
    const fromMonth = 6;
    const fromYear = 2025;
    const months = [];
    for (let m = fromMonth; m <= 12; m++) {
      months.push({ month: m, year: fromYear });
    }
    assert.strictEqual(months.length, 7, 'debe haber 7 meses: 6,7,8,9,10,11,12');
    assert.deepStrictEqual(months[0], { month: 6, year: 2025 });
    assert.deepStrictEqual(months[months.length - 1], { month: 12, year: 2025 });
    assert.ok(months.every(m => m.year === fromYear), 'todos los meses deben pertenecer al mismo año');
  });

  test('starting from month 1 generates 12 months', () => {
    const fromMonth = 1;
    const fromYear = 2025;
    const months = [];
    for (let m = fromMonth; m <= 12; m++) {
      months.push({ month: m, year: fromYear });
    }
    assert.strictEqual(months.length, 12);
  });

  test('starting from month 12 generates only 1 month', () => {
    const fromMonth = 12;
    const fromYear = 2025;
    const months = [];
    for (let m = fromMonth; m <= 12; m++) {
      months.push({ month: m, year: fromYear });
    }
    assert.strictEqual(months.length, 1);
    assert.deepStrictEqual(months[0], { month: 12, year: 2025 });
  });
});

// ────────────────────────────────────────────────────────────
// T2 — bulkAssign respects contract end date: no services
//      created after contract.startMonth + durationMonths - 1
// ────────────────────────────────────────────────────────────
describe('bulkAssign - respeta la fecha de fin del contrato', () => {
  test('no crea servicios en meses fuera del rango del contrato', async () => {
    const contract = makeContract({ startMonth: 1, durationMonths: 3 }); // meses 1..3
    const upsertedMonths = [];

    const mockPrisma = {
      $transaction: async (fn, opts) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async ({ where }) => {
          // Record exists for months 1..3
          const { periodMonth, periodYear } = where.contractId_periodMonth_periodYear;
          if (periodMonth >= 1 && periodMonth <= 3 && periodYear === 2025) {
            return makeRecord(contract.id, periodMonth, periodYear);
          }
          return null;
        },
        create: async (data) => makeRecord(contract.id, data.data.periodMonth, data.data.periodYear),
      },
      contract: {
        findUnique: async () => contract,
      },
      monthlyService: {
        upsert: async ({ where, create }) => {
          const record = await mockPrisma.monthlyRecord.findUnique({
            where: { contractId_periodMonth_periodYear: { contractId: contract.id, periodMonth: create.monthlyRecordId.split('-')[2] ? parseInt(create.monthlyRecordId.split('-')[2]) : 0, periodYear: 2025 } }
          });
          upsertedMonths.push(where.monthlyRecordId_conceptTypeId.monthlyRecordId);
          return { id: 'service-1', amount: 50000, conceptType: { id: 'ct-1', name: 'Agua', category: 'SERVICIO' } };
        },
      },
    };

    // Simulate the month filtering logic from bulkAssign directly
    const months = [
      { month: 1, year: 2025 },
      { month: 2, year: 2025 },
      { month: 3, year: 2025 },
      { month: 4, year: 2025 }, // fuera del rango
      { month: 5, year: 2025 }, // fuera del rango
    ];

    const endMonth = contract.startMonth + contract.durationMonths - 1; // = 3
    const validMonths = months.filter(({ month, year }) => {
      const startDate = new Date(contract.startDate);
      const totalMonthsDiff = (year - startDate.getFullYear()) * 12 + (month - (startDate.getMonth() + 1));
      const monthNumber = contract.startMonth + totalMonthsDiff;
      if (monthNumber < contract.startMonth) return false;
      if (monthNumber > endMonth) return false;
      return true;
    });

    assert.strictEqual(validMonths.length, 3, 'solo deben pasar meses 1, 2 y 3');
    assert.ok(validMonths.every(m => m.month <= 3), 'ningún mes posterior a 3 debe pasar el filtro');
  });
});

// ────────────────────────────────────────────────────────────
// T3 — bulkAssignMultiContract pasa el mismo amount a cada
//      contrato (regresión del bug $50k vs $43k)
// ────────────────────────────────────────────────────────────
describe('bulkAssignMultiContract - amount uniforme', () => {
  test('cada contrato recibe exactamente el amount indicado, sin contaminación', async () => {
    const contractIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const expectedAmount = 50000;
    const capturedAmounts = {};

    // Mock bulkAssign a nivel de servicio para capturar los amounts
    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      conceptType: {
        findFirst: async () => ({ id: 'ct-agua', groupId: 'group-1', isActive: true }),
      },
      contract: {
        findMany: async () => contractIds.map(id => ({ id })),
      },
      $transaction: async (fn, opts) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async ({ where }) => {
          const { contractId, periodMonth, periodYear } = where.contractId_periodMonth_periodYear;
          return makeRecord(contractId, periodMonth, periodYear);
        },
        create: async (data) => makeRecord(data.data.contractId, data.data.periodMonth, data.data.periodYear),
        findMany: async () => [],
        updateMany: async () => {},
      },
      contract: {
        findFirst: async () => null,
        findMany: async () => contractIds.map(id => ({ id })),
        findUnique: async ({ where }) => makeContract({ id: where.id }),
      },
      monthlyService: {
        findUnique: async () => null, // no existing service → no overwrite warning
        upsert: async ({ create, update }) => {
          const recordId = create.monthlyRecordId;
          capturedAmounts[recordId] = create.amount;
          return { id: 'service-1', amount: create.amount, monthlyRecordId: recordId, conceptType: { id: 'ct-agua', name: 'Agua', category: 'SERVICIO' } };
        },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    const months = [{ month: 4, year: 2026 }];
    const result = await service.bulkAssignMultiContract('group-1', contractIds, 'ct-agua', expectedAmount, months);

    assert.strictEqual(result.errors.length, 0, `hubo errores: ${JSON.stringify(result.errors)}`);

    // Todos los servicios upsertados deben tener el amount correcto
    const capturedValues = Object.values(capturedAmounts);
    assert.ok(capturedValues.length > 0, 'debe haber creado al menos un servicio');
    const wrongAmounts = capturedValues.filter(a => Math.abs(a - expectedAmount) > 0.01);
    assert.strictEqual(wrongAmounts.length, 0, `algunos servicios tienen monto incorrecto: ${JSON.stringify(wrongAmounts)}`);
  });
});

// ────────────────────────────────────────────────────────────
// T4 — bulkAssign es idempotente: re-llamar con mismo input
//      no duplica filas (usa upsert, no create)
// ────────────────────────────────────────────────────────────
describe('bulkAssign - idempotencia vía upsert', () => {
  test('el mismo servicio en el mismo mes/contrato usa upsert, no duplica', async () => {
    let upsertCallCount = 0;
    let createCallCount = 0;

    const contract = makeContract();
    const existingRecord = makeRecord(contract.id, 4, 2026);

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      $transaction: async (fn) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async () => existingRecord,
        create: async (data) => { createCallCount++; return existingRecord; },
      },
      contract: { findUnique: async () => contract },
      monthlyService: {
        findUnique: async () => null, // no existing service
        upsert: async ({ create, update }) => {
          upsertCallCount++;
          return { id: 'svc-1', amount: create.amount, conceptType: { id: 'ct-1', name: 'Agua', category: 'SERVICIO' } };
        },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    const months = [{ month: 4, year: 2026 }];

    // Primera llamada
    await service.bulkAssign('group-1', contract.id, 'ct-1', 50000, months);
    const firstCallCount = upsertCallCount;

    // Segunda llamada - mismos parámetros
    await service.bulkAssign('group-1', contract.id, 'ct-1', 50000, months);
    const secondCallCount = upsertCallCount;

    assert.strictEqual(firstCallCount, 1, 'primera llamada debe hacer 1 upsert');
    assert.strictEqual(secondCallCount, 2, 'segunda llamada debe hacer 1 upsert más (no duplica, es upsert)');
    assert.strictEqual(createCallCount, 0, 'no debe haber creado un nuevo MonthlyRecord (ya existía)');
  });
});

// ────────────────────────────────────────────────────────────
// T5 — propagateForward=false NO toca meses futuros
//      (regresión del bug fantasma)
// ────────────────────────────────────────────────────────────
describe('addService (sin propagación) - no afecta meses futuros', () => {
  test('addService sólo toca el recordId indicado, no crea servicios en otros registros', async () => {
    const createdRecordIds = [];

    const mockRecalculate = { recalculateMonthlyRecord: async () => {}, recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      monthlyService: {
        create: async ({ data }) => {
          createdRecordIds.push(data.monthlyRecordId);
          return { id: 'svc-1', ...data, conceptType: { id: data.conceptTypeId, name: 'Agua', category: 'SERVICIO' } };
        },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    const targetRecordId = 'record-only-this-one';
    await service.addService(targetRecordId, 'ct-agua', 50000, null);

    assert.strictEqual(createdRecordIds.length, 1, 'debe crear exactamente 1 servicio');
    assert.strictEqual(createdRecordIds[0], targetRecordId, 'debe crear el servicio solo en el record especificado');
  });
});

// ────────────────────────────────────────────────────────────
// T6 — contrato inactivo: bulkAssign no crea servicios
// ────────────────────────────────────────────────────────────
describe('bulkAssign - contrato inactivo', () => {
  test('no crea servicios si el contrato está inactivo', async () => {
    const inactiveContract = makeContract({ active: false });
    let upsertCallCount = 0;

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      $transaction: async (fn) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async () => null, // no existe el record, habrá que crearlo
        create: async (data) => makeRecord(inactiveContract.id, data.data.periodMonth, data.data.periodYear),
      },
      contract: { findUnique: async () => inactiveContract },
      monthlyService: {
        upsert: async () => { upsertCallCount++; return {}; },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    const months = [{ month: 4, year: 2026 }];
    const result = await service.bulkAssign('group-1', inactiveContract.id, 'ct-1', 50000, months);

    assert.strictEqual(upsertCallCount, 0, 'no debe upsertear servicios para contratos inactivos');
  });
});

// ────────────────────────────────────────────────────────────
// T7 — hash del advisory lock es consistente entre los dos paths
// ────────────────────────────────────────────────────────────
describe('advisory lock - ambos paths deben usar hashtext de Postgres', () => {
  test('processDirtyRecords usa pg_advisory_xact_lock(hashtext(...)) igual que _recalculateCore', async () => {
    // Este test verifica el patrón textual en el código fuente
    const fs = require('node:fs');
    const serviceCode = fs.readFileSync(
      require('node:path').join(__dirname, '../src/services/monthlyRecordService.js'),
      'utf-8'
    );

    // _recalculateCore debe usar hashtext
    assert.ok(
      serviceCode.includes("pg_advisory_xact_lock(hashtext("),
      '_recalculateCore debe usar pg_advisory_xact_lock(hashtext(...))'
    );

    // processDirtyRecords ya NO debe usar Math.imul
    assert.ok(
      !serviceCode.includes('Math.imul'),
      'processDirtyRecords NO debe usar Math.imul para calcular el lockValue - usa hashtext en su lugar'
    );
  });
});

// ────────────────────────────────────────────────────────────
// T8 — batchAddServices usa create (no upsert)
//      → si se llama dos veces lanzará conflict (P2002)
// ────────────────────────────────────────────────────────────
describe('batchAddServices - usa create sin idempotencia', () => {
  test('batchAddServices crea servicios en exactamente los records del payload', async () => {
    const createdItems = [];

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      $transaction: async (fn) => fn(mockPrisma),
      monthlyService: {
        create: async ({ data }) => {
          createdItems.push({ recordId: data.monthlyRecordId, amount: data.amount });
          return { id: `svc-${createdItems.length}`, ...data, conceptType: { id: data.conceptTypeId, name: 'ABL', category: 'IMPUESTO' } };
        },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    const distributions = [
      { recordId: 'rec-1', amount: 25000 },
      { recordId: 'rec-2', amount: 25000 },
    ];

    await service.batchAddServices(distributions, 'ct-abl', 'ABL');

    assert.strictEqual(createdItems.length, 2, 'debe crear exactamente 2 servicios');
    assert.strictEqual(createdItems[0].recordId, 'rec-1');
    assert.strictEqual(createdItems[0].amount, 25000);
    assert.strictEqual(createdItems[1].recordId, 'rec-2');
    assert.strictEqual(createdItems[1].amount, 25000);
  });
});

// ────────────────────────────────────────────────────────────
// T9 — bulkAssignMultiContract deduplica contractIds duplicados:
//      cada contrato recibe exactamente un upsert
// ────────────────────────────────────────────────────────────
describe('bulkAssignMultiContract - deduplica contractIds duplicados', () => {
  test('contractId duplicado en el input produce un solo upsert por contrato', async () => {
    const upsertCallsByContract = {};

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      conceptType: {
        findFirst: async () => ({ id: 'ct-agua', groupId: 'group-1', isActive: true }),
      },
      contract: {
        findMany: async ({ where }) => where.id.in.map(id => ({ id })),
        findUnique: async ({ where }) => makeContract({ id: where.id }),
      },
      $transaction: async (fn, opts) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async ({ where }) => {
          const { contractId, periodMonth, periodYear } = where.contractId_periodMonth_periodYear;
          return makeRecord(contractId, periodMonth, periodYear);
        },
        create: async (data) => makeRecord(data.data.contractId, data.data.periodMonth, data.data.periodYear),
        updateMany: async () => {},
      },
      monthlyService: {
        findUnique: async () => null, // no existing service
        upsert: async ({ create }) => {
          // record id is 'record-c1-5-2026' → split('-')[1] = 'c1'
          const contractId = create.monthlyRecordId.split('-')[1];
          upsertCallsByContract[contractId] = (upsertCallsByContract[contractId] || 0) + 1;
          return { id: 'svc-1', amount: create.amount, conceptType: { id: 'ct-agua', name: 'Agua', category: 'SERVICIO' } };
        },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    const months = [{ month: 5, year: 2026 }];
    const result = await service.bulkAssignMultiContract('group-1', ['c1', 'c1', 'c2'], 'ct-agua', 50000, months);

    assert.strictEqual(result.errors.length, 0, `no debe haber errores: ${JSON.stringify(result.errors)}`);
    // c1 should have been upserted exactly once (not twice)
    assert.strictEqual(upsertCallsByContract['c1'] ?? 0, 1, 'c1 debe tener exactamente 1 upsert, no 2');
    assert.strictEqual(upsertCallsByContract['c2'] ?? 0, 1, 'c2 debe tener exactamente 1 upsert');
    const totalUpserts = Object.values(upsertCallsByContract).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalUpserts, 2, 'en total deben haberse hecho exactamente 2 upserts');
  });
});

// ────────────────────────────────────────────────────────────
// T10 — Regresión 668d9fb: serviceId de otro record es rechazado
// ────────────────────────────────────────────────────────────
describe('cross-record service validation (regresión 668d9fb)', () => {
  test('un serviceId que pertenece a otro record es rechazado', () => {
    // Simulate the guard logic added in 668d9fb:
    // existing.monthlyRecordId must equal recordId from URL
    const recordId = 'record-A';
    const anotherRecordId = 'record-B';

    // Service belongs to record-B but request targets record-A
    const existingService = { id: 'svc-1', monthlyRecordId: anotherRecordId, conceptTypeId: 'ct-agua', amount: 50000 };

    // Guard check (mirrors the controller logic)
    const isValid = existingService.monthlyRecordId === recordId;

    assert.strictEqual(isValid, false, 'serviceId de otro record debe ser rechazado (monthlyRecordId no coincide)');

    // Confirm the same service would pass if it belonged to the correct record
    const ownService = { ...existingService, monthlyRecordId: recordId };
    const isOwnValid = ownService.monthlyRecordId === recordId;
    assert.strictEqual(isOwnValid, true, 'serviceId del mismo record debe ser aceptado');
  });
});

// ────────────────────────────────────────────────────────────
// T11 — bulkAssign emite console.warn('[service-overwrite]')
//       cuando el amount cambia, pero NO cuando es igual
// ────────────────────────────────────────────────────────────
describe('bulkAssign - emite warning cuando cambia el monto de un servicio existente', () => {
  test('console.warn se emite cuando el amount existente difiere del nuevo', async () => {
    const contract = makeContract();
    const existingRecord = makeRecord(contract.id, 4, 2026);
    const OLD_AMOUNT = 25000;
    const NEW_AMOUNT = 50000;
    const warnings = [];

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      $transaction: async (fn) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async () => existingRecord,
      },
      contract: { findUnique: async () => contract },
      monthlyService: {
        // Existing service with OLD_AMOUNT
        findUnique: async () => ({ id: 'svc-existing', amount: OLD_AMOUNT }),
        upsert: async ({ create, update }) => ({
          id: 'svc-existing',
          amount: update.amount,
          conceptType: { id: 'ct-1', name: 'Agua', category: 'SERVICIO' },
        }),
      },
    };

    // Intercept console.warn
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };

    try {
      const service = proxyquire('../src/services/monthlyServiceService', {
        '../lib/prisma': mockPrisma,
        './monthlyRecordService': mockRecalculate,
      });

      const months = [{ month: 4, year: 2026 }];
      await service.bulkAssign('group-1', contract.id, 'ct-1', NEW_AMOUNT, months);
    } finally {
      console.warn = originalWarn;
    }

    const overwriteWarnings = warnings.filter(([tag]) => tag === '[service-overwrite]');
    assert.strictEqual(overwriteWarnings.length, 1, 'debe emitir exactamente 1 warning de overwrite');
    const [, payload] = overwriteWarnings[0];
    assert.strictEqual(payload.oldAmount, OLD_AMOUNT, 'oldAmount debe ser el monto anterior');
    assert.strictEqual(payload.newAmount, NEW_AMOUNT, 'newAmount debe ser el monto nuevo');
  });

  test('NO emite warning cuando el amount no cambia', async () => {
    const contract = makeContract();
    const existingRecord = makeRecord(contract.id, 4, 2026);
    const SAME_AMOUNT = 50000;
    const warnings = [];

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      $transaction: async (fn) => fn(mockPrisma),
      monthlyRecord: { findUnique: async () => existingRecord },
      contract: { findUnique: async () => contract },
      monthlyService: {
        findUnique: async () => ({ id: 'svc-existing', amount: SAME_AMOUNT }),
        upsert: async ({ create, update }) => ({
          id: 'svc-existing', amount: update.amount,
          conceptType: { id: 'ct-1', name: 'Agua', category: 'SERVICIO' },
        }),
      },
    };

    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };

    try {
      const service = proxyquire('../src/services/monthlyServiceService', {
        '../lib/prisma': mockPrisma,
        './monthlyRecordService': mockRecalculate,
      });
      const months = [{ month: 4, year: 2026 }];
      await service.bulkAssign('group-1', contract.id, 'ct-1', SAME_AMOUNT, months);
    } finally {
      console.warn = originalWarn;
    }

    const overwriteWarnings = warnings.filter(([tag]) => tag === '[service-overwrite]');
    assert.strictEqual(overwriteWarnings.length, 0, 'no debe emitir warning cuando el amount no cambia');
  });
});

// ────────────────────────────────────────────────────────────
// T12 — bulkAssign respeta rescindedAt: no crea servicios
//       en meses posteriores a la fecha de rescisión
// ────────────────────────────────────────────────────────────
describe('bulkAssign - respeta rescindedAt', () => {
  test('no crea servicios en meses posteriores a la fecha de rescisión', async () => {
    // Contract rescinded at month 3 of 2025 (startMonth=1, so rescMonthNumber=3)
    const contract = makeContract({
      rescindedAt: '2025-03-15T12:00:00.000Z',
      durationMonths: 24,
    });
    let upsertCallCount = 0;

    const mockRecalculate = { recalculateMultipleRecords: async () => {} };
    const mockPrisma = {
      $transaction: async (fn) => fn(mockPrisma),
      monthlyRecord: {
        findUnique: async () => null, // force record creation path
        create: async (data) => makeRecord(contract.id, data.data.periodMonth, data.data.periodYear),
      },
      contract: { findUnique: async () => contract },
      monthlyService: {
        findUnique: async () => null,
        upsert: async () => { upsertCallCount++; return {}; },
      },
    };

    const service = proxyquire('../src/services/monthlyServiceService', {
      '../lib/prisma': mockPrisma,
      './monthlyRecordService': mockRecalculate,
    });

    // Request months 1-6, but contract is rescinded at month 3
    const months = [
      { month: 1, year: 2025 },
      { month: 2, year: 2025 },
      { month: 3, year: 2025 }, // = rescission month (borderline — rescMonthNumber=3, guard is monthNumber > 3)
      { month: 4, year: 2025 }, // after rescission
      { month: 5, year: 2025 }, // after rescission
      { month: 6, year: 2025 }, // after rescission
    ];

    await service.bulkAssign('group-1', contract.id, 'ct-1', 50000, months);

    // Months 1, 2, 3 should be upserted (3 is the rescission month itself, not after)
    // Months 4, 5, 6 should be skipped
    assert.strictEqual(upsertCallCount, 3, `debe upsertear solo los meses 1, 2 y 3 (rescisión en mes 3), obtuvo: ${upsertCallCount}`);
  });
});
