// Script para migrar contratos existentes al nuevo sistema de historial de alquileres
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function migrateRentHistory() {
  console.log('🔄 Migrando contratos al sistema de historial de alquileres...\n');

  // Obtener todos los contratos
  const contracts = await prisma.contract.findMany({
    select: {
      id: true,
      baseRent: true,
      startMonth: true,
    },
  });

  console.log(`📋 Encontrados ${contracts.length} contratos\n`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const contract of contracts) {
    // Verificar si ya tiene historial
    const existingHistory = await prisma.rentHistory.findFirst({
      where: { contractId: contract.id },
    });

    if (existingHistory) {
      console.log(`⏭️  Contrato ${contract.id} ya tiene historial, omitiendo...`);
      skippedCount++;
      continue;
    }

    // Crear registro inicial en el historial
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: contract.startMonth, // Desde el inicio del contrato
        rentAmount: contract.baseRent,
        adjustmentPercent: null,
        reason: 'INICIAL',
      },
    });

    console.log(`✅ Contrato ${contract.id} - Rent inicial: $${contract.baseRent}`);
    migratedCount++;
  }

  console.log('\n✨ Migración completada:');
  console.log(`   - Migrados: ${migratedCount}`);
  console.log(`   - Omitidos: ${skippedCount}`);
  console.log(`   - Total: ${contracts.length}`);

  await prisma.$disconnect();
}

migrateRentHistory()
  .catch((e) => {
    console.error('❌ Error durante la migración:', e);
    process.exit(1);
  });
