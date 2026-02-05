// Group Validators using Zod
const { z } = require('zod');

const createGroupSchema = z.object({
  name: z.string().min(2, 'Nombre debe tener minimo 2 caracteres').max(100),
  description: z.string().max(500).optional(),
  punitoryRate: z.number().min(0).max(1).optional(),
  currency: z.string().length(3).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  punitoryRate: z.number().min(0).max(1).optional(),
  currency: z.string().length(3).optional(),
});

const inviteUserSchema = z.object({
  email: z.string().email('Email invalido'),
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token es requerido'),
});

module.exports = {
  createGroupSchema,
  updateGroupSchema,
  inviteUserSchema,
  acceptInviteSchema,
};
