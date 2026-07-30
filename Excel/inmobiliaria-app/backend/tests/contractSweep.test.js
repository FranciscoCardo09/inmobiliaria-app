// contractSweepService: cierre perezoso de las renovaciones anticipadas.
//
// Al renovar anticipadamente, el contrato viejo queda active=true + renewedAt
// para seguir operando sus meses restantes. Cuando su rango termina hay que
// dejarlo en el mismo estado terminal que una renovación post-vencimiento
// (active=false => RENEWED). Eso es lo que verifica este archivo.

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

function buildEnv() {
  const prisma = makeFakePrisma();
  const sweepService = proxyquire('../src/services/contractSweepService', {
    '../lib/prisma': prisma,
  });
  return { prisma, sweepService };
}

// Fechas relativas a hoy para que los tests no caduquen con el calendario.
function monthStart(offsetMonths) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
}

function seed(prisma, id, overrides = {}) {
  return prisma.contract.create({
    data: {
      id,
      groupId: 'g1',
      propertyId: 'p1',
      startDate: monthStart(-30),
      startMonth: 1,
      durationMonths: 24, // vencido hace 6 meses
      active: true,
      renewedAt: new Date(),
      rescindedAt: null,
      ...overrides,
    },
  });
}

test('sweep — desactiva el contrato viejo cuando su rango ya terminó', async () => {
  const { prisma, sweepService } = buildEnv();
  await seed(prisma, 'c-terminado');

  const count = await sweepService.sweepSupersededContracts('g1');

  assert.strictEqual(count, 1);
  const after = await prisma.contract.findUnique({ where: { id: 'c-terminado' } });
  assert.strictEqual(after.active, false);
  assert.ok(after.renewedAt, 'renewedAt se conserva => estado RENEWED, no TERMINATED');
});

test('sweep — NO toca el contrato viejo que todavía está en curso', async () => {
  const { prisma, sweepService } = buildEnv();
  // Arrancó hace 22 meses y dura 24: le quedan meses por operar.
  await seed(prisma, 'c-en-curso', { startDate: monthStart(-22) });

  const count = await sweepService.sweepSupersededContracts('g1');

  assert.strictEqual(count, 0);
  const after = await prisma.contract.findUnique({ where: { id: 'c-en-curso' } });
  assert.strictEqual(after.active, true, 'sigue operativo: debe seguir generando registros mensuales');
});

test('sweep — ignora contratos sin renovación', async () => {
  const { prisma, sweepService } = buildEnv();
  await seed(prisma, 'c-sin-renovar', { renewedAt: null });

  const count = await sweepService.sweepSupersededContracts('g1');

  assert.strictEqual(count, 0);
  const after = await prisma.contract.findUnique({ where: { id: 'c-sin-renovar' } });
  assert.strictEqual(after.active, true);
});

test('sweep — ignora contratos rescindidos (A-13: conservan active=true)', async () => {
  const { prisma, sweepService } = buildEnv();
  await seed(prisma, 'c-rescindido', { rescindedAt: new Date() });

  const count = await sweepService.sweepSupersededContracts('g1');

  assert.strictEqual(count, 0);
  const after = await prisma.contract.findUnique({ where: { id: 'c-rescindido' } });
  assert.strictEqual(after.active, true);
});

test('sweep — no cruza grupos', async () => {
  const { prisma, sweepService } = buildEnv();
  await seed(prisma, 'c-otro-grupo', { groupId: 'g2' });

  const count = await sweepService.sweepSupersededContracts('g1');

  assert.strictEqual(count, 0);
  const after = await prisma.contract.findUnique({ where: { id: 'c-otro-grupo' } });
  assert.strictEqual(after.active, true);
});

test('sweep — es idempotente: la segunda corrida no escribe nada', async () => {
  const { prisma, sweepService } = buildEnv();
  await seed(prisma, 'c-terminado');

  assert.strictEqual(await sweepService.sweepSupersededContracts('g1'), 1);
  assert.strictEqual(await sweepService.sweepSupersededContracts('g1'), 0);
});
