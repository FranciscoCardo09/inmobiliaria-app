// Corrección puntual: Ponce Emilia Roxana, deuda Marzo 2026.
// El pago real fue UN único pago de 997.000 (no 977.000), y el 2º pago de 63.345
// fue artefacto del bug de punitorios. Se anulan ambos pagos y se re-registra el
// pago único de 997.000 con la lógica ya corregida → deuda saldada + saldo a favor.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const debtSvc = require('../src/services/debtService');
const mrSvc = require('../src/services/monthlyRecordService');
const fmt = (n) => (n == null ? 'null' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }));
const DRY = process.argv.includes('--dry-run');

async function snapshot(tag, debtId, recId, aprRecId) {
  const d = await prisma.debt.findUnique({ where: { id: debtId }, include: { payments: { orderBy: { createdAt: 'asc' } } } });
  const r = await prisma.monthlyRecord.findUnique({ where: { id: recId }, include: { transactions: { include: { concepts: true } } } });
  const apr = aprRecId ? await prisma.monthlyRecord.findUnique({ where: { id: aprRecId } }) : null;
  console.log(`\n----- ${tag} -----`);
  console.log(`DEUDA Marzo: status=${d.status} amountPaid=${fmt(d.amountPaid)} accumPunit=${fmt(d.accumulatedPunitory)} currentTotal=${fmt(d.currentTotal)}`);
  d.payments.forEach((p) => console.log(`   pago ${fmt(p.amount)} @${p.paymentDate.toISOString().slice(0, 10)} punitAtPay=${fmt(p.punitoryAtPayment)}`));
  console.log(`REC Marzo: rent=${fmt(r.rentAmount)} totalDue=${fmt(r.totalDue)} paid=${fmt(r.amountPaid)} balance=${fmt(r.balance)} status=${r.status}`);
  r.transactions.forEach((t) => console.log(`   tx ${fmt(t.amount)} [${t.concepts.map((c) => c.type + ':' + fmt(c.amount)).join(', ')}]`));
  if (apr) console.log(`REC Abril: prevBalance=${fmt(apr.previousBalance)} totalDue=${fmt(apr.totalDue)} balance=${fmt(apr.balance)} status=${apr.status}`);
}

(async () => {
  const t = await prisma.tenant.findFirst({ where: { name: { contains: 'Ponce Emilia', mode: 'insensitive' } }, select: { id: true, name: true } });
  const rec = await prisma.monthlyRecord.findFirst({ where: { contract: { tenantId: t.id }, periodMonth: 3, periodYear: 2026 }, select: { id: true } });
  const apr = await prisma.monthlyRecord.findFirst({ where: { contract: { tenantId: t.id }, periodMonth: 4, periodYear: 2026 }, select: { id: true } });
  const debt = await prisma.debt.findFirst({ where: { monthlyRecordId: rec.id }, include: { payments: { orderBy: { createdAt: 'asc' } } } });
  console.log(`Inquilino: ${t.name} | deuda Marzo ${debt.id}`);

  await snapshot('ANTES', debt.id, rec.id, apr.id);

  if (DRY) { console.log('\n[DRY-RUN] no se aplica nada.'); await prisma.$disconnect(); return; }

  // 1) anular pagos en orden inverso (LIFO)
  const paysDesc = [...debt.payments].sort((a, b) => b.createdAt - a.createdAt);
  for (const p of paysDesc) {
    await debtSvc.cancelDebtPayment(debt.id, p.id);
    console.log(`anulado pago ${fmt(p.amount)}`);
  }
  await mrSvc.recalculateMultipleRecords([rec.id], null, true);

  // 2) re-registrar el pago único corregido de 997.000 el 09/05/2026
  await debtSvc.payDebt(debt.id, 997000, '2026-05-09', 'EFECTIVO', 'Pago corregido: pago único de 997.000 (09/05)');
  await mrSvc.recalculateMultipleRecords([rec.id], null, true);
  await new Promise((r) => setTimeout(r, 50));
  await mrSvc.processDirtyRecords();

  await snapshot('DESPUÉS', debt.id, rec.id, apr.id);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
