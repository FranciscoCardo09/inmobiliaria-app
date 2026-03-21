// Cron Authentication Middleware
// Validates x-cron-secret header for external cron endpoints
const ApiResponse = require('../utils/apiResponse');

const cronAuth = (req, res, next) => {
  const cronSecret = req.headers['x-cron-secret'];

  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return ApiResponse.unauthorized(res, 'Cron secret inválido');
  }

  next();
};

module.exports = { cronAuth };
