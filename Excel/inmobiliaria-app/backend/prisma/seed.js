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
      name: 'Admin H&H',
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

  // Create H&H group
  const group = await prisma.group.upsert({
    where: { slug: 'hh-inmobiliaria' },
    update: {},
    create: {
      name: 'H&H Inmobiliaria',
      slug: 'hh-inmobiliaria',
      description: 'Grupo principal de H&H',
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

  // Create demo properties
  await prisma.property.upsert({
    where: {
      id: 'demo-property-1',
    },
    update: {},
    create: {
      id: 'demo-property-1',
      groupId: group.id,
      categoryId: categoriaVarios.id,
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

  console.log('Demo properties created (3)');

  console.log(`
  =============================================
     Seed completed!
  =============================================
     Test credentials:

     admin@hh.com / Password123 (ADMIN)
     paco@hh.com / Password123 (OPERATOR)
     pedro@hh.com / Password123 (VIEWER)

     Group: H&H Inmobiliaria
     
     Categories: VARIOS, MATIENZO, LOCAL
     Demo Properties: 3 propiedades creadas
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
