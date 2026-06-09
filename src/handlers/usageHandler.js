const { escapeHtml } = require('../utils/formatters');

function buildUsageMessage() {
  return [
    '<b>Huong dan bot thanh toan</b>',
    '',
    '<code>/naptien 50000</code> - tao lenh nap tien va chon ngan hang',
    '<code>/ruttien</code> hoac <code>/ruttien 100000</code> - tao link form rut tien',
    '<code>/danhsachrut</code> hoac <code>/danhsachrut mine</code> - xem cac lenh rut gan nhat',
    '<code>/thongke</code>, <code>/thongke week</code>, <code>/thongke month</code> - xem doanh thu nap thanh cong',
    '<code>/doanhthu</code> - tao link dashboard doanh thu tren web',
    '<code>/chotdoanhthu</code> - chot cac lenh nap thanh cong chua doi soat va xuat XLSX',
    '<code>/lichsuchot</code> - xem 10 lan chot doanh thu gan nhat',
    '',
    `Trong group co the dung dang <code>/${escapeHtml('naptien@BotUsername')} 50000</code>.`
  ].join('\n');
}

async function sendUsage(bot, chatId) {
  await bot.sendMessage(chatId, buildUsageMessage(), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Test callback', callback_data: 'debug:callback' }]
      ]
    }
  });
}

module.exports = {
  buildUsageMessage,
  sendUsage
};
