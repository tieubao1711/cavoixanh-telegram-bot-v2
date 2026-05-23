const env = require('../config/env');
const { createWithdrawSession, listWithdrawOrders } = require('../services/withdrawStore');
const { getWithdrawUrl } = require('../services/withdrawWeb');
const { isAllowedUser, extractAxiosError } = require('../utils/botUtils');
const { escapeHtml, formatNumber, formatDateTime } = require('../utils/formatters');

async function handleRutTienCommand(bot, msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  if (!env.withdrawApproverTelegramId) {
    await bot.sendMessage(chatId, 'Chua cau hinh WITHDRAW_APPROVER_TELEGRAM_ID.');
    return;
  }

  const rawAmount = (match?.[1] || '').trim();
  const amount = rawAmount ? Number(rawAmount.replace(/[,. ]/g, '')) : null;
  if (rawAmount && (!Number.isInteger(amount) || amount <= 0)) {
    await bot.sendMessage(chatId, 'Cach dung: /ruttien hoac /ruttien 100000');
    return;
  }

  try {
    const { token, approvalCode } = await createWithdrawSession({
      chatId,
      userId,
      telegramUsername: msg.from.username || '',
      amount
    });
    const url = getWithdrawUrl(token);
    const requester = msg.from.username
      ? `@${msg.from.username}`
      : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || String(userId);

    await bot.sendMessage(env.withdrawApproverTelegramId, [
      '<b>Ma xac thuc rut tien</b>',
      `Ma: <code>${approvalCode}</code>`,
      `Nguoi yeu cau: ${escapeHtml(requester)} (<code>${userId}</code>)`,
      amount ? `So tien yeu cau: <b>${formatNumber(amount)}</b>` : 'So tien: nguoi dung nhap trong form',
      'Chi cung cap ma nay neu ban dong y cho tao lenh rut.'
    ].join('\n'), { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, [
      '<b>Form rut tien</b>',
      amount ? `So tien: <b>${formatNumber(amount)}</b>` : 'Ban co the nhap so tien trong form.',
      'Ma xac thuc da duoc gui cho nguoi duyet. Ban can nhap dung ma do trong form.',
      'Link co hieu luc trong 15 phut.'
    ].join('\n'), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Mo form rut tien', url }]]
      }
    });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi tao form rut tien: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

async function handleDanhSachRutCommand(bot, msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  const arg = (match?.[1] || '').trim().toLowerCase();
  const onlyMine = arg === 'mine' || arg === 'me';

  try {
    const orders = await listWithdrawOrders({
      limit: 10,
      userId: onlyMine ? userId : undefined
    });

    if (!orders.length) {
      await bot.sendMessage(chatId, onlyMine ? 'Ban chua co lenh rut nao.' : 'Chua co lenh rut nao.');
      return;
    }

    await bot.sendMessage(chatId, buildWithdrawListMessage(orders, onlyMine), {
      parse_mode: 'HTML'
    });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi lay danh sach rut tien: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

function buildWithdrawListMessage(orders, onlyMine) {
  const lines = [
    `<b>Danh sach rut tien gan nhat${onlyMine ? ' cua ban' : ''}</b>`
  ];

  orders.forEach((order, index) => {
    lines.push('');
    lines.push(`<b>${index + 1}. ${escapeHtml(order.status || '-')}</b> - <b>${formatNumber(order.amount)}</b>`);
    lines.push(`Ngan hang: ${escapeHtml(order.bankName || order.bankCode || '-')}`);
    lines.push(`STK: <code>${escapeHtml(maskAccount(order.bankAccount))}</code>`);
    lines.push(`Ten TK: ${escapeHtml(order.bankAccountName || '-')}`);
    lines.push(`Ma lenh: <code>${escapeHtml(order.requestId || '-')}</code>`);
    lines.push(`Thoi gian: ${escapeHtml(formatDateTime(order.createdAt))}`);
  });

  lines.push('');
  lines.push('Dung <code>/danhsachrut mine</code> de chi xem lenh cua ban.');
  return lines.join('\n');
}

function maskAccount(value) {
  const text = String(value || '');
  if (text.length <= 4) return text || '-';
  return `${'*'.repeat(Math.max(text.length - 4, 0))}${text.slice(-4)}`;
}

module.exports = {
  handleRutTienCommand,
  handleDanhSachRutCommand,
  buildWithdrawListMessage
};
