/*
 * Verifica el Arreglo 1 (Problema A) a través del controlador real updateContract.
 * Espera a que el handler fire-and-forget (asyncHandler) termine, y asserta el resultado.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ctrl = require('../src/controllers/contractsController');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond) => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}`); if (!cond) failures++; };

(async () => {
  const group = await prisma.group.findFirst({ select: { id: true } });
  const prop = await prisma.property.create({ data: { groupId: group.id, address: '__VERIFY_FIX1__' } });
  // Contrato real arrancado 2024-04 (rango mN 1..24). Records consistentes con ese inicio.
  const c = await prisma.contract.create({ data: { groupId: group.id, propertyId: prop.id, contractType: 'INQUILINO', startDate: new Date(2024, 3, 1), startMonth: 1, currentMonth: 1, durationMonths: 24, baseRent: 100000 } });
  await prisma.monthlyRecord.create({ data: { groupId: group.id, contractId: c.id, monthNumber: 23, periodMonth: 2, periodYear: 2026, rentAmount: 100000, totalDue: 100000, balance: 0, status: 'PENDING' } });          // feb 2026 $0
  await prisma.monthlyRecord.create({ data: { groupId: group.id, contractId: c.id, monthNumber: 24, periodMonth: 3, periodYear: 2026, rentAmount: 100000, totalDue: 100000, amountPaid: 70000, balance: -30000, status: 'PARTIAL' } }); // mar 2026 PAGADO
  try {
    let warning;
    const res = { status: () => res, json: (o) => { warning = o && o.data && o.data.warning; } };
    // Simula la edición real: mover startDate a 2026-04 (lo que generaba meses fantasma)
    ctrl.updateContract({ params: { groupId: group.id, id: c.id }, body: { startDate: '2026-04-01' }, user: { id: 'verify' } }, res, (e) => { if (e) console.log('NEXT ERR', e.message); });
    // Esperar a que el handler termine (poll hasta que cambie la fecha)
    for (let i = 0; i < 100; i++) { const x = await prisma.contract.findUnique({ where: { id: c.id }, select: { startDate: true } }); if (x.startDate.getFullYear() === 2026) break; await sleep(50); }
    await sleep(150); // margen para que termine el repair posterior al cambio de fecha

    const recs = await prisma.monthlyRecord.findMany({ where: { contractId: c.id }, select: { periodMonth: true, amountPaid: true } });
    const feb = recs.find((r) => r.periodMonth === 2);
    const mar = recs.find((r) => r.periodMonth === 3);

    check('la edicion de startDate persistio (2026)', (await prisma.contract.findUnique({ where: { id: c.id }, select: { startDate: true } })).startDate.getFullYear() === 2026);
    check('mes fantasma sin plata (feb $0) fue BORRADO', !feb);
    check('mes con pagos (mar $70k) fue PRESERVADO', !!mar);
    check('se devolvio WARNING de meses con pagos fuera de rango', !!warning && warning.code === 'PAID_RECORDS_OUT_OF_RANGE');
  } finally {
    await prisma.monthlyRecord.deleteMany({ where: { contractId: c.id } });
    await prisma.contract.delete({ where: { id: c.id } });
    await prisma.property.delete({ where: { id: prop.id } });
  }
  await prisma.$disconnect();
  console.log(failures === 0 ? '\nFIX 1: TODO OK' : `\nFIX 1: ${failures} FALLAS`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
