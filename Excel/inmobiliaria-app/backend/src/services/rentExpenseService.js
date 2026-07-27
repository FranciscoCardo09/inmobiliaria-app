// Rent Expense Service (Gastos Alquiler) - recibo de gastos de ingreso cobrados
// al inquilino nuevo (informes, apto eléctrico, honorarios, etc.) con descuento
// de reserva. Numeración propia (GA-######), catálogo de conceptos separado de
// ConceptType para no mezclarse con los servicios mensuales de contratos.
const prisma = require('../lib/prisma');
const { round2 } = require('../utils/punitory');

/**
 * Siguiente número de recibo de Gastos Alquiler, atómico y monotónico por
 * grupo. Mismo patrón que nextReceiptNumber en paymentTransactionService.js
 * (A-15), pero con su propio contador dedicado para no mezclar la serie con
 * los recibos de pago de alquiler.
 */
const nextReceiptNumber = async (tx, groupId) => {
  const seq = await tx.rentExpenseSequence.upsert({
    where: { groupId },
    create: { groupId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `GA-${String(seq.lastNumber).padStart(6, '0')}`;
};

/**
 * Crea el recibo junto con sus ítems, y alimenta el catálogo de conceptos
 * reutilizables. Total y saldo se recalculan en el servidor a partir de los
 * ítems recibidos: no se confía en lo que mande el front.
 */
const createReceipt = async (groupId, payload) => {
  const { fecha, tenantName, address, ivaCondicion, porCuentaYOrdenDe, reserva, observations, items } = payload;

  return prisma.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(tx, groupId);

    const total = round2(items.reduce((sum, item) => sum + item.importe, 0));
    const saldo = round2(total - (reserva || 0));

    const receipt = await tx.rentExpenseReceipt.create({
      data: {
        groupId,
        receiptNumber,
        fecha,
        tenantName,
        address,
        ivaCondicion: ivaCondicion || null,
        porCuentaYOrdenDe: porCuentaYOrdenDe || null,
        total,
        reserva: reserva || 0,
        saldo,
        observations: observations || null,
        items: {
          create: items.map((item, index) => ({
            concepto: item.concepto.trim(),
            importe: item.importe,
            cuotaNumber: item.cuotaNumber || null,
            cuotaTotal: item.cuotaTotal || null,
            order: index,
          })),
        },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });

    // Alimentar el catálogo de conceptos reutilizables (nombre solamente).
    // Reactiva un nombre que hubiera sido desactivado, igual que hace
    // createConceptType en paymentsController.js.
    const uniqueNames = Array.from(new Set(items.map((item) => item.concepto.trim()).filter(Boolean)));
    for (const name of uniqueNames) {
      await tx.rentExpenseConcept.upsert({
        where: { groupId_name: { groupId, name } },
        update: { isActive: true },
        create: { groupId, name },
      });
    }

    return receipt;
  });
};

const listReceipts = async (groupId, { from, to, search } = {}) => {
  const where = { groupId };

  if (from || to) {
    where.fecha = {};
    if (from) where.fecha.gte = new Date(from);
    if (to) where.fecha.lte = new Date(to);
  }

  if (search) {
    where.OR = [
      { tenantName: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
      { receiptNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  return prisma.rentExpenseReceipt.findMany({
    where,
    orderBy: { fecha: 'desc' },
  });
};

const getReceipt = async (groupId, id) => {
  const receipt = await prisma.rentExpenseReceipt.findUnique({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  if (!receipt || receipt.groupId !== groupId) return null;
  return receipt;
};

const deleteReceipt = async (groupId, id) => {
  const existing = await prisma.rentExpenseReceipt.findUnique({ where: { id } });
  if (!existing || existing.groupId !== groupId) return false;
  await prisma.rentExpenseReceipt.delete({ where: { id } });
  return true;
};

const listConcepts = async (groupId) => {
  return prisma.rentExpenseConcept.findMany({
    where: { groupId, isActive: true },
    orderBy: { name: 'asc' },
  });
};

const deactivateConcept = async (groupId, id) => {
  const existing = await prisma.rentExpenseConcept.findUnique({ where: { id } });
  if (!existing || existing.groupId !== groupId) return false;
  await prisma.rentExpenseConcept.update({ where: { id }, data: { isActive: false } });
  return true;
};

module.exports = {
  createReceipt,
  listReceipts,
  getReceipt,
  deleteReceipt,
  listConcepts,
  deactivateConcept,
};
