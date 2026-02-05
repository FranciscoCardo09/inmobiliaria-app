// Main Router - combines all route modules
const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const groupsRoutes = require('./groups.routes');
const invitesRoutes = require('./invites.routes');
const categoriesRoutes = require('./categories.routes');
const propertiesRoutes = require('./properties.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/groups', groupsRoutes);
router.use('/invites', invitesRoutes);

// Nested group routes (Phase 2)
router.use('/groups/:groupId/categories', categoriesRoutes);
router.use('/groups/:groupId/properties', propertiesRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;
