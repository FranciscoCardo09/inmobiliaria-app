const { z } = require('zod');

const bulkLoadServicesSchema = z.object({
  // Use string().min(1) instead of uuid() — dev seed data uses non-UUID IDs
  contractIds: z
    .array(z.string().min(1, 'contractId no puede estar vacío'))
    .min(1, 'contractIds debe contener al menos un contrato')
    .transform((arr) => Array.from(new Set(arr))),
  conceptTypeId: z.string().min(1, 'conceptTypeId es requerido'),
  amount: z
    .number({
      required_error: 'amount es requerido',
      invalid_type_error: 'amount debe ser un número',
    })
    .positive('amount debe ser mayor a 0')
    .finite('amount debe ser un número finito'),
  months: z
    .array(
      z.object({
        month: z.number().int().min(1, 'month debe estar entre 1 y 12').max(12, 'month debe estar entre 1 y 12'),
        year: z.number().int().min(2000, 'year debe ser mayor a 2000').max(2100, 'year debe ser menor a 2100'),
      })
    )
    .min(1, 'months debe contener al menos un período'),
  // nullish() accepts null, undefined, or string — preserves backwards compatibility
  description: z.string().max(500).nullish(),
});

module.exports = { bulkLoadServicesSchema };
