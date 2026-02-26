// Service Categories Controller
// Handles: CRUD for dynamic service categories per group

const ApiResponse = require('../utils/apiResponse');

const prisma = require('../lib/prisma');

// GET /api/groups/:groupId/service-categories
const getServiceCategories = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const categories = await prisma.serviceCategory.findMany({
      where: { groupId, isActive: true },
      orderBy: { name: 'asc' },
    });

    return ApiResponse.success(res, categories);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/service-categories
const createServiceCategory = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, label, color } = req.body;

    if (!name || !label) {
      return ApiResponse.badRequest(res, 'name y label son requeridos');
    }

    const normalizedName = name.toUpperCase().replace(/\s+/g, '_');

    const category = await prisma.serviceCategory.create({
      data: {
        groupId,
        name: normalizedName,
        label,
        color: color || 'badge-ghost',
      },
    });

    return ApiResponse.created(res, category, 'Categoría de servicio creada');
  } catch (error) {
    if (error.code === 'P2002') {
      return ApiResponse.conflict(res, 'Ya existe una categoría con ese nombre en este grupo');
    }
    next(error);
  }
};

// PUT /api/groups/:groupId/service-categories/:id
const updateServiceCategory = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { label, color, isActive } = req.body;

    const existing = await prisma.serviceCategory.findUnique({ where: { id } });
    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Categoría no encontrada');
    }

    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (color !== undefined) updateData.color = color;
    if (isActive !== undefined) updateData.isActive = isActive;

    const category = await prisma.serviceCategory.update({
      where: { id },
      data: updateData,
    });

    return ApiResponse.success(res, category, 'Categoría actualizada');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/service-categories/:id
const deleteServiceCategory = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const existing = await prisma.serviceCategory.findUnique({ where: { id } });
    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Categoría no encontrada');
    }

    if (existing.isDefault) {
      return ApiResponse.badRequest(res, 'No se puede eliminar una categoría por defecto');
    }

    // Check if any concept types use this category
    const usedBy = await prisma.conceptType.count({
      where: { groupId, category: existing.name, isActive: true },
    });

    if (usedBy > 0) {
      return ApiResponse.badRequest(
        res,
        `No se puede eliminar. Hay ${usedBy} tipo(s) de servicio usando esta categoría`
      );
    }

    await prisma.serviceCategory.update({
      where: { id },
      data: { isActive: false },
    });

    return ApiResponse.success(res, null, 'Categoría eliminada');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/service-categories/seed-defaults
const seedDefaultServiceCategories = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const defaults = [
      { name: 'IMPUESTO', label: 'Impuesto', color: 'badge-error' },
      { name: 'SERVICIO', label: 'Servicio', color: 'badge-info' },
      { name: 'GASTO', label: 'Gasto', color: 'badge-warning' },
      { name: 'MANTENIMIENTO', label: 'Mantenimiento', color: 'badge-accent' },
      { name: 'DESCUENTO', label: 'Descuento', color: 'badge-success' },
      { name: 'BONIFICACION', label: 'Bonificación', color: 'badge-success' },
      { name: 'OTROS', label: 'Otros', color: 'badge-ghost' },
    ];

    const created = [];
    for (const d of defaults) {
      try {
        const cat = await prisma.serviceCategory.upsert({
          where: { groupId_name: { groupId, name: d.name } },
          update: {},
          create: { groupId, ...d, isDefault: true },
        });
        created.push(cat);
      } catch (e) {
        // Skip errors
      }
    }

    return ApiResponse.success(res, created, 'Categorías por defecto creadas');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServiceCategories,
  createServiceCategory,
  updateServiceCategory,
  deleteServiceCategory,
  seedDefaultServiceCategories,
};
