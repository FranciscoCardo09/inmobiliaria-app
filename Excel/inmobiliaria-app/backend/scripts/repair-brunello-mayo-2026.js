/**
 * Reparación puntual: Brunello Ana Carolina — deuda Mayo 2026.
 *
 * Causa: el pago final de la deuda (25/6, $301.670,44) se registró con el código
 * viejo de payDebt, que imputaba solo los punitorios NUEVOS ($9.832,27) e ignoraba
 * los acumulados impagos del pago anterior ($100.600,67). El excedente ($86.999,17)
 * se clasificó como SOBREPAGO → saldo a favor falso de $100.600,67 en Junio.
 *
 * Realidad: punitorios totales adeudados al 25/6 = 100.600,67 + 9.832,27 = 110.432,94.
 * El inquilino pagó EXACTO: cargos (578.601 + 110.432,94) − crédito abril (13.601,50)
 * = 675.432,44 = total abonado (179.392 + 194.370 + 301.670,44). Saldo final: $0.
 *
 * Imputación correcta del pago final (crédito cubre servicios primero, convención de la app):
 *   SERVICIOS_DEUDA 31.237,50 + ALQUILER_DEUDA 160.000 + PUNITORIOS 110.432,94 = 301.670,44
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const TX_FINAL = '37b334f1-ad66-44c3-8b86-4d20282561d6';
const DEBT_MAYO = 'a0cf1d57-5a33-4c4e-9286-62912151685e';
const DEBT_PAYMENT_FINAL = '102fa361-cf2b-4677-afe7-42e215d86ce0';
const REC_MAYO = 'f215c867-f060-4519-b2c0-45ff9efd2d06';
const REC_JUNIO = '4b08b57c-209d-4964-ae3d-7ef5dc6a8be0';
const DEBT_JUNIO = 'edbefc9f-2736-4147-b73a-a379f89d1929';

const PUNIT_TOTAL = 110432.94;      // 100.600,67 (al 19/6) + 9.832,27 (nuevos al 25/6)
const CREDITO_ABRIL = 13601.5;

(async () => {
  const dump = async (label) => {
    const [mayo, junio, debtMayo, debtJunio, tx] = await Promise.all([
      p.monthlyRecord.findUnique({ where: { id: REC_MAYO }, select: { punitoryAmount: true, totalDue: true, amountPaid: true, balance: true, previousBalance: true, status: true } }),
      p.monthlyRecord.findUnique({ where: { id: REC_JUNIO }, select: { totalDue: true, balance: true, previousBalance: true, status: true } }),
      p.debt.findUnique({ where: { id: DEBT_MAYO }, select: { accumulatedPunitory: true, currentTotal: true, status: true } }),
      p.debt.findUnique({ where: { id: DEBT_JUNIO }, select: { appliedCredit: true, currentTotal: true, status: true } }),
      p.paymentTransaction.findUnique({ where: { id: TX_FINAL }, include: { concepts: true } }),
    ]);
    console.log(`--- ${label} ---`);
    console.log('Mayo rec :', JSON.stringify(mayo));
    console.log('Junio rec:', JSON.stringify(junio));
    console.log('Deuda May:', JSON.stringify(debtMayo));
    console.log('Deuda Jun:', JSON.stringify(debtJunio));
    console.log('Tx final :', tx.amount, 'punitoryAmount:', tx.punitoryAmount, 'concepts:', JSON.stringify(tx.concepts.map(c => ({ t: c.type, a: c.amount }))));
  };

  await dump('ANTES');

  await p.$transaction(async (tx) => {
    // 1. Conceptos de la transacción final: crédito cubre servicios primero
    const concepts = await tx.transactionConcept.findMany({ where: { transactionId: TX_FINAL } });
    const byType = Object.fromEntries(concepts.map(c => [c.type, c]));
    if (!byType.SOBREPAGO || !byType.PUNITORIOS || !byType.SERVICIOS_DEUDA) {
      throw new Error('Estado inesperado de conceptos: ' + JSON.stringify(concepts.map(c => c.type)));
    }
    await tx.transactionConcept.update({ where: { id: byType.SERVICIOS_DEUDA.id }, data: { amount: 31237.5 } }); // 44.839 − 13.601,50 (crédito)
    await tx.transactionConcept.update({ where: { id: byType.PUNITORIOS.id }, data: { amount: PUNIT_TOTAL } });
    await tx.transactionConcept.delete({ where: { id: byType.SOBREPAGO.id } });

    // 2. Punitorio congelado de la transacción (recalculateMonthlyRecord lo copia al record)
    await tx.paymentTransaction.update({ where: { id: TX_FINAL }, data: { punitoryAmount: PUNIT_TOTAL } });

    // 3. DebtPayment final: punitorios totales adeudados al momento del pago
    await tx.debtPayment.update({ where: { id: DEBT_PAYMENT_FINAL }, data: { punitoryAtPayment: PUNIT_TOTAL } });

    // 4. Deuda Mayo: punitorio acumulado real (queda PAID, currentTotal 0:
    //    160.000 + 239.209 + 110.432,94 − 13.601,50 − 496.040,44 = 0)
    await tx.debt.update({ where: { id: DEBT_MAYO }, data: { accumulatedPunitory: PUNIT_TOTAL, currentTotal: 0 } });

    // 5. Record Mayo: totalDue = 160.000 + 33.600 + 385.001 + 110.432,94 − 13.601,50 = 675.432,44
    //    amountPaid 675.432,44 → balance 0 (pagó justo)
    await tx.monthlyRecord.update({
      where: { id: REC_MAYO },
      data: { punitoryAmount: PUNIT_TOTAL, totalDue: 675432.44, balance: 0 },
    });

    // 6. Record Junio: sin saldo a favor arrastrado
    //    totalDue = 181.024 + 38.015,04 + 416.610 = 635.649,04
    await tx.monthlyRecord.update({
      where: { id: REC_JUNIO },
      data: { previousBalance: 0, totalDue: 635649.04, balance: -635649.04 },
    });

    // 7. Deuda Junio: sin crédito aplicado
    //    currentTotal = 181.024 + 454.625,04 + 33.670,46 = 669.319,50
    await tx.debt.update({ where: { id: DEBT_JUNIO }, data: { appliedCredit: 0, currentTotal: 669319.5 } });
  });

  await dump('DESPUÉS');
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
