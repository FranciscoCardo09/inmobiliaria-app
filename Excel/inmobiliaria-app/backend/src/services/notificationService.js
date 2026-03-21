// Notification Orchestrator Service
// Coordinates template rendering, channel dispatch, and logging
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailService = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');
const templates = require('./notificationTemplates');

// --- HELPERS ---

/**
 * Get group with WhatsApp credentials
 */
const getGroupWithCredentials = async (groupId) => {
  return prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      companyName: true,
      whatsappAccountSid: true,
      whatsappAuthToken: true,
      whatsappFrom: true,
    },
  });
};

/**
 * Get primary tenant from a contract (with email + phone)
 */
const getTenantFromContract = async (contractId) => {
  const ct = await prisma.contractTenant.findFirst({
    where: { contractId, isPrimary: true },
    include: {
      tenant: {
        select: { id: true, name: true, dni: true, email: true, phone: true },
      },
    },
  });
  if (ct) return ct.tenant;

  // Fallback: direct tenant relation
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      tenant: {
        select: { id: true, name: true, dni: true, email: true, phone: true },
      },
    },
  });
  return contract?.tenant || null;
};

/**
 * Send via selected channels and log to NotificationLog
 */
const sendAndLog = async ({
  groupId, type, channel, recipientType, recipient, subject, html,
  whatsappText, contractId, monthlyRecordId, debtId, userId,
  attachments, whatsappCredentials,
}) => {
  let status = 'SENT';
  let errorMessage = null;

  try {
    if (channel === 'EMAIL') {
      if (!recipient.email) {
        return { status: 'SKIPPED', reason: 'Sin email' };
      }
      const result = await emailService.sendNotificationEmail({
        to: recipient.email,
        subject,
        html,
        attachments,
        fromName: whatsappCredentials?.companyName || undefined,
      });
      if (!result.success) {
        status = 'FAILED';
        errorMessage = result.error;
      }
    } else if (channel === 'WHATSAPP') {
      if (!recipient.phone) {
        return { status: 'SKIPPED', reason: 'Sin teléfono' };
      }
      const result = await sendWhatsApp({
        to: recipient.phone,
        body: whatsappText,
        credentials: whatsappCredentials,
      });
      if (!result.success) {
        status = 'FAILED';
        errorMessage = result.error;
      }
    }
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
  }

  // Log to NotificationLog
  await prisma.notificationLog.create({
    data: {
      groupId,
      type,
      channel,
      recipientType,
      recipientId: recipient.id,
      recipientName: recipient.name,
      recipientContact: channel === 'EMAIL' ? recipient.email : recipient.phone,
      contractId: contractId || null,
      monthlyRecordId: monthlyRecordId || null,
      debtId: debtId || null,
      subject,
      status,
      errorMessage,
      createdBy: userId,
    },
  });

  return { status, errorMessage };
};

/**
 * Process sending for multiple channels
 */
const sendForChannels = async (channels, params) => {
  const results = [];
  for (const channel of channels) {
    const result = await sendAndLog({ ...params, channel });
    results.push({ channel, ...result });
  }
  return results;
};

/**
 * Build summary from results array
 */
const buildSummary = (allResults) => {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const details = [];

  for (const r of allResults) {
    if (r.status === 'SENT') sent++;
    else if (r.status === 'FAILED') failed++;
    else if (r.status === 'SKIPPED') skipped++;
    details.push(r);
  }

  return { sent, failed, skipped, details };
};

// --- MAIN FUNCTIONS ---

/**
 * Send next-month liquidation notifications to selected tenants
 */
const sendNextMonth = async (groupId, tenantIds, channels, periodMonth, periodYear, userId) => {
  const group = await getGroupWithCredentials(groupId);
  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  // Get monthly records for the period, filtered by tenantIds via contract
  const records = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth,
      periodYear,
      contract: {
        OR: [
          { contractTenants: { some: { tenantId: { in: tenantIds }, isPrimary: true } } },
          { tenantId: { in: tenantIds } },
        ],
      },
    },
    include: {
      contract: {
        include: {
          contractTenants: {
            where: { isPrimary: true },
            include: { tenant: { select: { id: true, name: true, email: true, phone: true } } },
          },
          tenant: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
      services: {
        include: { conceptType: { select: { name: true } } },
      },
    },
  });

  const allResults = [];
  for (const record of records) {
    const tenant = record.contract.contractTenants?.[0]?.tenant || record.contract.tenant;
    if (!tenant) continue;

    const { subject, html, whatsappText } = templates.nextMonthTemplate(tenant, record, group.name);
    const results = await sendForChannels(channels, {
      groupId, type: 'NEXT_MONTH', recipientType: 'TENANT',
      recipient: tenant, subject, html, whatsappText,
      contractId: record.contractId, monthlyRecordId: record.id,
      userId, whatsappCredentials,
    });
    allResults.push(...results.map(r => ({ ...r, recipientName: tenant.name })));
  }

  return buildSummary(allResults);
};

/**
 * Send debt notifications to selected debts (auto-detect TOTAL vs PARTIAL)
 */
const sendDebtNotifications = async (groupId, debtIds, channels, userId) => {
  const group = await getGroupWithCredentials(groupId);
  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  const debts = await prisma.debt.findMany({
    where: { id: { in: debtIds }, groupId },
    include: {
      contract: {
        include: {
          contractTenants: {
            where: { isPrimary: true },
            include: { tenant: { select: { id: true, name: true, email: true, phone: true } } },
          },
          tenant: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
  });

  const allResults = [];
  for (const debt of debts) {
    const tenant = debt.contract.contractTenants?.[0]?.tenant || debt.contract.tenant;
    if (!tenant) continue;

    const type = debt.status === 'OPEN' ? 'DEBT_TOTAL' : 'DEBT_PARTIAL';
    const templateFn = debt.status === 'OPEN' ? templates.debtTotalTemplate : templates.debtPartialTemplate;
    const { subject, html, whatsappText } = templateFn(tenant, debt, group.name);

    const results = await sendForChannels(channels, {
      groupId, type, recipientType: 'TENANT',
      recipient: tenant, subject, html, whatsappText,
      contractId: debt.contractId, debtId: debt.id,
      userId, whatsappCredentials,
    });
    allResults.push(...results.map(r => ({ ...r, recipientName: tenant.name })));
  }

  return buildSummary(allResults);
};

/**
 * Send late payment notifications (cron - day 11)
 * No userId needed — uses system context
 */
const sendLatePayments = async (groupId) => {
  const group = await getGroupWithCredentials(groupId);
  if (!group) return { sent: 0, failed: 0, skipped: 0, details: [] };

  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Find unpaid records for current month
  const records = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth: currentMonth,
      periodYear: currentYear,
      isPaid: false,
      status: { not: 'COMPLETE' },
    },
    include: {
      contract: {
        include: {
          contractTenants: {
            where: { isPrimary: true },
            include: { tenant: { select: { id: true, name: true, email: true, phone: true } } },
          },
          tenant: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
  });

  // Get first admin user of the group for createdBy
  const adminMember = await prisma.userGroup.findFirst({
    where: { groupId, role: 'ADMIN' },
    select: { userId: true },
  });
  const systemUserId = adminMember?.userId;
  if (!systemUserId) return { sent: 0, failed: 0, skipped: 0, details: [] };

  const channels = [];
  // Send via both channels if configured
  channels.push('EMAIL');
  if (group.whatsappAccountSid && group.whatsappAuthToken && group.whatsappFrom) {
    channels.push('WHATSAPP');
  }

  const allResults = [];
  for (const record of records) {
    const tenant = record.contract.contractTenants?.[0]?.tenant || record.contract.tenant;
    if (!tenant) continue;

    const { subject, html, whatsappText } = templates.latePaymentTemplate(
      tenant, record, record.contract, group.name
    );

    const results = await sendForChannels(channels, {
      groupId, type: 'LATE_PAYMENT', recipientType: 'TENANT',
      recipient: tenant, subject, html, whatsappText,
      contractId: record.contractId, monthlyRecordId: record.id,
      userId: systemUserId, whatsappCredentials,
    });
    allResults.push(...results.map(r => ({ ...r, recipientName: tenant.name })));
  }

  return buildSummary(allResults);
};

/**
 * Send adjustment notification to selected contracts
 */
const sendAdjustmentNotice = async (groupId, contractIds, channels, userId) => {
  const group = await getGroupWithCredentials(groupId);
  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds }, groupId },
    include: {
      contractTenants: {
        where: { isPrimary: true },
        include: { tenant: { select: { id: true, name: true, email: true, phone: true } } },
      },
      tenant: { select: { id: true, name: true, email: true, phone: true } },
      adjustmentIndex: { select: { name: true } },
      rentHistory: { orderBy: { appliedAt: 'desc' }, take: 2 },
    },
  });

  const allResults = [];
  for (const contract of contracts) {
    const tenant = contract.contractTenants?.[0]?.tenant || contract.tenant;
    if (!tenant) continue;

    const newRent = contract.baseRent;
    const oldRent = contract.rentHistory?.[1]?.rentAmount || newRent;
    const indexName = contract.adjustmentIndex?.name || 'Manual';

    const { subject, html, whatsappText } = templates.adjustmentTemplate(
      tenant, contract, oldRent, newRent, indexName, group.name
    );

    const results = await sendForChannels(channels, {
      groupId, type: 'ADJUSTMENT', recipientType: 'TENANT',
      recipient: tenant, subject, html, whatsappText,
      contractId: contract.id, userId, whatsappCredentials,
    });
    allResults.push(...results.map(r => ({ ...r, recipientName: tenant.name })));
  }

  return buildSummary(allResults);
};

/**
 * Send contract expiring notification
 */
const sendContractExpiring = async (groupId, contractId, channels, userId) => {
  const group = await getGroupWithCredentials(groupId);
  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      contractTenants: {
        where: { isPrimary: true },
        include: { tenant: { select: { id: true, name: true, email: true, phone: true } } },
      },
      tenant: { select: { id: true, name: true, email: true, phone: true } },
      property: { select: { address: true } },
    },
  });

  if (!contract || contract.groupId !== groupId) {
    return { sent: 0, failed: 0, skipped: 0, details: [] };
  }

  const tenant = contract.contractTenants?.[0]?.tenant || contract.tenant;
  if (!tenant) return { sent: 0, failed: 0, skipped: 0, details: [] };

  const endDate = new Date(contract.startDate);
  endDate.setMonth(endDate.getMonth() + contract.durationMonths);
  const remainingDays = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));

  const { subject, html, whatsappText } = templates.contractExpiringTemplate(
    tenant, contract, contract.property, remainingDays, group.name
  );

  const results = await sendForChannels(channels, {
    groupId, type: 'CONTRACT_EXPIRING', recipientType: 'TENANT',
    recipient: tenant, subject, html, whatsappText,
    contractId: contract.id, userId, whatsappCredentials,
  });

  return buildSummary(results.map(r => ({ ...r, recipientName: tenant.name })));
};

/**
 * Send cash receipt after payment
 */
const sendCashReceipt = async (groupId, transactionId, channels, userId) => {
  const group = await getGroupWithCredentials(groupId);
  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
    include: {
      monthlyRecord: {
        include: {
          contract: {
            include: {
              contractTenants: {
                where: { isPrimary: true },
                include: { tenant: { select: { id: true, name: true, email: true, phone: true } } },
              },
              tenant: { select: { id: true, name: true, email: true, phone: true } },
            },
          },
        },
      },
    },
  });

  if (!transaction || transaction.groupId !== groupId) {
    return { sent: 0, failed: 0, skipped: 0, details: [] };
  }

  const contract = transaction.monthlyRecord.contract;
  const tenant = contract.contractTenants?.[0]?.tenant || contract.tenant;
  if (!tenant) return { sent: 0, failed: 0, skipped: 0, details: [] };

  const { subject, html, whatsappText } = templates.cashReceiptTemplate(tenant, transaction, group.name);

  const results = await sendForChannels(channels, {
    groupId, type: 'CASH_RECEIPT', recipientType: 'TENANT',
    recipient: tenant, subject, html, whatsappText,
    contractId: contract.id, monthlyRecordId: transaction.monthlyRecordId,
    userId, whatsappCredentials,
  });

  return buildSummary(results.map(r => ({ ...r, recipientName: tenant.name })));
};

/**
 * Send owner report / liquidation
 */
const sendOwnerReport = async (groupId, ownerIds, reportType, periodMonth, periodYear, channels, userId) => {
  const group = await getGroupWithCredentials(groupId);
  const whatsappCredentials = {
    accountSid: group.whatsappAccountSid,
    authToken: group.whatsappAuthToken,
    whatsappFrom: group.whatsappFrom,
    companyName: group.companyName || group.name,
  };

  const owners = await prisma.owner.findMany({
    where: { id: { in: ownerIds }, groupId },
    select: { id: true, name: true, email: true, phone: true },
  });

  const allResults = [];
  for (const owner of owners) {
    const liquidation = {
      period: `${templates.monthNames[periodMonth]} ${periodYear}`,
    };

    const { subject, html, whatsappText } = templates.ownerReportTemplate(owner, liquidation, group.name);

    const results = await sendForChannels(channels, {
      groupId, type: 'REPORT_OWNER', recipientType: 'OWNER',
      recipient: owner, subject, html, whatsappText,
      userId, whatsappCredentials,
    });
    allResults.push(...results.map(r => ({ ...r, recipientName: owner.name })));
  }

  return buildSummary(allResults);
};

/**
 * Get notification log with filters (paginated)
 */
const getNotificationLog = async (groupId, filters = {}) => {
  const { type, status, channel, from, to, page = 1, limit = 50 } = filters;

  const where = { groupId };
  if (type) where.type = type;
  if (status) where.status = status;
  if (channel) where.channel = channel;
  if (from || to) {
    where.sentAt = {};
    if (from) where.sentAt.gte = new Date(from);
    if (to) where.sentAt.lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { name: true } },
      },
    }),
    prisma.notificationLog.count({ where }),
  ]);

  return { logs, total, page, limit, pages: Math.ceil(total / limit) };
};

/**
 * Get notification stats for dashboard
 */
const getNotificationStats = async (groupId) => {
  const [byTypeAndStatus, byChannel] = await Promise.all([
    prisma.notificationLog.groupBy({
      by: ['type', 'status'],
      where: { groupId },
      _count: true,
    }),
    prisma.notificationLog.groupBy({
      by: ['channel', 'status'],
      where: { groupId },
      _count: true,
    }),
  ]);

  let totalSent = 0;
  let totalFailed = 0;
  const byType = {};

  for (const row of byTypeAndStatus) {
    if (!byType[row.type]) byType[row.type] = { sent: 0, failed: 0 };
    if (row.status === 'SENT') {
      byType[row.type].sent += row._count;
      totalSent += row._count;
    } else if (row.status === 'FAILED') {
      byType[row.type].failed += row._count;
      totalFailed += row._count;
    }
  }

  const channelStats = {};
  for (const row of byChannel) {
    if (!channelStats[row.channel]) channelStats[row.channel] = { sent: 0, failed: 0 };
    if (row.status === 'SENT') channelStats[row.channel].sent += row._count;
    else if (row.status === 'FAILED') channelStats[row.channel].failed += row._count;
  }

  return { totalSent, totalFailed, byType, byChannel: channelStats };
};

module.exports = {
  sendNextMonth,
  sendDebtNotifications,
  sendLatePayments,
  sendAdjustmentNotice,
  sendContractExpiring,
  sendCashReceipt,
  sendOwnerReport,
  getNotificationLog,
  getNotificationStats,
};
