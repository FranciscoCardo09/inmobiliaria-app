// Notifications Controller
const ApiResponse = require('../utils/apiResponse');
const notificationService = require('../services/notificationService');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// POST /api/groups/:groupId/notifications/next-month
const sendNextMonth = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { tenantIds, channels, periodMonth, periodYear } = req.body;
    if (!tenantIds?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un inquilino');
    if (!channels?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un canal');
    const result = await notificationService.sendNextMonth(groupId, tenantIds, channels, periodMonth, periodYear, req.user.id);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// POST /api/groups/:groupId/notifications/debtors
const sendDebtors = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { debtIds, channels } = req.body;
    if (!debtIds?.length) return ApiResponse.badRequest(res, 'Seleccione al menos una deuda');
    if (!channels?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un canal');
    const result = await notificationService.sendDebtNotifications(groupId, debtIds, channels, req.user.id);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// POST /api/groups/:groupId/notifications/late-payments
const sendLatePayments = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await notificationService.sendLatePayments(groupId);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// POST /api/groups/:groupId/notifications/adjustments
const sendAdjustments = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractIds, channels } = req.body;
    if (!contractIds?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un contrato');
    if (!channels?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un canal');
    const result = await notificationService.sendAdjustmentNotice(groupId, contractIds, channels, req.user.id);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// POST /api/groups/:groupId/notifications/contract-expiring
const sendContractExpiring = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { contractId, channels } = req.body;
    if (!contractId) return ApiResponse.badRequest(res, 'contractId es requerido');
    if (!channels?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un canal');
    const result = await notificationService.sendContractExpiring(groupId, contractId, channels, req.user.id);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// POST /api/groups/:groupId/notifications/cash-receipt
const sendCashReceipt = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { transactionId, channels } = req.body;
    if (!transactionId) return ApiResponse.badRequest(res, 'transactionId es requerido');
    if (!channels?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un canal');
    const result = await notificationService.sendCashReceipt(groupId, transactionId, channels, req.user.id);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// POST /api/groups/:groupId/notifications/report-owner
const sendOwnerReport = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { ownerIds, reportType, month, year, channels } = req.body;
    if (!ownerIds?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un propietario');
    if (!channels?.length) return ApiResponse.badRequest(res, 'Seleccione al menos un canal');
    const result = await notificationService.sendOwnerReport(groupId, ownerIds, reportType, month, year, channels, req.user.id);
    return ApiResponse.success(res, result, `${result.sent} notificaciones enviadas`);
  } catch (error) { next(error); }
};

// GET /api/groups/:groupId/notifications/log
const getLog = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await notificationService.getNotificationLog(groupId, req.query);
    return ApiResponse.success(res, result);
  } catch (error) { next(error); }
};

// GET /api/groups/:groupId/notifications/stats
const getStats = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await notificationService.getNotificationStats(groupId);
    return ApiResponse.success(res, result);
  } catch (error) { next(error); }
};

// POST /api/cron/late-payments (cron endpoint - iterates ALL groups)
const cronLatePayments = async (req, res, next) => {
  try {
    const groups = await prisma.group.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const results = [];
    for (const group of groups) {
      const result = await notificationService.sendLatePayments(group.id);
      results.push({ groupId: group.id, ...result });
    }
    return ApiResponse.success(res, results, 'Cron ejecutado');
  } catch (error) { next(error); }
};

module.exports = {
  sendNextMonth,
  sendDebtors,
  sendLatePayments,
  sendAdjustments,
  sendContractExpiring,
  sendCashReceipt,
  sendOwnerReport,
  getLog,
  getStats,
  cronLatePayments,
};
