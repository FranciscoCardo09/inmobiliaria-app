const { z } = require('zod');

const bulkLoadServicesSchema = z.object({
  contractIds: z
    .array(z.string().uuid('contractId debe ser un UUID válido'))
    .min(1, 'contractIds debe contener al menos un contrato')
    .transform((arr) => Array.from(new Set(arr))),
  conceptTypeId: z.string().uuid('conceptTypeId debe ser un UUID válido'),
  amount: z
    .number({ invalid_type_error: 'amount debe ser un número' })
    .positive('amount debe ser mayor a 0')
    .finite('amount debe ser un número finito'),
  months: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        year: z.number().int().min(2000).max(2100),
      })
    )
    .min(1, 'months debe contener al menos un período'),
  description: z.string().max(500).optional(),
});

module.exports = { bulkLoadServicesSchema };
