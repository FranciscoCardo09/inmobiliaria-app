/*
 * Repair de "meses fantasma" (monthNumber fuera de rango).
 *   DRY-RUN:  node sim/repair.js
 *   APLICAR:  APPLY=1 node sim/repair.js
 *
 * - Borra records fuera de rango SIN plata (Problema B + A-$0).
 * - Corrige monthNumber desfasados que SÍ están en rango.
 * - PRESERVA y reporta los records con pagos fuera de rango (Problema A) para
 *   reconciliación manual; nunca mueve dinero.
 *
 * Apunta a la base de DATABASE_URL (usar la copia LOCAL para probar).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { repairContractRecordMonthNumbers } = require('../src/services/monthlyRecordService');
const APPLY = process.env.APPLY === '1';
const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('es-AR');

(async () => {
  console.log(`MODO: ${APPLY ? 'APLICAR (escribe)' : 'DRY-RUN (no escribe)'}`);
  const contracts = await prisma.contract.findMany({
    select: { id: true, startDate: true, startMonth: true, durationMonths: true, rescindedAt: true,
      property: { select: { address: true } } },
  });

  let totalDeleted = 0, totalUpdated = 0;
  const allPaidOrphans = [];

  for (const c of contracts) {
    // En dry-run usamos deletePhantoms:false y simulamos el conteo; en apply borramos de verdad.
    if (APPLY) {
      const r = await repairContractRecordMonthNumbers(c, { deletePhantoms: true });
      totalDeleted += r.deleted; totalUpdated += r.updated;
      r.paidOrphans.forEach((o) => allPaidOrphans.push({ ...o, address: c.property?.address }));
    } else {
      // Dry-run: inspeccionar sin tocar
      const endMonth = c.startMonth + c.durationMonths - 1;
      const recs = await prisma.monthlyRecord.findMany({
        where: { contractId: c.id },
        select: { id: true, periodMonth: true, periodYear: true, monthNumber: true, amountPaid: true,
          debt: { select: { id: true } }, _count: { select: { transactions: true } } },
      });
      const { getMonthNumber } = require('../src/services/monthlyRecordService');
      for (const rec of recs) {
        const target = getMonthNumber(c, rec.periodMonth, rec.periodYear);
        const inRange = target >= c.startMonth && target <= endMonth;
        const hasMoney = (rec.amountPaid || 0) > 0 || !!rec.debt || (rec._count?.transactions || 0) > 0;
        if (inRange) { if (rec.monthNumber !== target) totalUpdated++; }
        else if (hasMoney) allPaidOrphans.push({ id: rec.id, periodMonth: rec.periodMonth, periodYear: rec.periodYear, monthNumber: rec.monthNumber, amountPaid: rec.amountPaid || 0, address: c.property?.address });
        else totalDeleted++;
      }
    }
  }

  console.log(`\nRecords fantasma ${APPLY ? 'BORRADOS' : 'a borrar'} (fuera de rango, sin plata): ${totalDeleted}`);
  console.log(`monthNumber ${APPLY ? 'CORREGIDOS' : 'a corregir'} (en rango, desfasados): ${totalUpdated}`);
  console.log(`\nMeses con PAGOS fuera de rango (Problema A — PRESERVADOS, requieren reconciliación manual): ${allPaidOrphans.length}`);
  const totalPaid = allPaidOrphans.reduce((s, o) => s + o.amountPaid, 0);
  console.log(`Total pagado atrapado: ${fmt(totalPaid)}`);
  for (const o of allPaidOrphans.sort((a, b) => b.amountPaid - a.amountPaid)) {
    console.log(`  - ${o.address || '?'}  ${o.periodYear}-${String(o.periodMonth).padStart(2, '0')} (mN=${o.monthNumber})  pagado=${fmt(o.amountPaid)}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
