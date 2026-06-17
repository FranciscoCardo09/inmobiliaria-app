// Arreglo puntual de datos: concepto "Cocina cuotas 3 de 3" -> "Cocina",
// y Godoy queda con plan de 3 cuotas (1/3, 2/3, 3/3) desde junio 2026.
// Cazaux NO se toca (los 9 meses quedan como recurrentes, sin número de cuota).
// Uso: DATABASE_URL=<prod> node scripts/fix-cocina-cuotas.js [--apply]
const prisma = require('../src/lib/prisma');
const { assignInstallmentService } = require('../src/services/monthlyServiceService');

const CONCEPT_ID = '31b5da03-7849-424c-aaa9-725707e27c82';
const GODOY_CONTRACT = '5025cf6b-2604-4d02-9196-6ec13f69645c';
const CUOTA_AMOUNT = 123333;

const APPLY = process.argv.includes('--apply');

(async () => {
  const concept = await prisma.conceptType.findUnique({ where: { id: CONCEPT_ID } });
  if (!concept) throw new Error('Concepto Cocina no encontrado');
  console.log(`Concepto actual: label="${concept.label}" (group ${concept.groupId})`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Acciones que se aplicarían:');
    console.log(`  1) Renombrar label "${concept.label}" -> "Cocina"`);
    console.log('  2) Godoy: asignar 3 cuotas desde 6/2026 (1/3,2/3,3/3), $%d c/u', CUOTA_AMOUNT);
    console.log('  3) Cazaux: SIN cambios (recurrente)');
    console.log('\nCorré con --apply para ejecutar.');
    await prisma.$disconnect();
    return;
  }

  // 1) Renombrar concepto
  await prisma.conceptType.update({ where: { id: CONCEPT_ID }, data: { label: 'Cocina' } });
  console.log('OK: concepto renombrado a "Cocina"');

  // 2) Godoy: 3 cuotas desde junio 2026 (upsert junio + crea jul/ago)
  const res = await assignInstallmentService(
    concept.groupId, GODOY_CONTRACT, CONCEPT_ID, 3, 6, 2026, CUOTA_AMOUNT * 3
  );
  console.log(`OK: Godoy ${res.length} cuota(s) asignadas`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
