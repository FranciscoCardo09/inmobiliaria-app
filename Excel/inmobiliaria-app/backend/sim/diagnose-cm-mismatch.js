/*
 * Diagnóstico: por qué "Control Mensual total ≈ suma totalDue" falla en full-coverage.js
 * para Ene-Abr 2026. Traza, registro por registro, de dónde viene la diferencia entre
 * data.totales.total (reporte) y la suma de MonthlyRecord.totalDue (congelado).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const reportSvc = require('../src/services/reportDataService');
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n) => Number(n).toLocaleString('es-AR');

async function main() {
  // Mismo "hoy" que usó full-coverage.js en su verificación (requiere -r ./sim/clock.js).
  global.__setNow(2026, 6, 22);

  for (const [y, m] of [[2026, 1], [2026, 2], [2026, 3], [2026, 4]]) {
    const data = await reportSvc.getControlMensualData('sim-group', m, y);
    const recs = await prisma.monthlyRecord.findMany({
      where: { groupId: 'sim-group', periodMonth: m, periodYear: y },
      include: { debt: true, contract: { select: { id: true } } },
    });
    const sumDue = r2(recs.reduce((a, r) => a + (r.totalDue || 0), 0));
    console.log(`\n=== ${m}/${y} === reporte.total=${fmt(data.totales.total)} sum(totalDue)=${fmt(sumDue)} diff=${fmt(r2(data.totales.total - sumDue))}`);

    // Reconstruir, por registro, si tenía deuda abierta (dispara total EN VIVO en vez de totalDue).
    const debtSvc = require('../src/services/debtService');
    let sumDiffFromOpenDebts = 0;
    let rowsWithOpenDebt = 0;
    for (const r of recs) {
      if (r.debt && r.debt.status !== 'PAID') {
        rowsWithOpenDebt++;
        const live = await debtSvc.computeLiveDebtTotal(r.debt, '2026-06-22', null);
        const liveTotalOut = r2(r.rentAmount + r.servicesTotal + (r.includeIva ? r.ivaAmount : 0) + (live.liveAccumulatedPunitory || 0) - r.previousBalance);
        const rowDiff = r2(liveTotalOut - r.totalDue);
        sumDiffFromOpenDebts += rowDiff;
      }
    }
    console.log(`  registros con deuda OPEN/PARTIAL: ${rowsWithOpenDebt} | suma(diferencia por deuda viva vs totalDue congelado) = ${fmt(r2(sumDiffFromOpenDebts))}`);
    console.log(`  ¿explica toda la diferencia?  ${Math.abs(r2(sumDiffFromOpenDebts) - r2(data.totales.total - sumDue)) <= 5 ? 'SÍ' : 'NO — queda un resto sin explicar'}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
