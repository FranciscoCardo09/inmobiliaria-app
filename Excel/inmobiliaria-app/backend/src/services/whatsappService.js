// WhatsApp Service - Twilio SDK wrapper (per-group credentials)
const twilio = require('twilio');

// Cache Twilio clients per accountSid to avoid re-creating
const clientCache = new Map();

const getClient = (accountSid, authToken) => {
  if (!accountSid || !authToken) return null;
  if (!clientCache.has(accountSid)) {
    clientCache.set(accountSid, twilio(accountSid, authToken));
  }
  return clientCache.get(accountSid);
};

const formatArgentinePhone = (phone) => {
  if (!phone) return null;
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // If starts with 0, remove it (local format)
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  // If doesn't start with +, add +54
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('54')) cleaned = '+' + cleaned;
    else if (cleaned.startsWith('9')) cleaned = '+54' + cleaned;
    else cleaned = '+549' + cleaned;
  }
  return cleaned;
};

/**
 * Send WhatsApp message via Twilio using per-group credentials
 * @param {Object} params
 * @param {string} params.to - Recipient phone number
 * @param {string} params.body - Message body
 * @param {string} [params.mediaUrl] - Optional media URL
 * @param {Object} params.credentials - Group Twilio credentials
 * @param {string} params.credentials.accountSid
 * @param {string} params.credentials.authToken
 * @param {string} params.credentials.whatsappFrom - e.g. "whatsapp:+549XXXXXXXXXX"
 */
const sendWhatsApp = async ({ to, body, mediaUrl, credentials }) => {
  try {
    if (!credentials || !credentials.accountSid || !credentials.authToken || !credentials.whatsappFrom) {
      return { success: false, error: 'WhatsApp no configurado para este grupo' };
    }

    const twilioClient = getClient(credentials.accountSid, credentials.authToken);
    if (!twilioClient) {
      return { success: false, error: 'No se pudo inicializar el cliente Twilio' };
    }

    const formattedPhone = formatArgentinePhone(to);
    if (!formattedPhone) {
      return { success: false, error: 'Número de teléfono inválido' };
    }

    const messageData = {
      from: credentials.whatsappFrom,
      to: `whatsapp:${formattedPhone}`,
      body,
    };

    if (mediaUrl) {
      messageData.mediaUrl = [mediaUrl];
    }

    const message = await twilioClient.messages.create(messageData);
    console.log(`WhatsApp sent to ${formattedPhone}: ${message.sid}`);
    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendWhatsApp, formatArgentinePhone };
