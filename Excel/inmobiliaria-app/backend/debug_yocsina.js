const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const reportDataService = require('./src/services/reportDataService');
async function run() {
  const data = await reportDataService.getControlMensualData('191e50f7-3a41-4526-b07a-aeee65307218', 4, 2026);
  console.log(JSON.stringify(data.totales, null, 2));
  console.log(JSON.stringify(data.registros.find(r => r.propiedad && r.propiedad.includes('Yocsina')), null, 2));
}
run().catch(console.error).finally(() => prisma.$disconnect());
