const { sendUsage } = require('./usageHandler');
const { handleNapTienCommand, handleRechargeCallbackQuery } = require('./rechargeHandler');
const { handleRutTienCommand, handleDanhSachRutCommand } = require('./withdrawHandler');
const { handleThongKeCommand } = require('./statsHandler');
const { handleChotDoanhThuCommand, handleLichSuChotCommand } = require('./settlementHandler');
const { commandRegex } = require('../utils/botUtils');

function registerBot(bot) {
  bot.onText(commandRegex('start', false), async (msg) => {
    await sendUsage(bot, msg.chat.id);
  });

  bot.onText(commandRegex('help', false), async (msg) => {
    await sendUsage(bot, msg.chat.id);
  });

  bot.onText(commandRegex('naptien'), async (msg, match) => {
    await handleNapTienCommand(bot, msg, match);
  });

  bot.onText(commandRegex('ruttien'), async (msg, match) => {
    await handleRutTienCommand(bot, msg, match);
  });

  bot.onText(commandRegex('danhsachrut'), async (msg, match) => {
    await handleDanhSachRutCommand(bot, msg, match);
  });

  bot.onText(commandRegex('thongke'), async (msg, match) => {
    await handleThongKeCommand(bot, msg, match);
  });

  bot.onText(commandRegex('chotdoanhthu', false), async (msg) => {
    await handleChotDoanhThuCommand(bot, msg);
  });

  bot.onText(commandRegex('lichsuchot', false), async (msg) => {
    await handleLichSuChotCommand(bot, msg);
  });

  bot.on('callback_query', async (query) => {
    try {
      await handleRechargeCallbackQuery(bot, query);
    } catch (error) {
      console.error('[callback_query_error]', error?.message || error);
      if (query.id) {
        await bot.answerCallbackQuery(query.id, {
          text: 'Co loi khi xu ly lua chon. Vui long thu lai.',
          show_alert: true
        }).catch(() => {});
      }
      if (query.message?.chat?.id) {
        await bot.sendMessage(query.message.chat.id, 'Co loi khi xu ly lua chon bank. Vui long thu lai hoac tao lenh nap moi.');
      }
    }
  });
}

module.exports = { registerBot };
