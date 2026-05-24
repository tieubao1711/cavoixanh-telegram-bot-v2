const TelegramBot = require('node-telegram-bot-api');
const env = require('./config/env');
const { registerBot } = require('./handlers/botHandler');
const { connectMongo, closeMongo } = require('./db/mongo');
const { startRechargeCallbackServer } = require('./services/callbackServer');

if (!env.telegramBotToken) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment variables');
}

const bot = new TelegramBot(env.telegramBotToken, { polling: false });
let callbackServer;

connectMongo()
  .then(async () => {
    await bot.deleteWebHook({ drop_pending_updates: false });
    registerBot(bot);
    await bot.startPolling({
      restart: true,
      params: {
        allowed_updates: [
          'message',
          'callback_query'
        ]
      }
    });
    callbackServer = startRechargeCallbackServer(bot);
    console.log('Payment Telegram bot started');
  })
  .catch((error) => {
    console.error('[startup_error]', error?.message || error);
    process.exit(1);
  });

bot.on('polling_error', (error) => {
  console.error('[polling_error]', {
    message: error?.message,
    code: error?.code,
    responseBody: error?.response?.body,
    stack: error?.stack
  });
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
