// Main Router - combines all route modules
const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const groupsRoutes = require('./groups.routes');
const invitesRoutes = require('./invites.routes');
const categoriesRoutes = require('./categories.routes');
const propertiesRoutes = require('./properties.routes');
const ownersRoutes = require('./owners.routes');
const tenantsRoutes = require('./tenants.routes');
const contractsRoutes = require('./contracts.routes');
const adjustmentIndicesRoutes = require('./adjustmentIndices.routes');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');
const contractsController = require('../controllers/contractsController');
const adjustmentIndicesController = require('../controllers/adjustmentIndicesController');
const dashboardRoutes = require('./dashboard.routes');
const paymentsRoutes = require('./payments.routes');
const monthlyRecordsRoutes = require('./monthlyRecords.routes');
const paymentTransactionsRoutes = require('./paymentTransactions.routes');
const holidaysRoutes = require('./holidays.routes');
const debtsRoutes = require('./debts.routes');
const serviceCategoriesRoutes = require('./serviceCategories.routes');
const reportsRoutes = require('./reports.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/groups', groupsRoutes);
router.use('/invites', invitesRoutes);

// Nested group routes (Phase 2)
router.use('/groups/:groupId/categories', categoriesRoutes);
router.use('/groups/:groupId/owners', ownersRoutes);
router.use('/groups/:groupId/properties', propertiesRoutes);

// Nested group routes (Phase 3)
router.use('/groups/:groupId/tenants', tenantsRoutes);
router.use('/groups/:groupId/contracts', contractsRoutes);
router.use('/groups/:groupId/adjustment-indices', adjustmentIndicesRoutes);

// Assign tenant to property
router.post(
  '/groups/:groupId/properties/:propertyId/tenant',
  authenticate,
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  contractsController.assignTenantToProperty
);

// Apply all adjustments at once (Phase 3.5)
router.post(
  '/groups/:groupId/adjustments/apply-all-next-month',
  authenticate,
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  adjustmentIndicesController.applyAllNextMonth
);

// Dashboard (Phase 3.5)
router.use('/groups/:groupId/dashboard', dashboardRoutes);

// Payments (Phase 4)
router.use('/groups/:groupId/payments', paymentsRoutes);

// Service Categories
router.use('/groups/:groupId/service-categories', serviceCategoriesRoutes);

// Monthly Control (Phase 5)
router.use('/groups/:groupId/monthly-records', monthlyRecordsRoutes);
router.use('/groups/:groupId/payment-transactions', paymentTransactionsRoutes);

// Debts + Close Month (Phase 5+)
router.use('/groups/:groupId', debtsRoutes);

// Reports (Phase 6)
router.use('/groups/:groupId/reports', reportsRoutes);

// Holidays (global)
router.use('/holidays', holidaysRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;
