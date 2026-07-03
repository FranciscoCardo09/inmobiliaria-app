// Reparaciones puntuales de conceptos/punitorios detectadas en la verificación de
// saldos a favor (2026-07). Cada fix se activa con su propio flag:
//
//   FIX_ETICA=1 node scripts/repair-conceptos.js
//     → Etica S.A. mayo 2026: el pago del 14/05 etiquetó $64.662,36 como PUNITORIOS
//       (ya pagados con la deuda el 10/05) y $96.993,64 como SOBREPAGO. En realidad
//       ambos eran el IVA ($161.655,90). Re-etiqueta ambos conceptos como IVA y pone
//       punitoryAmount=0 en esa transacción. Sin esto, cualquier recálculo del mes
//       lo haría aparecer debiendo $64.662.
//
//   FIX_AMAYA=1 node scripts/repair-conceptos.js
//     → Amaya Nelida (Av Colón 375) marzo 2026: quedó PARTIAL debiendo $4.801,48 de
//       punitorios que la deuda asociada ya dio por saldados (PAID en $0). APLICAR
//       SOLO SI EL JEFE CONFIRMA que esos punitorios se perdonaron. Ajusta el
//       punitorio congelado de la transacción a lo realmente cobrado ($1.370) y
//       recalcula (el mes queda COMPLETO). Si NO estaban perdonados, avisar: hay
//       que reabrir la deuda, no correr este fix.
//
//   FIX_VALENZUELA=1 node scripts/repair-conceptos.js
//     → Valenzuela (Belardinelli 3917): la bonificación "Saldo a favor $9.667" de
//       marzo 2026 fue un error de carga (confirmado por el usuario). Se borra ese
//       servicio, se corrigen los renglones A_FAVOR/SOBREPAGO de los recibos
//       (el alquiler pasa a figurar completo) y se recalcula marzo→julio.
//       Resultado: todos los meses quedan en $0, sin saldo a favor arrastrado.
//
// Sin flags: solo muestra el estado actual (dry run).
const path = require('path');
const base = path.join(__dirname, '..');
const { PrismaClient } = require(base + '/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fixEtica = process.env.FIX_ETICA === '1';
  const fixAmaya = process.env.FIX_AMAYA === '1';
  const { recalculateMultipleRecords } = require(base + '/src/services/monthlyRecordService');

  // ---- ETICA S.A. mayo 2026 ----
  const etica = await prisma.monthlyRecord.findFirst({
    where: { periodMonth: 5, periodYear: 2026, contract: { tenant: { name: { contains: 'Etica', mode: 'insensitive' } } } },
    include: { transactions: { include: { concepts: true }, orderBy: { paymentDate: 'asc' } } },
  });
  if (etica) {
    const tx = etica.transactions.find(t => Math.abs(t.amount - 1012392) < 1);
    const punCon = tx?.concepts.find(c => c.type === 'PUNITORIOS');
    const sobCon = tx?.concepts.find(c => c.type === 'SOBREPAGO');
    console.log(`[Etica 2026-05] tx=${tx?.amount} PUNITORIOS=${punCon?.amount} SOBREPAGO=${sobCon?.amount}`);
    if (fixEtica && tx && punCon && sobCon) {
      await prisma.transactionConcept.update({ where: { id: punCon.id }, data: { type: 'IVA', description: 'IVA 21% sobre alquiler' } });
      await prisma.transactionConcept.update({ where: { id: sobCon.id }, data: { type: 'IVA', description: 'IVA 21% sobre alquiler' } });
      await prisma.paymentTransaction.update({ where: { id: tx.id }, data: { punitoryAmount: 0 } });
      await recalculateMultipleRecords([etica.id], null, true);
      console.log('  → re-etiquetado como IVA + recalculado. LISTO');
    } else if (fixEtica) {
      console.log('  → no se encontró la transacción/conceptos esperados, NO se tocó nada');
    }
  }

  // ---- AMAYA NELIDA marzo 2026 ----
  const amaya = await prisma.monthlyRecord.findFirst({
    where: { periodMonth: 3, periodYear: 2026, contract: { tenant: { name: { contains: 'Amaya Nelida', mode: 'insensitive' } } } },
    include: { transactions: { include: { concepts: true } } },
  });
  if (amaya) {
    console.log(`[Amaya Nelida 2026-03] status=${amaya.status} balance=${amaya.balance} punitoryAmount=${amaya.punitoryAmount}`);
    const tx = amaya.transactions[0];
    if (fixAmaya && tx) {
      const paidPun = tx.concepts.filter(c => c.type === 'PUNITORIOS').reduce((s, c) => s + c.amount, 0);
      await prisma.paymentTransaction.update({ where: { id: tx.id }, data: { punitoryAmount: paidPun } });
      await recalculateMultipleRecords([amaya.id], null, true);
      console.log(`  → punitorio congelado ajustado a lo cobrado ($${paidPun}) + recalculado. LISTO`);
    }
  }

  // ---- BIASSI (F. Alcorta Dto5) marzo 2026: registrar el pago de $35.145 que se
  // cobró en la realidad (confirmado por el usuario) pero nunca se cargó. La deuda ya
  // estaba marcada PAID; se usa su fecha de cierre (07/05/2026) como fecha de pago. ----
  const fixBiassi = process.env.FIX_BIASSI === '1';
  const biassi = await prisma.monthlyRecord.findFirst({
    where: { periodMonth: 3, periodYear: 2026, contract: { tenant: { name: { contains: 'Biassi', mode: 'insensitive' } } } },
    include: { debt: true, transactions: true },
  });
  if (biassi) {
    console.log(`[Biassi 2026-03] status=${biassi.status} balance=${biassi.balance} deuda=${biassi.debt?.status} paid=${biassi.debt?.amountPaid}`);
    const yaRegistrado = biassi.transactions.some(t => Math.abs(t.amount - 35145) < 1);
    if (fixBiassi && biassi.debt && !yaRegistrado && Math.abs(biassi.balance + 35145) < 1) {
      const fecha = biassi.debt.closedAt || new Date(2026, 4, 7, 12);
      await prisma.debtPayment.create({
        data: {
          debtId: biassi.debt.id,
          paymentDate: fecha,
          amount: 35145,
          punitoryAtPayment: 0,
          paymentMethod: 'EFECTIVO',
          observations: 'Pago cobrado en su momento, cargado retroactivamente (reparación 2026-07)',
        },
      });
      await prisma.paymentTransaction.create({
        data: {
          groupId: biassi.groupId,
          monthlyRecordId: biassi.id,
          paymentDate: fecha,
          amount: 35145,
          paymentMethod: 'EFECTIVO',
          punitoryAmount: 0,
          punitoryForgiven: false,
          observations: 'Pago de deuda Marzo 2026 (cargado retroactivamente, reparación 2026-07)',
          concepts: { create: [{ type: 'ALQUILER_DEUDA', description: 'Pago deuda alquiler', amount: 35145 }] },
        },
      });
      await prisma.debt.update({
        where: { id: biassi.debt.id },
        data: { amountPaid: 35145, currentTotal: 0, lastPaymentDate: fecha },
      });
      await recalculateMultipleRecords([biassi.id], null, true);
      console.log('  → pago de $35.145 registrado (07/05/2026) + recalculado. LISTO');
    } else if (fixBiassi) {
      console.log('  → estado distinto al esperado o pago ya registrado; NO se tocó nada');
    }
  }

  // ---- VALENZUELA: eliminar el saldo a favor erróneo de marzo 2026 ----
  const fixValenzuela = process.env.FIX_VALENZUELA === '1';
  const valRecs = await prisma.monthlyRecord.findMany({
    where: {
      periodYear: 2026,
      periodMonth: { gte: 3 },
      contract: { tenant: { name: { contains: 'Valenzuela Mendoza', mode: 'insensitive' } } },
    },
    orderBy: { periodMonth: 'asc' },
    include: {
      services: { include: { conceptType: { select: { label: true, category: true } } } },
      transactions: { include: { concepts: true } },
    },
  });
  if (valRecs.length) {
    const marzo = valRecs.find(r => r.periodMonth === 3);
    const bonif = marzo?.services.find(s =>
      (s.conceptType.category === 'BONIFICACION' || s.conceptType.category === 'DESCUENTO') &&
      Math.abs(s.amount - 9667) < 1
    );
    console.log(`[Valenzuela] bonificación marzo: ${bonif ? '$' + bonif.amount + ' (' + bonif.conceptType.label + ')' : 'NO encontrada'}`);
    for (const r of valRecs) {
      console.log(`  2026-${String(r.periodMonth).padStart(2, '0')}: due=${r.totalDue} paid=${r.amountPaid} bal=${r.balance}`);
    }
    if (fixValenzuela && bonif) {
      // 1. Borrar la bonificación errónea
      await prisma.monthlyService.delete({ where: { id: bonif.id } });
      // 2. Corregir los renglones de los recibos: quitar A_FAVOR y SOBREPAGO de $9.667
      //    y devolver ese monto al renglón ALQUILER (el pago siempre fue el alquiler completo)
      for (const r of valRecs) {
        for (const t of r.transactions) {
          const aFavor = t.concepts.find(c => c.type === 'A_FAVOR' && Math.abs(c.amount + 9667) < 1);
          const sobre = t.concepts.find(c => c.type === 'SOBREPAGO' && Math.abs(c.amount - 9667) < 1);
          const alquiler = t.concepts.find(c => c.type === 'ALQUILER');
          if (sobre && alquiler) {
            await prisma.transactionConcept.update({
              where: { id: alquiler.id },
              data: { amount: Math.round((alquiler.amount + sobre.amount) * 100) / 100 },
            });
            await prisma.transactionConcept.delete({ where: { id: sobre.id } });
            if (aFavor) await prisma.transactionConcept.delete({ where: { id: aFavor.id } });
            console.log(`  → recibo ${t.paymentDate.toISOString().slice(0, 10)} corregido (alquiler completo, sin a favor/sobrepago)`);
          }
        }
      }
      // 3. Recalcular toda la cadena desde marzo
      await recalculateMultipleRecords(valRecs.map(r => r.id), null, true);
      console.log('  → recalculado marzo→' + valRecs[valRecs.length - 1].periodMonth + '. El saldo a favor arrastrado desaparece. LISTO');
    }
  }

  if (!fixEtica && !fixAmaya && !fixValenzuela && !fixBiassi) console.log('\n(dry run — flags: FIX_ETICA=1, FIX_AMAYA=1, FIX_VALENZUELA=1, FIX_BIASSI=1)');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
