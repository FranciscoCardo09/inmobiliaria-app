// JWT Utilities
const jwt = require('jsonwebtoken');
const config = require('../config');

const generateAccessToken = (payload) => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret);
  } catch (error) {
    return null;
  }
};

const generateTokenPair = (user) => {
  const payload = {
    userId: user.id,
    email: user.email,
    globalRole: user.globalRole,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ userId: user.id }),
    expiresIn: config.jwt.expiresIn,
  };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
};
