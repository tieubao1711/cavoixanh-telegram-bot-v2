const dotenv = require('dotenv');

dotenv.config();

function cleanBaseUrl(value, fallback) {
  return String(value || fallback || '').replace(/\/$/, '');
}

const allowedUserIds = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

module.exports = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  apiBaseUrl: cleanBaseUrl(process.env.API_BASE_URL, 'http://localhost:3000'),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  allowedUserIds,
  rechargeApiBaseUrl: cleanBaseUrl(
    process.env.RECHARGE_API_BASE_URL,
    process.env.API_BASE_URL || 'http://localhost:3000'
  ),
  rechargeApiKey: process.env.RECHARGE_API_KEY || '',
  rechargeSignKey: process.env.RECHARGE_SIGN_KEY || '',
  rechargeCallbackPasswordLv2: process.env.RECHARGE_CALLBACK_PASSWORD_LV2 || '',
  rechargeCallbackPort: Number(process.env.RECHARGE_CALLBACK_PORT || 3001),
  rechargeCallbackPath: process.env.RECHARGE_CALLBACK_PATH || '/recharge/callback',
  rechargeCallbackPublicUrl: process.env.RECHARGE_CALLBACK_PUBLIC_URL || '',
  withdrawApproverTelegramId: process.env.WITHDRAW_APPROVER_TELEGRAM_ID || '',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongodbDbName: process.env.MONGODB_DB_NAME || 'payment_telegram_bot'
};
