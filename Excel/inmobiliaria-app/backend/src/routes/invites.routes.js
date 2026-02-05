// Invites Routes (public-ish endpoints for accepting invites)
const express = require('express');
const router = express.Router();
const groupsController = require('../controllers/groupsController');
const { authenticate } = require('../middleware/auth');

// Accept invite (requires auth - user must be logged in)
router.post('/:token/accept', authenticate, groupsController.acceptInvite);

module.exports = router;
