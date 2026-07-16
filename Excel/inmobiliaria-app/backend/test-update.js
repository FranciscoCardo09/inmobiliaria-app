const prisma = require('./src/lib/prisma');
const { updateContract } = require('./src/controllers/contractsController');

async function testUpdate() {
  const contract = await prisma.contract.findFirst({ where: { active: true } });
  
  console.log("OLD durationMonths:", contract.durationMonths);
  
  const req = {
    params: { groupId: contract.groupId, id: contract.id },
    body: {
      durationMonths: 36
    }
  };
  
  const res = {
    status: (code) => ({
      json: (data) => console.log("Response:", data)
    })
  };
  
  const next = (err) => console.error("Error:", err);
  
  await updateContract(req, res, next);
}

testUpdate().then(() => prisma.$disconnect());
