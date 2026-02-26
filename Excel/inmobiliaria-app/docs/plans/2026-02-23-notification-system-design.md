# Notification System Design — Opción C (Híbrido)

**Fecha:** 2026-02-23
**Estado:** Aprobado

## Contexto

Sistema de notificaciones para la app inmobiliaria H&H. 7 tipos de avisos con selección flexible (uno/múltiples/todos) por checkboxes, enviados por Email (Resend) y WhatsApp (Twilio). Cron externo (cron-job.org) para avisos automáticos del día 11. Sin n8n.

## Decisiones Tomadas

- **Canales:** Email (Resend existente) + WhatsApp (Twilio nuevo) — ambos para inquilinos y propietarios
- **Cron día 11:** cron-job.org (gratis, externo) → endpoint especial sin groupId que itera todos los grupos
- **Templates:** Hardcodeados en JS (funciones puras que retornan { subject, html, whatsappText })
- **Historial:** Tabla NotificationLog en Prisma (log de cada envío con estado SENT/FAILED)
- **Pago efectivo:** Botón manual post-registro (no automático)
- **Costo estimado:** No se muestra en UI

---

## Sección 1: Modelo de Datos

### NotificationLog (tabla nueva en Prisma)

```
NotificationLog
├── id                String (uuid, PK)
├── groupId           String (FK → Group)
├── type              Enum NotificationType:
│                       NEXT_MONTH | DEBT_TOTAL | DEBT_PARTIAL | LATE_PAYMENT
│                       | ADJUSTMENT | CONTRACT_EXPIRING | CASH_RECEIPT
│                       | REPORT_OWNER | REPORT_TENANT
├── channel           Enum NotificationChannel: EMAIL | WHATSAPP
├── recipientType     Enum RecipientType: TENANT | OWNER | ADMIN
├── recipientId       String? (FK → Tenant u Owner según recipientType)
├── recipientName     String (nombre snapshot para historial)
├── recipientContact  String? (email o phone usado)
├── contractId        String? (FK → Contract)
├── monthlyRecordId   String? (FK → MonthlyRecord)
├── debtId            String? (FK → Debt)
├── subject           String (asunto/resumen)
├── status            Enum NotificationStatus: SENT | FAILED | PENDING
├── errorMessage      String? (si falló)
├── metadata          Json? (montos, periodos, datos extra)
├── sentAt            DateTime
├── createdBy         String (FK → User)
```

### Mapa de destinatarios

| Tipo | Destinatario | Dato que se envía |
|------|-------------|-------------------|
| NEXT_MONTH | Inquilino | Desglose mes siguiente (alquiler+IVA+expensas+servicios) |
| DEBT_TOTAL | Inquilino | Deuda completa sin pago |
| DEBT_PARTIAL | Inquilino | Saldo pendiente parcial |
| LATE_PAYMENT | Inquilino | Urgente, pago atrasado post día 10 |
| ADJUSTMENT | Inquilino | Nuevo monto por ajuste de índice |
| CONTRACT_EXPIRING | Inquilino | Contrato próximo a vencer |
| CASH_RECEIPT | Inquilino | Recibo de pago efectivo + PDF |
| REPORT_OWNER | Propietario | Liquidación: cuánto se depositó, desglose |
| REPORT_TENANT | Inquilino | Reporte enviado manualmente |

### Contactos disponibles

| Destinatario | Email | Phone (WhatsApp) |
|---|---|---|
| Tenant | Opcional | Opcional |
| Owner | Opcional | Obligatorio |

Destinatarios sin dato de contacto para el canal seleccionado se skipean con warning.

---

## Sección 2: API — Endpoints

Todos bajo `/api/groups/:groupId/notifications/`, requieren rol ADMIN:

```
POST /notifications/next-month
Body: { tenantIds: [], channels: ["email","whatsapp"], periodMonth, periodYear }

POST /notifications/debtors
Body: { debtIds: [], channels: ["email","whatsapp"] }

POST /notifications/late-payments
Body: {} (busca todos los impagos automáticamente)

POST /notifications/adjustments
Body: { contractIds: [], channels: ["email","whatsapp"] }

POST /notifications/contract-expiring
Body: { contractId: "id", channels: ["email","whatsapp"] }

POST /notifications/cash-receipt
Body: { transactionId: "id", channels: ["email","whatsapp"] }

POST /notifications/report-owner
Body: { ownerIds: [], reportType: "liquidacion", month, year, channels: [] }

GET /notifications/log
Query: ?type=&status=&from=&to=&page=&limit=

GET /notifications/stats
→ { totalSent, totalFailed, byType: {}, byChannel: {} }
```

### Endpoint cron (fuera de group scope):

```
POST /api/cron/late-payments
Header: x-cron-secret: {CRON_SECRET}
→ Itera TODOS los grupos, ejecuta sendLatePayments() por cada uno
```

### Seguridad cron
- Middleware cronAuth.js valida header `x-cron-secret === process.env.CRON_SECRET`
- El endpoint late-payments en notifications.routes acepta JWT (manual)
- El endpoint en cron.routes acepta x-cron-secret (automático)

### Respuesta estándar de todos los POST de envío:
```json
{ "sent": 3, "failed": 1, "skipped": 1, "details": [...] }
```

---

## Sección 3: Servicios Backend

### Archivos nuevos

```
src/services/whatsappService.js          — Twilio SDK wrapper
src/services/notificationService.js      — Orquestador central
src/services/notificationTemplates.js    — 9 templates hardcodeados
src/controllers/notificationsController.js
src/routes/notifications.routes.js
src/routes/cron.routes.js
src/middleware/cronAuth.js
```

### whatsappService.js
- `sendWhatsApp({ to, body, mediaUrl? })` — wrapper de Twilio
- Formatea phone argentino: +549XXXXXXXXXX
- Retorna `{ success, messageSid }` o `{ success: false, error }`

### notificationTemplates.js
Funciones puras, cada una recibe datos y retorna `{ subject, html, whatsappText }`:

- `nextMonthTemplate(tenant, record, concepts[])`
- `debtTotalTemplate(tenant, debt)`
- `debtPartialTemplate(tenant, debt)`
- `latePaymentTemplate(tenant, record, punitoryInfo)`
- `adjustmentTemplate(tenant, contract, oldRent, newRent)`
- `contractExpiringTemplate(tenant, contract, remainingDays)`
- `cashReceiptTemplate(tenant, transaction)`
- `ownerReportTemplate(owner, liquidationData)`
- `reportTenantTemplate(tenant, reportData)`

### notificationService.js (orquestador)

Funciones exportadas:
- `sendNextMonth(groupId, tenantIds, channels, period, userId)`
- `sendDebtNotifications(groupId, debtIds, channels, userId)`
- `sendLatePayments(groupId)` — automático, busca todos los impagos
- `sendAdjustmentNotice(groupId, contractIds, channels, userId)`
- `sendContractExpiring(groupId, contractId, channels, userId)`
- `sendCashReceipt(groupId, transactionId, channels, userId)`
- `sendOwnerReport(groupId, ownerIds, reportType, period, channels, userId)`
- `getNotificationLog(groupId, filters)`
- `getNotificationStats(groupId)`

Flujo estándar por función:
1. Query Prisma para datos completos (tenant/owner + contrato + montos)
2. Validar que destinatario tenga contacto para el canal
3. Llamar template correspondiente
4. Enviar por cada canal (emailService / whatsappService)
5. Guardar NotificationLog (SENT o FAILED)
6. Retornar `{ sent, failed, skipped, details[] }`

### Archivos modificados

- `emailService.js` — agregar `sendNotificationEmail({ to, subject, html, attachments? })`
- `routes/index.js` — registrar notifications.routes + cron.routes

---

## Sección 4: Frontend

### Archivos nuevos

```
src/pages/notifications/NotificationDashboard.jsx
src/components/notifications/TenantCheckboxList.jsx
src/components/notifications/OwnerCheckboxList.jsx
src/components/notifications/SendNotificationModal.jsx
src/components/notifications/NotificationHistory.jsx
src/hooks/useNotifications.js
```

### Integración en páginas existentes

**MonthlyControlPage.jsx:** Botón "Avisar inquilinos" → despliega TenantCheckboxList con montos del mes → selección → SendNotificationModal (tipo NEXT_MONTH)

**DebtList.jsx:** Checkboxes sobre deudas abiertas → "Avisar deudores" → SendNotificationModal (auto-detecta DEBT_TOTAL vs DEBT_PARTIAL)

**Post pago efectivo:** Botones inline "Enviar recibo" por email/WhatsApp → SendNotificationModal (tipo CASH_RECEIPT)

**ReportsPage.jsx:** Botones "Enviar al dueño" por email/WhatsApp → SendNotificationModal (tipo REPORT_OWNER, recipientType OWNER)

**ContractsExpiring.jsx:** Botón individual por fila → SendNotificationModal (tipo CONTRACT_EXPIRING)

### SendNotificationModal (componente central)

```
Props: { type, recipients[], recipientType, channels?, extraData? }

Muestra:
- Tipo de notificación
- Cantidad de destinatarios
- Selector de canal: Email / WhatsApp / Ambos
- Warnings: destinatarios sin email o sin teléfono
- Envíos efectivos: X de Y
- Botones: Enviar / Cancelar
```

### NotificationDashboard (página nueva)

Ruta: `/dashboard/notifications`
- Stats: enviados, fallidos, por tipo, por canal
- Filtros: tipo, canal, estado, rango de fechas
- Tabla historial paginada

### Archivos modificados

```
MonthlyControlPage.jsx    — botón + checkboxes
DebtList.jsx              — botón + checkboxes
ReportsPage.jsx           — botones enviar al dueño
ContractsExpiring.jsx     — botones avisar individual
Sidebar/layout            — link a /notifications
Router                    — ruta /dashboard/notifications
```

---

## Sección 5: Cron Externo + Seguridad

### cron-job.org

```
URL: https://tu-backend.onrender.com/api/cron/late-payments
Método: POST
Header: x-cron-secret: {CRON_SECRET}
Schedule: 0 9 11 * * (día 11, 9AM Argentina)
```

El endpoint itera todos los grupos activos y ejecuta sendLatePayments() por cada uno.

### Variables de entorno nuevas

```env
TWILIO_ACCOUNT_SID=ACxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+5493511234567
CRON_SECRET=un-string-random-largo
```

### Dependencias nuevas

```
npm install twilio (backend)
```

---

## Sección 6: Lo que NO se toca

- Lógica de pagos, deudas, monthly records, reportes existentes
- Auth, roles, middleware existente
- Frontend existente (solo se agregan botones)
- Tablas existentes en la DB (solo se agrega NotificationLog)
- Fases 1-6 intactas
