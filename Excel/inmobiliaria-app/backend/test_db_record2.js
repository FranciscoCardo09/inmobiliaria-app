const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const rs = await prisma.monthlyRecord.findMany({
    where: { 
      contract: {
        property: { address: { contains: 'Yocsina' } }
      },
      periodMonth: 4,
      periodYear: 2026
    },
    include: { transactions: true }
  });
  console.dir(rs, { depth: null });
}
run().finally(() => prisma.$disconnect());
