/*
 * Backfill: sincroniza los servicios impagos de deudas OPEN/PARTIAL con los
 * servicios realmente cargados en su MonthlyRecord. Corrige deudas creadas antes
 * del fix (servicios agregados al mes que nunca se sumaron a la deuda).
 *
 * Dry-run (default):  node sim/backfill-debt-services.js
 * Aplicar cambios:    node sim/backfill-debt-services.js --apply
 *
 * DATABASE_URL decide la base (local o prod).
 */
const prisma = require('../src/lib/prisma');
const { syncDebtServicesFromRecord } = require('../src/services/debtService');

const APPLY = process.argv.includes('--apply');
const f = (n) => Math.round((n || 0) * 100) / 100;

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en la base)' : 'DRY-RUN (solo muestra)'}\n`);

  const debts = await prisma.debt.findMany({
    where: { status: { in: ['OPEN', 'PARTIAL'] } },
    select: {
      id: true, monthlyRecordId: true, periodLabel: true,
      unpaidRentAmount: true, unpaidServicesAmount: true, currentTotal: true,
      contract: { select: { property: { select: { address: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  let planned = 0;
  for (const d of debts) {
    if (!d.monthlyRecordId) continue;

    if (APPLY) {
      const updated = await syncDebtServicesFromRecord(d.monthlyRecordId);
      if (updated && f(updated.unpaidServicesAmount) !== f(d.unpaidServicesAmount)) {
        planned++;
        console.log(`[APLICADO] ${d.contract?.property?.address || '?'} | ${d.periodLabel}`);
        console.log(`   unpaidServices: ${f(d.unpaidServicesAmount)} -> ${f(updated.unpaidServicesAmount)} | currentTotal: ${f(d.currentTotal)} -> ${f(updated.currentTotal)}`);
      }
    } else {
      // Dry-run: replicar el cálculo de syncDebtServicesFromRecord sin escribir
      const record = await prisma.monthlyRecord.findUnique({
        where: { id: d.monthlyRecordId },
        select: {
          rentAmount: true, includeIva: true, amountPaid: true, punitoryAmount: true, previousBalance: true,
          services: { select: { amount: true, conceptType: { select: { category: true } } } },
        },
      });
      if (!record) continue;
      let servicesTotal = 0;
      for (const s of record.services) {
        if (s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION') servicesTotal -= Math.abs(s.amount);
        else servicesTotal += s.amount;
      }
      const ivaAmount = record.includeIva ? f(record.rentAmount * 0.21) : 0;
      const { calculateImputation } = require('../src/services/debtService');
      const { unpaidServices } = calculateImputation({
        rentAmount: record.rentAmount,
        servicesTotal,
        ivaAmount,
        punitoryAmount: record.punitoryAmount || 0,
        amountPaid: record.amountPaid || 0,
        previousBalance: Math.max(record.previousBalance || 0, 0),
      });
      if (f(unpaidServices) !== f(d.unpaidServicesAmount)) {
        planned++;
        console.log(`[CAMBIARÍA] ${d.contract?.property?.address || '?'} | ${d.periodLabel}`);
        console.log(`   unpaidServices: ${f(d.unpaidServicesAmount)} -> ${f(unpaidServices)} (delta ${f(unpaidServices - d.unpaidServicesAmount)})`);
      }
    }
  }

  console.log(`\nDeudas ${APPLY ? 'modificadas' : 'a modificar'}: ${planned} de ${debts.length} abiertas/parciales`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
