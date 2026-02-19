// Production Seed - Creates admin user and group for gestionalquileres.com.ar
// Run manually once: DATABASE_URL="postgresql://..." node prisma/seed-prod.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const hashPassword = async (password) => {
  return bcrypt.hash(password, 12);
};

async function main() {
  console.log('Seeding production database...');

  // Create admin user
  const adminPassword = await hashPassword('GestionAlq123');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@gestionalquileres.com.ar' },
    update: {},
    create: {
      email: 'admin@gestionalquileres.com.ar',
      name: 'Admin Gestion Alquileres',
      passwordHash: adminPassword,
      globalRole: 'SUPERADMIN',
      isEmailVerified: true,
    },
  });

  console.log('Admin user created:', admin.email);

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

  // Add admin to group
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

  console.log('Admin added to group as ADMIN');

  // Create categories
  const categoriaVarios = await prisma.category.upsert({
    where: { groupId_name: { groupId: group.id, name: 'VARIOS' } },
    update: {},
    create: {
      groupId: group.id,
      name: 'VARIOS',
      color: 'blue',
      description: 'Propiedades varias',
    },
  });

  const categoriaMatienzo = await prisma.category.upsert({
    where: { groupId_name: { groupId: group.id, name: 'MATIENZO' } },
    update: {},
    create: {
      groupId: group.id,
      name: 'MATIENZO',
      color: 'green',
      description: 'Propiedades Matienzo',
    },
  });

  const categoriaLocal = await prisma.category.upsert({
    where: { groupId_name: { groupId: group.id, name: 'LOCAL' } },
    update: {},
    create: {
      groupId: group.id,
      name: 'LOCAL',
      color: 'orange',
      description: 'Locales comerciales',
    },
  });

  console.log('Categories created: VARIOS, MATIENZO, LOCAL');

  // Create default service categories
  const defaultServiceCategories = [
    { name: 'IMPUESTO', label: 'Impuesto', color: 'badge-error' },
    { name: 'SERVICIO', label: 'Servicio', color: 'badge-info' },
    { name: 'GASTO', label: 'Gasto', color: 'badge-warning' },
    { name: 'MANTENIMIENTO', label: 'Mantenimiento', color: 'badge-success' },
    { name: 'OTROS', label: 'Otros', color: 'badge-ghost' },
  ];

  for (const cat of defaultServiceCategories) {
    await prisma.serviceCategory.upsert({
      where: { groupId_name: { groupId: group.id, name: cat.name } },
      update: {},
      create: {
        groupId: group.id,
        name: cat.name,
        label: cat.label,
        color: cat.color,
        isDefault: true,
      },
    });
  }

  console.log('Default service categories created');

  // Create default concept types
  const defaultConcepts = [
    { name: 'EXPENSAS', label: 'Expensas', category: 'GASTO' },
    { name: 'MUNICIPAL', label: 'Municipal', category: 'IMPUESTO' },
    { name: 'AGUA', label: 'Agua', category: 'SERVICIO' },
    { name: 'LUZ', label: 'Luz', category: 'SERVICIO' },
    { name: 'GAS', label: 'Gas', category: 'SERVICIO' },
    { name: 'ABL', label: 'ABL', category: 'IMPUESTO' },
  ];

  for (const concept of defaultConcepts) {
    await prisma.conceptType.upsert({
      where: { groupId_name: { groupId: group.id, name: concept.name } },
      update: {},
      create: {
        groupId: group.id,
        name: concept.name,
        label: concept.label,
        category: concept.category,
        isDefault: true,
      },
    });
  }

  console.log('Default concept types created');

  // Create adjustment indices
  await prisma.adjustmentIndex.upsert({
    where: { groupId_name: { groupId: group.id, name: 'IPC Trimestral' } },
    update: {},
    create: {
      groupId: group.id,
      name: 'IPC Trimestral',
      frequencyMonths: 3,
      currentValue: 15.5,
    },
  });

  await prisma.adjustmentIndex.upsert({
    where: { groupId_name: { groupId: group.id, name: 'Indice Mensual' } },
    update: {},
    create: {
      groupId: group.id,
      name: 'Indice Mensual',
      frequencyMonths: 1,
      currentValue: 4.2,
    },
  });

  await prisma.adjustmentIndex.upsert({
    where: { groupId_name: { groupId: group.id, name: 'Indice Semestral' } },
    update: {},
    create: {
      groupId: group.id,
      name: 'Indice Semestral',
      frequencyMonths: 6,
      currentValue: 28.0,
    },
  });

  console.log('Adjustment indices created');

  console.log(`
  =============================================
     PRODUCTION SEED COMPLETED
  =============================================
     Login: admin@gestionalquileres.com.ar / GestionAlq123
     Group: Gestion Alquileres
     Categories: VARIOS, MATIENZO, LOCAL
     Service Categories: 5 defaults
     Concept Types: 6 defaults
     Adjustment Indices: 3 (Trimestral, Mensual, Semestral)
  =============================================
  `);
}

main()
  .catch((e) => {
    console.error('Production seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
