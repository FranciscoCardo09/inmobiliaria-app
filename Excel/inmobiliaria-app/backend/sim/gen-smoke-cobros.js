/*
 * Smoke test: genera PDF/DOCX/Excel/HTML de liquidacion-all con el nuevo bloque
 * "cobrado de deudas anteriores" + total combinado. DB local aislada (NO prod).
 * Uso: DATABASE_URL="postgresql://postgres:sim@localhost:55432/simdb" node sim/gen-smoke-cobros.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getLiquidacionesAllContracts } = require('../src/services/reportDataService');
const { generateLiquidacionAllPDF } = require('../src/services/pdfTemplates');
const { generateLiquidacionAllDOCX } = require('../src/services/docxTemplates');
const { generateLiquidacionExcel } = require('../src/services/excelTemplates');
const { generateLiquidacionAllHTML } = require('../src/services/htmlTemplates');

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`); if (!cond) failures++; };

async function setup() {
  const group = await prisma.group.create({ data: { name: '__GSC__', slug: '__gsc__' + Date.now(), punitoryRate: 0.006 } });
  const owner = await prisma.owner.create({ data: { groupId: group.id, name: 'Dueño', dni: '20111111', phone: '0', email: 'o@t.com' } });
  const tenant = await prisma.tenant.create({ data: { groupId: group.id, name: 'Inq', dni: '777' } });
  const prop = await prisma.property.create({ data: { groupId: group.id, address: 'Calle 1', ownerId: owner.id } });
  const contract = await prisma.contract.create({ data: {
    groupId: group.id, propertyId: prop.id, tenantId: tenant.id, contractType: 'INQUILINO',
    startDate: new Date(2026, 0, 1), startMonth: 1, currentMonth: 3, durationMonths: 24, baseRent: 50000,
    punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006, active: true } });
  const feb = await prisma.monthlyRecord.create({ data: {
    groupId: group.id, contractId: contract.id, monthNumber: 2, periodMonth: 2, periodYear: 2026,
    rentAmount: 50000, servicesTotal: 0, totalDue: 50000, amountPaid: 0, balance: -50000, status: 'PENDING' } });
  await prisma.monthlyRecord.create({ data: {
    groupId: group.id, contractId: contract.id, monthNumber: 3, periodMonth: 3, periodYear: 2026,
    rentAmount: 50000, servicesTotal: 0, totalDue: 50000, amountPaid: 0, balance: -50000, status: 'PENDING' } });
  await prisma.debt.create({ data: {
    groupId: group.id, contractId: contract.id, monthlyRecordId: feb.id, periodLabel: 'Febrero 2026',
    periodMonth: 2, periodYear: 2026, originalAmount: 50000, unpaidRentAmount: 50000, accumulatedPunitory: 3000,
    currentTotal: 53000, amountPaid: 0, punitoryPercent: 0.006, punitoryStartDate: new Date(2026, 1, 10), status: 'OPEN' } });
  await prisma.paymentTransaction.create({ data: {
    groupId: group.id, monthlyRecordId: feb.id, paymentDate: new Date(2026, 2, 15, 12, 0, 0), amount: 20000, paymentMethod: 'EFECTIVO',
    concepts: { create: [{ type: 'ALQUILER_DEUDA', amount: 20000 }] } } });
  return { group, contract };
}

async function run() {
  const ctx = await setup();
  try {
    const data = await getLiquidacionesAllContracts(ctx.group.id, 3, 2026, null, { soloConPago: false }, null, [ctx.contract.id]);
    check('hay datos', data.length === 1);
    check('tiene cobradoOtrosPeriodos', data[0].cobradoOtrosPeriodos?.total === 20000, `t=${data[0].cobradoOtrosPeriodos?.total}`);
    check('tiene totalSinAbonar', data[0].totalSinAbonar > 0, `=${data[0].totalSinAbonar}`);

    const pdf = await generateLiquidacionAllPDF(data);
    check('PDF buffer > 1KB', pdf && pdf.length > 1000, `len=${pdf?.length}`);
    const docx = await generateLiquidacionAllDOCX(data);
    check('DOCX buffer > 1KB', docx && docx.length > 1000, `len=${docx?.length}`);
    const xlsx = await generateLiquidacionExcel(data);
    check('XLSX buffer > 1KB', xlsx && xlsx.length > 1000, `len=${xlsx?.length}`);
    const html = generateLiquidacionAllHTML(data);
    check('HTML contiene bloque cobrados', html.includes('Cobrado de deudas anteriores'), '');
    check('HTML contiene total sin abonar', html.includes('TOTAL SIN ABONAR'), '');
  } finally {
    await prisma.group.delete({ where: { id: ctx.group.id } }).catch((e) => console.log('cleanup warn', e.message));
  }
  await prisma.$disconnect();
  console.log(failures === 0 ? '\n✅ GENERADORES OK' : `\n❌ ${failures} FALLAS`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('ERROR', e); process.exit(1); });
