// Tenants Controller
// Handles: CRUD tenants per group with filters + history (sin garante)

const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/tenants
const getTenants = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { search, isActive } = req.query;

    const where = { groupId };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { dni: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        guarantors: {
          orderBy: { order: 'asc' },
        },
        contracts: {
          where: { active: true },
          include: {
            property: {
              select: { id: true, address: true, code: true },
            },
          },
          orderBy: { startDate: 'desc' },
          take: 1,
        },
        _count: { select: { contracts: true } },
      },
      orderBy: { name: 'asc' },
    });

    return ApiResponse.success(res, tenants);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/tenants/:id
const getTenantById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        guarantors: {
          orderBy: { order: 'asc' },
        },
        contracts: {
          include: {
            property: {
              select: { id: true, address: true, code: true },
            },
            adjustmentIndex: {
              select: { id: true, name: true, frequencyMonths: true },
            },
          },
          orderBy: { startDate: 'desc' },
        },
      },
    });

    if (!tenant || tenant.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Inquilino no encontrado');
    }

    return ApiResponse.success(res, tenant);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/tenants/:id/history
const getTenantHistory = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant || tenant.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Inquilino no encontrado');
    }

    const contracts = await prisma.contract.findMany({
      where: { tenantId: id },
      include: {
        property: { select: { id: true, address: true, code: true } },
        adjustmentIndex: { select: { name: true, frequencyMonths: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    return ApiResponse.success(res, {
      tenant: { id: tenant.id, name: tenant.name, dni: tenant.dni },
      contracts,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/tenants
const createTenant = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, dni, phone, email, observations, guarantors } = req.body;

    if (!name || !dni) {
      return ApiResponse.badRequest(res, 'Nombre y DNI son requeridos');
    }

    // Validate guarantors (max 5)
    if (guarantors && guarantors.length > 5) {
      return ApiResponse.badRequest(res, 'Un inquilino puede tener como máximo 5 garantes');
    }

    const existing = await prisma.tenant.findUnique({
      where: { groupId_dni: { groupId, dni } },
    });

    if (existing) {
      return ApiResponse.conflict(res, 'Ya existe un inquilino con ese DNI en este grupo');
    }

    const tenant = await prisma.tenant.create({
      data: {
        groupId, name, dni, phone, email, observations,
        guarantors: guarantors?.length ? {
          create: guarantors.map((g, idx) => ({
            name: g.name,
            dni: g.dni,
            phone: g.phone || null,
            email: g.email || null,
            address: g.address || null,
            observations: g.observations || null,
            order: idx + 1,
          })),
        } : undefined,
      },
      include: {
        guarantors: { orderBy: { order: 'asc' } },
        contracts: {
          where: { active: true },
          include: {
            property: { select: { id: true, address: true, code: true } },
          },
        },
        _count: { select: { contracts: true } },
      },
    });

    return ApiResponse.created(res, tenant, 'Inquilino creado exitosamente');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/tenants/:id
const updateTenant = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { name, dni, phone, email, observations, isActive, guarantors } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant || tenant.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Inquilino no encontrado');
    }

    if (dni && dni !== tenant.dni) {
      const existing = await prisma.tenant.findUnique({
        where: { groupId_dni: { groupId, dni } },
      });
      if (existing) {
        return ApiResponse.conflict(res, 'Ya existe un inquilino con ese DNI en este grupo');
      }
    }

    // Validate guarantors (max 5)
    if (guarantors && guarantors.length > 5) {
      return ApiResponse.badRequest(res, 'Un inquilino puede tener como máximo 5 garantes');
    }

    // Use transaction to replace guarantors atomically
    const updated = await prisma.$transaction(async (tx) => {
      // If guarantors provided, delete old ones and create new
      if (guarantors !== undefined) {
        await tx.guarantor.deleteMany({ where: { tenantId: id } });
        if (guarantors.length > 0) {
          await tx.guarantor.createMany({
            data: guarantors.map((g, idx) => ({
              tenantId: id,
              name: g.name,
              dni: g.dni,
              phone: g.phone || null,
              email: g.email || null,
              address: g.address || null,
              observations: g.observations || null,
              order: idx + 1,
            })),
          });
        }
      }

      return tx.tenant.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(dni && { dni }),
          ...(phone !== undefined && { phone }),
          ...(email !== undefined && { email }),
          ...(observations !== undefined && { observations }),
          ...(isActive !== undefined && { isActive }),
        },
        include: {
          guarantors: { orderBy: { order: 'asc' } },
          contracts: {
            where: { active: true },
            include: {
              property: { select: { id: true, address: true, code: true } },
            },
          },
          _count: { select: { contracts: true } },
        },
      });
    });

    return ApiResponse.success(res, updated, 'Inquilino actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/tenants/:id
const deleteTenant = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { contracts: true } } },
    });

    if (!tenant || tenant.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Inquilino no encontrado');
    }

    if (tenant._count.contracts > 0) {
      return ApiResponse.badRequest(
        res,
        'No se puede eliminar un inquilino con contratos. Desactívelo en su lugar.'
      );
    }

    await prisma.tenant.delete({ where: { id } });
    return ApiResponse.success(res, null, 'Inquilino eliminado');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTenants,
  getTenantById,
  getTenantHistory,
  createTenant,
  updateTenant,
  deleteTenant,
};
