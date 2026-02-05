// Authentication Middleware
const { verifyAccessToken } = require('../utils/jwt');
const ApiResponse = require('../utils/apiResponse');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return ApiResponse.unauthorized(res, 'Token no proporcionado');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return ApiResponse.unauthorized(res, 'Token invalido o expirado');
    }

    // Get full user from DB
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return ApiResponse.unauthorized(res, 'Usuario no encontrado o inactivo');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return ApiResponse.unauthorized(res, 'Error de autenticacion');
  }
};

// Check if user is SuperAdmin
const requireSuperAdmin = (req, res, next) => {
  if (req.user.globalRole !== 'SUPERADMIN') {
    return ApiResponse.forbidden(res, 'Requiere rol SuperAdmin');
  }
  next();
};

module.exports = {
  authenticate,
  requireSuperAdmin,
};
