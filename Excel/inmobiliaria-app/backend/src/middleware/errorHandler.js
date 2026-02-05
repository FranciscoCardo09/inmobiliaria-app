// Global Error Handler Middleware
const ApiResponse = require('../utils/apiResponse');
const config = require('../config');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Prisma errors
  if (err.code === 'P2002') {
    return ApiResponse.conflict(res, 'El registro ya existe');
  }

  if (err.code === 'P2025') {
    return ApiResponse.notFound(res, 'Registro no encontrado');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return ApiResponse.unauthorized(res, 'Token invalido');
  }

  if (err.name === 'TokenExpiredError') {
    return ApiResponse.unauthorized(res, 'Token expirado');
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return ApiResponse.badRequest(res, 'Error de validacion', errors);
  }

  // Default error
  const message = config.nodeEnv === 'development'
    ? err.message
    : 'Error interno del servidor';

  return ApiResponse.error(res, message, 500);
};

// Not found handler
const notFoundHandler = (req, res) => {
  return ApiResponse.notFound(res, `Ruta ${req.method} ${req.path} no encontrada`);
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
