/*
 * Complementa la simulación full-coverage.js (22 contratos INQUILINO) con los
 * escenarios de "edición de contrato" que esa sim no cubre:
 *   - C23: ajuste de alquiler VENCIDO pero NO aplicado (para probar el botón
 *     "aplicar ajuste" en vivo, con fecha real de hoy).
 *   - C24: contrato RESCINDIDO (para probar rescission-preview / undo-rescind
 *     y la multa de rescisión en Liquidación).
 *   - C25: par de contratos RENOVADOS (viejo vencido + nuevo activo enlazados
 *     por renewedFromContractId), con saldo a favor final del viejo para ver
 *     el carryover de crédito.
 *   - C26: contrato PROPIETARIO (lado dueño de Liquidación/Impuestos).
 *
 * Corre contra la misma base local ya poblada por full-coverage.js (reutiliza
 * groupId 'sim-group' y sus conceptTypes). NO trunca nada.
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const prisma = new PrismaClient();

const GID = 'sim-group';

async function main() {
  const cts = await prisma.conceptType.findMany({ where: { groupId: GID } });
  const CT = Object.fromEntries(cts.map((c) => [c.name, c.id]));
  const adjIndex = await prisma.adjustmentIndex.findFirst({ where: { groupId: GID } });
  // Le damos un % real para que "aplicar ajuste" tenga un valor visible.
  await prisma.adjustmentIndex.update({ where: { id: adjIndex.id }, data: { currentValue: 9.5, lastUpdated: new Date() } });

  async function makeContract({ key, contractType = 'INQUILINO', startDate, startMonth = 1, durationMonths, baseRent, active = true, reuseTenantId = null, reusePropertyId = null, extra = {} }) {
    const propId = reusePropertyId || (await prisma.property.create({ data: { groupId: GID, address: `Calle ${key} 456` } })).id;
    let tenantId = reuseTenantId, contractTenants;
    if (contractType === 'INQUILINO') {
      if (!tenantId) {
        const tenant = await prisma.tenant.create({ data: { groupId: GID, name: `Inquilino ${key}`, dni: `DNI-${key}` } });
        tenantId = tenant.id;
      }
      contractTenants = { create: [{ tenantId, isPrimary: true }] };
    }
    const contract = await prisma.contract.create({
      data: {
        groupId: GID, tenantId, propertyId: propId, contractType,
        startDate, startMonth, durationMonths, currentMonth: 1,
        baseRent, punitoryStartDay: 4, punitoryGraceDay: 10, punitoryPercent: 0.006,
        active,
        ...(contractType === 'INQUILINO' ? { contractTenants } : {}),
        ...extra,
      },
    });
    if (contractType === 'INQUILINO') {
      await prisma.rentHistory.create({ data: { contractId: contract.id, effectiveFromMonth: startMonth, rentAmount: baseRent, reason: 'INICIAL' } });
    }
    return { contract, propertyId: propId };
  }

  async function payFullOnTime(contract, monthNumber, periodMonth, periodYear, rentAmount, paymentDate, opts = {}) {
    const mr = await prisma.monthlyRecord.create({
      data: {
        groupId: GID, contractId: contract.id, monthNumber, periodMonth, periodYear,
        rentAmount, servicesTotal: opts.servicesTotal || 0, previousBalance: opts.previousBalance || 0,
        punitoryAmount: 0, punitoryDays: 0, includeIva: !!opts.includeIva, ivaAmount: opts.ivaAmount || 0,
        totalDue: rentAmount + (opts.servicesTotal || 0) + (opts.ivaAmount || 0) - (opts.previousBalance || 0),
        amountPaid: opts.amountPaid ?? (rentAmount + (opts.servicesTotal || 0) + (opts.ivaAmount || 0) - (opts.previousBalance || 0)),
        balance: opts.balance ?? 0,
        status: 'COMPLETE', isPaid: true, isCancelled: true, fullPaymentDate: paymentDate,
      },
    });
    if (opts.services) {
      for (const s of opts.services) {
        await prisma.monthlyService.create({ data: { groupId: GID, monthlyRecordId: mr.id, conceptTypeId: s.conceptTypeId, amount: s.amount, description: s.name } });
      }
    }
    const tx = await prisma.paymentTransaction.create({
      data: { groupId: GID, monthlyRecordId: mr.id, paymentDate, amount: mr.amountPaid, paymentMethod: 'TRANSFERENCIA' },
    });
    const concepts = [{ transactionId: tx.id, type: 'ALQUILER', amount: rentAmount }];
    if (opts.services) {
      for (const s of opts.services) concepts.push({ transactionId: tx.id, type: s.type, amount: s.amount });
    }
    if (opts.ivaAmount) concepts.push({ transactionId: tx.id, type: 'IVA', amount: opts.ivaAmount });
    if (opts.balance > 0) concepts.push({ transactionId: tx.id, type: 'SOBREPAGO', amount: opts.balance });
    await prisma.transactionConcept.createMany({ data: concepts });
    return mr;
  }

  // ============================================================
  // C23 — ajuste VENCIDO, no aplicado (hoy real: probar "aplicar ajuste")
  // ============================================================
  // startDate 2026-01-01, startMonth 1 → mes-contrato = mes calendario.
  // frequencyMonths=3, startMonth=1 → mes 7 (Julio) es mes de ajuste (7-1=6, 6%3=0).
  {
    const { contract } = await makeContract({
      key: 'C23_ajuste_pendiente', startDate: new Date(2026, 0, 1), durationMonths: 24, baseRent: 250000,
      extra: { adjustmentIndexId: adjIndex.id },
    });
    for (let m = 1; m <= 6; m++) {
      await payFullOnTime(contract, m, m, 2026, 250000, new Date(2026, m - 1, 5, 12));
    }
    console.log('C23_ajuste_pendiente:', contract.id, '(ajuste 9.5% vencido en Julio 2026, sin aplicar)');
  }

  // ============================================================
  // C24 — RESCINDIDO en Mayo 2026 (multa se factura en Junio automáticamente)
  // ============================================================
  {
    const { contract } = await makeContract({
      key: 'C24_rescindido', startDate: new Date(2026, 0, 1), durationMonths: 24, baseRent: 280000,
      extra: { rescindedAt: new Date(2026, 4, 10, 12), rescissionPenalty: 280000 },
    });
    for (let m = 1; m <= 4; m++) {
      await payFullOnTime(contract, m, m, 2026, 280000, new Date(2026, m - 1, 5, 12));
    }
    console.log('C24_rescindido:', contract.id, '(rescindido 10/05/2026, multa $280.000 factura en Junio)');
  }

  // ============================================================
  // C25 — RENOVACIÓN: contrato viejo vencido (2025) + nuevo activo (2026)
  // ============================================================
  {
    const { contract: oldC } = await makeContract({
      key: 'C25_viejo_renovado', startDate: new Date(2025, 0, 1), durationMonths: 12, baseRent: 200000,
      active: false, extra: { renewedAt: new Date(2025, 11, 20, 12) },
    });
    for (let m = 1; m <= 11; m++) {
      await payFullOnTime(oldC, m, m, 2025, 200000, new Date(2025, m - 1, 5, 12));
    }
    // Mes 12 (Dic 2025): sobrepaga → deja saldo a favor de 15000 para el carryover (C-06).
    await payFullOnTime(oldC, 12, 12, 2025, 200000, new Date(2025, 11, 5, 12), { amountPaid: 215000, balance: 15000 });

    const { contract: newC } = await makeContract({
      key: 'C25_nuevo_renovado', startDate: new Date(2026, 0, 1), durationMonths: 24, baseRent: 230000,
      reuseTenantId: oldC.tenantId, reusePropertyId: oldC.propertyId,
      extra: { renewedFromContractId: oldC.id },
    });
    for (let m = 1; m <= 6; m++) {
      await payFullOnTime(newC, m, m, 2026, 230000, new Date(2026, m - 1, 5, 12));
    }
    console.log('C25_viejo_renovado:', oldC.id, '/ C25_nuevo_renovado:', newC.id, '(saldo a favor $15.000 heredado)');
  }

  // ============================================================
  // C26 — PROPIETARIO (lado dueño: impuestos/servicios, Liquidación propietario)
  // ============================================================
  {
    const owner = await prisma.owner.create({
      data: {
        groupId: GID, name: 'Roberto Fernández (Propietario)', dni: 'DNI-OWNER-C26', phone: '11-5555-0001',
        bankName: 'Banco Nación', bankHolder: 'Roberto Fernández', bankCuit: '20-11223344-5',
        bankAccountType: 'Caja de Ahorro', bankAccountNumber: '123456789', bankCbu: '0110599520000012345678', bankAlias: 'roberto.fernandez.mp',
      },
    });
    const prop = await prisma.property.create({ data: { groupId: GID, address: 'Av. Propietario 789', ownerId: owner.id } });
    const contract = await prisma.contract.create({
      data: {
        groupId: GID, propertyId: prop.id, contractType: 'PROPIETARIO',
        startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 120, currentMonth: 1,
        baseRent: 0, active: true,
      },
    });
    for (let m = 1; m <= 4; m++) {
      const mr = await prisma.monthlyRecord.create({
        data: {
          groupId: GID, contractId: contract.id, monthNumber: m, periodMonth: m, periodYear: 2026,
          rentAmount: 0, servicesTotal: 45000, totalDue: 45000, amountPaid: 45000, balance: 0,
          status: 'COMPLETE', isPaid: true, isCancelled: true, fullPaymentDate: new Date(2026, m - 1, 10, 12),
        },
      });
      await prisma.monthlyService.create({ data: { groupId: GID, monthlyRecordId: mr.id, conceptTypeId: CT.MUNICIPALIDAD, amount: 20000, description: 'MUNICIPALIDAD' } });
      await prisma.monthlyService.create({ data: { groupId: GID, monthlyRecordId: mr.id, conceptTypeId: CT.EXPENSAS, amount: 25000, description: 'EXPENSAS' } });
      const tx = await prisma.paymentTransaction.create({ data: { groupId: GID, monthlyRecordId: mr.id, paymentDate: new Date(2026, m - 1, 10, 12), amount: 45000, paymentMethod: 'TRANSFERENCIA' } });
      await prisma.transactionConcept.createMany({ data: [
        { transactionId: tx.id, type: 'MUNICIPALIDAD', amount: 20000 },
        { transactionId: tx.id, type: 'EXPENSAS', amount: 25000 },
      ] });
    }
    console.log('C26_propietario:', contract.id, '(propietario Roberto Fernández, owner:', owner.id, ')');
  }

  console.log('\nSupplementary seed OK.');
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
