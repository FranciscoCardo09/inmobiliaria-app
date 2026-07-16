/* Smoke test final: recorre los endpoints/servicios clave contra la DB local poblada. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const GID = 'sim-group';

async function main() {
  const reportSvc = require('../src/services/reportDataService');
  const adjustmentSvc = require('../src/services/adjustmentService');
  const monthlyRecordSvc = require('../src/services/monthlyRecordService');

  const contracts = await prisma.contract.count({ where: { groupId: GID } });
  const owners = await prisma.owner.count({ where: { groupId: GID } });
  const properties = await prisma.property.count({ where: { groupId: GID } });
  const tenants = await prisma.tenant.count({ where: { groupId: GID } });
  const monthlyRecords = await prisma.monthlyRecord.count({ where: { groupId: GID } });
  const transactions = await prisma.paymentTransaction.count({ where: { groupId: GID } });
  const debts = await prisma.debt.count({ where: { groupId: GID } });
  console.log('=== Conteos ===');
  console.log({ contracts, owners, properties, tenants, monthlyRecords, transactions, debts });

  console.log('\n=== Liquidación General (todos los contratos, Abril 2026) ===');
  const liq = await reportSvc.getLiquidacionesAllContracts(GID, 4, 2026, null, { soloConPago: false, includePlaceholders: true }, null, null);
  console.log('filas:', liq.length);
  const grand = reportSvc.computeGrandTotals(liq);
  console.log('grandTotal:', grand.grandTotal);

  console.log('\n=== Control Mensual (Abril 2026) ===');
  const cm = await reportSvc.getControlMensualData(GID, 4, 2026);
  console.log('registros:', cm.registros.length, 'total:', cm.totales.total);

  console.log('\n=== Ajustes (Julio 2026 — debería incluir C23 pendiente) ===');
  const ajustes = await reportSvc.getAjustesMesData(GID, 7, 2026);
  console.log(ajustes.ajustes.map((a) => ({ propiedad: a.propiedad, aplicado: a.aplicado, pct: a.porcentajeAjuste })));

  console.log('\n=== getContractsWithAdjustmentInCalendar directo (Julio 2026) ===');
  const due = await adjustmentSvc.getContractsWithAdjustmentInCalendar(GID, 7, 2026);
  console.log('contratos con ajuste vigente en Julio:', due.length, due.map(c => c.property?.address));

  console.log('\n=== Impuestos (propietarios, Abril 2026) ===');
  const imp = await reportSvc.getImpuestosData(GID, 4, 2026, null, null, null);
  console.log('filas impuestos:', imp.impuestos.length, 'grandTotal:', imp.grandTotal);

  console.log('\n=== Renovación: contrato viejo sigue visible en Estado de Cuentas ===');
  const oldC = await prisma.contract.findFirst({ where: { groupId: GID, renewedAt: { not: null } } });
  const ec = await reportSvc.getEstadoCuentasData(GID, oldC.id);
  console.log('viejo:', oldC.id, 'historial meses:', ec.historial.length, 'totalPagado:', ec.resumen.totalPagado);

  console.log('\n=== Rescisión: contrato rescindido, generar registro de multa (Junio 2026) on-demand ===');
  const rescC = await prisma.contract.findFirst({ where: { groupId: GID, rescindedAt: { not: null } } });
  await monthlyRecordSvc.getOrCreateMonthlyRecords(GID, 6, 2026);
  const penaltyRec = await prisma.monthlyRecord.findFirst({ where: { contractId: rescC.id, periodMonth: 6, periodYear: 2026 } });
  console.log('rescindido:', rescC.id, 'registro multa Junio:', penaltyRec ? { rentAmount: penaltyRec.rentAmount, totalDue: penaltyRec.totalDue } : 'NO GENERADO');

  console.log('\n=== PROPIETARIO: Liquidación individual C26 ===');
  const propC = await prisma.contract.findFirst({ where: { groupId: GID, contractType: 'PROPIETARIO' } });
  const liqProp = await reportSvc.getLiquidacionData(GID, propC.id, 3, 2026, {});
  console.log('propietario:', liqProp?.inquilino?.nombre, 'total:', liqProp?.total, 'esPropietario:', liqProp?.inquilino?.esPropietario);

  console.log('\n✅ Smoke check completo sin excepciones.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ ERROR:', e);
  await prisma.$disconnect();
  process.exit(1);
});
