const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const reportData = require('./src/services/reportDataService');
const empresaService = require('./src/services/empresaConfigService');

async function test() {
  const records = await prisma.monthlyRecord.findMany({
    where: {
      contract: { property: { address: { contains: 'Cumbres' } } },
      periodMonth: 4,
      periodYear: 2026
    },
    include: {
      contract: {
        include: {
          property: { include: { owner: { include: { transferBeneficiary: true } }, transferBeneficiary: true } },
          tenant: true,
          contractTenants: { include: { tenant: true }, orderBy: { isPrimary: 'desc' } },
        }
      },
      services: { include: { conceptType: true } },
      transactions: { include: { concepts: true }, orderBy: { paymentDate: 'asc' } },
    }
  });

  if (!records.length) { console.log('not found'); return; }
  const empresa = await empresaService.getEmpresaData(records[0].groupId);
  
  const options = { honorariosPercent: 8, gastosAMiCargo: { serviceIds: [], extras: [] } };
  const d = reportData.buildLiquidacionFromRecord(records[0], empresa, 4, 2026, options);
  console.log('Record honorarios:', d.honorarios);
  console.log('honorariosCobrado:', d.honorariosCobrado);
  console.log('rentAmount:', d.rentAmount);
  console.log('paymentStatus:', d.paymentStatus);
  console.log('amtPaid:', d.amountPaid);
  console.log('commissionBase:', d.commissionBase); // not exported... but can be inferred
  
  process.exit(0);
}
test();
