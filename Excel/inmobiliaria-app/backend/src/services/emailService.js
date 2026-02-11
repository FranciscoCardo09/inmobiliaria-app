// Email Service - Nodemailer with HTML Templates
const nodemailer = require('nodemailer');
const config = require('../config');

// Create transporter based on environment
const createTransporter = () => {
  // For development, use Mailtrap or Ethereal
  if (config.nodeEnv === 'development') {
    return nodemailer.createTransport({
      host: config.smtp.host || 'sandbox.smtp.mailtrap.io',
      port: config.smtp.port || 2525,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }

  // For production, use configured SMTP
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
};

// Base HTML template
const baseTemplate = (content, title) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background-color: #f3f4f6;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      padding: 40px;
    }
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo-icon {
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 28px;
      font-weight: bold;
    }
    h1 {
      color: #1f2937;
      font-size: 24px;
      font-weight: 700;
      text-align: center;
      margin: 0 0 10px 0;
    }
    .subtitle {
      color: #6b7280;
      text-align: center;
      margin-bottom: 30px;
    }
    .content {
      color: #4b5563;
      font-size: 16px;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: white !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
      text-align: center;
    }
    .btn:hover {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
    }
    .btn-container {
      text-align: center;
      margin: 30px 0;
    }
    .footer {
      text-align: center;
      color: #9ca3af;
      font-size: 14px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
    .warning {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 12px 16px;
      color: #92400e;
      font-size: 14px;
      margin-top: 20px;
    }
    .code {
      background: #f3f4f6;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 14px;
      word-break: break-all;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <div class="logo-icon">H</div>
      </div>
      ${content}
      <div class="footer">
        <p>Este email fue enviado por <strong>Inmobiliaria H&H</strong></p>
        <p>Si no solicitaste este email, puedes ignorarlo.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

// Email Verification Template
const verificationEmailTemplate = (name, verificationLink) => {
  const content = `
    <h1>Confirma tu email</h1>
    <p class="subtitle">Bienvenido a Inmobiliaria H&H</p>
    <div class="content">
      <p>Hola <strong>${name}</strong>,</p>
      <p>Gracias por registrarte. Para completar tu registro y acceder a tu cuenta, confirma tu email haciendo clic en el boton de abajo:</p>
    </div>
    <div class="btn-container">
      <a href="${verificationLink}" class="btn">Confirmar mi Email</a>
    </div>
    <div class="content">
      <p>O copia y pega este link en tu navegador:</p>
      <div class="code">${verificationLink}</div>
    </div>
    <div class="warning">
      Este link expira en 24 horas. Si no solicitaste esta cuenta, ignora este email.
    </div>
  `;
  return baseTemplate(content, 'Confirma tu Email - Inmobiliaria H&H');
};

// Password Reset Template
const passwordResetTemplate = (name, resetLink) => {
  const content = `
    <h1>Restablecer Contrasena</h1>
    <p class="subtitle">Solicitud de cambio de contrasena</p>
    <div class="content">
      <p>Hola <strong>${name}</strong>,</p>
      <p>Recibimos una solicitud para restablecer la contrasena de tu cuenta. Haz clic en el boton de abajo para crear una nueva contrasena:</p>
    </div>
    <div class="btn-container">
      <a href="${resetLink}" class="btn">Restablecer Contrasena</a>
    </div>
    <div class="content">
      <p>O copia y pega este link en tu navegador:</p>
      <div class="code">${resetLink}</div>
    </div>
    <div class="warning">
      Este link expira en 1 hora. Si no solicitaste este cambio, ignora este email y tu contrasena permanecera igual.
    </div>
  `;
  return baseTemplate(content, 'Restablecer Contrasena - Inmobiliaria H&H');
};

// Welcome Email Template (after verification)
const welcomeEmailTemplate = (name) => {
  const content = `
    <h1>Bienvenido a Inmobiliaria H&H</h1>
    <p class="subtitle">Tu cuenta ha sido verificada</p>
    <div class="content">
      <p>Hola <strong>${name}</strong>,</p>
      <p>Tu email ha sido verificado exitosamente. Ya puedes acceder a todas las funciones del sistema:</p>
      <ul>
        <li>Gestionar propiedades</li>
        <li>Administrar inquilinos</li>
        <li>Registrar pagos</li>
        <li>Generar reportes</li>
      </ul>
    </div>
    <div class="btn-container">
      <a href="${config.frontendUrl}/dashboard" class="btn">Ir al Dashboard</a>
    </div>
  `;
  return baseTemplate(content, 'Bienvenido - Inmobiliaria H&H');
};

// Send email function
const sendEmail = async ({ to, subject, html, attachments }) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: config.smtp.from || '"Inmobiliaria H&H" <no-reply@inmobiliaria-hh.com>',
      to,
      subject,
      html,
    };

    if (attachments) {
      mailOptions.attachments = attachments;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
};

// Public methods
const emailService = {
  // Send verification email
  sendVerificationEmail: async (user, token) => {
    const verificationLink = `${config.frontendUrl}/verify-email?token=${token}`;
    const html = verificationEmailTemplate(user.name, verificationLink);

    return sendEmail({
      to: user.email,
      subject: 'Confirma tu email - Inmobiliaria H&H',
      html,
    });
  },

  // Send password reset email
  sendPasswordResetEmail: async (user, token) => {
    const resetLink = `${config.frontendUrl}/reset-password?token=${token}`;
    const html = passwordResetTemplate(user.name, resetLink);

    return sendEmail({
      to: user.email,
      subject: 'Restablecer contrasena - Inmobiliaria H&H',
      html,
    });
  },

  // Send welcome email
  sendWelcomeEmail: async (user) => {
    const html = welcomeEmailTemplate(user.name);

    return sendEmail({
      to: user.email,
      subject: 'Bienvenido a Inmobiliaria H&H',
      html,
    });
  },

  // Send report email with PDF attachment
  sendReportEmail: async ({ to, subject, pdfBuffer, filename }) => {
    const content = `
      <h1>Reporte Adjunto</h1>
      <p class="subtitle">Inmobiliaria H&H</p>
      <div class="content">
        <p>Adjuntamos el reporte solicitado: <strong>${filename}</strong></p>
        <p>Este archivo ha sido generado automáticamente por el sistema de gestión inmobiliaria.</p>
      </div>
    `;
    const html = baseTemplate(content, 'Reporte - Inmobiliaria H&H');

    return sendEmail({
      to,
      subject,
      html,
      attachments: [{
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
  },
};

module.exports = emailService;
