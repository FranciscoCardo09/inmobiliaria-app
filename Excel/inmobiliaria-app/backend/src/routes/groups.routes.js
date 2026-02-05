// Groups Routes
const express = require('express');
const router = express.Router();
const groupsController = require('../controllers/groupsController');
const { authenticate } = require('../middleware/auth');
const { requireGroupMember, requireGroupAdmin } = require('../middleware/groupAuth');
const validate = require('../middleware/validate');
const { createGroupSchema, updateGroupSchema, inviteUserSchema } = require('../validators/groupValidators');

// All routes require authentication
router.use(authenticate);

// Group CRUD
router.get('/', groupsController.listGroups);
router.post('/', validate(createGroupSchema), groupsController.createGroup);
router.get('/:groupId', requireGroupMember, groupsController.getGroup);
router.put('/:groupId', requireGroupAdmin, validate(updateGroupSchema), groupsController.updateGroup);
router.delete('/:groupId', requireGroupAdmin, groupsController.deleteGroup);

// Members management
router.get('/:groupId/members', requireGroupMember, groupsController.listMembers);
router.put('/:groupId/members/:userId', requireGroupAdmin, groupsController.updateMemberRole);
router.delete('/:groupId/members/:userId', requireGroupAdmin, groupsController.removeMember);

// Invitations
router.post('/:groupId/invite', requireGroupAdmin, validate(inviteUserSchema), groupsController.inviteUser);
router.get('/:groupId/invites', requireGroupAdmin, groupsController.listInvites);
router.delete('/:groupId/invites/:inviteId', requireGroupAdmin, groupsController.cancelInvite);

module.exports = router;
