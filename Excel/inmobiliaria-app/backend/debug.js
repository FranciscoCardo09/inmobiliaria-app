const prisma = require('./src/lib/prisma');
async function run() {
  const c = await prisma.contract.findFirst({ where: { property: { address: { contains: 'Pinos 4081' } } } });
  const records = await prisma.monthlyRecord.findMany({ where: { contractId: "392c5452-0c05-48a8-9f73-1a9c63af62e9", periodMonth: 3 }, include: { transactions: true } });
  console.log(JSON.stringify(records[0].transactions, null, 2));
}
run().then(()=>process.exit(0)).catch(console.error);
