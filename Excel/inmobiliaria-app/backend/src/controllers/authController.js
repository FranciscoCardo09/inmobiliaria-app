// Auth Controller
// Handles: register, login, refresh, me, logout, verifyEmail, forgotPassword, resetPassword

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { hashPassword, comparePassword } = require('../utils/password');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const ApiResponse = require('../utils/apiResponse');
const { getExpiryDate } = require('../utils/helpers');
const emailService = require('../services/emailService');

const prisma = new PrismaClient();

// Generate secure random token
const generateSecureToken = () => crypto.randomBytes(32).toString('hex');

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return ApiResponse.conflict(res, 'El email ya esta registrado');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user (not verified)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        isEmailVerified: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        createdAt: true,
      },
    });

    // Generate verification token
    const verificationToken = generateSecureToken();

    // Save verification token (expires in 24 hours)
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: getExpiryDate(1), // 1 day
      },
    });

    // Send verification email (don't block registration if email fails)
    emailService.sendVerificationEmail(user, verificationToken)
      .catch(err => console.error('Failed to send verification email:', err.message));

    return ApiResponse.created(res, {
      user,
      message: 'Se ha enviado un email de verificacion a tu correo',
    }, 'Usuario registrado. Por favor verifica tu email');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return ApiResponse.unauthorized(res, 'Credenciales invalidas');
    }

    if (!user.isActive) {
      return ApiResponse.unauthorized(res, 'Usuario inactivo');
    }

    // Check if user has password (not Google-only user)
    if (!user.passwordHash) {
      return ApiResponse.badRequest(res, 'Esta cuenta usa Google. Inicia sesion con Google');
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.passwordHash);

    if (!isValidPassword) {
      return ApiResponse.unauthorized(res, 'Credenciales invalidas');
    }

    // Check email verification (skip for Google OAuth users)
    if (!user.isEmailVerified && !user.googleId) {
      return ApiResponse.forbidden(res, 'Email no verificado. Revisa tu correo para confirmar tu cuenta');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate tokens
    const tokens = generateTokenPair(user);

    // Save refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: getExpiryDate(7),
      },
    });

    // Get user groups
    const groups = await prisma.userGroup.findMany({
      where: { userId: user.id },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    return ApiResponse.success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        globalRole: user.globalRole,
      },
      groups: groups.map((g) => ({
        ...g.group,
        role: g.role,
      })),
      ...tokens,
    }, 'Login exitoso');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/refresh
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    if (!decoded) {
      return ApiResponse.unauthorized(res, 'Refresh token invalido');
    }

    // Check if token exists in DB
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken) {
      return ApiResponse.unauthorized(res, 'Refresh token no encontrado');
    }

    if (storedToken.expiresAt < new Date()) {
      // Delete expired token
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      return ApiResponse.unauthorized(res, 'Refresh token expirado');
    }

    if (!storedToken.user.isActive) {
      return ApiResponse.unauthorized(res, 'Usuario inactivo');
    }

    // Delete old refresh token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    // Generate new tokens
    const tokens = generateTokenPair(storedToken.user);

    // Save new refresh token
    await prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        token: tokens.refreshToken,
        expiresAt: getExpiryDate(7),
      },
    });

    return ApiResponse.success(res, tokens, 'Tokens renovados');
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/me
const me = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    // Get user groups
    const groups = await prisma.userGroup.findMany({
      where: { userId: req.user.id },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
          },
        },
      },
    });

    // Get pending invites
    const pendingInvites = await prisma.groupInvite.findMany({
      where: {
        email: user.email,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        invitedBy: {
          select: {
            name: true,
          },
        },
      },
    });

    return ApiResponse.success(res, {
      user,
      groups: groups.map((g) => ({
        ...g.group,
        role: g.role,
        joinedAt: g.joinedAt,
      })),
      pendingInvites: pendingInvites.map((i) => ({
        id: i.id,
        token: i.token,
        groupName: i.group.name,
        groupId: i.group.id,
        role: i.role,
        invitedBy: i.invitedBy.name,
        expiresAt: i.expiresAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/logout
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Delete the refresh token
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    }

    return ApiResponse.success(res, null, 'Logout exitoso');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/verify-email
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return ApiResponse.badRequest(res, 'Token de verificacion requerido');
    }

    // Find verification token
    const verificationToken = await prisma.emailVerificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      return ApiResponse.badRequest(res, 'Token de verificacion invalido');
    }

    // Check expiration
    if (verificationToken.expiresAt < new Date()) {
      // Delete expired token
      await prisma.emailVerificationToken.delete({ where: { id: verificationToken.id } });
      return ApiResponse.badRequest(res, 'Token de verificacion expirado. Solicita uno nuevo');
    }

    // Update user as verified
    const user = await prisma.user.update({
      where: { id: verificationToken.userId },
      data: { isEmailVerified: true },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
      },
    });

    // Delete all verification tokens for this user
    await prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id },
    });

    // Send welcome email
    await emailService.sendWelcomeEmail(user);

    // Generate tokens for auto-login
    const tokens = generateTokenPair(user);

    // Save refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: getExpiryDate(7),
      },
    });

    return ApiResponse.success(res, {
      user,
      ...tokens,
    }, 'Email verificado exitosamente');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/resend-verification
const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return ApiResponse.badRequest(res, 'Email requerido');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Don't reveal if user exists
      return ApiResponse.success(res, null, 'Si el email existe, recibiras un correo de verificacion');
    }

    if (user.isEmailVerified) {
      return ApiResponse.badRequest(res, 'Este email ya esta verificado');
    }

    // Delete old verification tokens
    await prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id },
    });

    // Generate new verification token
    const verificationToken = generateSecureToken();

    // Save verification token
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: getExpiryDate(1), // 1 day
      },
    });

    // Send verification email
    await emailService.sendVerificationEmail(user, verificationToken);

    return ApiResponse.success(res, null, 'Email de verificacion enviado');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return ApiResponse.badRequest(res, 'Email requerido');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success (don't reveal if user exists)
    if (!user) {
      return ApiResponse.success(res, null, 'Si el email existe, recibiras instrucciones para restablecer tu contrasena');
    }

    // Check if user has password (not Google-only)
    if (!user.passwordHash && user.googleId) {
      return ApiResponse.success(res, null, 'Si el email existe, recibiras instrucciones para restablecer tu contrasena');
    }

    // Delete old reset tokens
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // Generate reset token
    const resetToken = generateSecureToken();

    // Save reset token (expires in 1 hour)
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Send password reset email
    await emailService.sendPasswordResetEmail(user, resetToken);

    return ApiResponse.success(res, null, 'Si el email existe, recibiras instrucciones para restablecer tu contrasena');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return ApiResponse.badRequest(res, 'Token y contrasena requeridos');
    }

    if (password.length < 8) {
      return ApiResponse.badRequest(res, 'La contrasena debe tener al menos 8 caracteres');
    }

    // Find reset token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return ApiResponse.badRequest(res, 'Token de restablecimiento invalido');
    }

    // Check if already used
    if (resetToken.usedAt) {
      return ApiResponse.badRequest(res, 'Este token ya fue utilizado');
    }

    // Check expiration
    if (resetToken.expiresAt < new Date()) {
      return ApiResponse.badRequest(res, 'Token expirado. Solicita uno nuevo');
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update user password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          isEmailVerified: true, // Also verify email if not verified
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all refresh tokens (security measure)
      prisma.refreshToken.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    return ApiResponse.success(res, null, 'Contrasena actualizada exitosamente');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  refresh,
  me,
  logout,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
};
