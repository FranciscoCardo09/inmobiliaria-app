const { addService, propagateServiceForward } = require('./src/services/monthlyServiceService');
const prisma = require('./src/lib/prisma');

async function run() {
  try {
    // 1. Get a test record
    const record = await prisma.monthlyRecord.findFirst({
      include: {
        services: true
      }
    });
    
    if (!record) {
      console.log('No monthly records found to test');
      return;
    }

    // 2. Get a concept type
    const concept = await prisma.conceptType.findFirst({
      where: {}
    });

    if (!concept) {
      console.log('No concept type found');
      return;
    }

    console.log(`Testing addService for recordId ${record.id} and conceptId ${concept.id}...`);
    // 3. Try to add a service directly (doesn't propagate)
    try {
      const added = await addService(record.id, concept.id, 500, 'Test Service');
      console.log('✔ addService OK');
      
      // Cleanup
      await prisma.monthlyService.delete({ where: { id: added.id } });
    } catch (e1) {
      console.log('❌ addService FAILED:', e1);
    }
    
    console.log(`Testing propagateServiceForward for contractId ${record.contractId}...`);
    try {
      await propagateServiceForward(record.groupId, record.contractId, concept.id, 500, record.periodMonth, record.periodYear, 'Test Propagate');
      console.log('✔ propagateServiceForward OK');
    } catch (e2) {
      console.log('❌ propagateServiceForward FAILED:', e2);
    }

  } catch (e) {
    console.error('Fatal error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
