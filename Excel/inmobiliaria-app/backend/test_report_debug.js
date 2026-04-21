const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const reportDataService = require('./src/services/reportDataService');

async function run() {
  // Mock options as frontend would send
  const options = { soloConPago: false };
  const records = await reportDataService.getLiquidacionesAllContracts('191e50f7-3a41-4526-b07a-aeee65307218', 4, 2026, null, options, null, null);
  const yocsina = records.find(r => r.propiedad.direccion.includes('Yocsina'));
  console.dir({
    paymentStatus: yocsina.paymentStatus,
    amountPaid: yocsina.amountPaid,
    total: yocsina.total,
    paidAlquiler: yocsina.paidAlquiler,
    paidPunitorios: yocsina.paidPunitorios,
    pendingAmount: yocsina.pendingAmount,
    isRentPaid: yocsina.isRentPaid
  }, { depth: null });
}
run().catch(console.error).finally(() => prisma.$disconnect());
