// Payments Controller - Phase 4
const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');
const {
  calculatePaymentConcepts,
  getCurrentMonthPayments,
  getNextMonthPayments,
} = require('../services/paymentService');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/payments/current-month
const getCurrentMonth = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const data = await getCurrentMonthPayments(groupId);
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/payments/next-month
const getNextMonth = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const data = await getNextMonthPayments(groupId);
    return ApiResponse.success(res, data);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/payments/calculate?contractId=xxx&paymentDate=2026-03-15
const calculatePayment = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId, paymentDate } = req.query;

    if (!contractId) {
      return ApiResponse.badRequest(res, 'contractId es requerido');
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        tenant: { select: { id: true, name: true } },
        property: { select: { id: true, address: true, code: true } },
        adjustmentIndex: true,
      },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.badRequest(res, 'Contrato no encontrado');
    }

    const result = await calculatePaymentConcepts(contract, paymentDate);

    return ApiResponse.success(res, {
      contract: {
        id: contract.id,
        tenant: contract.tenant,
        property: contract.property,
        baseRent: contract.baseRent,
        currentMonth: contract.currentMonth,
        punitoryStartDay: contract.punitoryStartDay,
        punitoryPercent: contract.punitoryPercent,
      },
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/payments
const getPayments = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId, status, from, to } = req.query;

    const where = { groupId };
    if (contractId) where.contractId = contractId;
    if (status) where.status = status;
    if (from || to) {
      where.paymentDate = {};
      if (from) where.paymentDate.gte = new Date(from);
      if (to) where.paymentDate.lte = new Date(to);
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        contract: {
          include: {
            tenant: { select: { id: true, name: true, dni: true } },
            property: { select: { id: true, address: true, code: true } },
          },
        },
        concepts: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return ApiResponse.success(res, payments);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/payments/:id
const getPaymentById = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: { select: { id: true, name: true, dni: true } },
            property: { select: { id: true, address: true, code: true } },
          },
        },
        concepts: true,
      },
    });

    if (!payment || payment.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Pago no encontrado');
    }

    return ApiResponse.success(res, payment);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/payments
const createPayment = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      contractId,
      monthNumber,
      paymentDate,
      amountPaid,
      concepts,
      observations,
    } = req.body;

    // Validations
    if (!contractId || !monthNumber || !concepts || !Array.isArray(concepts)) {
      return ApiResponse.badRequest(
        res,
        'contractId, monthNumber y concepts son requeridos'
      );
    }

    // Verify contract exists and belongs to group
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
    });

    if (!contract || contract.groupId !== groupId) {
      return ApiResponse.badRequest(res, 'Contrato no encontrado');
    }

    // Check if payment already exists for this contract+month
    const existing = await prisma.payment.findUnique({
      where: {
        contractId_monthNumber: { contractId, monthNumber },
      },
    });

    if (existing) {
      return ApiResponse.conflict(
        res,
        `Ya existe un pago para el mes ${monthNumber} de este contrato`
      );
    }

    // Calculate totals
    const totalDue = concepts.reduce((sum, c) => sum + (c.amount || 0), 0);
    const paid = amountPaid !== undefined ? parseFloat(amountPaid) : 0;
    const balance = paid - totalDue;

    let status = 'PENDING';
    if (paid >= totalDue) status = 'COMPLETE';
    else if (paid > 0) status = 'PARTIAL';

    // Create payment with concepts in transaction
    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.payment.create({
        data: {
          groupId,
          contractId,
          monthNumber,
          paymentDate: paymentDate ? new Date(paymentDate) : null,
          totalDue,
          amountPaid: paid,
          balance,
          status,
          observations,
          concepts: {
            create: concepts.map((c) => ({
              type: c.type,
              description: c.description || null,
              amount: c.amount || 0,
              isAutomatic: c.isAutomatic || false,
            })),
          },
        },
        include: {
          concepts: true,
          contract: {
            include: {
              tenant: { select: { id: true, name: true } },
              property: { select: { id: true, address: true, code: true } },
            },
          },
        },
      });

      return newPayment;
    });

    return ApiResponse.created(res, payment, 'Pago registrado exitosamente');
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/payments/:id
const updatePayment = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { amountPaid, paymentDate, observations, concepts } = req.body;

    const existing = await prisma.payment.findUnique({
      where: { id },
    });

    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Pago no encontrado');
    }

    const updateData = {};
    if (paymentDate !== undefined)
      updateData.paymentDate = paymentDate ? new Date(paymentDate) : null;
    if (observations !== undefined) updateData.observations = observations;

    // If concepts are provided, recalculate totals
    if (concepts && Array.isArray(concepts)) {
      const totalDue = concepts.reduce((sum, c) => sum + (c.amount || 0), 0);
      const paid =
        amountPaid !== undefined ? parseFloat(amountPaid) : existing.amountPaid;
      const balance = paid - totalDue;

      let status = 'PENDING';
      if (paid >= totalDue) status = 'COMPLETE';
      else if (paid > 0) status = 'PARTIAL';

      updateData.totalDue = totalDue;
      updateData.amountPaid = paid;
      updateData.balance = balance;
      updateData.status = status;

      // Delete old concepts and create new ones
      const payment = await prisma.$transaction(async (tx) => {
        await tx.paymentConcept.deleteMany({ where: { paymentId: id } });

        return tx.payment.update({
          where: { id },
          data: {
            ...updateData,
            concepts: {
              create: concepts.map((c) => ({
                type: c.type,
                description: c.description || null,
                amount: c.amount || 0,
                isAutomatic: c.isAutomatic || false,
              })),
            },
          },
          include: {
            concepts: true,
            contract: {
              include: {
                tenant: { select: { id: true, name: true } },
                property: { select: { id: true, address: true, code: true } },
              },
            },
          },
        });
      });

      return ApiResponse.success(res, payment, 'Pago actualizado');
    }

    // Simple update without concepts change
    if (amountPaid !== undefined) {
      const paid = parseFloat(amountPaid);
      const balance = paid - existing.totalDue;

      let status = 'PENDING';
      if (paid >= existing.totalDue) status = 'COMPLETE';
      else if (paid > 0) status = 'PARTIAL';

      updateData.amountPaid = paid;
      updateData.balance = balance;
      updateData.status = status;
    }

    const payment = await prisma.payment.update({
      where: { id },
      data: updateData,
      include: {
        concepts: true,
        contract: {
          include: {
            tenant: { select: { id: true, name: true } },
            property: { select: { id: true, address: true, code: true } },
          },
        },
      },
    });

    return ApiResponse.success(res, payment, 'Pago actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/payments/:id
const deletePayment = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const existing = await prisma.payment.findUnique({
      where: { id },
    });

    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Pago no encontrado');
    }

    await prisma.payment.delete({ where: { id } });

    return ApiResponse.success(res, null, 'Pago eliminado');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCurrentMonth,
  getNextMonth,
  calculatePayment,
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  deletePayment,
};
