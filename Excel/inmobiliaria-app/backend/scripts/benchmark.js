const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getResumenEjecutivoData, getEvolucionIngresosData } = require('../src/services/reportDataService');

async function run() {
  const group = await prisma.group.findFirst({ where: { isActive: true } });
  if (!group) {
    console.log("No active group found");
    process.exit(1);
  }

  const groupId = group.id;
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();

  console.log("=========================================");
  console.log(`Ejecutando Benchmark para GroupID: ${groupId}`);
  console.log("=========================================\n");

  console.time('getResumenEjecutivoData');
  await getResumenEjecutivoData(groupId, month, year);
  console.timeEnd('getResumenEjecutivoData');

  console.time('getEvolucionIngresosData');
  await getEvolucionIngresosData(groupId, year);
  console.timeEnd('getEvolucionIngresosData');

  console.log("\nHecho.");
  process.exit(0);
}

run();
