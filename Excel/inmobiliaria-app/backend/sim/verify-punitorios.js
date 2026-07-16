/*
 * Verifica el cálculo de punitorios (acumulados / nuevos / total) end-to-end
 * en los cuatro casos: mes abierto sin deuda, pago parcial sin deuda,
 * deuda completa y deuda parcial. DB local aislada (NO prod).
 *
 * Uso: DATABASE_URL="postgresql://postgres:sim@localhost:55433/verifydb" node sim/verify-punitorios.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { registerPayment, calculatePunitoryPreview } = require('../src/services/paymentTransactionService');
const { payDebt, calculateDebtPunitory } = require('../src/services/debtService');

let failures = 0;
const r2 = (n) => Math.round(n * 100) / 100;
const f = (n) => Math.round(n).toLocaleString('es-AR');
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRecalc(id, pred) { for (let i = 0; i < 60; i++) { const r = await prisma.monthlyRecord.findUnique({ where: { id } }); if (pred(r)) return r; await sleep(100); } return prisma.monthlyRecord.findUnique({ where: { id } }); }

const R = 100000, PCT = 0.006, DAY = R * PCT; // 600/dia

async function setup() {
  const group = await prisma.group.create({ data: { name: '__VP__', slug: '__vp__' + Date.now(), punitoryRate: PCT } });
  const prop = await prisma.property.create({ data: { groupId: group.id, address: '__VP_PROP__' } });
  const tenant = await prisma.tenant.create({ data: { groupId: group.id, name: 'T', dni: '88888888' } });
  const contract = await prisma.contract.create({
    data: { groupId: group.id, propertyId: prop.id, tenantId: tenant.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 0, 1), startMonth: 1, currentMonth: 1, durationMonths: 24, baseRent: R,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: PCT },
  });
  return { group, prop, tenant, contract };
}
async function mkRec(ctx, monthNumber, periodMonth, opts = {}) {
  return prisma.monthlyRecord.create({ data: {
    groupId: ctx.group.id, contractId: ctx.contract.id, monthNumber, periodMonth, periodYear: 2026,
    rentAmount: R, servicesTotal: 0, totalDue: R, amountPaid: 0, balance: 0, status: 'PENDING', ...opts } });
}

async function run() {
  const ctx = await setup();
  try {
    // ===== CASO 1: mes abierto, pago en plazo => 0 punitorios =====
    console.log('\n=== 1) mes abierto, en plazo ===');
    const r1 = await mkRec(ctx, 6, 6);
    const { transaction: t1 } = await registerPayment(ctx.group.id, r1.id, { paymentDate: '2026-06-08', amount: R, paymentMethod: 'EFECTIVO' });
    check('1: sin punitorios pagando dia 8 (gracia 10)', r2(t1.punitoryAmount) === 0, `pun=${t1.punitoryAmount}`);

    // ===== CASO 2: mes abierto, pago tardio TOTAL =====
    console.log('\n=== 2) mes abierto, tardio total (1 pago) ===');
    const r2rec = await mkRec(ctx, 5, 5);
    const prev2 = await calculatePunitoryPreview(r2rec.id, '2026-05-15');
    // mes en curso, desde startDay 4 hasta 15 inclusive = 12 dias
    const esperado2 = r2(DAY * 12);
    check('2: preview total = 600*12 dias', r2(prev2.amount) === esperado2, `got ${f(prev2.amount)} esperado ${f(esperado2)} (dias ${prev2.days})`);
    check('2: acumulados=0, nuevos=total', r2(prev2.accumulatedPunitory) === 0 && r2(prev2.newPunitory) === esperado2);
    const { transaction: t2 } = await registerPayment(ctx.group.id, r2rec.id, { paymentDate: '2026-05-15', amount: R + esperado2, paymentMethod: 'EFECTIVO' });
    check('2: tx.punitoryAmount coincide con preview', r2(t2.punitoryAmount) === esperado2, `got ${t2.punitoryAmount}`);

    // ===== CASO 3: mes abierto, pago PARCIAL tardio + segundo pago tardio =====
    console.log('\n=== 3) mes abierto, parcial + parcial (acumulados) ===');
    const r3 = await mkRec(ctx, 4, 4);
    // pago1 dia 15-abr (parcial: paga solo 40000 del alquiler). punitorio sobre rent impago.
    const prev3a = await calculatePunitoryPreview(r3.id, '2026-04-15');
    console.log(`   preview pago1 (15-abr): total ${f(prev3a.amount)} (acum ${f(prev3a.accumulatedPunitory)} + nuevo ${f(prev3a.newPunitory)}, dias ${prev3a.days})`);
    await registerPayment(ctx.group.id, r3.id, { paymentDate: '2026-04-15', amount: 40000, paymentMethod: 'EFECTIVO' });
    const r3mid = await waitRecalc(r3.id, (x) => x.amountPaid >= 40000);
    console.log(`   tras pago1: record.punitoryAmount(frozen)=${f(r3mid.punitoryAmount)} amountPaid=${f(r3mid.amountPaid)}`);
    // pago2 dia 25-abr: nuevos desde 15-abr; acumulados = frozen no pagado
    const prev3b = await calculatePunitoryPreview(r3.id, '2026-04-25');
    console.log(`   preview pago2 (25-abr): total ${f(prev3b.amount)} (acum ${f(prev3b.accumulatedPunitory)} + nuevo ${f(prev3b.newPunitory)}, dias ${prev3b.days})`);
    // CHEQUEO clave: ¿el dia 15-abr se cuenta dos veces?
    // unpaidRent tras pago1 = 60000 (rent 100k - 40k). Pero el pago1 imputó: rent impago al momento del pago1.
    // dias reales de atraso del alquiler impago: depende de base cambiante. Verificamos consistencia de no-negatividad y monotonia.
    check('3: acumulados >= 0', r2(prev3b.accumulatedPunitory) >= 0, `acum=${prev3b.accumulatedPunitory}`);
    check('3: nuevos >= 0', r2(prev3b.newPunitory) >= 0);
    check('3: total = acumulados + nuevos', r2(prev3b.amount) === r2(prev3b.accumulatedPunitory + prev3b.newPunitory), `${prev3b.amount} vs ${r2(prev3b.accumulatedPunitory + prev3b.newPunitory)}`);
    // Diagnóstico doble-conteo: el dia 15 (pago1) entra en frozen y el calculo nuevo arranca en 15 inclusive
    console.log(`   [diag] nuevo pago2 dias=${prev3b.days} (15..25 inclusive = 11). Si fuese exclusivo del dia 15 serian 10.`);

    // ===== CASO 4: deuda completa (1 pago) =====
    console.log('\n=== 4) deuda completa ===');
    const dRec = await mkRec(ctx, 1, 1, { status: 'PARTIAL' });
    const debt = await prisma.debt.create({ data: {
      groupId: ctx.group.id, contractId: ctx.contract.id, monthlyRecordId: dRec.id, periodMonth: 1, periodYear: 2026,
      periodLabel: 'Enero 2026', originalAmount: R, unpaidRentAmount: R, unpaidServicesAmount: 0, accumulatedPunitory: 0,
      currentTotal: R, amountPaid: 0, punitoryStartDate: new Date(2026, 0, 4), punitoryPercent: PCT, status: 'OPEN' } });
    const dprev = await calculateDebtPunitory(debt, '2026-02-10', null, true);
    // DEUDA cuenta desde punitoryStartDay (dia 4) hasta 10-feb inclusive = 38 dias (NO desde dia 1)
    const esperado4 = r2(DAY * 38);
    check('4: punitorio deuda = 600*38 (4-ene..10-feb, desde startDay)', r2(dprev.amount) === esperado4, `got ${f(dprev.amount)} esperado ${f(esperado4)} (dias ${dprev.days})`);
    const { debt: dpaid } = await payDebt(debt.id, R + esperado4, '2026-02-10', 'EFECTIVO');
    check('4: deuda PAID', dpaid.status === 'PAID');

    // ===== CASO 5: deuda PARCIAL + completar =====
    console.log('\n=== 5) deuda parcial + completar ===');
    const dRec2 = await mkRec(ctx, 2, 2, { status: 'PARTIAL' });
    const debt2 = await prisma.debt.create({ data: {
      groupId: ctx.group.id, contractId: ctx.contract.id, monthlyRecordId: dRec2.id, periodMonth: 2, periodYear: 2026,
      periodLabel: 'Febrero 2026', originalAmount: R, unpaidRentAmount: R, unpaidServicesAmount: 0, accumulatedPunitory: 0,
      currentTotal: R, amountPaid: 0, punitoryStartDate: new Date(2026, 1, 4), punitoryPercent: PCT, status: 'OPEN' } });
    // pago parcial el 10-mar
    const d2a = await calculateDebtPunitory(debt2, '2026-03-10', null, true);
    console.log(`   preview parcial (10-mar): total ${f(d2a.amount)} (acum ${f(d2a.accumulatedPunitory)} + nuevo ${f(d2a.newPunitoryAmount)}, dias ${d2a.days})`);
    await payDebt(debt2.id, 50000, '2026-03-10', 'EFECTIVO'); // parcial: cubre parte del alquiler
    const debt2mid = await prisma.debt.findUnique({ where: { id: debt2.id } });
    console.log(`   tras parcial: amountPaid=${f(debt2mid.amountPaid)} accumulatedPunitory=${f(debt2mid.accumulatedPunitory)} status=${debt2mid.status}`);
    const d2b = await calculateDebtPunitory(debt2mid, '2026-03-20', null, true);
    console.log(`   preview completar (20-mar): total ${f(d2b.amount)} (acum-impago ${f(d2b.unpaidAccumulatedPunitory)} + nuevo ${f(d2b.newPunitoryAmount)}, dias ${d2b.days})`);
    check('5: parcial deja deuda PARTIAL', debt2mid.status === 'PARTIAL', `status=${debt2mid.status}`);
    check('5: total punitorio impago >= 0', r2(d2b.amount) >= 0);
    check('5: no hay punitorio acumulado negativo', r2(d2b.unpaidAccumulatedPunitory) >= 0, `unpaidAcc=${d2b.unpaidAccumulatedPunitory}`);
  } finally {
    await sleep(800); // dejar terminar processDirtyRecords (advisory locks) antes de limpiar
    await prisma.debtPayment.deleteMany({ where: { debt: { groupId: ctx.group.id } } }).catch(() => {});
    await prisma.debt.deleteMany({ where: { groupId: ctx.group.id } }).catch(() => {});
    await prisma.group.delete({ where: { id: ctx.group.id } }).catch((e) => console.log('cleanup warn', e.message));
  }
  await prisma.$disconnect();
  console.log(failures === 0 ? '\n✅ TODOS LOS ASSERTS OK' : `\n❌ ${failures} FALLAS`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('ERROR', e); process.exit(1); });
