// Corrección puntual: Russo Carlos, deuda Mayo 2026 (PARTIAL con un pago de 50.000).
// Con la lógica vieja el saldo a favor (34.957) redujo la base de servicios. Para aplicar
// la regla nueva (base completa + crédito al total) hay que: anular el pago → borrar y
// recrear la deuda con la lógica nueva → re-aplicar el pago de 50.000.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const debtSvc = require('../src/services/debtService');
const mrSvc = require('../src/services/monthlyRecordService');
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }));
const DRY = process.argv.includes('--dry-run');

async function snap(tag, contractId) {
  const d = await prisma.debt.findFirst({ where: { contractId, periodMonth: 5, periodYear: 2026 }, include: { payments: { orderBy: { createdAt: 'asc' } } } });
  if (!d) { console.log(`\n----- ${tag} -----\n(sin deuda Mayo)`); return null; }
  const cur = await debtSvc.calculateDebtPunitory(d, '2026-06-22', null, true);
  console.log(`\n----- ${tag} -----`);
  console.log(`DEUDA Mayo ${d.status}: unpaidRent=${fmt(d.unpaidRentAmount)} unpaidServ=${fmt(d.unpaidServicesAmount)} accumPunit=${fmt(d.accumulatedPunitory)} appliedCredit=${fmt(d.appliedCredit)} amountPaid=${fmt(d.amountPaid)} currentTotal=${fmt(d.currentTotal)}`);
  console.log(`  punitorio en vivo (calc): base=${fmt((d.unpaidRentAmount + d.unpaidServicesAmount) - d.amountPaid)} punit=${fmt(cur.amount)} (${cur.days}d) remainingNeto=${fmt(cur.remainingDebt)}`);
  d.payments.forEach((p) => console.log(`  pago ${fmt(p.amount)} @${p.paymentDate.toISOString().slice(0, 10)}`));
  return d;
}

(async () => {
  const t = await prisma.tenant.findFirst({ where: { name: { contains: 'Russo Carlos', mode: 'insensitive' } }, select: { id: true } });
  const c = await prisma.contract.findFirst({ where: { tenantId: t.id }, select: { id: true, groupId: true } });

  const d0 = await snap('ANTES', c.id);
  if (DRY || !d0) { console.log('\n[DRY-RUN/sin deuda] sin cambios.'); await prisma.$disconnect(); return; }

  const recordId = d0.monthlyRecordId;
  const pay = d0.payments[d0.payments.length - 1]; // LIFO

  // 1) anular el pago (borra el PaymentTransaction del record y revierte la deuda)
  await debtSvc.cancelDebtPayment(d0.id, pay.id);
  await mrSvc.recalculateMultipleRecords([recordId], null, true);
  console.log(`\nanulado pago ${fmt(pay.amount)}`);

  // 2) borrar la deuda (quedó OPEN con datos viejos) y recrear con la lógica nueva
  await prisma.debt.deleteMany({ where: { monthlyRecordId: recordId } });
  const record = await prisma.monthlyRecord.findUnique({
    where: { id: recordId },
    include: { transactions: { orderBy: { paymentDate: 'asc' } }, services: { include: { conceptType: { select: { category: true } } } } },
  });
  const contract = await prisma.contract.findUnique({ where: { id: c.id } });
  const recreated = await debtSvc.createDebtFromMonthlyRecord(record, contract);
  console.log(`recreada: unpaidRent=${fmt(recreated.unpaidRentAmount)} unpaidServ=${fmt(recreated.unpaidServicesAmount)} appliedCredit=${fmt(recreated.appliedCredit)} accumPunit=${fmt(recreated.accumulatedPunitory)}`);

  // 3) re-aplicar el pago de 50.000 en su fecha original
  await debtSvc.payDebt(recreated.id, pay.amount, pay.paymentDate.toISOString().slice(0, 10), pay.paymentMethod || 'EFECTIVO', 'Re-aplicado tras corrección de base de punitorios');
  await mrSvc.recalculateMultipleRecords([recordId], null, true);
  await new Promise((r) => setTimeout(r, 50));
  await mrSvc.processDirtyRecords();

  await snap('DESPUÉS', c.id);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
