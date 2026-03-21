# Notification System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 7-type notification system (email + WhatsApp) with checkbox selection, cron automation, and notification dashboard to the inmobiliaria app.

**Architecture:** New `NotificationLog` Prisma model for tracking. Three new backend services (whatsapp, templates, notification orchestrator) + controller + routes. Frontend gets checkbox lists, a send modal, and a notification dashboard page. External cron via cron-job.org for day-11 late payment alerts.

**Tech Stack:** Express, Prisma/PostgreSQL, Resend (email), Twilio (WhatsApp), React, TanStack Query, DaisyUI

**Design doc:** `docs/plans/2026-02-23-notification-system-design.md`

---

### Task 1: Prisma Schema — NotificationLog model + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (append after line 658)

**Step 1: Add enums and NotificationLog model**

Append to `schema.prisma` after the `ContractTenant` model:

```prisma
enum NotificationType {
  NEXT_MONTH
  DEBT_TOTAL
  DEBT_PARTIAL
  LATE_PAYMENT
  ADJUSTMENT
  CONTRACT_EXPIRING
  CASH_RECEIPT
  REPORT_OWNER
  REPORT_TENANT
}

enum NotificationChannel {
  EMAIL
  WHATSAPP
}

enum RecipientType {
  TENANT
  OWNER
  ADMIN
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}

model NotificationLog {
  id               String             @id @default(uuid())
  groupId          String             @map("group_id")
  type             NotificationType
  channel          NotificationChannel
  recipientType    RecipientType      @map("recipient_type")
  recipientId      String?            @map("recipient_id")
  recipientName    String             @map("recipient_name")
  recipientContact String?            @map("recipient_contact")
  contractId       String?            @map("contract_id")
  monthlyRecordId  String?            @map("monthly_record_id")
  debtId           String?            @map("debt_id")
  subject          String
  status           NotificationStatus @default(PENDING)
  errorMessage     String?            @map("error_message")
  metadata         Json?
  sentAt           DateTime           @default(now()) @map("sent_at")
  createdBy        String             @map("created_by")

  group   Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user    User  @relation(fields: [createdBy], references: [id])

  @@index([groupId])
  @@index([type])
  @@index([status])
  @@index([sentAt])
  @@map("notification_logs")
}
```

Also add `notifications NotificationLog[]` to the `Group` model relations, and `notificationsSent NotificationLog[]` to the `User` model relations.

**Step 2: Generate and run migration**

```bash
cd backend && npx prisma migrate dev --name add-notification-log
```

Expected: Migration created and applied, `npx prisma generate` runs automatically.

**Step 3: Verify**

```bash
cd backend && npx prisma studio
```

Check that `NotificationLog` table appears with correct columns.

**Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add NotificationLog model with enums for notification tracking"
```

---

### Task 2: WhatsApp Service (Twilio)

**Files:**
- Create: `backend/src/services/whatsappService.js`
- Modify: `backend/src/config/index.js` (add twilio config — check how resend config is loaded)
- Modify: `backend/package.json` (add twilio dependency)

**Step 1: Install twilio**

```bash
cd backend && npm install twilio
```

**Step 2: Add twilio config**

Check `backend/src/config/index.js` for the pattern, then add:

```js
twilio: {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  whatsappFrom: process.env.TWILIO_WHATSAPP_FROM,
},
```

**Step 3: Create whatsappService.js**

```js
const twilio = require('twilio');
const config = require('../config');

let client = null;

const getClient = () => {
  if (!client && config.twilio.accountSid && config.twilio.authToken) {
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return client;
};

const formatArgentinePhone = (phone) => {
  if (!phone) return null;
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // If starts with 0, remove it (local format)
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  // If doesn't start with +, add +54
  if (!cleaned.startsWith('+')) {
    // If starts with 54, add +
    if (cleaned.startsWith('54')) cleaned = '+' + cleaned;
    // If starts with 9 (mobile), add +54
    else if (cleaned.startsWith('9')) cleaned = '+54' + cleaned;
    // Otherwise assume local, add +549
    else cleaned = '+549' + cleaned;
  }
  return cleaned;
};

const sendWhatsApp = async ({ to, body, mediaUrl }) => {
  try {
    const twilioClient = getClient();
    if (!twilioClient) {
      console.warn('Twilio not configured, skipping WhatsApp send');
      return { success: false, error: 'Twilio no configurado' };
    }

    const formattedPhone = formatArgentinePhone(to);
    if (!formattedPhone) {
      return { success: false, error: 'Número de teléfono inválido' };
    }

    const messageData = {
      from: config.twilio.whatsappFrom,
      to: `whatsapp:${formattedPhone}`,
      body,
    };

    if (mediaUrl) {
      messageData.mediaUrl = [mediaUrl];
    }

    const message = await twilioClient.messages.create(messageData);
    console.log(`WhatsApp sent to ${formattedPhone}: ${message.sid}`);
    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendWhatsApp, formatArgentinePhone };
```

**Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/whatsappService.js backend/src/config/
git commit -m "feat: add WhatsApp service with Twilio integration"
```

---

### Task 3: Notification Templates

**Files:**
- Create: `backend/src/services/notificationTemplates.js`

**Step 1: Create notificationTemplates.js**

Each function returns `{ subject, html, whatsappText }`. Use the `baseTemplate` pattern from `emailService.js` for HTML wrapping.

```js
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(amount);
};

const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// --- TEMPLATE FUNCTIONS ---

const nextMonthTemplate = (tenant, record, groupName) => {
  const period = `${monthNames[record.periodMonth]} ${record.periodYear}`;
  const concepts = (record.services || []).map(s =>
    `${s.conceptType?.name || s.name}: ${formatCurrency(s.amount)}`
  ).join('\n');

  const subject = `Liquidación ${period} - ${groupName}`;

  const whatsappText = [
    `*Liquidación ${period} - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `${period.toUpperCase()} vence DÍA 10:`,
    `Alquiler: ${formatCurrency(record.rentAmount)}`,
    concepts ? concepts : '',
    `*TOTAL: ${formatCurrency(record.totalDue)}*`,
    ``,
    `Pague antes del día 10.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>Liquidación ${period}</h2>
    <p>Hola ${tenant.name},</p>
    <p><strong>${period.toUpperCase()}</strong> vence DÍA 10:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Alquiler</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(record.rentAmount)}</td></tr>
      ${(record.services || []).map(s => `
        <tr><td style="padding:8px;border-bottom:1px solid #eee">${s.conceptType?.name || s.name}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(s.amount)}</td></tr>
      `).join('')}
      <tr style="font-weight:bold"><td style="padding:8px">TOTAL</td>
          <td style="padding:8px;text-align:right">${formatCurrency(record.totalDue)}</td></tr>
    </table>
    <p>Pague antes del día 10.</p>
  `;

  return { subject, html, whatsappText };
};

const debtTotalTemplate = (tenant, debt, groupName) => {
  const subject = `DEUDA ${debt.periodLabel} - ${groupName}`;
  const dailyPunitory = debt.unpaidRentAmount * (debt.punitoryPercent || 0.02);

  const whatsappText = [
    `*⚠️ DEUDA ${debt.periodLabel} - ${groupName}*`,
    ``,
    `${tenant.name},`,
    `NO pagó ${debt.periodLabel}: ${formatCurrency(debt.unpaidRentAmount)}`,
    `Punitorios DESDE día ${debt.punitoryStartDate ? new Date(debt.punitoryStartDate).getDate() : '4'}`,
    `${formatCurrency(dailyPunitory)} POR DÍA`,
    ``,
    `Regularice a la brevedad.`,
  ].join('\n');

  const html = `
    <h2>⚠️ Deuda ${debt.periodLabel}</h2>
    <p>${tenant.name},</p>
    <p>NO registramos pago de <strong>${debt.periodLabel}</strong>:</p>
    <p style="font-size:24px;font-weight:bold;color:#dc2626">${formatCurrency(debt.unpaidRentAmount)}</p>
    <p>Punitorios: <strong>${formatCurrency(dailyPunitory)} por día</strong></p>
    <p>Regularice a la brevedad.</p>
  `;

  return { subject, html, whatsappText };
};

const debtPartialTemplate = (tenant, debt, groupName) => {
  const remaining = debt.unpaidRentAmount - (debt.amountPaid || 0);
  const dailyPunitory = remaining * (debt.punitoryPercent || 0.02);
  const subject = `SALDO PENDIENTE ${debt.periodLabel} - ${groupName}`;

  const whatsappText = [
    `*⚠️ SALDO PENDIENTE ${debt.periodLabel} - ${groupName}*`,
    ``,
    `${tenant.name},`,
    `Saldo ${debt.periodLabel}: ${formatCurrency(remaining)}`,
    debt.lastPaymentDate ? `Último pago: ${new Date(debt.lastPaymentDate).toLocaleDateString('es-AR')}` : '',
    `Punitorios: ${formatCurrency(dailyPunitory)} POR DÍA`,
    ``,
    `Regularice a la brevedad.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>⚠️ Saldo pendiente ${debt.periodLabel}</h2>
    <p>${tenant.name},</p>
    <p>Saldo de <strong>${debt.periodLabel}</strong>:</p>
    <p style="font-size:24px;font-weight:bold;color:#f59e0b">${formatCurrency(remaining)}</p>
    ${debt.lastPaymentDate ? `<p>Último pago: ${new Date(debt.lastPaymentDate).toLocaleDateString('es-AR')}</p>` : ''}
    <p>Punitorios: <strong>${formatCurrency(dailyPunitory)} por día</strong></p>
    <p>Regularice a la brevedad.</p>
  `;

  return { subject, html, whatsappText };
};

const latePaymentTemplate = (tenant, record, contract, groupName) => {
  const period = `${monthNames[record.periodMonth]} ${record.periodYear}`;
  const dailyPunitory = record.rentAmount * (contract.punitoryPercent || 0.02);
  const subject = `URGENTE - Pago ${period} ATRASADO - ${groupName}`;

  const whatsappText = [
    `*🚨 URGENTE - Pago ${period} ATRASADO*`,
    ``,
    `${tenant.name},`,
    `NO pagó antes del día 10.`,
    `Punitorios DESDE día ${contract.punitoryStartDay || 4}: ${formatCurrency(dailyPunitory)}/día`,
    ``,
    `Pague HOY.`,
  ].join('\n');

  const html = `
    <h2 style="color:#dc2626">🚨 URGENTE - Pago ${period} ATRASADO</h2>
    <p>${tenant.name},</p>
    <p>NO registramos su pago antes del día 10.</p>
    <p>Punitorios desde día ${contract.punitoryStartDay || 4}: <strong>${formatCurrency(dailyPunitory)}/día</strong></p>
    <p style="font-weight:bold">Pague HOY.</p>
  `;

  return { subject, html, whatsappText };
};

const adjustmentTemplate = (tenant, contract, oldRent, newRent, indexName, groupName) => {
  const pctChange = ((newRent - oldRent) / oldRent * 100).toFixed(1);
  const subject = `Ajuste de alquiler - ${groupName}`;

  const whatsappText = [
    `*Ajuste de alquiler - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `Su alquiler fue ajustado por índice ${indexName}:`,
    `Anterior: ${formatCurrency(oldRent)}`,
    `Nuevo: ${formatCurrency(newRent)} (+${pctChange}%)`,
    ``,
    `Vigente desde el próximo período.`,
  ].join('\n');

  const html = `
    <h2>Ajuste de alquiler</h2>
    <p>Hola ${tenant.name},</p>
    <p>Su alquiler fue ajustado por índice <strong>${indexName}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Anterior</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(oldRent)}</td></tr>
      <tr style="font-weight:bold"><td style="padding:8px">Nuevo (+${pctChange}%)</td>
          <td style="padding:8px;text-align:right">${formatCurrency(newRent)}</td></tr>
    </table>
    <p>Vigente desde el próximo período.</p>
  `;

  return { subject, html, whatsappText };
};

const contractExpiringTemplate = (tenant, contract, property, remainingDays, groupName) => {
  const endDate = new Date(contract.startDate);
  endDate.setMonth(endDate.getMonth() + contract.durationMonths);
  const subject = `Contrato próximo a vencer - ${groupName}`;

  const whatsappText = [
    `*Contrato próximo a vencer - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `Su contrato en ${property.address} vence el ${endDate.toLocaleDateString('es-AR')}.`,
    `Quedan ${remainingDays} días.`,
    ``,
    `Comuníquese para coordinar la renovación.`,
  ].join('\n');

  const html = `
    <h2>Contrato próximo a vencer</h2>
    <p>Hola ${tenant.name},</p>
    <p>Su contrato en <strong>${property.address}</strong> vence el <strong>${endDate.toLocaleDateString('es-AR')}</strong>.</p>
    <p>Quedan <strong>${remainingDays} días</strong>.</p>
    <p>Comuníquese para coordinar la renovación.</p>
  `;

  return { subject, html, whatsappText };
};

const cashReceiptTemplate = (tenant, transaction, groupName) => {
  const subject = `Recibo de pago #${transaction.receiptNumber || ''} - ${groupName}`;

  const whatsappText = [
    `*Recibo de pago - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `Registramos su pago:`,
    `Monto: ${formatCurrency(transaction.amount)}`,
    `Fecha: ${new Date(transaction.paymentDate).toLocaleDateString('es-AR')}`,
    transaction.receiptNumber ? `Recibo #${transaction.receiptNumber}` : '',
    ``,
    `Gracias.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>Recibo de pago</h2>
    <p>Hola ${tenant.name},</p>
    <p>Registramos su pago:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Monto</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(transaction.amount)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Fecha</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${new Date(transaction.paymentDate).toLocaleDateString('es-AR')}</td></tr>
      ${transaction.receiptNumber ? `<tr><td style="padding:8px">Recibo</td><td style="padding:8px;text-align:right">#${transaction.receiptNumber}</td></tr>` : ''}
    </table>
    <p>Gracias.</p>
  `;

  return { subject, html, whatsappText };
};

const ownerReportTemplate = (owner, liquidation, groupName) => {
  const period = liquidation.period || 'del período';
  const subject = `Liquidación ${period} - ${groupName}`;

  const whatsappText = [
    `*Liquidación ${period} - ${groupName}*`,
    ``,
    `Hola ${owner.name},`,
    `Le informamos el detalle de su liquidación:`,
    liquidation.totalIncome ? `Ingresos: ${formatCurrency(liquidation.totalIncome)}` : '',
    liquidation.commission ? `Comisión: ${formatCurrency(liquidation.commission)}` : '',
    liquidation.netAmount ? `*Neto depositado: ${formatCurrency(liquidation.netAmount)}*` : '',
    ``,
    `PDF adjunto en el email.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>Liquidación ${period}</h2>
    <p>Hola ${owner.name},</p>
    <p>Le informamos el detalle de su liquidación:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${liquidation.totalIncome ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Ingresos</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(liquidation.totalIncome)}</td></tr>` : ''}
      ${liquidation.commission ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Comisión</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(liquidation.commission)}</td></tr>` : ''}
      ${liquidation.netAmount ? `<tr style="font-weight:bold"><td style="padding:8px">Neto depositado</td><td style="padding:8px;text-align:right">${formatCurrency(liquidation.netAmount)}</td></tr>` : ''}
    </table>
    <p>Adjuntamos el PDF con el detalle completo.</p>
  `;

  return { subject, html, whatsappText };
};

module.exports = {
  nextMonthTemplate,
  debtTotalTemplate,
  debtPartialTemplate,
  latePaymentTemplate,
  adjustmentTemplate,
  contractExpiringTemplate,
  cashReceiptTemplate,
  ownerReportTemplate,
  formatCurrency,
  monthNames,
};
```

**Step 2: Commit**

```bash
git add backend/src/services/notificationTemplates.js
git commit -m "feat: add notification message templates for all 9 notification types"
```

---

### Task 4: Extend emailService + Notification Orchestrator

**Files:**
- Modify: `backend/src/services/emailService.js` (add `sendNotificationEmail` method, lines ~338)
- Create: `backend/src/services/notificationService.js`

**Step 1: Add sendNotificationEmail to emailService**

Add to the `emailService` object (before the closing `}` around line 341):

```js
sendNotificationEmail: async ({ to, subject, html, attachments }) => {
  const fullHtml = baseTemplate(html, subject);
  return sendEmail({ to, subject, html: fullHtml, attachments });
},
```

**Step 2: Create notificationService.js**

This is the largest file. It orchestrates:
- Querying data from Prisma
- Calling templates
- Sending via email/WhatsApp
- Logging to NotificationLog

Key functions to implement:

```js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailService = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');
const templates = require('./notificationTemplates');

// Helper: send via selected channels and log
const sendAndLog = async ({ groupId, type, channel, recipientType, recipient, subject, html, whatsappText, contractId, monthlyRecordId, debtId, userId, attachments }) => {
  // ... sends email or whatsapp based on channel, creates NotificationLog entry
};

// Helper: get tenant with contact info from contract
const getTenantFromContract = async (contractId) => {
  // Query ContractTenant where isPrimary + include tenant with email, phone
};

module.exports = {
  sendNextMonth: async (groupId, tenantIds, channels, periodMonth, periodYear, userId) => { ... },
  sendDebtNotifications: async (groupId, debtIds, channels, userId) => { ... },
  sendLatePayments: async (groupId) => { ... },
  sendAdjustmentNotice: async (groupId, contractIds, channels, userId) => { ... },
  sendContractExpiring: async (groupId, contractId, channels, userId) => { ... },
  sendCashReceipt: async (groupId, transactionId, channels, userId) => { ... },
  sendOwnerReport: async (groupId, ownerIds, reportType, periodMonth, periodYear, channels, userId) => { ... },
  getNotificationLog: async (groupId, filters) => { ... },
  getNotificationStats: async (groupId) => { ... },
};
```

Each `send*` function follows the same pattern:
1. Query Prisma for all needed data (include tenant/owner email+phone)
2. For each recipient:
   a. Check contact info exists for selected channel
   b. Call appropriate template function
   c. Call `sendAndLog()` for each channel
3. Return `{ sent, failed, skipped, details[] }`

**Implementation notes:**
- `sendNextMonth`: query MonthlyRecords by period + tenantIds via contract.contractTenants, include services
- `sendDebtNotifications`: query Debts by debtIds, auto-detect DEBT_TOTAL (status OPEN) vs DEBT_PARTIAL (status PARTIAL)
- `sendLatePayments`: query MonthlyRecords WHERE current month, isPaid=false, status != COMPLETE. No userId (system/cron). Use `createdBy` = a system user ID or the first admin of the group
- `sendOwnerReport`: query Owner by ownerIds, generate PDF using existing report service, attach to email, WhatsApp gets text-only summary
- `getNotificationLog`: paginated query on NotificationLog with filters (type, status, dateRange)
- `getNotificationStats`: aggregation query with `groupBy` on type and channel

**Step 3: Commit**

```bash
git add backend/src/services/emailService.js backend/src/services/notificationService.js
git commit -m "feat: add notification orchestrator service with send+log for all 7 types"
```

---

### Task 5: Cron Auth Middleware

**Files:**
- Create: `backend/src/middleware/cronAuth.js`

**Step 1: Create cronAuth.js**

Follow the pattern from `backend/src/middleware/auth.js`:

```js
const ApiResponse = require('../utils/apiResponse');

const cronAuth = (req, res, next) => {
  const cronSecret = req.headers['x-cron-secret'];

  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return ApiResponse.unauthorized(res, 'Cron secret inválido');
  }

  next();
};

module.exports = { cronAuth };
```

**Step 2: Commit**

```bash
git add backend/src/middleware/cronAuth.js
git commit -m "feat: add cron authentication middleware"
```

---

### Task 6: Controller + Routes

**Files:**
- Create: `backend/src/controllers/notificationsController.js`
- Create: `backend/src/routes/notifications.routes.js`
- Create: `backend/src/routes/cron.routes.js`
- Modify: `backend/src/routes/index.js` (register new routes, ~lines 26 and 95)

**Step 1: Create notificationsController.js**

Follow the pattern from `backend/src/controllers/debtsController.js`:

```js
const ApiResponse = require('../utils/apiResponse');
const notificationService = require('../services/notificationService');

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

// Same pattern for: sendDebtors, sendLatePayments, sendAdjustments,
// sendContractExpiring, sendCashReceipt, sendOwnerReport, getLog, getStats

const cronLatePayments = async (req, res, next) => {
  try {
    // Get ALL groups
    const groups = await prisma.group.findMany({ select: { id: true } });
    const results = [];
    for (const group of groups) {
      const result = await notificationService.sendLatePayments(group.id);
      results.push({ groupId: group.id, ...result });
    }
    return ApiResponse.success(res, results, 'Cron ejecutado');
  } catch (error) { next(error); }
};

module.exports = { sendNextMonth, sendDebtors, sendLatePayments, sendAdjustments,
  sendContractExpiring, sendCashReceipt, sendOwnerReport, getLog, getStats, cronLatePayments };
```

**Step 2: Create notifications.routes.js**

```js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');
const ctrl = require('../controllers/notificationsController');

// All routes require ADMIN
router.use(authenticate, requireGroupAccess(['ADMIN']));

router.post('/next-month', ctrl.sendNextMonth);
router.post('/debtors', ctrl.sendDebtors);
router.post('/late-payments', ctrl.sendLatePayments);
router.post('/adjustments', ctrl.sendAdjustments);
router.post('/contract-expiring', ctrl.sendContractExpiring);
router.post('/cash-receipt', ctrl.sendCashReceipt);
router.post('/report-owner', ctrl.sendOwnerReport);
router.get('/log', ctrl.getLog);
router.get('/stats', ctrl.getStats);

module.exports = router;
```

**Step 3: Create cron.routes.js**

```js
const express = require('express');
const router = express.Router();
const { cronAuth } = require('../middleware/cronAuth');
const ctrl = require('../controllers/notificationsController');

router.post('/late-payments', cronAuth, ctrl.cronLatePayments);

module.exports = router;
```

**Step 4: Register routes in index.js**

At ~line 26, add:
```js
const notificationsRoutes = require('./notifications.routes');
const cronRoutes = require('./cron.routes');
```

At ~line 95, add:
```js
router.use('/groups/:groupId/notifications', notificationsRoutes);
router.use('/cron', cronRoutes);
```

**Step 5: Commit**

```bash
git add backend/src/controllers/notificationsController.js backend/src/routes/notifications.routes.js backend/src/routes/cron.routes.js backend/src/routes/index.js
git commit -m "feat: add notification endpoints (7 send + log + stats + cron)"
```

---

### Task 7: Frontend — useNotifications Hook

**Files:**
- Create: `frontend/src/hooks/useNotifications.js`

**Step 1: Create hook**

Follow pattern from `frontend/src/hooks/useDebts.js`:

```js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useNotifications = (groupId) => {
  const queryClient = useQueryClient()

  const logQuery = useQuery({
    queryKey: ['notifications', 'log', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/notifications/log`)
      return res.data.data
    },
    enabled: !!groupId,
  })

  const statsQuery = useQuery({
    queryKey: ['notifications', 'stats', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/notifications/stats`)
      return res.data.data
    },
    enabled: !!groupId,
  })

  const createSendMutation = (endpoint) => useMutation({
    mutationFn: async (body) => {
      const res = await api.post(`/groups/${groupId}/notifications/${endpoint}`, body)
      return res.data.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success(`${data.sent} notificaciones enviadas`)
      if (data.failed > 0) toast.error(`${data.failed} fallaron`)
      if (data.skipped > 0) toast(`${data.skipped} omitidos (sin contacto)`)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Error enviando notificaciones'),
  })

  return {
    log: logQuery.data || [],
    stats: statsQuery.data || {},
    isLoadingLog: logQuery.isLoading,
    isLoadingStats: statsQuery.isLoading,
    sendNextMonth: createSendMutation('next-month'),
    sendDebtors: createSendMutation('debtors'),
    sendAdjustments: createSendMutation('adjustments'),
    sendContractExpiring: createSendMutation('contract-expiring'),
    sendCashReceipt: createSendMutation('cash-receipt'),
    sendOwnerReport: createSendMutation('report-owner'),
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/useNotifications.js
git commit -m "feat: add useNotifications hook with mutations for all notification types"
```

---

### Task 8: Frontend — SendNotificationModal

**Files:**
- Create: `frontend/src/components/notifications/SendNotificationModal.jsx`

**Step 1: Create SendNotificationModal**

Uses DaisyUI modal pattern. Props: `{ isOpen, onClose, type, recipients[], recipientType, onSend, isSending }`.

Key features:
- Channel selector: Email / WhatsApp / Ambos (checkboxes)
- Warning list: recipients without email or phone for selected channel
- Effective sends count: "X de Y serán notificados"
- Confirm / Cancel buttons
- Loading state while sending

The modal calls `onSend({ ids, channels })` — the parent page provides the actual mutation.

**Step 2: Commit**

```bash
git add frontend/src/components/notifications/SendNotificationModal.jsx
git commit -m "feat: add SendNotificationModal component with channel selection and warnings"
```

---

### Task 9: Frontend — TenantCheckboxList + OwnerCheckboxList

**Files:**
- Create: `frontend/src/components/notifications/TenantCheckboxList.jsx`
- Create: `frontend/src/components/notifications/OwnerCheckboxList.jsx`

**Step 1: Create TenantCheckboxList**

Reusable component. Props: `{ records[], selectedIds, onSelectionChange }`.

Shows:
- "Seleccionar todos" checkbox at top
- Each tenant row: checkbox + name + amount + badges (DEUDA if applicable)
- `onSelectionChange(newSelectedIds)` callback

Uses DaisyUI checkbox + table styling. Each row shows data from MonthlyRecord enriched with tenant info.

**Step 2: Create OwnerCheckboxList**

Same pattern but for owners. Props: `{ owners[], selectedIds, onSelectionChange }`.

**Step 3: Commit**

```bash
git add frontend/src/components/notifications/TenantCheckboxList.jsx frontend/src/components/notifications/OwnerCheckboxList.jsx
git commit -m "feat: add checkbox list components for tenant and owner selection"
```

---

### Task 10: Frontend — Integrate into MonthlyControlPage

**Files:**
- Modify: `frontend/src/pages/monthly-control/MonthlyControlPage.jsx`

**Step 1: Add notification UI to MonthlyControlPage**

Add imports for `TenantCheckboxList`, `SendNotificationModal`, `useNotifications`.

Add state: `showNotifyPanel`, `selectedTenantIds`, `showSendModal`.

Add a "Avisar Inquilinos" button (collapsible) that shows the TenantCheckboxList populated from the existing `records` data. Below the list: "Avisar X seleccionados" button that opens SendNotificationModal with type `NEXT_MONTH`.

Wire `onSend` to `sendNextMonth.mutateAsync({ tenantIds, channels, periodMonth, periodYear })`.

**Step 2: Commit**

```bash
git add frontend/src/pages/monthly-control/MonthlyControlPage.jsx
git commit -m "feat: add tenant notification checkboxes to monthly control page"
```

---

### Task 11: Frontend — Integrate into DebtList

**Files:**
- Modify: `frontend/src/pages/debts/DebtList.jsx`

**Step 1: Add notification UI to DebtList**

Same pattern as Task 10 but for debts. Add checkboxes to each debt row. "Avisar Deudores" button opens SendNotificationModal with type auto-detected from debt status.

Wire `onSend` to `sendDebtors.mutateAsync({ debtIds, channels })`.

**Step 2: Commit**

```bash
git add frontend/src/pages/debts/DebtList.jsx
git commit -m "feat: add debtor notification checkboxes to debt list page"
```

---

### Task 12: Frontend — Integrate into ReportsPage (Owner Reports)

**Files:**
- Modify: `frontend/src/pages/reports/ReportsPage.jsx`

**Step 1: Add send-to-owner buttons**

In the liquidación report section, add "Enviar al dueño" buttons (email icon + WhatsApp icon) next to existing download buttons.

These open SendNotificationModal with type `REPORT_OWNER`, recipientType `OWNER`.

Wire `onSend` to `sendOwnerReport.mutateAsync({ ownerIds, reportType, month, year, channels })`.

**Step 2: Commit**

```bash
git add frontend/src/pages/reports/ReportsPage.jsx
git commit -m "feat: add send-to-owner buttons in reports page for liquidation reports"
```

---

### Task 13: Frontend — Integrate into ContractsExpiring

**Files:**
- Modify: `frontend/src/pages/contracts/ContractsExpiring.jsx` (verify exact path)

**Step 1: Add per-row notification buttons**

Each expiring contract row gets email + WhatsApp icon buttons. Click opens SendNotificationModal with type `CONTRACT_EXPIRING`, single recipient.

**Step 2: Commit**

```bash
git add frontend/src/pages/contracts/
git commit -m "feat: add expiring contract notification buttons"
```

---

### Task 14: Frontend — Cash Receipt Send Buttons

**Files:**
- Find and modify: the component that shows after registering a PaymentTransaction (likely inside `MonthlyControlPage.jsx` or `PaymentRegistrationModal`)

**Step 1: Add "Enviar recibo" buttons**

After a payment is registered successfully, show inline buttons: "Enviar recibo por Email" / "Enviar recibo por WhatsApp".

Wire to `sendCashReceipt.mutateAsync({ transactionId, channels })`.

**Step 2: Commit**

```bash
git add frontend/src/
git commit -m "feat: add cash receipt send buttons after payment registration"
```

---

### Task 15: Frontend — NotificationDashboard Page + Route + Sidebar

**Files:**
- Create: `frontend/src/pages/notifications/NotificationDashboard.jsx`
- Create: `frontend/src/components/notifications/NotificationHistory.jsx`
- Modify: `frontend/src/App.jsx` (~line 41 import, ~line 130 route)
- Modify: `frontend/src/components/layout/Sidebar.jsx` (~line 35 navItems)

**Step 1: Create NotificationHistory component**

Table component with filters (type, channel, status, date range). Paginated. Shows: time, recipient, type, channel, status badge.

**Step 2: Create NotificationDashboard page**

Uses `useNotifications` hook for stats + log. Shows:
- Stats cards: Enviados, Fallidos, por tipo, por canal
- NotificationHistory table below

**Step 3: Add route in App.jsx**

Import and add `<Route path="notifications" element={<NotificationDashboard />} />`.

**Step 4: Add sidebar entry in Sidebar.jsx**

Add to `navItems` array: `{ name: 'Notificaciones', href: '/notifications', icon: BellIcon }`.

Update phase gating if needed.

**Step 5: Commit**

```bash
git add frontend/src/pages/notifications/ frontend/src/components/notifications/NotificationHistory.jsx frontend/src/App.jsx frontend/src/components/layout/Sidebar.jsx
git commit -m "feat: add notification dashboard page with history and stats"
```

---

### Task 16: Environment Variables + Documentation

**Files:**
- Modify: `backend/.env.example` (or create if doesn't exist)

**Step 1: Add env vars**

```env
# Twilio WhatsApp
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+549XXXXXXXXXX

# Cron security
CRON_SECRET=generate-a-random-string-here
```

**Step 2: Setup cron-job.org**

Manual step (document in README or design doc):
1. Create account at cron-job.org
2. New cron job:
   - URL: `https://your-backend.onrender.com/api/cron/late-payments`
   - Method: POST
   - Header: `x-cron-secret: your-secret`
   - Schedule: `0 9 11 * *` (day 11, 9AM)
3. Test with "Run now" button

**Step 3: Commit**

```bash
git add backend/.env.example
git commit -m "feat: add environment variables for Twilio and cron authentication"
```

---

### Task 17: Integration Testing

**Step 1: Test backend endpoints manually**

```bash
# Start backend
cd backend && npm run dev

# Test next-month notification (replace groupId and tenantId with real values)
curl -X POST http://localhost:3001/api/groups/{groupId}/notifications/next-month \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"tenantIds":["id1"],"channels":["email"],"periodMonth":3,"periodYear":2026}'

# Test cron endpoint
curl -X POST http://localhost:3001/api/cron/late-payments \
  -H "x-cron-secret: your-secret"

# Test stats
curl http://localhost:3001/api/groups/{groupId}/notifications/stats \
  -H "Authorization: Bearer {token}"
```

**Step 2: Test frontend flows**

1. Go to Monthly Control → click "Avisar Inquilinos" → select tenants → choose Email → Send → verify toast success
2. Go to Debts → select debts → "Avisar Deudores" → verify
3. Go to Reports → Liquidación → "Enviar al dueño" → verify
4. Go to Notifications dashboard → verify log shows all sent notifications

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete notification system - 7 types, email+whatsapp, checkbox selection, dashboard"
```
