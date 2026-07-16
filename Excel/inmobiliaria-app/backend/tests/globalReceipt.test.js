const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

// ============================================================================
// A-19 (auditoría 2026-07-10): el recibo GLOBAL (getPagoEfectivoFromRecord,
// rama sin `transactionId`) calcula el TOTAL incluyendo IVA y restando el
// saldo a favor (`record.previousBalance`), pero esos dos renglones no
// estaban en el detalle de `conceptos` → la suma visible de renglones no
// cuadraba con el TOTAL impreso en el documento entregado al inquilino.
//
// Fix: agregar los renglones IVA y "Saldo a favor" al detalle, reusando los
// mismos valores YA calculados para `total` (no se recalcula ni se toca
// ninguna fórmula de punitorios).
// ============================================================================

const GROUP = 'g1';

function buildService(prisma) {
  return proxyquire('../src/services/reportDataService', {
    '../lib/prisma': prisma,
  });
}

async function seedGroup(prisma) {
  await prisma.group.create({ data: { id: GROUP, name: 'Test SRL', currency: 'ARS' } });
}

function baseContract(overrides = {}) {
  return {
    id: 'c1',
    contractType: 'INQUILINO',
    tenant: { id: 't1', name: 'Juan Pérez', dni: '20123456' },
    contractTenants: [],
    rescindedAt: null,
    property: { id: 'p1', address: 'Calle Falsa 123', owner: { id: 'o1', name: 'Propietario SA', dni: '30111222' } },
    ...overrides,
  };
}

function sumConceptos(conceptos) {
  return conceptos.reduce((s, c) => s + c.importe, 0);
}

test('recibo global: con IVA y saldo a favor, la suma de renglones == TOTAL', async () => {
  const prisma = makeFakePrisma();
  await seedGroup(prisma);
  const svc = buildService(prisma);

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr1', groupId: GROUP, contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      rentAmount: 100000, servicesTotal: 10000, includeIva: true,
      previousBalance: 15000, punitoryDays: 0, punitoryForgiven: false,
      contract: baseContract(),
      services: [
        { id: 's1', amount: 10000, conceptType: { name: 'ABL', label: 'ABL', category: 'IMPUESTO' } },
      ],
      transactions: [],
      debt: null,
    },
  });

  const data = await svc.getPagoEfectivoFromRecord(GROUP, 'mr1', null);

  const expectedIva = 100000 * 0.21;
  const expectedTotal = Math.max(100000 + 10000 + expectedIva - 15000, 0);
  assert.equal(data.total, expectedTotal);

  const ivaRow = data.conceptos.find((c) => c.concepto === 'IVA 21%');
  const creditoRow = data.conceptos.find((c) => c.concepto === 'Saldo a favor');
  assert.ok(ivaRow, 'debe existir el renglón de IVA');
  assert.equal(ivaRow.importe, expectedIva);
  assert.ok(creditoRow, 'debe existir el renglón de Saldo a favor');
  assert.equal(creditoRow.importe, -15000);

  assert.equal(sumConceptos(data.conceptos), data.total, 'la suma de los renglones debe ser exactamente el TOTAL impreso');
});

test('recibo global: sin IVA y sin saldo a favor, no aparecen renglones espurios', async () => {
  const prisma = makeFakePrisma();
  await seedGroup(prisma);
  const svc = buildService(prisma);

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr2', groupId: GROUP, contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, punitoryDays: 0, punitoryForgiven: false,
      contract: baseContract(),
      services: [],
      transactions: [],
      debt: null,
    },
  });

  const data = await svc.getPagoEfectivoFromRecord(GROUP, 'mr2', null);

  assert.equal(data.conceptos.find((c) => c.concepto === 'IVA 21%'), undefined);
  assert.equal(data.conceptos.find((c) => c.concepto === 'Saldo a favor'), undefined);
  assert.equal(data.total, 100000);
  assert.equal(sumConceptos(data.conceptos), data.total);
});

test('recibo global: con punitorios (sin deuda asociada), la suma de renglones sigue == TOTAL', async () => {
  const prisma = makeFakePrisma();
  await seedGroup(prisma);
  const svc = buildService(prisma);

  await prisma.monthlyRecord.create({
    data: {
      id: 'mr3', groupId: GROUP, contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      rentAmount: 100000, servicesTotal: 0, includeIva: false,
      previousBalance: 0, punitoryDays: 12, punitoryForgiven: false,
      contract: baseContract(),
      services: [],
      transactions: [
        { id: 'tx1', paymentDate: new Date(2026, 6, 20), paymentMethod: 'EFECTIVO', amount: 100000 + 3000, punitoryForgiven: false, concepts: [{ type: 'PUNITORIOS', amount: 3000 }] },
      ],
      debt: null,
    },
  });

  const data = await svc.getPagoEfectivoFromRecord(GROUP, 'mr3', null);

  const punitoriosRow = data.conceptos.find((c) => c.concepto.startsWith('Punitorios'));
  assert.ok(punitoriosRow);
  assert.equal(punitoriosRow.importe, 3000);
  assert.equal(data.total, 103000);
  assert.equal(sumConceptos(data.conceptos), data.total);
});
