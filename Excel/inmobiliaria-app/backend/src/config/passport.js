// Passport Configuration - Google OAuth 2.0
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { PrismaClient } = require('@prisma/client');
const config = require('./index');

const prisma = new PrismaClient();

// Google OAuth Strategy - only initialize if credentials are configured
if (config.google.clientId && config.google.clientSecret) {
passport.use(
  new GoogleStrategy(
    {
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackURL,
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const googleId = profile.id;
        const name = profile.displayName;
        const avatar = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('No email found in Google profile'), null);
        }

        // Check if user exists by googleId
        let user = await prisma.user.findUnique({
          where: { googleId },
        });

        if (!user) {
          // Check if user exists by email (might have registered with email/password)
          user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
          });

          if (user) {
            // Link Google account to existing user
            user = await prisma.user.update({
              where: { id: user.id },
              data: {
                googleId,
                avatar: avatar || user.avatar,
              },
            });
          } else {
            // Create new user
            user = await prisma.user.create({
              data: {
                email: email.toLowerCase(),
                name,
                googleId,
                avatar,
                // No password for Google-only users
              },
            });
          }
        }

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return done(null, user);
      } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
      }
    }
  )
);
} else {
  console.log('Google OAuth not configured - skipping strategy initialization');
}

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
