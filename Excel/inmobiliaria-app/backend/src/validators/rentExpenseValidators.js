const { z } = require('zod');

const createReceiptSchema = z.object({
  fecha: z.coerce.date({ invalid_type_error: 'fecha inválida' }),
  tenantName: z.string().min(1, 'El nombre del inquilino es requerido').max(200),
  address: z.string().min(1, 'La dirección es requerida').max(300),
  ivaCondicion: z.string().max(100).nullish(),
  porCuentaYOrdenDe: z.string().max(200).nullish(),
  reserva: z.number().min(0, 'La reserva no puede ser negativa').finite().default(0),
  observations: z.string().max(500).nullish(),
  items: z
    .array(
      z.object({
        concepto: z.string().min(1, 'El concepto no puede estar vacío').max(200),
        importe: z.number({
          required_error: 'El importe es requerido',
          invalid_type_error: 'El importe debe ser un número',
        }).finite('El importe debe ser un número finito'),
        cuotaNumber: z.number().int().positive().nullish(),
        cuotaTotal: z.number().int().positive().nullish(),
      })
    )
    .min(1, 'Agregá al menos un concepto')
    .refine(
      (items) => items.every((i) => !i.cuotaNumber || (i.cuotaTotal && i.cuotaNumber <= i.cuotaTotal)),
      { message: 'La cuota no puede ser mayor al total de cuotas' }
    ),
});

module.exports = { createReceiptSchema };
