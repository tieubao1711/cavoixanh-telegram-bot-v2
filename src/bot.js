const TelegramBot = require('node-telegram-bot-api');
const env = require('./config/env');
const { registerBot } = require('./handlers/botHandler');
const { connectMongo, closeMongo } = require('./db/mongo');
const { startRechargeCallbackServer } = require('./services/callbackServer');

if (!env.telegramBotToken) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment variables');
}

const bot = new TelegramBot(env.telegramBotToken, { polling: true });
let callbackServer;

connectMongo()
  .then(() => {
    registerBot(bot);
    callbackServer = startRechargeCallbackServer(bot);
    console.log('Payment Telegram bot started');
  })
  .catch((error) => {
    console.error('[startup_error]', error?.message || error);
    process.exit(1);
  });

bot.on('polling_error', (error) => {
  console.error('[polling_error]', error?.message || error);
});

async function shutdown() {
  try {
    await bot.stopPolling();
    if (callbackServer) callbackServer.close();
    await closeMongo();
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
