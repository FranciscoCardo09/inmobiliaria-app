// Main Application Entry Point
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const config = require('./config');
const routes = require('./routes');
const passport = require('./config/passport');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Cookie parser
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    message: 'Demasiadas peticiones, intenta mas tarde',
  },
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Passport (no session needed - we use JWT)
app.use(passport.initialize());

// Request logging (development)
if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Inmobiliaria API',
    version: '1.5.0',
    phase: '1.5',
    status: 'running',
    features: ['email-auth', 'google-oauth'],
    docs: '/api/health',
  });
});

// API routes
app.use('/api', routes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`
  =============================================
     Inmobiliaria API - Fase 1.5
  =============================================
     Environment: ${config.nodeEnv}
     Port: ${PORT}
     Frontend: ${config.frontendUrl}
     Google OAuth: ${config.google.clientId ? 'Configured' : 'Not configured'}
  =============================================
  `);
});

module.exports = app;
