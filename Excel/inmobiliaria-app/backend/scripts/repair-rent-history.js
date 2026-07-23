// Reparación de datos: alquileres históricos pisados por ajustes (caso Rezzonico
// y, en general, cualquier contrato al que le falta la fila INICIAL de historial).
// DRY RUN por defecto. Ejecutar con APPLY=1 para aplicar.
const APPLY = process.env.APPLY === '1';
const base = require('path').join(__dirname, '..');
const { PrismaClient } = require(base + '/node_modules/@prisma/client');
const prisma = new PrismaClient();

const REZZONICO = 'ff160be0-b8a7-4568-b54d-a137031e80a5';

function expectedRent(histories, monthNumber, baseRent) {
  // histories: orden effFrom desc, createdAt desc (misma lógica que el fix del código)
  for (const h of histories) {
    if (h.effectiveFromMonth <= monthNumber) return h.rentAmount;
  }
  if (histories.length > 0) return histories[histories.length - 1].rentAmount;
  return baseRent;
}

async function main() {
  console.log(APPLY ? '*** MODO APPLY ***' : '*** DRY RUN (sin cambios) ***');

  // ---- 1. Rezzonico: arreglar el historial (caso puntual conocido) ----
  const rez = await prisma.rentHistory.findMany({
    where: { contractId: REZZONICO },
    orderBy: [{ effectiveFromMonth: 'asc' }, { createdAt: 'asc' }],
  });
  console.log('\n[1] Historial Rezzonico actual:');
  rez.forEach(h => console.log(`   effFrom=${h.effectiveFromMonth} $${h.rentAmount} ${h.reason} (${h.createdAt.toISOString().slice(0,10)}) id=${h.id}`));

  const orphan36 = rez.find(h => h.effectiveFromMonth === 36);
  const manualDup4 = rez.find(h => h.effectiveFromMonth === 4 && h.reason === 'AJUSTE_MANUAL');
  if (orphan36) {
    console.log(`   → remapear effFrom=36 ($${orphan36.rentAmount}) a effFrom=1 reason=INICIAL`);
    if (APPLY) await prisma.rentHistory.update({ where: { id: orphan36.id }, data: { effectiveFromMonth: 1, reason: 'INICIAL' } });
  }
  if (manualDup4) {
    console.log(`   → borrar duplicado AJUSTE_MANUAL effFrom=4 ($${manualDup4.rentAmount}) (el AUTOMATICO de $278304 es el vigente)`);
    if (APPLY) await prisma.rentHistory.delete({ where: { id: manualDup4.id } });
  }

  // ---- 2. Scan global: contratos con meses sin cobertura de historial ----
  const contracts = await prisma.contract.findMany({
    select: {
      id: true, active: true, startMonth: true, durationMonths: true, baseRent: true,
      tenant: { select: { name: true } },
      property: { select: { address: true } },
    },
  });
  const allHist = await prisma.rentHistory.findMany({
    orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
  });
  const histByContract = new Map();
  for (const h of allHist) {
    if (!histByContract.has(h.contractId)) histByContract.set(h.contractId, []);
    histByContract.get(h.contractId).push(h);
  }

  console.log('\n[2] Contratos con meses NO cubiertos por historial (candidatos al bug):');
  const missingBaseline = []; // { contract, oldestAjuste, alquilerOriginal }
  const manualDecisionNeeded = []; // no se puede derivar el % (sin AJUSTE_AUTOMATICO previo)
  for (const c of contracts) {
    const hs = histByContract.get(c.id) || [];
    if (hs.length === 0) continue; // sin historial: nada que comparar (otro caso, no este script)
    const minEff = Math.min(...hs.map(h => h.effectiveFromMonth));
    if (minEff > c.startMonth) {
      console.log(`   ${c.tenant?.name || 's/inquilino'} | ${c.property?.address} | active=${c.active} startMonth=${c.startMonth} minHist=${minEff} id=${c.id}`);

      // Fila de ajuste automático más antigua con % conocido: de ahí derivamos el
      // alquiler original (INICIAL) que falta.
      const ajustesAsc = hs
        .filter(h => h.reason === 'AJUSTE_AUTOMATICO' && h.effectiveFromMonth === minEff && h.adjustmentPercent)
        .sort((a, b) => a.createdAt - b.createdAt);
      const oldestAjuste = ajustesAsc[0];
      if (oldestAjuste) {
        const alquilerOriginal = Math.round(oldestAjuste.rentAmount / (1 + oldestAjuste.adjustmentPercent / 100));
        missingBaseline.push({ contract: c, oldestAjuste, alquilerOriginal });
        console.log(`      → crear INICIAL effFrom=${c.startMonth} $${alquilerOriginal} (derivado de $${oldestAjuste.rentAmount} / (1+${oldestAjuste.adjustmentPercent}%))`);
      } else {
        manualDecisionNeeded.push(c);
        console.log(`      → NO se puede derivar el % (fila más antigua sin adjustmentPercent); requiere decisión manual`);
      }
    }
  }
  if (missingBaseline.length === 0 && manualDecisionNeeded.length === 0) {
    console.log('   (ninguno)');
  }

  // ---- 3. Crear las filas INICIAL faltantes ----
  if (missingBaseline.length > 0) {
    console.log(`\n[3] ${APPLY ? 'Creando' : 'Se crearían'} ${missingBaseline.length} filas INICIAL faltantes:`);
    for (const { contract: c, alquilerOriginal } of missingBaseline) {
      console.log(`   ${c.tenant?.name || '?'} | ${c.property?.address} | effFrom=${c.startMonth} $${alquilerOriginal}`);
      if (APPLY) {
        await prisma.rentHistory.create({
          data: {
            contractId: c.id,
            effectiveFromMonth: c.startMonth,
            rentAmount: alquilerOriginal,
            adjustmentPercent: null,
            reason: 'INICIAL',
          },
        });
      }
    }
  }
  if (manualDecisionNeeded.length > 0) {
    console.log(`\n[3b] Contratos que requieren decisión manual (no automatizados por este script):`);
    manualDecisionNeeded.forEach(c => console.log(`   ${c.tenant?.name || '?'} | ${c.property?.address} | id=${c.id}`));
  }

  // ---- 4. Registros mensuales con rentAmount distinto al histórico esperado ----
  console.log('\n[4] MonthlyRecords con rentAmount != esperado según historial:');
  const records = await prisma.monthlyRecord.findMany({
    where: { isPostExpiry: false },
    select: {
      id: true, contractId: true, monthNumber: true, periodMonth: true, periodYear: true,
      rentAmount: true, amountPaid: true, status: true,
    },
  });

  // Releer historial (con la reparación aplicada, si APPLY) para comparar contra el
  // estado post-fix; en dry-run simulamos el efecto (Rezzonico + INICIAL faltantes).
  const allHist2 = APPLY ? await prisma.rentHistory.findMany({
    orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
  }) : allHist;
  const histBy2 = new Map();
  for (const h of allHist2) {
    if (!histBy2.has(h.contractId)) histBy2.set(h.contractId, []);
    histBy2.get(h.contractId).push(h);
  }
  if (!APPLY) {
    // Simular Rezzonico
    const sim = (histBy2.get(REZZONICO) || [])
      .filter(h => !(h.effectiveFromMonth === 4 && h.reason === 'AJUSTE_MANUAL'))
      .map(h => h.effectiveFromMonth === 36 ? { ...h, effectiveFromMonth: 1 } : h)
      .sort((a, b) => b.effectiveFromMonth - a.effectiveFromMonth || b.createdAt - a.createdAt);
    histBy2.set(REZZONICO, sim);
    // Simular las filas INICIAL que se crearían
    for (const { contract: c, alquilerOriginal } of missingBaseline) {
      const cur = histBy2.get(c.id) || [];
      histBy2.set(c.id, [...cur, { effectiveFromMonth: c.startMonth, rentAmount: alquilerOriginal, reason: 'INICIAL', createdAt: new Date() }]
        .sort((a, b) => b.effectiveFromMonth - a.effectiveFromMonth || b.createdAt - a.createdAt));
    }
  }

  const cMap = new Map(contracts.map(c => [c.id, c]));
  const toFix = [];
  for (const r of records) {
    const c = cMap.get(r.contractId);
    if (!c) continue;
    const hs = histBy2.get(r.contractId) || [];
    if (hs.length === 0) continue;
    const exp = expectedRent(hs, r.monthNumber, c.baseRent);
    // rentAmount 0 = penalidad/rescisión, no se compara contra historial
    if (r.rentAmount === 0) continue;
    if (Math.abs(exp - r.rentAmount) > 0.5) {
      toFix.push({ r, c, exp });
      console.log(`   ${c.tenant?.name || '?'} | ${c.property?.address} | ${r.periodYear}-${String(r.periodMonth).padStart(2,'0')} mn=${r.monthNumber} rent=${r.rentAmount} → esperado=${exp} paid=${r.amountPaid} status=${r.status} active=${c.active}`);
    }
  }
  if (toFix.length === 0) console.log('   (ninguno)');

  // ---- 5. Aplicar fix de records (todos los contratos activos, no solo Rezzonico) ----
  if (APPLY) {
    const activeFixes = toFix.filter(f => f.c.active);
    console.log(`\n[5] Corrigiendo ${activeFixes.length} registros (contratos activos)...`);
    for (const f of activeFixes) {
      await prisma.monthlyRecord.update({ where: { id: f.r.id }, data: { rentAmount: f.exp } });
    }
    if (activeFixes.length > 0) {
      const { recalculateMultipleRecords } = require(base + '/src/services/monthlyRecordService');
      await recalculateMultipleRecords(activeFixes.map(f => f.r.id), null, true);
      console.log('   Recalculo inline completado.');
    }
  } else {
    console.log(`\n[5] (dry-run) Se corregirían ${toFix.filter(f => f.c.active).length} registros de contratos activos + recálculo.`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
