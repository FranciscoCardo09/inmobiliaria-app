// Database Seed - Creates test users and groups
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const hashPassword = async (password) => {
  return bcrypt.hash(password, 12);
};

async function main() {
  console.log('Seeding database...');

  // Create test users
  const adminPassword = await hashPassword('Password123');
  const pacoPassword = await hashPassword('Password123');
  const pedroPassword = await hashPassword('Password123');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@hh.com' },
    update: {},
    create: {
      email: 'admin@hh.com',
      name: 'Admin Gestion Alquileres',
      passwordHash: adminPassword,
      globalRole: 'SUPERADMIN',
      isEmailVerified: true,
    },
  });

  const paco = await prisma.user.upsert({
    where: { email: 'paco@hh.com' },
    update: {},
    create: {
      email: 'paco@hh.com',
      name: 'Paco',
      passwordHash: pacoPassword,
      isEmailVerified: true,
    },
  });

  const pedro = await prisma.user.upsert({
    where: { email: 'pedro@hh.com' },
    update: {},
    create: {
      email: 'pedro@hh.com',
      name: 'Pedro',
      passwordHash: pedroPassword,
      isEmailVerified: true,
    },
  });

  console.log('Users created:', { admin: admin.email, paco: paco.email, pedro: pedro.email });

  // Create main group
  const group = await prisma.group.upsert({
    where: { slug: 'gestion-alquileres' },
    update: {},
    create: {
      name: 'Gestion Alquileres',
      slug: 'gestion-alquileres',
      description: 'Grupo principal de Gestion Alquileres',
      punitoryRate: 0.006,
      currency: 'ARS',
    },
  });

  console.log('Group created:', group.name);

  // Add users to group
  await prisma.userGroup.upsert({
    where: {
      userId_groupId: {
        userId: admin.id,
        groupId: group.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      groupId: group.id,
      role: 'ADMIN',
    },
  });

  await prisma.userGroup.upsert({
    where: {
      userId_groupId: {
        userId: paco.id,
        groupId: group.id,
      },
    },
    update: {},
    create: {
      userId: paco.id,
      groupId: group.id,
      role: 'OPERATOR',
    },
  });

  await prisma.userGroup.upsert({
    where: {
      userId_groupId: {
        userId: pedro.id,
        groupId: group.id,
      },
    },
    update: {},
    create: {
      userId: pedro.id,
      groupId: group.id,
      role: 'VIEWER',
    },
  });

  console.log('Members added to group');

  // ==================================================
  // FASE 2: Categories and Properties
  // ==================================================

  // Create categories (based on ListasPropiedades.gs: VARIOS, MATIENZO, LOCAL)
  const categoriaVarios = await prisma.category.upsert({
    where: {
      groupId_name: {
        groupId: group.id,
        name: 'VARIOS',
      },
    },
    update: {},
    create: {
      groupId: group.id,
      name: 'VARIOS',
      color: 'blue',
      description: 'Propiedades varias',
    },
  });

  const categoriaMatienzo = await prisma.category.upsert({
    where: {
      groupId_name: {
        groupId: group.id,
        name: 'MATIENZO',
      },
    },
    update: {},
    create: {
      groupId: group.id,
      name: 'MATIENZO',
      color: 'green',
      description: 'Propiedades Matienzo',
    },
  });

  const categoriaLocal = await prisma.category.upsert({
    where: {
      groupId_name: {
        groupId: group.id,
        name: 'LOCAL',
      },
    },
    update: {},
    create: {
      groupId: group.id,
      name: 'LOCAL',
      color: 'orange',
      description: 'Locales comerciales',
    },
  });

  console.log('Categories created: VARIOS, MATIENZO, LOCAL');

  // ==================================================
  // FASE 3: Create Owners (Dueños)
  // ==================================================

  const owner1 = await prisma.owner.upsert({
    where: {
      groupId_dni: {
        groupId: group.id,
        dni: '20123456',
      },
    },
    update: {},
    create: {
      id: 'demo-owner-1',
      groupId: group.id,
      name: 'María García',
      dni: '20123456',
      phone: '1199999999',
      email: 'maria.garcia@email.com',
    },
  });

  const owner2 = await prisma.owner.upsert({
    where: {
      groupId_dni: {
        groupId: group.id,
        dni: '20654321',
      },
    },
    update: {},
    create: {
      id: 'demo-owner-2',
      groupId: group.id,
      name: 'Carlos López',
      dni: '20654321',
      phone: '1188888888',
      email: 'carlos.lopez@email.com',
    },
  });

  console.log('Demo owners created: María García, Carlos López');

  // Create demo properties with owners
  await prisma.property.upsert({
    where: {
      id: 'demo-property-1',
    },
    update: {},
    create: {
      id: 'demo-property-1',
      groupId: group.id,
      categoryId: categoriaVarios.id,
      ownerId: owner1.id,
      address: 'Av. Corrientes 1234',
      code: '4B',
      squareMeters: 45,
      rooms: 2,
      bathrooms: 1,
      floor: '4',
      apartment: 'B',
      observations: 'Departamento con balcón',
    },
  });

  await prisma.property.upsert({
    where: {
      id: 'demo-property-2',
    },
    update: {},
    create: {
      id: 'demo-property-2',
      groupId: group.id,
      categoryId: categoriaLocal.id,
      ownerId: owner2.id,
      address: 'Av. Rivadavia 2500',
      code: 'LC',
      squareMeters: 80,
      rooms: 0,
      bathrooms: 1,
      floor: 'PB',
      observations: 'Local comercial con vidriera',
    },
  });

  await prisma.property.upsert({
    where: {
      id: 'demo-property-3',
    },
    update: {},
    create: {
      id: 'demo-property-3',
      groupId: group.id,
      categoryId: categoriaMatienzo.id,
      ownerId: owner1.id,
      address: 'Matienzo 2080',
      code: '3A',
      squareMeters: 55,
      rooms: 3,
      bathrooms: 1,
      floor: '3',
      apartment: 'A',
      observations: 'Edificio Matienzo - muy luminoso',
    },
  });

  console.log('Demo properties created (3) - assigned to owners');

  // ==================================================
  // FASE 3: Adjustment Indices (Índices de ajuste)
  // ==================================================

  const indexTrimestral = await prisma.adjustmentIndex.upsert({
    where: {
      groupId_name: {
        groupId: group.id,
        name: 'IPC Trimestral',
      },
    },
    update: {},
    create: {
      id: 'demo-index-1',
      groupId: group.id,
      name: 'IPC Trimestral',
      frequencyMonths: 3,
      currentValue: 15.5, // 15.5% de aumento
    },
  });

  const indexMensual = await prisma.adjustmentIndex.upsert({
    where: {
      groupId_name: {
        groupId: group.id,
        name: 'Índice Mensual',
      },
    },
    update: {},
    create: {
      id: 'demo-index-2',
      groupId: group.id,
      name: 'Índice Mensual',
      frequencyMonths: 1,
      currentValue: 4.2, // 4.2% de aumento
    },
  });

  const indexSemestral = await prisma.adjustmentIndex.upsert({
    where: {
      groupId_name: {
        groupId: group.id,
        name: 'Índice Semestral',
      },
    },
    update: {},
    create: {
      id: 'demo-index-3',
      groupId: group.id,
      name: 'Índice Semestral',
      frequencyMonths: 6,
      currentValue: 28.0, // 28% de aumento
    },
  });

  console.log('Adjustment indices created: IPC Trimestral (3m), Índice Mensual (1m), Índice Semestral (6m)');

  // ==================================================
  // FASE 3: Tenants (Inquilinos)
  // ==================================================

  const tenant1 = await prisma.tenant.upsert({
    where: {
      groupId_dni: {
        groupId: group.id,
        dni: '12345678',
      },
    },
    update: {},
    create: {
      id: 'demo-tenant-1',
      groupId: group.id,
      name: 'Juan Pérez',
      dni: '12345678',
      phone: '1166666666',
      email: 'juan.perez@email.com',
      observations: 'Inquilino puntual',
    },
  });

  const tenant2 = await prisma.tenant.upsert({
    where: {
      groupId_dni: {
        groupId: group.id,
        dni: '87654321',
      },
    },
    update: {},
    create: {
      id: 'demo-tenant-2',
      groupId: group.id,
      name: 'Ana López',
      dni: '87654321',
      phone: '1144444444',
      email: 'ana.lopez@email.com',
      observations: 'Buen historial',
    },
  });

  console.log('Demo tenants created: Juan Pérez, Ana López');

  // ==================================================
  // FASE 3: Contracts (Contratos)
  // ==================================================

  // Contract 1: Juan Pérez → Av. Corrientes 1234
  // CORRECTED: Empezó en mes 4, ahora está en mes 5, con ajuste trimestral
  // Ajustes en: 4, 7, 10, 13, 16, 19, 22
  await prisma.contract.upsert({
    where: { id: 'demo-contract-1' },
    update: {},
    create: {
      id: 'demo-contract-1',
      groupId: group.id,
      tenantId: tenant1.id,
      propertyId: 'demo-property-1',
      startDate: new Date('2025-10-01'), // Comenzó octubre 2025
      startMonth: 4, // Empezó en mes 4
      durationMonths: 24,
      currentMonth: 5, // Estamos en mes 5
      baseRent: 150000,
      adjustmentIndexId: indexTrimestral.id,
      nextAdjustmentMonth: 7, // Próximo ajuste en mes 7 (4+3)
      punitoryStartDay: 10,
      punitoryPercent: 0.006,
      active: true,
      observations: 'Contrato que empezó en mes 4 con ajuste trimestral. Próximo ajuste: mes 7',
    },
  });

  // Contract 2: Ana López → Matienzo 2080
  // CORRECTED: Empezó en mes 11, ahora está en mes 13, con ajuste trimestral
  // Ajustes en: 11, 14, 17, 20, 23
  await prisma.contract.upsert({
    where: { id: 'demo-contract-2' },
    update: {},
    create: {
      id: 'demo-contract-2',
      groupId: group.id,
      tenantId: tenant2.id,
      propertyId: 'demo-property-3',
      startDate: new Date('2024-05-01'), // Comenzó mayo 2024
      startMonth: 11, // Empezó en mes 11
      durationMonths: 24,
      currentMonth: 13, // Mes 13/24
      baseRent: 120000,
      adjustmentIndexId: indexTrimestral.id,
      nextAdjustmentMonth: 14, // Próximo ajuste en mes 14 (11+3)
      punitoryStartDay: 5,
      punitoryPercent: 0.006,
      active: true,
      observations: 'Contrato que empezó en mes 11 con ajuste trimestral. Próximo ajuste: mes 14 (¡PRÓXIMO MES!)',
    },
  });

  // Contract 3: Property sin contrato (Av. Rivadavia 2500 está disponible)
  console.log('Demo contracts created (2) with adjustment tracking');

  // ==================================================
  // FASE 4: Payments (Pagos)
  // ==================================================

  // Delete existing demo payments first
  await prisma.payment.deleteMany({
    where: { id: { in: ['demo-payment-1', 'demo-payment-2'] } },
  });

  // Pago 1: Juan Pérez - Mes 5 - COMPLETE (pagó a tiempo el 5 de febrero)
  await prisma.payment.create({
    data: {
      id: 'demo-payment-1',
      groupId: group.id,
      contractId: 'demo-contract-1',
      monthNumber: 5,
      periodMonth: 2,
      periodYear: 2026,
      paymentDate: new Date('2026-02-05'),
      totalDue: 199500,
      amountPaid: 199500,
      balance: 0,
      status: 'COMPLETE',
      observations: 'Pago completo a tiempo',
      concepts: {
        create: [
          { type: 'ALQUILER', amount: 150000, isAutomatic: true },
          { type: 'IVA', amount: 31500, isAutomatic: true },
          { type: 'EXPENSAS', amount: 9000, isAutomatic: false },
          { type: 'MUNICIPAL', amount: 9000, isAutomatic: false },
        ],
      },
    },
  });

  // Pago 2: Ana López - Mes 13 - PARTIAL (pagó tarde, con punitorios, parcial)
  await prisma.payment.create({
    data: {
      id: 'demo-payment-2',
      groupId: group.id,
      contractId: 'demo-contract-2',
      monthNumber: 13,
      periodMonth: 2,
      periodYear: 2026,
      paymentDate: new Date('2026-02-12'),
      totalDue: 165720,
      amountPaid: 120000,
      balance: -45720,
      status: 'PARTIAL',
      observations: 'Pago parcial - falta completar',
      concepts: {
        create: [
          { type: 'ALQUILER', amount: 120000, isAutomatic: true },
          { type: 'IVA', amount: 25200, isAutomatic: true },
          { type: 'PUNITORIOS', amount: 5040, isAutomatic: true, description: '7 días de atraso' },
          { type: 'EXPENSAS', amount: 7500, isAutomatic: false },
          { type: 'MUNICIPAL', amount: 7980, isAutomatic: false },
        ],
      },
    },
  });

  console.log('Demo payments created (2): Juan COMPLETE, Ana PARTIAL');

  console.log(`
  =============================================
     ✅ SEED COMPLETED - FASE 4!
  =============================================
     Test credentials:
       • admin@hh.com / Password123 (ADMIN)
       • paco@hh.com / Password123 (OPERATOR)
       • pedro@hh.com / Password123 (VIEWER)

     Group: Gestion Alquileres

     📁 Categories: VARIOS, MATIENZO, LOCAL
     👤 Owners: María García, Carlos López
     🏢 Properties: 3 propiedades
     📊 Indices: IPC Trimestral, Mensual, Semestral
     👥 Tenants: Juan Pérez, Ana López
     📝 Contracts: 2 activos

     💳 Pagos (FASE 4):
       1. Juan Pérez Mes 5 - COMPLETE ($199,500)
       2. Ana López Mes 13 - PARTIAL ($120,000 de $165,720)
  =============================================
  `);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
