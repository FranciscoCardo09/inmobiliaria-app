/*
 * Verifica el override de período por contrato en la liquidación. DB local aislada (NO prod).
 * Uso: DATABASE_URL="postgresql://postgres:sim@localhost:55433/verifydb" node sim/verify-liquidacion-override.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getLiquidacionesAllContracts } = require('../src/services/reportDataService');

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`); if (!cond) failures++; };
const byContract = (arr, cid) => arr.find((d) => d.contractId === cid);

async function setup() {
  const group = await prisma.group.create({ data: { name: '__VLO__', slug: '__vlo__' + Date.now(), punitoryRate: 0.006 } });
  const owner = await prisma.owner.create({ data: { groupId: group.id, name: 'Dueño Test', dni: '20111111', phone: '0000', email: 'o@t.com' } });
  const tenant = await prisma.tenant.create({ data: { groupId: group.id, name: 'Inq Test', dni: '77777777' } });
  const mkContractProp = async (address, baseRent) => {
    const prop = await prisma.property.create({ data: { groupId: group.id, address, ownerId: owner.id } });
    const contract = await prisma.contract.create({ data: {
      groupId: group.id, propertyId: prop.id, tenantId: tenant.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 0, 1), startMonth: 1, currentMonth: 1, durationMonths: 24, baseRent,
      punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006, active: true } });
    return { prop, contract };
  };
  const A = await mkContractProp('AAA Calle 1', 100000);
  const B = await mkContractProp('BBB Calle 2', 200000);
  const mkRec = (contract, monthNumber, periodMonth, rentAmount) => prisma.monthlyRecord.create({ data: {
    groupId: group.id, contractId: contract.id, monthNumber, periodMonth, periodYear: 2026,
    rentAmount, servicesTotal: 0, totalDue: rentAmount, amountPaid: rentAmount, balance: 0,
    status: 'COMPLETE', isPaid: true, isCancelled: true } });
  // Junio (global) y Mayo (override) para ambos, con rent distinto por mes para distinguir
  await mkRec(A.contract, 6, 6, 100000); await mkRec(A.contract, 5, 5, 90000);
  await mkRec(B.contract, 6, 6, 200000); await mkRec(B.contract, 5, 5, 180000);
  return { group, A: A.contract, B: B.contract };
}

async function run() {
  const ctx = await setup();
  const gid = ctx.group.id;
  const opts = { soloConPago: false, includePlaceholders: true };
  try {
    // 1) Sin overrides → ambos en junio
    console.log('\n=== 1) sin override (global junio) ===');
    const r1 = await getLiquidacionesAllContracts(gid, 6, 2026, null, opts, null, [ctx.A.id, ctx.B.id]);
    check('1: 2 contratos', r1.length === 2, `len=${r1.length}`);
    check('1: A en junio rent 100000', byContract(r1, ctx.A.id)?.periodo.mes === 6 && byContract(r1, ctx.A.id)?.rentAmount === 100000);
    check('1: B en junio rent 200000', byContract(r1, ctx.B.id)?.periodo.mes === 6 && byContract(r1, ctx.B.id)?.rentAmount === 200000);

    // 2) Override B → mayo. A queda en junio, B trae mayo. Sin duplicados.
    console.log('\n=== 2) override B → mayo ===');
    const r2 = await getLiquidacionesAllContracts(gid, 6, 2026, null, { ...opts, periodOverrides: { [ctx.B.id]: { month: 5, year: 2026 } } }, null, [ctx.A.id, ctx.B.id]);
    check('2: 2 contratos (sin duplicados)', r2.length === 2, `len=${r2.length}`);
    check('2: A sigue en junio (100000)', byContract(r2, ctx.A.id)?.periodo.mes === 6 && byContract(r2, ctx.A.id)?.rentAmount === 100000);
    check('2: B trae MAYO (rent 180000, periodo.mes=5)', byContract(r2, ctx.B.id)?.periodo.mes === 5 && byContract(r2, ctx.B.id)?.rentAmount === 180000, `mes=${byContract(r2, ctx.B.id)?.periodo.mes} rent=${byContract(r2, ctx.B.id)?.rentAmount}`);
    const bCount = r2.filter((d) => d.contractId === ctx.B.id).length;
    check('2: B aparece UNA sola vez', bCount === 1, `bCount=${bCount}`);

    // 3) Override A → marzo (sin registro) + placeholders → A noData
    console.log('\n=== 3) override A → marzo (sin datos) ===');
    const r3 = await getLiquidacionesAllContracts(gid, 6, 2026, null, { ...opts, periodOverrides: { [ctx.A.id]: { month: 3, year: 2026 } } }, null, [ctx.A.id, ctx.B.id]);
    const a3 = byContract(r3, ctx.A.id);
    check('3: A devuelve placeholder noData', !!a3?.noData, `noData=${a3?.noData}`);
    check('3: A placeholder con período marzo', a3?.periodo.mes === 3 && a3?.periodo.anio === 2026, `label=${a3?.periodo.label}`);
    check('3: B sigue en junio', byContract(r3, ctx.B.id)?.periodo.mes === 6);

    // 4) Igual que (3) pero SIN includePlaceholders (camino de descarga) → A no aparece
    console.log('\n=== 4) override A → marzo, sin placeholders (descarga) ===');
    const r4 = await getLiquidacionesAllContracts(gid, 6, 2026, null, { soloConPago: false, periodOverrides: { [ctx.A.id]: { month: 3, year: 2026 } } }, null, [ctx.A.id, ctx.B.id]);
    check('4: solo B (A omitido, sin placeholder)', r4.length === 1 && r4[0].contractId === ctx.B.id, `len=${r4.length}`);

    // 5) Override cruzando año (B → diciembre 2025, sin registro) → placeholder con anio 2025
    console.log('\n=== 5) override B → diciembre 2025 (cruce de año) ===');
    const r5 = await getLiquidacionesAllContracts(gid, 6, 2026, null, { ...opts, periodOverrides: { [ctx.B.id]: { month: 12, year: 2025 } } }, null, [ctx.A.id, ctx.B.id]);
    const b5 = byContract(r5, ctx.B.id);
    check('5: B placeholder dic-2025', !!b5?.noData && b5?.periodo.mes === 12 && b5?.periodo.anio === 2025, `label=${b5?.periodo.label}`);
  } finally {
    await prisma.group.delete({ where: { id: gid } }).catch((e) => console.log('cleanup warn', e.message));
  }
  await prisma.$disconnect();
  console.log(failures === 0 ? '\n✅ TODOS LOS ASSERTS OK' : `\n❌ ${failures} FALLAS`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('ERROR', e); process.exit(1); });
