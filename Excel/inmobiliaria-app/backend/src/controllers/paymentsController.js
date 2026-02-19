// Payments Controller - Phase 4 v2
const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');
const {
  calculatePaymentConcepts,
} = require('../services/paymentService');

const prisma = new PrismaClient();

// GET /api/groups/:groupId/payments
// Supports filters: periodMonth, periodYear, status, categoryId, tenantId, propertyId, contractId, search
const getPayments = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      periodMonth,
      periodYear,
      status,
      categoryId,
      tenantId,
      propertyId,
      contractId,
      search,
    } = req.query;

    const where = { groupId };
    if (contractId) where.contractId = contractId;
    if (status) where.status = status;

    // Filter by cuota month/year
    if (periodMonth) where.periodMonth = parseInt(periodMonth);
    if (periodYear) where.periodYear = parseInt(periodYear);

    // Filters that require contract relation
    const contractWhere = {};
    if (tenantId) contractWhere.tenantId = tenantId;
    if (propertyId) contractWhere.propertyId = propertyId;
    if (categoryId) {
      contractWhere.property = { categoryId };
    }

    // Text search on tenant name or property address
    if (search) {
      contractWhere.OR = [
        { tenant: { name: { contains: search } } },
        { property: { address: { contains: search } } },
        { property: { code: { contains: search } } },
      ];
    }

    if (Object.keys(contractWhere).length > 0) {
      where.contract = contractWhere;
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        contract: {
          include: {
            tenant: { select: { id: true, name: true, dni: true } },
            property: {
              select: {
                id: true,
                address: true,
                code: true,
                categoryId: true,
                category: { select: { id: true, name: true, color: true } },
              },
            },
          },
        },
        concepts: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
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
            property: {
              select: {
                id: true,
                address: true,
                code: true,
                category: { select: { id: true, name: true, color: true } },
              },
            },
          },
        },
        concepts: {
          orderBy: { createdAt: 'asc' },
        },
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

// POST /api/groups/:groupId/payments
const createPayment = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      contractId,
      monthNumber,
      periodMonth,
      periodYear,
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

    if (!periodMonth || !periodYear) {
      return ApiResponse.badRequest(
        res,
        'periodMonth y periodYear son requeridos'
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

    // Calculate totals from concepts (IVA is now manual, included in concepts)
    const totalDue = concepts.reduce((sum, c) => sum + (c.amount || 0), 0);
    const paid = amountPaid !== undefined ? parseFloat(amountPaid) : 0;
    const balance = paid - totalDue;

    let status = 'PENDING';
    if (paid >= totalDue && paid > 0) status = 'COMPLETE';
    else if (paid > 0) status = 'PARTIAL';

    // Create payment with concepts in transaction
    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.payment.create({
        data: {
          groupId,
          contractId,
          monthNumber,
          periodMonth: parseInt(periodMonth),
          periodYear: parseInt(periodYear),
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
              property: {
                select: {
                  id: true,
                  address: true,
                  code: true,
                  category: { select: { id: true, name: true, color: true } },
                },
              },
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
      if (paid >= totalDue && paid > 0) status = 'COMPLETE';
      else if (paid > 0) status = 'PARTIAL';

      updateData.totalDue = totalDue;
      updateData.amountPaid = paid;
      updateData.balance = balance;
      updateData.status = status;

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
                property: {
                  select: {
                    id: true,
                    address: true,
                    code: true,
                    category: { select: { id: true, name: true, color: true } },
                  },
                },
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
      if (paid >= existing.totalDue && paid > 0) status = 'COMPLETE';
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
            property: {
              select: {
                id: true,
                address: true,
                code: true,
                category: { select: { id: true, name: true, color: true } },
              },
            },
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

// ============================================
// CONCEPT TYPES CRUD
// ============================================

// GET /api/groups/:groupId/concept-types
const getConceptTypes = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const conceptTypes = await prisma.conceptType.findMany({
      where: { groupId, isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return ApiResponse.success(res, conceptTypes);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/concept-types
const createConceptType = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, label, category, description } = req.body;

    if (!name || !label) {
      return ApiResponse.badRequest(res, 'name y label son requeridos');
    }

    // Normalize name to uppercase
    const normalizedName = name.toUpperCase().replace(/\s+/g, '_');

    const conceptType = await prisma.conceptType.create({
      data: {
        groupId,
        name: normalizedName,
        label,
        category: category || 'OTROS',
        description: description || null,
      },
    });

    return ApiResponse.created(res, conceptType, 'Tipo de concepto creado');
  } catch (error) {
    if (error.code === 'P2002') {
      return ApiResponse.conflict(res, 'Ya existe un concepto con ese nombre en este grupo');
    }
    next(error);
  }
};

// PUT /api/groups/:groupId/concept-types/:id
const updateConceptType = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;
    const { label, category, description, isActive } = req.body;

    const existing = await prisma.conceptType.findUnique({ where: { id } });
    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Tipo de concepto no encontrado');
    }

    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    const conceptType = await prisma.conceptType.update({
      where: { id },
      data: updateData,
    });

    return ApiResponse.success(res, conceptType, 'Tipo de concepto actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/concept-types/:id
const deleteConceptType = async (req, res, next) => {
  try {
    const { groupId, id } = req.params;

    const existing = await prisma.conceptType.findUnique({ where: { id } });
    if (!existing || existing.groupId !== groupId) {
      return ApiResponse.notFound(res, 'Tipo de concepto no encontrado');
    }

    // Soft delete - mark inactive
    await prisma.conceptType.update({
      where: { id },
      data: { isActive: false },
    });

    return ApiResponse.success(res, null, 'Tipo de concepto eliminado');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/concept-types/seed-defaults
const seedDefaultConceptTypes = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    // Also seed default service categories if they don't exist
    const defaultCategories = [
      { name: 'IMPUESTO', label: 'Impuesto', color: 'badge-error' },
      { name: 'SERVICIO', label: 'Servicio', color: 'badge-info' },
      { name: 'GASTO', label: 'Gasto', color: 'badge-warning' },
      { name: 'MANTENIMIENTO', label: 'Mantenimiento', color: 'badge-accent' },
      { name: 'DESCUENTO', label: 'Descuento', color: 'badge-success' },
      { name: 'OTROS', label: 'Otros', color: 'badge-ghost' },
    ];

    for (const dc of defaultCategories) {
      try {
        await prisma.serviceCategory.upsert({
          where: { groupId_name: { groupId, name: dc.name } },
          update: {},
          create: { groupId, ...dc, isDefault: true },
        });
      } catch (e) { /* skip */ }
    }

    const defaults = [
      { name: 'EXPENSAS', label: 'Expensas', category: 'GASTO', description: 'Expensas del edificio/consorcio' },
      { name: 'AGUA', label: 'Agua', category: 'SERVICIO', description: 'Servicio de agua corriente' },
      { name: 'SEGURO', label: 'Seguro', category: 'SERVICIO', description: 'Seguro de la propiedad' },
      { name: 'MUNICIPAL', label: 'Municipal', category: 'IMPUESTO', description: 'Tasa municipal' },
      { name: 'RENTAS', label: 'Rentas', category: 'IMPUESTO', description: 'Impuesto provincial de rentas' },
    ];

    const created = [];
    for (const d of defaults) {
      try {
        const ct = await prisma.conceptType.upsert({
          where: { groupId_name: { groupId, name: d.name } },
          update: {},
          create: { groupId, ...d, isDefault: true },
        });
        created.push(ct);
      } catch (e) {
        // Skip duplicates
      }
    }

    return ApiResponse.success(res, created, 'Conceptos por defecto creados');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  calculatePayment,
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  deletePayment,
  getConceptTypes,
  createConceptType,
  updateConceptType,
  deleteConceptType,
  seedDefaultConceptTypes,
};
