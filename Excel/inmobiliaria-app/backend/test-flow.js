const prisma = require('./src/lib/prisma');
const { calculatePunitoryPreview, registerPayment } = require('./src/services/paymentTransactionService');
const { getOrCreateMonthlyRecords } = require('./src/services/monthlyRecordService');
const { buildLiquidacionFromRecord } = require('./src/services/reportDataService');

async function runTest() {
  console.log('--- INICIANDO PRUEBA LOCAL ---');
  try {
    // 1. Setup Data
    const group = await prisma.group.create({ data: { name: 'Test Group', slug: `test-${Date.now()}` } });
    const owner = await prisma.owner.create({ data: { name: 'Test Owner', phone: '123', dni: '111', email: 'o@test.com', groupId: group.id } });
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant', phone: '123', dni: '222', email: 't@test.com', groupId: group.id } });
    const property = await prisma.property.create({ data: { address: 'Test 123', ownerId: owner.id, groupId: group.id } });
    
    const contract = await prisma.contract.create({
      data: {
        groupId: group.id,
        propertyId: property.id,
        tenantId: tenant.id,
        startDate: new Date('2026-01-01'),
        active: true,
        durationMonths: 12,
        startMonth: 1,
        currentMonth: 1,
        baseRent: 686488,
        punitoryStartDay: 1,
        punitoryGraceDay: 10,
        punitoryPercent: 0.006
      }
    });

    // 2. Create March Record
    console.log('\n--- CREANDO REGISTRO DE MARZO 2026 ---');
    const recordsMarch = await getOrCreateMonthlyRecords(group.id, 3, 2026);
    const marchRecord = recordsMarch[0];
    console.log(`Registro Marzo creado (Alquiler: ${marchRecord.rentAmount}, Estado: ${marchRecord.status})`);

    // 3. Preview Payment on May 9th
    console.log('\n--- PREVIEW DE PAGO (09/05/2026) ---');
    const preview = await calculatePunitoryPreview(marchRecord.id, '2026-05-09');
    console.log(`Días de punitorios calculados: ${preview.days}`);
    console.log(`Monto de punitorios (calculados): $${preview.newPunitory}`);
    console.log(`Total Sugerido a Pagar: $${preview.baseRent + preview.newPunitory}`);

    // 4. Register Payment
    console.log('\n--- REGISTRANDO PAGO POR $997.000 ---');
    const payment = await registerPayment(group.id, marchRecord.id, {
      amount: 997000,
      paymentDate: '2026-05-09',
      paymentMethod: 'TRANSFER',
      notes: 'Test pago mayor'
    });
    console.log(`Pago registrado con éxito. ID: ${payment.id}`);

    // 5. Fetch updated March Record
    const updatedMarch = await prisma.monthlyRecord.findUnique({ where: { id: marchRecord.id } });
    console.log('\n--- ESTADO FINAL DE MARZO ---');
    console.log(`Estado: ${updatedMarch.status}`);
    console.log(`Pagado total: $${updatedMarch.amountPaid}`);
    console.log(`Punitorios finales: $${updatedMarch.punitoryAmount}`);
    console.log(`SALDO A FAVOR (balance propagable): $${updatedMarch.balance}`);

    // 6. Fetch April Record to see propagation
    console.log('\n--- CREANDO REGISTRO DE ABRIL 2026 (PARA VER PROPAGACIÓN) ---');
    const recordsApril = await getOrCreateMonthlyRecords(group.id, 4, 2026);
    const aprilRecord = recordsApril[0];
    console.log(`Abril creado. Saldo a favor propagado (previousBalance): $${aprilRecord.previousBalance}`);

    // 7. Test Report
    console.log('\n--- GENERANDO LIQUIDACIÓN DE MARZO ---');
    const liquidacion = await buildLiquidacionFromRecord(updatedMarch, contract);
    console.log(`Subtotal Alquileres Cobrado (Base + Punitorios): $${liquidacion.subtotalAlquileresCobrado}`);
    console.log(`Honorarios (5%): $${liquidacion.honorarios}`);
    console.log(`Pendiente de cobro: $${liquidacion.pendingAmount}`);

  } catch (error) {
    console.error('Error in test:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
