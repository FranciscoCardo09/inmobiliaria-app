// Properties Controller
// Handles: CRUD properties per group with filters

const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/properties
const getProperties = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { categoryId, search, isActive } = req.query;

    // Build where clause
    const where = { groupId };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      // SQLite doesn't support 'mode: insensitive', use contains only
      where.OR = [
        { address: { contains: search } },
        { code: { contains: search } },
        { observations: { contains: search } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const properties = await prisma.property.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
      orderBy: { address: 'asc' },
    });

    return ApiResponse.success(res, properties);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/properties/:id
const getPropertyById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const property = await prisma.property.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });

    if (!property || property.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Propiedad no encontrada');
    }

    return ApiResponse.success(res, property);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/properties
const createProperty = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      categoryId,
      address,
      code,
      squareMeters,
      rooms,
      bathrooms,
      floor,
      apartment,
      observations,
    } = req.body;

    // Verify category belongs to group if provided
    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category || category.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Categoria invalida');
      }
    }

    const property = await prisma.property.create({
      data: {
        groupId,
        categoryId,
        address,
        code,
        squareMeters: squareMeters ? parseFloat(squareMeters) : null,
        rooms: rooms ? parseInt(rooms, 10) : null,
        bathrooms: bathrooms ? parseInt(bathrooms, 10) : null,
        floor,
        apartment,
        observations,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });

    return ApiResponse.created(res, property, 'Propiedad creada exitosamente');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/properties/:id
const updateProperty = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const {
      categoryId,
      address,
      code,
      squareMeters,
      rooms,
      bathrooms,
      floor,
      apartment,
      observations,
      isActive,
    } = req.body;

    // Verify property belongs to group
    const property = await prisma.property.findUnique({
      where: { id },
    });

    if (!property || property.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Propiedad no encontrada');
    }

    // Verify category belongs to group if provided
    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category || category.groupId !== groupId) {
        return ApiResponse.badRequest(res, 'Categoria invalida');
      }
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        ...(categoryId !== undefined && { categoryId }),
        ...(address && { address }),
        ...(code !== undefined && { code }),
        ...(squareMeters !== undefined && { squareMeters: squareMeters ? parseFloat(squareMeters) : null }),
        ...(rooms !== undefined && { rooms: rooms ? parseInt(rooms, 10) : null }),
        ...(bathrooms !== undefined && { bathrooms: bathrooms ? parseInt(bathrooms, 10) : null }),
        ...(floor !== undefined && { floor }),
        ...(apartment !== undefined && { apartment }),
        ...(observations !== undefined && { observations }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });

    return ApiResponse.success(res, updated, 'Propiedad actualizada');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/properties/:id
const deleteProperty = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    // Verify property belongs to group
    const property = await prisma.property.findUnique({
      where: { id },
    });

    if (!property || property.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Propiedad no encontrada');
    }

    await prisma.property.delete({
      where: { id },
    });

    return ApiResponse.success(res, null, 'Propiedad eliminada');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
};
