const prisma = require('./src/lib/prisma');

async function main() {
  const records = await prisma.monthlyRecord.findMany({
    where: {
      contract: {
        property: {
          address: {
            contains: 'Los Pinos'
          }
        }
      },
      periodMonth: 3,
      periodYear: 2026
    },
    include: {
      contract: {
        include: {
          property: true
        }
      }
    }
  });

  const figueroa = await prisma.monthlyRecord.findMany({
    where: {
      contract: {
        property: {
          address: {
            contains: 'figueroa'
          }
        }
      },
      periodMonth: 3,
      periodYear: 2026
    },
    include: {
      contract: {
        include: {
          property: true
        }
      }
    }
  });

  console.log("=== LOS PINOS ===");
  records.forEach(r => {
    console.log(`Propiedad: ${r.contract.property.address}`);
    console.log(`- monthNumber: ${r.monthNumber}`);
    console.log(`- isCancelled: ${r.isCancelled}`);
    console.log(`- isPaid: ${r.isPaid}`);
    console.log(`- status: ${r.status}`);
    console.log(`- balance: ${r.balance}`);
    console.log(`- amountPaid: ${r.amountPaid}`);
    console.log(`- totalDue: ${r.totalDue}`);
    console.log("-------------------");
  });

  console.log("=== FIGUEROA ALCORTA ===");
  figueroa.forEach(r => {
    console.log(`Propiedad: ${r.contract.property.address}`);
    console.log(`- monthNumber: ${r.monthNumber}`);
    console.log(`- isCancelled: ${r.isCancelled}`);
    console.log(`- isPaid: ${r.isPaid}`);
    console.log(`- status: ${r.status}`);
    console.log(`- balance: ${r.balance}`);
    console.log(`- amountPaid: ${r.amountPaid}`);
    console.log(`- totalDue: ${r.totalDue}`);
    console.log("-------------------");
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
