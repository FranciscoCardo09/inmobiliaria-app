const prisma = require('./src/lib/prisma');

async function testDuration() {
  const contract = await prisma.contract.findFirst({ where: { active: true } });
  console.log("Original durationMonths:", contract.durationMonths);
  
  // call the actual update logic
  const { startDate, durationMonths, currentMonth } = contract;
  const data = { durationMonths: 36 };
  if (startDate || data.durationMonths || currentMonth) {
    data.startMonth = 1;
  }
  
  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data
  });
  console.log("Updated durationMonths:", updated.durationMonths);
}
testDuration().finally(() => prisma.$disconnect());
