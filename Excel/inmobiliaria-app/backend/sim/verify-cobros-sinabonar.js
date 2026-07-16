/*
 * Verifica:
 *  1) Bloque "cobrado de deudas anteriores" = pagos por paymentDate dentro del mes elegido,
 *     SOLO de períodos ANTERIORES (no el propio mes ni meses futuros adelantados).
 *  2) Total combinado "sin abonar" = pendingAmount (mes actual impago) + totalDeuda (deudas formales).
 * DB local aislada (NO prod). Crea su propio grupo y lo borra al final.
 * Uso: DATABASE_URL="postgresql://postgres:sim@localhost:55432/simdb" node sim/verify-cobros-sinabonar.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getLiquidacionesAllContracts } = require('../src/services/reportDataService');

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`); if (!cond) failures++; };
const byContract = (arr, cid) => arr.find((d) => d.contractId === cid);
const close = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.01;

async function setup() {
  const group = await prisma.group.create({ data: { name: '__VCS__', slug: '__vcs__' + Date.now(), punitoryRate: 0.006 } });
  const owner = await prisma.owner.create({ data: { groupId: group.id, name: 'Dueño Test', dni: '20111111', phone: '0000', email: 'o@t.com' } });
  const tenant = await prisma.tenant.create({ data: { groupId: group.id, name: 'Inq Test', dni: '77777777' } });

  const mkContract = async (address, baseRent) => {
    const prop = await prisma.property.create({ data: { groupId: group.id, address, ownerId: owner.id } });
    return prisma.contract.create({ data: {
      groupId: group.id, propertyId: prop.id, tenantId: tenant.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 0, 1), startMonth: 1, currentMonth: 3, durationMonths: 24, baseRent,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006, active: true } });
  };

  const mkRec = (contract, monthNumber, periodMonth, rentAmount, paid) => prisma.monthlyRecord.create({ data: {
    groupId: group.id, contractId: contract.id, monthNumber, periodMonth, periodYear: 2026,
    rentAmount, servicesTotal: 0, totalDue: rentAmount,
    amountPaid: paid ? rentAmount : 0, balance: paid ? 0 : -rentAmount,
    status: paid ? 'COMPLETE' : 'PENDING', isPaid: !!paid, isCancelled: !!paid } });

  const mkDebt = (contract, recId, periodMonth, currentTotal, punitorios, status) => prisma.debt.create({ data: {
    groupId: group.id, contractId: contract.id, monthlyRecordId: recId,
    periodLabel: `Periodo ${periodMonth}`, periodMonth, periodYear: 2026,
    originalAmount: currentTotal - punitorios, unpaidRentAmount: currentTotal - punitorios,
    accumulatedPunitory: punitorios, currentTotal, amountPaid: status === 'PAID' ? currentTotal : 0,
    punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 1, 10), status } });

  const mkTx = (recId, dateY, dateM, dateD, amount, punitorios) => prisma.paymentTransaction.create({ data: {
    groupId: group.id, monthlyRecordId: recId, paymentDate: new Date(dateY, dateM, dateD, 12, 0, 0),
    amount, paymentMethod: 'EFECTIVO',
    concepts: { create: [
      { type: 'ALQUILER_DEUDA', amount: amount - punitorios },
      ...(punitorios > 0 ? [{ type: 'PUNITORIOS', amount: punitorios }] : []),
    ] } } });

  // ── MARIO_NOPAGO: no pagó marzo NI febrero → Feb queda como deuda formal; sin cobros en marzo
  const marioNoPago = await mkContract('AAA Mario NoPago', 50000);
  const mnFeb = await mkRec(marioNoPago, 2, 2, 50000, false);
  await mkRec(marioNoPago, 3, 3, 50000, false); // marzo impago
  await mkDebt(marioNoPago, mnFeb.id, 2, 53000, 3000, 'OPEN'); // deuda febrero pendiente

  // ── MARIO_PAGO_DEUDA: en marzo pagó la deuda de febrero (53000). Marzo sigue impago.
  const marioPago = await mkContract('BBB Mario PagoDeuda', 50000);
  const mpFeb = await mkRec(marioPago, 2, 2, 50000, false);
  await mkRec(marioPago, 3, 3, 50000, false);
  await mkDebt(marioPago, mpFeb.id, 2, 53000, 3000, 'PAID'); // deuda febrero ya saldada
  await mkTx(mpFeb.id, 2026, 2, 15, 53000, 3000);  // pago en MARZO (mes=2 idx) de la deuda feb
  await mkTx(mpFeb.id, 2026, 1, 10, 10000, 0);     // pago en FEBRERO (idx 1) → NO debe contar en marzo

  // ── PEPITO: pagó marzo normal, sin deudas
  const pepito = await mkContract('CCC Pepito', 60000);
  await mkRec(pepito, 3, 3, 60000, true);

  // ── FUTURO: pagó marzo, y adelantó abril durante marzo → abril NO debe aparecer (futuro)
  const futuro = await mkContract('DDD Futuro', 70000);
  await mkRec(futuro, 3, 3, 70000, true);
  const fAbr = await mkRec(futuro, 4, 4, 70000, false);
  await mkTx(fAbr.id, 2026, 2, 20, 70000, 0); // adelanto de abril, pagado en marzo

  return { group, marioNoPago, marioPago, pepito, futuro };
}

async function run() {
  const ctx = await setup();
  const gid = ctx.group.id;
  const ids = [ctx.marioNoPago.id, ctx.marioPago.id, ctx.pepito.id, ctx.futuro.id];
  const opts = { soloConPago: false };
  try {
    const r = await getLiquidacionesAllContracts(gid, 3, 2026, null, opts, null, ids);

    console.log('\n=== MARIO_NOPAGO (total sin abonar = marzo + deuda feb) ===');
    const mn = byContract(r, ctx.marioNoPago.id);
    check('MN aparece', !!mn);
    check('MN status NO COBRADO', mn?.paymentStatus === 'NO COBRADO', `status=${mn?.paymentStatus}`);
    check('MN sin bloque cobrados', mn?.cobradoOtrosPeriodos == null, `cobr=${JSON.stringify(mn?.cobradoOtrosPeriodos)}`);
    check('MN totalDeuda = 53000', close(mn?.totalDeuda, 53000), `totalDeuda=${mn?.totalDeuda}`);
    check('MN totalSinAbonar = pendingAmount + totalDeuda', close(mn?.totalSinAbonar, (mn?.pendingAmount || 0) + (mn?.totalDeuda || 0)), `sinAbonar=${mn?.totalSinAbonar} pending=${mn?.pendingAmount} deuda=${mn?.totalDeuda}`);
    check('MN totalSinAbonar incluye marzo (> deuda sola)', (mn?.totalSinAbonar || 0) > (mn?.totalDeuda || 0), `sinAbonar=${mn?.totalSinAbonar}`);

    console.log('\n=== MARIO_PAGO_DEUDA (cobró feb en marzo; feb-dated excluido) ===');
    const mp = byContract(r, ctx.marioPago.id);
    check('MP aparece', !!mp);
    check('MP tiene bloque cobrados', mp?.cobradoOtrosPeriodos != null);
    check('MP cobrados total = 53000 (excluye pago feb-dated de 10000)', close(mp?.cobradoOtrosPeriodos?.total, 53000), `total=${mp?.cobradoOtrosPeriodos?.total}`);
    check('MP detalle: 1 período (febrero)', mp?.cobradoOtrosPeriodos?.detalle?.length === 1, `len=${mp?.cobradoOtrosPeriodos?.detalle?.length}`);
    check('MP detalle período = mes 2', mp?.cobradoOtrosPeriodos?.detalle?.[0]?.periodMonth === 2);
    check('MP detalle punitorios = 3000', close(mp?.cobradoOtrosPeriodos?.detalle?.[0]?.punitorios, 3000), `pun=${mp?.cobradoOtrosPeriodos?.detalle?.[0]?.punitorios}`);

    console.log('\n=== PEPITO (pagó marzo, sin nada extra) ===');
    const pp = byContract(r, ctx.pepito.id);
    check('PP status PAGADO', pp?.paymentStatus === 'PAGADO', `status=${pp?.paymentStatus}`);
    check('PP sin bloque cobrados', pp?.cobradoOtrosPeriodos == null);
    check('PP totalSinAbonar = 0', close(pp?.totalSinAbonar, 0), `sinAbonar=${pp?.totalSinAbonar}`);

    console.log('\n=== FUTURO (adelanto de abril en marzo NO debe aparecer) ===');
    const fu = byContract(r, ctx.futuro.id);
    check('FU aparece (marzo)', !!fu && fu.periodo.mes === 3);
    check('FU sin bloque cobrados (futuro excluido)', fu?.cobradoOtrosPeriodos == null, `cobr=${JSON.stringify(fu?.cobradoOtrosPeriodos)}`);
  } finally {
    await prisma.group.delete({ where: { id: gid } }).catch((e) => console.log('cleanup warn', e.message));
  }
  await prisma.$disconnect();
  console.log(failures === 0 ? '\n✅ TODOS LOS ASSERTS OK' : `\n❌ ${failures} FALLAS`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('ERROR', e); process.exit(1); });
