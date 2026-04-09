const prisma = require('./src/lib/prisma');

async function main() {
  const d = await prisma.debt.findMany({
    where: {
      contract: {
        property: {
          address: { contains: 'Los Pinos 3989 Torre 1 2A' } // or whatever format it is
        }
      }
    },
    include: { contract: { include: { property: true } } }
  });

  const allDebts = await prisma.debt.findMany({
    where: { currentTotal: { lt: 1 } },
    include: { contract: { include: { property: true } } }
  });

  console.log('Zero debts:', allDebts.map(x => ({ 
     id: x.id, 
     address: x.contract.property.address, 
     status: x.status, 
     currentTotal: x.currentTotal,
     unpaidRentAmount: x.unpaidRentAmount
  })));

  if (d.length > 0) {
     console.log('Record for Los Pinos 3989 2A:');
     console.log(d.map(x => ({ 
        id: x.id, 
        address: x.contract.property.address, 
        status: x.status, 
        currentTotal: x.currentTotal,
        unpaidRentAmount: x.unpaidRentAmount,
        accumulatedPunitory: x.accumulatedPunitory
     })));
  } else {
     console.log('Did not find the specific one yet, maybe address contains "2 A"');
     const d2 = await prisma.debt.findMany({
        where: { contract: { property: { address: { contains: '3989' } } } },
        include: { contract: { include: { property: true } } }
     });
     console.log(d2.map(x => ({ 
        address: x.contract.property.address, 
        status: x.status, 
        currentTotal: x.currentTotal,
        unpaidRentAmount: x.unpaidRentAmount,
        originalAmount: x.originalAmount
     })));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
