// Auth Validators using Zod
const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(8, 'Password debe tener minimo 8 caracteres'),
  name: z.string().min(2, 'Nombre debe tener minimo 2 caracteres').max(100),
});

const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Password es requerido'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token es requerido'),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
};
