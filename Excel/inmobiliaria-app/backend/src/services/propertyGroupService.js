const prisma = require('../lib/prisma');

const list = async (groupId) => {
  return prisma.propertyGroup.findMany({
    where: { groupId },
    include: {
      items: {
        include: {
          contract: {
            include: {
              property: { select: { id: true, address: true, unit: true } },
              tenant: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
};

const create = async (groupId, name, items) => {
  return prisma.propertyGroup.create({
    data: {
      groupId,
      name,
      items: {
        create: items.map(({ contractId, percentage }) => ({
          contractId,
          percentage,
        })),
      },
    },
    include: { items: true },
  });
};

const update = async (id, groupId, name, items) => {
  return prisma.$transaction(async (tx) => {
    await tx.propertyGroupItem.deleteMany({ where: { propertyGroupId: id } });
    return tx.propertyGroup.update({
      where: { id, groupId },
      data: {
        name,
        items: {
          create: items.map(({ contractId, percentage }) => ({
            contractId,
            percentage,
          })),
        },
      },
      include: { items: true },
    });
  });
};

const remove = async (id, groupId) => {
  return prisma.propertyGroup.delete({ where: { id, groupId } });
};

module.exports = { list, create, update, remove };
