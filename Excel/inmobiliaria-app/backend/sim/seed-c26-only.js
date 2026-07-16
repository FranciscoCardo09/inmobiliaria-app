/* Solo C26 (PROPIETARIO) — separado porque seed-supplementary-local.js ya corrió C23-C25 OK. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const GID = 'sim-group';

async function main() {
  const cts = await prisma.conceptType.findMany({ where: { groupId: GID } });
  const CT = Object.fromEntries(cts.map((c) => [c.name, c.id]));

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
    await prisma.monthlyService.create({ data: { monthlyRecordId: mr.id, conceptTypeId: CT.MUNICIPALIDAD, amount: 20000, description: 'MUNICIPALIDAD' } });
    await prisma.monthlyService.create({ data: { monthlyRecordId: mr.id, conceptTypeId: CT.EXPENSAS, amount: 25000, description: 'EXPENSAS' } });
    const tx = await prisma.paymentTransaction.create({ data: { groupId: GID, monthlyRecordId: mr.id, paymentDate: new Date(2026, m - 1, 10, 12), amount: 45000, paymentMethod: 'TRANSFERENCIA' } });
    await prisma.transactionConcept.createMany({ data: [
      { transactionId: tx.id, type: 'MUNICIPALIDAD', amount: 20000 },
      { transactionId: tx.id, type: 'EXPENSAS', amount: 25000 },
    ] });
  }
  console.log('C26_propietario:', contract.id, '(propietario Roberto Fernández, owner:', owner.id, ')');
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); }).finally(() => prisma.$disconnect());
