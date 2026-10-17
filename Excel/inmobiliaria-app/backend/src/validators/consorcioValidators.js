// Validación de los cuerpos de la API de Consorcios. Los montos viajan en
// centavos enteros (la UI convierte "$ 1.234,56" → 123456).
const { z } = require('zod');
const { VARIABLES } = require('../services/consorcio/labels');
const { ROLES, KINDS } = require('../services/consorcio/defaults');

const cents = z.number().int('El monto tiene que estar en centavos enteros')
  .min(-Number.MAX_SAFE_INTEGER, 'Monto fuera de rango').max(Number.MAX_SAFE_INTEGER, 'Monto fuera de rango');
const text = (label) => z.string({ required_error: `${label} es obligatorio` }).trim().min(1, `${label} es obligatorio`);

// Un texto del informe sólo puede usar las variables conocidas ({mesAnterior}, …)
const template = (label) => text(label)
  .refine((s) => [...s.matchAll(/\{(\w+)\}/g)].every((m) => m[1] in VARIABLES),
    { message: `${label} usa una variable que no existe. Válidas: ${Object.keys(VARIABLES).map((v) => `{${v}}`).join(', ')}` })
  .refine((s) => s !== '__reserva__', { message: `${label} no puede ser "__reserva__"` });

const cbu = z.string().regex(/^\d{22}$/, 'El CBU tiene 22 dígitos');

const consorcioCreate = z.object({
  name: text('El nombre'),
  cbu,
  bankAccountName: z.string().trim().nullish(),
  initialReserveCents: cents.nullish(),
  reserveLabel: z.string().trim().min(1).optional(),
});
const consorcioUpdate = consorcioCreate.partial().extend({ isActive: z.boolean().optional() });

const rubroCreate = z.object({
  number: z.number().int().min(1).max(99),
  name: text('El nombre del rubro'),
  kind: z.enum(KINDS),
  role: z.enum(ROLES).nullish(),
  defaultItemLabel: template('El texto automático').nullish(),
});
const rubroUpdate = rubroCreate.partial();

const reglaFields = {
  matchCuit: z.string().regex(/^\d{11}$/, 'El CUIT tiene 11 dígitos').nullish(),
  matchText: z.string().trim().min(3, 'El texto a buscar necesita al menos 3 letras').nullish(),
  matchConcept: z.string().regex(/^\d{1,4}$/, 'El código de concepto es numérico').nullish(),
  direction: z.enum(['CREDITO', 'DEBITO']).nullish(),
  matchAmountCents: cents.positive().nullish(),
  rubroId: text('El rubro'),
  itemLabel: template('El texto de la línea'),
  alwaysAsk: z.boolean().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  isActive: z.boolean().optional(),
};
const reglaCreate = z.object(reglaFields).refine((r) => r.matchCuit || r.matchText || r.matchConcept, {
  message: 'La regla necesita al menos una condición: CUIT, texto o código de concepto',
  path: ['matchCuit'],
});
const reglaUpdate = z.object(reglaFields).partial();

const upload = z.object({
  fileBase64: z.string().min(8, 'Falta el archivo'),
  fileName: z.string().max(255).nullish(),
  replace: z.boolean().optional(),
});

const classify = z.object({
  items: z.array(z.object({
    movementId: text('El movimiento'),
    action: z.enum(['ASIGNAR', 'EXCLUIR', 'AUTO']),
    rubroId: z.string().nullish(),
    itemLabel: template('El texto de la línea').nullish(),
    note: z.string().max(500).nullish(),
    remember: z.enum(['SIEMPRE', 'PREGUNTAR']).nullish(),
  })).min(1, 'No hay movimientos para clasificar').max(1000),
});

const ajusteCreate = z.object({
  kind: z.enum(['AJUSTE', 'MANUAL']),
  rubroId: text('El rubro'),
  itemLabel: template('El texto de la línea'),
  amountCents: cents.min(0, 'El monto no puede ser negativo'),
  note: text('La nota'),
});
const ajusteUpdate = ajusteCreate.omit({ kind: true }).partial();

const reserve = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('MANUAL'), cents, note: text('La nota') }),
  z.object({ mode: z.literal('AUTO') }),
]);

const lineOrder = z.object({ keys: z.array(z.string().min(1)).max(1000) });

module.exports = {
  consorcioCreate, consorcioUpdate, rubroCreate, rubroUpdate, reglaCreate, reglaUpdate,
  upload, classify, ajusteCreate, ajusteUpdate, reserve, lineOrder,
};
