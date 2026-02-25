// Owners Controller
// Handles: CRUD owners (dueños de propiedades) per group

const ApiResponse = require('../utils/apiResponse');

const prisma = require('../lib/prisma');

// GET /api/groups/:groupId/owners
const getOwners = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { search } = req.query;

    const where = { groupId };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { dni: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const owners = await prisma.owner.findMany({
      where,
      include: {
        _count: { select: { properties: true } },
      },
      orderBy: { name: 'asc' },
    });

    return ApiResponse.success(res, owners);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/owners/:id
const getOwnerById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const owner = await prisma.owner.findUnique({
      where: { id },
      include: {
        properties: {
          select: { id: true, address: true, isActive: true },
          orderBy: { address: 'asc' },
        },
      },
    });

    if (!owner || owner.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Dueño no encontrado');
    }

    return ApiResponse.success(res, owner);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/owners
const createOwner = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, dni, phone, email, bankName, bankHolder, bankCuit, bankAccountType, bankAccountNumber, bankCbu, bankAlias } = req.body;

    if (!name || !dni || !phone) {
      return ApiResponse.badRequest(res, 'Nombre, DNI y teléfono son requeridos');
    }

    const existing = await prisma.owner.findUnique({
      where: { groupId_dni: { groupId, dni } },
    });

    if (existing) {
      return ApiResponse.conflict(res, 'Ya existe un dueño con ese DNI en este grupo');
    }

    const owner = await prisma.owner.create({
      data: { groupId, name, dni, phone, email, bankName, bankHolder, bankCuit, bankAccountType, bankAccountNumber, bankCbu, bankAlias },
      include: { _count: { select: { properties: true } } },
    });

    return ApiResponse.created(res, owner, 'Dueño creado exitosamente');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/owners/:id
const updateOwner = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { name, dni, phone, email, bankName, bankHolder, bankCuit, bankAccountType, bankAccountNumber, bankCbu, bankAlias } = req.body;

    const owner = await prisma.owner.findUnique({ where: { id } });
    if (!owner || owner.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Dueño no encontrado');
    }

    if (dni && dni !== owner.dni) {
      const existing = await prisma.owner.findUnique({
        where: { groupId_dni: { groupId, dni } },
      });
      if (existing) {
        return ApiResponse.conflict(res, 'Ya existe un dueño con ese DNI en este grupo');
      }
    }

    const updated = await prisma.owner.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(dni && { dni }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(bankName !== undefined && { bankName }),
        ...(bankHolder !== undefined && { bankHolder }),
        ...(bankCuit !== undefined && { bankCuit }),
        ...(bankAccountType !== undefined && { bankAccountType }),
        ...(bankAccountNumber !== undefined && { bankAccountNumber }),
        ...(bankCbu !== undefined && { bankCbu }),
        ...(bankAlias !== undefined && { bankAlias }),
      },
      include: { _count: { select: { properties: true } } },
    });

    return ApiResponse.success(res, updated, 'Dueño actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/owners/:id
const deleteOwner = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const owner = await prisma.owner.findUnique({
      where: { id },
      include: { _count: { select: { properties: true } } },
    });

    if (!owner || owner.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Dueño no encontrado');
    }

    if (owner._count.properties > 0) {
      return ApiResponse.badRequest(
        res,
        'No se puede eliminar un dueño con propiedades asignadas. Reasigne las propiedades primero.'
      );
    }

    await prisma.owner.delete({ where: { id } });
    return ApiResponse.success(res, null, 'Dueño eliminado');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOwners,
  getOwnerById,
  createOwner,
  updateOwner,
  deleteOwner,
};
