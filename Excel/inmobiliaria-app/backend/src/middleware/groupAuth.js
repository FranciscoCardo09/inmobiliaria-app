// Group Authorization Middleware
const ApiResponse = require('../utils/apiResponse');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verify user belongs to the group
const requireGroupMember = async (req, res, next) => {
  try {
    const groupId = req.params.groupId || req.params.gid;

    if (!groupId) {
      return ApiResponse.badRequest(res, 'Group ID es requerido');
    }

    const membership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: req.user.id,
          groupId: groupId,
        },
      },
      include: {
        group: true,
      },
    });

    if (!membership) {
      return ApiResponse.forbidden(res, 'No perteneces a este grupo');
    }

    if (!membership.group.isActive) {
      return ApiResponse.forbidden(res, 'Este grupo esta inactivo');
    }

    req.groupMembership = membership;
    req.group = membership.group;
    next();
  } catch (error) {
    console.error('Group auth error:', error);
    return ApiResponse.error(res, 'Error verificando pertenencia al grupo');
  }
};

// Verify user is Admin of the group
const requireGroupAdmin = async (req, res, next) => {
  try {
    await requireGroupMember(req, res, () => {
      if (req.groupMembership.role !== 'ADMIN') {
        return ApiResponse.forbidden(res, 'Requiere rol Admin en este grupo');
      }
      next();
    });
  } catch (error) {
    console.error('Group admin auth error:', error);
    return ApiResponse.error(res, 'Error verificando rol de admin');
  }
};

// Verify user is Admin or Operator
const requireGroupOperator = async (req, res, next) => {
  try {
    await requireGroupMember(req, res, () => {
      if (!['ADMIN', 'OPERATOR'].includes(req.groupMembership.role)) {
        return ApiResponse.forbidden(res, 'Requiere rol Admin u Operador');
      }
      next();
    });
  } catch (error) {
    console.error('Group operator auth error:', error);
    return ApiResponse.error(res, 'Error verificando rol');
  }
};

// Generic role-based access control
const requireGroupAccess = (allowedRoles = ['ADMIN', 'OPERATOR', 'VIEWER']) => {
  return async (req, res, next) => {
    try {
      const groupId = req.params.groupId || req.params.gid;

      if (!groupId) {
        return ApiResponse.badRequest(res, 'Group ID es requerido');
      }

      const membership = await prisma.userGroup.findUnique({
        where: {
          userId_groupId: {
            userId: req.user.id,
            groupId: groupId,
          },
        },
        include: {
          group: true,
        },
      });

      if (!membership) {
        return ApiResponse.forbidden(res, 'No perteneces a este grupo');
      }

      if (!membership.group.isActive) {
        return ApiResponse.forbidden(res, 'Este grupo esta inactivo');
      }

      if (!allowedRoles.includes(membership.role)) {
        return ApiResponse.forbidden(res, `Requiere uno de estos roles: ${allowedRoles.join(', ')}`);
      }

      req.groupMembership = membership;
      req.group = membership.group;
      next();
    } catch (error) {
      console.error('Group access error:', error);
      return ApiResponse.error(res, 'Error verificando acceso al grupo');
    }
  };
};

module.exports = {
  requireGroupMember,
  requireGroupAdmin,
  requireGroupOperator,
  requireGroupAccess,
};
