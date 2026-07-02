/**
 * Reparación Brunello Mayo 2026 — v2 (corrección de monto y fecha del pago final).
 *
 * El usuario confirmó: el pago real fue $297.983 el 23/6/2026 (el saldo que mostraba
 * el sistema ese día). El registro del 25/6 por $301.670,44 (observación "TEST") se
 * cargó con el monto recalculado al 25, no con lo que el inquilino pagó.
 *
 * Punitorios al 23/6: 100.600,67 (acumulados al pago del 19/6) + 6.145,17 (5 días
 * sobre base 204.839) = 106.745,84 adeudados; cobrados 106.745,50 (tope del efectivo,
 * diferencia $0,34 dentro de la tolerancia de $1 del sistema).
 *
 * Imputación del pago (crédito cubre servicios primero):
 *   SERVICIOS_DEUDA 31.237,50 + ALQUILER_DEUDA 160.000 + PUNITORIOS 106.745,50 = 297.983
 *
 * Mes completo: cargos 578.601 + 106.745,50 − crédito 13.601,50 = 671.745,00
 *             = pagado 179.392 + 194.370 + 297.983 → balance $0 exacto.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const TX_FINAL = '37b334f1-ad66-44c3-8b86-4d20282561d6';
const DEBT_MAYO = 'a0cf1d57-5a33-4c4e-9286-62912151685e';
const DEBT_PAYMENT_FINAL = '102fa361-cf2b-4677-afe7-42e215d86ce0';
const REC_MAYO = 'f215c867-f060-4519-b2c0-45ff9efd2d06';

const AMOUNT = 297983;
const PUNIT_COBRADO = 106745.5;
const FECHA = new Date('2026-06-23T12:00:00.000Z');

(async () => {
  const dump = async (label) => {
    const [mayo, debtMayo, dp, tx] = await Promise.all([
      p.monthlyRecord.findUnique({ where: { id: REC_MAYO }, select: { punitoryAmount: true, totalDue: true, amountPaid: true, balance: true, status: true, fullPaymentDate: true } }),
      p.debt.findUnique({ where: { id: DEBT_MAYO }, select: { accumulatedPunitory: true, amountPaid: true, currentTotal: true, status: true, lastPaymentDate: true } }),
      p.debtPayment.findUnique({ where: { id: DEBT_PAYMENT_FINAL }, select: { amount: true, paymentDate: true, punitoryAtPayment: true, observations: true } }),
      p.paymentTransaction.findUnique({ where: { id: TX_FINAL }, include: { concepts: true } }),
    ]);
    console.log(`--- ${label} ---`);
    console.log('Mayo rec  :', JSON.stringify(mayo));
    console.log('Deuda May :', JSON.stringify(debtMayo));
    console.log('DebtPay   :', JSON.stringify(dp));
    console.log('Tx final  :', tx.amount, tx.paymentDate, 'punit:', tx.punitoryAmount, 'obs:', tx.observations, 'concepts:', JSON.stringify(tx.concepts.map(c => ({ t: c.type, a: c.amount }))));
  };

  await dump('ANTES');

  await p.$transaction(async (tx) => {
    // 1. Concepto PUNITORIOS del pago final → lo efectivamente cobrado al 23/6
    const punitConcept = await tx.transactionConcept.findFirst({ where: { transactionId: TX_FINAL, type: 'PUNITORIOS' } });
    if (!punitConcept) throw new Error('Concepto PUNITORIOS no encontrado');
    await tx.transactionConcept.update({ where: { id: punitConcept.id }, data: { amount: PUNIT_COBRADO, description: 'Punitorios por mora' } });

    // 2. Transacción: monto y fecha reales, sin la observación "TEST"
    await tx.paymentTransaction.update({
      where: { id: TX_FINAL },
      data: { amount: AMOUNT, paymentDate: FECHA, punitoryAmount: PUNIT_COBRADO, observations: 'Pago de deuda: Mayo 2026' },
    });

    // 3. DebtPayment: monto y fecha reales
    await tx.debtPayment.update({
      where: { id: DEBT_PAYMENT_FINAL },
      data: { amount: AMOUNT, paymentDate: FECHA, punitoryAtPayment: PUNIT_COBRADO, observations: null },
    });

    // 4. Deuda Mayo: 160.000 + 239.209 + 106.745,50 − 13.601,50 − 492.353 = 0
    await tx.debt.update({
      where: { id: DEBT_MAYO },
      data: { accumulatedPunitory: PUNIT_COBRADO, amountPaid: round2(194370 + AMOUNT), currentTotal: 0, lastPaymentDate: FECHA },
    });

    // 5. Record Mayo: totalDue = 578.601 + 106.745,50 − 13.601,50 = 671.745 = pagado → balance 0
    await tx.monthlyRecord.update({
      where: { id: REC_MAYO },
      data: { punitoryAmount: PUNIT_COBRADO, totalDue: 671745, amountPaid: 671745, balance: 0, fullPaymentDate: FECHA },
    });
  });

  function round2(x) { return Math.round(x * 100) / 100; }

  await dump('DESPUÉS');
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
