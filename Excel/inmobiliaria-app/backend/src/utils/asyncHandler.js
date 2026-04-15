/**
 * asyncHandler - Wrapper for asynchronous Express middleware/routes
 * Automatically catches exceptions and passes them to the next() error handler,
 * eliminating the need for repetitive try/catch blocks in controllers.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
