// Auth Routes
const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, refreshTokenSchema } = require('../validators/authValidators');
const { generateTokenPair } = require('../utils/jwt');
const { PrismaClient } = require('@prisma/client');
const config = require('../config');
const { getExpiryDate } = require('../utils/helpers');

const prisma = new PrismaClient();

// Public routes - Email/Password
router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshTokenSchema), authController.refresh);

// Email verification routes (public)
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);

// Password reset routes (public)
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected routes
router.get('/me', authenticate, authController.me);
router.post('/logout', authenticate, authController.logout);

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// Initiate Google OAuth
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${config.frontendUrl}/login?error=google_auth_failed`,
  }),
  async (req, res) => {
    try {
      const user = req.user;

      if (!user) {
        return res.redirect(`${config.frontendUrl}/login?error=no_user`);
      }

      // Generate JWT tokens
      const tokens = generateTokenPair(user);

      // Save refresh token to DB
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

      // Redirect to frontend with tokens in URL params
      // Frontend will extract and store them
      const params = new URLSearchParams({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userAvatar: user.avatar || '',
        groups: JSON.stringify(groups.map(g => ({
          id: g.group.id,
          name: g.group.name,
          slug: g.group.slug,
          role: g.role,
        }))),
      });

      res.redirect(`${config.frontendUrl}/auth/callback?${params.toString()}`);
    } catch (error) {
      console.error('Google callback error:', error);
      res.redirect(`${config.frontendUrl}/login?error=callback_failed`);
    }
  }
);

module.exports = router;
