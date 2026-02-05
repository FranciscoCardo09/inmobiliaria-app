// Groups Controller
// Handles: CRUD groups, invitations, members

const { PrismaClient } = require('@prisma/client');
const ApiResponse = require('../utils/apiResponse');
const { generateSlug, generateInviteToken, getExpiryDate } = require('../utils/helpers');

const prisma = new PrismaClient();

// GET /api/groups - List user's groups
const listGroups = async (req, res, next) => {
  try {
    const groups = await prisma.userGroup.findMany({
      where: { userId: req.user.id },
      include: {
        group: {
          include: {
            _count: {
              select: { members: true },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const result = groups.map((ug) => ({
      id: ug.group.id,
      name: ug.group.name,
      slug: ug.group.slug,
      description: ug.group.description,
      currency: ug.group.currency,
      myRole: ug.role,
      memberCount: ug.group._count.members,
      joinedAt: ug.joinedAt,
    }));

    return ApiResponse.success(res, result);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups - Create new group
const createGroup = async (req, res, next) => {
  try {
    const { name, description, punitoryRate, currency } = req.body;

    // Generate unique slug
    let slug = generateSlug(name);
    let slugExists = await prisma.group.findUnique({ where: { slug } });
    let counter = 1;

    while (slugExists) {
      slug = `${generateSlug(name)}-${counter}`;
      slugExists = await prisma.group.findUnique({ where: { slug } });
      counter++;
    }

    // Create group with creator as ADMIN
    const group = await prisma.group.create({
      data: {
        name,
        slug,
        description,
        punitoryRate: punitoryRate || 0.006,
        currency: currency || 'ARS',
        members: {
          create: {
            userId: req.user.id,
            role: 'ADMIN',
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return ApiResponse.created(res, {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      punitoryRate: group.punitoryRate,
      currency: group.currency,
      members: group.members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      })),
    }, 'Grupo creado exitosamente');
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId - Get group details
const getGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: { members: true },
        },
      },
    });

    if (!group) {
      return ApiResponse.notFound(res, 'Grupo no encontrado');
    }

    return ApiResponse.success(res, {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      punitoryRate: group.punitoryRate,
      currency: group.currency,
      isActive: group.isActive,
      memberCount: group._count.members,
      members: group.members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      createdAt: group.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId - Update group
const updateGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, description, punitoryRate, currency } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (punitoryRate !== undefined) updateData.punitoryRate = punitoryRate;
    if (currency) updateData.currency = currency;

    const group = await prisma.group.update({
      where: { id: groupId },
      data: updateData,
    });

    return ApiResponse.success(res, group, 'Grupo actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId - Delete group
const deleteGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    // Soft delete
    await prisma.group.update({
      where: { id: groupId },
      data: { isActive: false },
    });

    return ApiResponse.success(res, null, 'Grupo eliminado');
  } catch (error) {
    next(error);
  }
};

// POST /api/groups/:groupId/invite - Invite user to group
const inviteUser = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { email, role } = req.body;
    const normalizedEmail = email.toLowerCase();

    // Check if user is already a member
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      const existingMembership = await prisma.userGroup.findUnique({
        where: {
          userId_groupId: {
            userId: existingUser.id,
            groupId,
          },
        },
      });

      if (existingMembership) {
        return ApiResponse.conflict(res, 'El usuario ya es miembro del grupo');
      }
    }

    // Check for existing pending invite
    const existingInvite = await prisma.groupInvite.findFirst({
      where: {
        groupId,
        email: normalizedEmail,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvite) {
      return ApiResponse.conflict(res, 'Ya existe una invitacion pendiente para este email');
    }

    // Create invite
    const invite = await prisma.groupInvite.create({
      data: {
        groupId,
        email: normalizedEmail,
        role: role || 'VIEWER',
        token: generateInviteToken(),
        invitedById: req.user.id,
        expiresAt: getExpiryDate(7), // 7 days
      },
      include: {
        group: {
          select: {
            name: true,
          },
        },
      },
    });

    // TODO: Send email with invite link
    // For now, return the token in response
    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${invite.token}`;

    return ApiResponse.created(res, {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      inviteLink,
      expiresAt: invite.expiresAt,
      groupName: invite.group.name,
    }, 'Invitacion enviada');
  } catch (error) {
    next(error);
  }
};

// POST /api/invites/:token/accept - Accept invitation
const acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.params;

    // Find invite
    const invite = await prisma.groupInvite.findUnique({
      where: { token },
      include: {
        group: true,
      },
    });

    if (!invite) {
      return ApiResponse.notFound(res, 'Invitacion no encontrada');
    }

    if (invite.status !== 'PENDING') {
      return ApiResponse.badRequest(res, `Invitacion ya fue ${invite.status.toLowerCase()}`);
    }

    if (invite.expiresAt < new Date()) {
      await prisma.groupInvite.update({
        where: { id: invite.id },
        data: { status: 'EXPIRED' },
      });
      return ApiResponse.badRequest(res, 'Invitacion expirada');
    }

    // Check if invite email matches logged user
    if (invite.email !== req.user.email.toLowerCase()) {
      return ApiResponse.forbidden(res, 'Esta invitacion no es para tu email');
    }

    // Check if already member
    const existingMembership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: req.user.id,
          groupId: invite.groupId,
        },
      },
    });

    if (existingMembership) {
      await prisma.groupInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      return ApiResponse.conflict(res, 'Ya eres miembro de este grupo');
    }

    // Add user to group and mark invite as accepted
    await prisma.$transaction([
      prisma.userGroup.create({
        data: {
          userId: req.user.id,
          groupId: invite.groupId,
          role: invite.role,
        },
      }),
      prisma.groupInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      }),
    ]);

    return ApiResponse.success(res, {
      groupId: invite.groupId,
      groupName: invite.group.name,
      role: invite.role,
    }, `Te uniste a ${invite.group.name} como ${invite.role}`);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/members - List group members
const listMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const members = await prisma.userGroup.findMany({
      where: { groupId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return ApiResponse.success(res, members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt,
      lastLoginAt: m.user.lastLoginAt,
    })));
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/members/:userId - Update member role
const updateMemberRole = async (req, res, next) => {
  try {
    const { groupId, userId } = req.params;
    const { role } = req.body;

    // Can't change your own role
    if (userId === req.user.id) {
      return ApiResponse.badRequest(res, 'No puedes cambiar tu propio rol');
    }

    // Check target user is member
    const membership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (!membership) {
      return ApiResponse.notFound(res, 'Usuario no es miembro del grupo');
    }

    // Update role
    await prisma.userGroup.update({
      where: { userId_groupId: { userId, groupId } },
      data: { role },
    });

    return ApiResponse.success(res, { userId, role }, 'Rol actualizado');
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/members/:userId - Remove member
const removeMember = async (req, res, next) => {
  try {
    const { groupId, userId } = req.params;

    // Can't remove yourself if you're the only admin
    if (userId === req.user.id) {
      const adminCount = await prisma.userGroup.count({
        where: { groupId, role: 'ADMIN' },
      });

      if (adminCount <= 1) {
        return ApiResponse.badRequest(res, 'No puedes salir siendo el unico admin');
      }
    }

    await prisma.userGroup.delete({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    return ApiResponse.success(res, null, 'Miembro eliminado del grupo');
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/invites - List pending invites
const listInvites = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const invites = await prisma.groupInvite.findMany({
      where: {
        groupId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        invitedBy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return ApiResponse.success(res, invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy.name,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    })));
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId/invites/:inviteId - Cancel invite
const cancelInvite = async (req, res, next) => {
  try {
    const { groupId, inviteId } = req.params;

    await prisma.groupInvite.delete({
      where: { id: inviteId, groupId },
    });

    return ApiResponse.success(res, null, 'Invitacion cancelada');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listGroups,
  createGroup,
  getGroup,
  updateGroup,
  deleteGroup,
  inviteUser,
  acceptInvite,
  listMembers,
  updateMemberRole,
  removeMember,
  listInvites,
  cancelInvite,
};
