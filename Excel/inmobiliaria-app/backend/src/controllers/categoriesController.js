// Categories Controller
// Handles: CRUD categories per group

const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/categories
const getCategories = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const categories = await prisma.category.findMany({
      where: { groupId },
      include: {
        _count: {
          select: { properties: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return ApiResponse.success(res, categories);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/categories
const createCategory = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, color, description } = req.body;

    // Check if category name already exists in this group
    const existing = await prisma.category.findUnique({
      where: {
        groupId_name: {
          groupId,
          name: name.toUpperCase(),
        },
      },
    });

    if (existing) {
      return ApiResponse.badRequest(res, 'Ya existe una categoria con ese nombre');
    }

    const category = await prisma.category.create({
      data: {
        groupId,
        name: name.toUpperCase(),
        color,
        description,
      },
    });

    return ApiResponse.created(res, category, 'Categoria creada exitosamente');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/categories/:id
const updateCategory = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { name, color, description, isActive } = req.body;

    // Verify category belongs to group
    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category || category.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Categoria no encontrada');
    }

    // Check name uniqueness if changing name
    if (name && name.toUpperCase() !== category.name) {
      const existing = await prisma.category.findUnique({
        where: {
          groupId_name: {
            groupId,
            name: name.toUpperCase(),
          },
        },
      });

      if (existing) {
        return ApiResponse.badRequest(res, 'Ya existe una categoria con ese nombre');
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(name && { name: name.toUpperCase() }),
        ...(color !== undefined && { color }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return ApiResponse.success(res, updated, 'Categoria actualizada');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/categories/:id
const deleteCategory = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    // Verify category belongs to group
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { properties: true },
        },
      },
    });

    if (!category || category.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Categoria no encontrada');
    }

    // Check if category has properties
    if (category._count.properties > 0) {
      return ApiResponse.badRequest(
        res,
        `No se puede eliminar. Hay ${category._count.properties} propiedades asociadas`
      );
    }

    await prisma.category.delete({
      where: { id },
    });

    return ApiResponse.success(res, null, 'Categoria eliminada');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
