const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const rs = await prisma.monthlyRecord.findMany({
    where: { 
      contract: {
        property: { address: { contains: 'Yocsina' } }
      },
      monthNumber: 24, // As seen in screenshot: Alquiler Abril 2026 (Mes 24)
    },
    include: { transactions: true }
  });
  console.dir(rs, { depth: null });
}
run().finally(() => prisma.$disconnect());
