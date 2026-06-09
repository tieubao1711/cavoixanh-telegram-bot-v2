const { createRevenueDashboardSession } = require('../services/dashboardStore');
const { getRevenueDashboardUrl } = require('../services/revenueWeb');
const { isAllowedUser, extractAxiosError } = require('../utils/botUtils');
const { escapeHtml } = require('../utils/formatters');

async function handleDoanhThuCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  try {
    const { token, session } = await createRevenueDashboardSession({
      chatId,
      userId,
      telegramUsername: msg.from.username || ''
    });
    const url = getRevenueDashboardUrl(token);

    await bot.sendMessage(chatId, [
      '<b>Dashboard doanh thu</b>',
      'Link tam thoi co hieu luc trong 30 phut.',
      `Het han: <code>${escapeHtml(session.expiresAt.toISOString())}</code>`
    ].join('\n'), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Mo dashboard doanh thu', url }]]
      }
    });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi tao link doanh thu: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

module.exports = {
  handleDoanhThuCommand
};
