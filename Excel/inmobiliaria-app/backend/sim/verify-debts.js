/*
 * Verifica los dos arreglos contra una DB local aislada (NO prod):
 *  - Bug 1: conceptos del pago (registerPayment) reflejan montos REALES por concepto.
 *  - Bug 2: pago de deuda con excedente genera saldo a favor para el mes siguiente.
 *
 * Uso: DATABASE_URL="postgresql://postgres:sim@localhost:55433/verifydb" node sim/verify-debts.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { registerPayment } = require('../src/services/paymentTransactionService');
const { payDebt, calculateDebtPunitory } = require('../src/services/debtService');

let failures = 0;
const r2 = (n) => Math.round(n * 100) / 100;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`);
  if (!cond) failures++;
};
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

async function setup() {
  const group = await prisma.group.create({ data: { name: '__VERIFY_DEBTS__', slug: '__verify_debts__' + Date.now(), punitoryRate: 0.006 } });
  const prop = await prisma.property.create({ data: { groupId: group.id, address: '__VERIFY_DEBTS_PROP__' } });
  const tenant = await prisma.tenant.create({ data: { groupId: group.id, name: 'Inquilino Verify', dni: '99999999' } });
  const contract = await prisma.contract.create({
    data: {
      groupId: group.id, propertyId: prop.id, tenantId: tenant.id,
      contractType: 'INQUILINO', startDate: new Date(2026, 0, 1), startMonth: 1,
      currentMonth: 1, durationMonths: 24, baseRent: 100000,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
    },
  });
  const muni = await prisma.conceptType.create({ data: { groupId: group.id, name: 'IMP_MUNI', label: 'Impuesto Municipal', category: 'IMPUESTO' } });
  const dgr = await prisma.conceptType.create({ data: { groupId: group.id, name: 'IMP_DGR', label: 'Impuesto Provincial DGR', category: 'IMPUESTO' } });
  return { group, prop, tenant, contract, muni, dgr };
}

async function makeRecord(ctx, { monthNumber, periodMonth, services = [], rentAmount = 100000, amountPaid = 0, status = 'PENDING' }) {
  const servicesTotal = r2(sum(services, (s) => s.amount));
  const rec = await prisma.monthlyRecord.create({
    data: {
      groupId: ctx.group.id, contractId: ctx.contract.id,
      monthNumber, periodMonth, periodYear: 2026,
      rentAmount, servicesTotal, totalDue: r2(rentAmount + servicesTotal),
      amountPaid, balance: 0, status,
      services: { create: services.map((s) => ({ conceptTypeId: s.conceptTypeId, amount: s.amount, description: s.label })) },
    },
  });
  return rec;
}

async function run() {
  const ctx = await setup();
  try {
    // ===== BUG 1: conceptos reales en pago de mes =====
    console.log('\n=== BUG 1: desglose de pago de mes ===');

    // Caso A: pago TOTAL dentro de plazo (sin punitorios). Esperado: Alquiler 100000 + cada servicio completo.
    const recA = await makeRecord(ctx, {
      monthNumber: 5, periodMonth: 5,
      services: [{ conceptTypeId: ctx.muni.id, amount: 26660, label: 'Impuesto Municipal' },
                 { conceptTypeId: ctx.dgr.id, amount: 53993, label: 'Impuesto Provincial DGR' }],
    });
    const totalA = 100000 + 80653;
    const { transaction: txA } = await registerPayment(ctx.group.id, recA.id, { paymentDate: '2026-05-08', amount: totalA, paymentMethod: 'EFECTIVO' });
    const cA = txA.concepts;
    const muniA = cA.find((c) => c.description === 'Impuesto Municipal');
    const dgrA = cA.find((c) => c.description === 'Impuesto Provincial DGR');
    const alqA = cA.find((c) => c.type === 'ALQUILER');
    check('A: Impuesto Municipal con monto real 26660', muniA && r2(muniA.amount) === 26660, `got ${muniA?.amount}`);
    check('A: Impuesto Provincial con monto real 53993', dgrA && r2(dgrA.amount) === 53993, `got ${dgrA?.amount}`);
    check('A: Alquiler con monto real 100000', alqA && r2(alqA.amount) === 100000, `got ${alqA?.amount}`);
    check('A: sin concepto de punitorios', !cA.find((c) => c.type === 'PUNITORIOS'));
    check('A: suma de conceptos == monto pagado', r2(sum(cA, (c) => c.amount)) === r2(totalA), `got ${r2(sum(cA, (c) => c.amount))}`);

    // Caso B: pago con punitorios (pago tardío). Esperado: aparece concepto PUNITORIOS.
    const recB = await makeRecord(ctx, {
      monthNumber: 6, periodMonth: 6,
      services: [{ conceptTypeId: ctx.muni.id, amount: 26660, label: 'Impuesto Municipal' }],
    });
    // pagar muy tarde (dia 28) para forzar punitorios sobre el alquiler
    const punB = await prisma.$transaction ? null : null;
    const totalBbase = 100000 + 26660;
    // primero registrar con un monto que cubra todo + punitorios estimados: pagamos de más para asegurar que entren
    const { transaction: txB } = await registerPayment(ctx.group.id, recB.id, { paymentDate: '2026-06-28', amount: totalBbase + 50000, paymentMethod: 'EFECTIVO' });
    const cB = txB.concepts;
    const punConcept = cB.find((c) => c.type === 'PUNITORIOS');
    check('B: aparece concepto PUNITORIOS cuando se pagan', !!punConcept, `punitoryAmount tx=${txB.punitoryAmount}`);
    check('B: Impuesto Municipal real 26660', r2((cB.find((c) => c.description === 'Impuesto Municipal') || {}).amount) === 26660);
    check('B: Alquiler real 100000', r2((cB.find((c) => c.type === 'ALQUILER') || {}).amount) === 100000);
    const sobreB = cB.find((c) => c.type === 'SOBREPAGO');
    check('B: suma conceptos == pago', r2(sum(cB, (c) => c.amount)) === r2(totalBbase + 50000), `got ${r2(sum(cB, (c) => c.amount))}`);

    // Caso C: pago PARCIAL. Esperado: servicios secuenciales reales, alquiler 0 (no alcanza).
    const recC = await makeRecord(ctx, {
      monthNumber: 7, periodMonth: 7,
      services: [{ conceptTypeId: ctx.muni.id, amount: 26660, label: 'Impuesto Municipal' },
                 { conceptTypeId: ctx.dgr.id, amount: 53993, label: 'Impuesto Provincial DGR' }],
    });
    const { transaction: txC } = await registerPayment(ctx.group.id, recC.id, { paymentDate: '2026-07-08', amount: 30000, paymentMethod: 'EFECTIVO' });
    const cC = txC.concepts;
    const muniC = cC.find((c) => c.description === 'Impuesto Municipal');
    const dgrC = cC.find((c) => c.description === 'Impuesto Provincial DGR');
    check('C: Municipal pagado completo 26660', muniC && r2(muniC.amount) === 26660, `got ${muniC?.amount}`);
    check('C: DGR pagado parcial 3340 (30000-26660)', dgrC && r2(dgrC.amount) === 3340, `got ${dgrC?.amount}`);
    check('C: sin alquiler (no alcanzó)', !cC.find((c) => c.type === 'ALQUILER'));
    check('C: suma conceptos == 30000', r2(sum(cC, (c) => c.amount)) === 30000, `got ${r2(sum(cC, (c) => c.amount))}`);

    // ===== BUG 2: pago de deuda con excedente genera a favor =====
    console.log('\n=== BUG 2: excedente en pago de deuda ===');
    // Mes 1 (enero) cerrado → deuda; mes 2 (febrero) PENDING para recibir el a favor.
    const debtRec = await makeRecord(ctx, { monthNumber: 1, periodMonth: 1, services: [{ conceptTypeId: ctx.muni.id, amount: 20000, label: 'Impuesto Municipal' }], rentAmount: 100000, status: 'PARTIAL' });
    const febRec = await makeRecord(ctx, { monthNumber: 2, periodMonth: 2, services: [], rentAmount: 100000, status: 'PENDING' });
    const debt = await prisma.debt.create({
      data: {
        groupId: ctx.group.id, contractId: ctx.contract.id, monthlyRecordId: debtRec.id,
        periodMonth: 1, periodYear: 2026, periodLabel: 'Enero 2026',
        originalAmount: 120000, unpaidRentAmount: 100000, unpaidServicesAmount: 20000,
        accumulatedPunitory: 0, currentTotal: 120000, amountPaid: 0,
        punitoryStartDate: new Date(2026, 0, 4), punitoryPercent: 0.006, status: 'OPEN',
      },
    });
    // punitory real al momento del pago
    const punPreview = await calculateDebtPunitory(debt, '2026-02-15', null, true);
    const realPun = r2(punPreview.amount);
    const debtTotal = r2(100000 + 20000 + realPun);
    const EXTRA = 35000;
    console.log(`   deuda: rent 100000 + serv 20000 + punitorios ${realPun} = ${debtTotal}; pago ${debtTotal + EXTRA} (excedente ${EXTRA})`);

    const { debt: paidDebt } = await payDebt(debt.id, debtTotal + EXTRA, '2026-02-15', 'EFECTIVO');
    check('D: deuda queda PAID', paidDebt.status === 'PAID', `status=${paidDebt.status}`);
    check('D: currentTotal == 0', r2(paidDebt.currentTotal) === 0, `currentTotal=${paidDebt.currentTotal}`);

    // El recálculo del MonthlyRecord es asíncrono (setImmediate(processDirtyRecords)).
    // Esperar a que procese la cola de dirty records antes de verificar la propagación.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 60; i++) {
      const j = await prisma.monthlyRecord.findUnique({ where: { id: debtRec.id }, select: { amountPaid: true } });
      if (r2(j.amountPaid) > 0) break;
      await sleep(100);
    }
    await sleep(200);

    const debtTx = await prisma.paymentTransaction.findFirst({ where: { monthlyRecordId: debtRec.id }, include: { concepts: true }, orderBy: { createdAt: 'desc' } });
    check('D: tx.punitoryAmount == punitorio REAL (no inflado por excedente)', r2(debtTx.punitoryAmount) === realPun, `got ${debtTx.punitoryAmount}, real ${realPun}`);
    const sobre = debtTx.concepts.find((c) => c.type === 'SOBREPAGO');
    check('D: existe concepto SOBREPAGO con el excedente', sobre && Math.abs(r2(sobre.amount) - EXTRA) <= 1, `got ${sobre?.amount}`);
    const punTxConcept = debtTx.concepts.find((c) => c.type === 'PUNITORIOS');
    check('D: concepto PUNITORIOS no inflado', !punTxConcept || r2(punTxConcept.amount) === realPun, `got ${punTxConcept?.amount}`);

    const allRecs = await prisma.monthlyRecord.findMany({ where: { contractId: ctx.contract.id }, orderBy: { monthNumber: 'asc' }, select: { monthNumber: true, periodMonth: true, rentAmount: true, servicesTotal: true, punitoryAmount: true, amountPaid: true, totalDue: true, previousBalance: true, balance: true, status: true } });
    console.log('   --- estado de records del contrato ---');
    for (const rr of allRecs) console.log(`   m${rr.monthNumber} (p${rr.periodMonth}): rent=${rr.rentAmount} serv=${rr.servicesTotal} pun=${rr.punitoryAmount} pagado=${rr.amountPaid} totalDue=${rr.totalDue} prevBal=${rr.previousBalance} bal=${rr.balance} ${rr.status}`);
    const febAfter = await prisma.monthlyRecord.findUnique({ where: { id: febRec.id } });
    check('D: febrero (mes siguiente) recibe el excedente como previousBalance (a favor)', Math.abs(r2(febAfter.previousBalance) - EXTRA) <= 1, `previousBalance=${febAfter.previousBalance}`);
  } finally {
    // cleanup completo (cascade por groupId)
    await prisma.debtPayment.deleteMany({ where: { debt: { groupId: ctx.group.id } } }).catch(() => {});
    await prisma.debt.deleteMany({ where: { groupId: ctx.group.id } }).catch(() => {});
    await prisma.group.delete({ where: { id: ctx.group.id } }).catch((e) => console.log('cleanup warn', e.message));
  }
  await prisma.$disconnect();
  console.log(failures === 0 ? '\n✅ TODO OK' : `\n❌ ${failures} FALLAS`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('ERROR', e); process.exit(1); });
