const { getRechargeStats } = require('../services/rechargeStore');
const { escapeHtml, formatNumber } = require('../utils/formatters');
const { isAllowedUser, extractAxiosError } = require('../utils/botUtils');

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function getVietnamDateParts(date) {
  const local = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    date: local.getUTCDate(),
    day: local.getUTCDay()
  };
}

function vietnamLocalToUtcDate(year, month, date) {
  return new Date(Date.UTC(year, month, date) - VIETNAM_OFFSET_MS);
}

function getStatsRange(period) {
  const now = new Date();
  const parts = getVietnamDateParts(now);

  if (period === 'week') {
    const mondayOffset = parts.day === 0 ? -6 : 1 - parts.day;
    const start = vietnamLocalToUtcDate(parts.year, parts.month, parts.date + mondayOffset);
    const end = vietnamLocalToUtcDate(parts.year, parts.month, parts.date + mondayOffset + 7);
    return { period, label: 'tuan nay', start, end };
  }

  if (period === 'month') {
    const start = vietnamLocalToUtcDate(parts.year, parts.month, 1);
    const end = vietnamLocalToUtcDate(parts.year, parts.month + 1, 1);
    return { period, label: 'thang nay', start, end };
  }

  const start = vietnamLocalToUtcDate(parts.year, parts.month, parts.date);
  const end = vietnamLocalToUtcDate(parts.year, parts.month, parts.date + 1);
  return { period: 'day', label: 'hom nay', start, end };
}

function buildStatsMessage(range, stats) {
  const lines = [
    `<b>Thong ke doanh thu ${escapeHtml(range.label)}</b>`,
    `Doanh thu: <b>${formatNumber(stats.totalAmount)}</b>`,
    `Lenh nap thanh cong: <b>${formatNumber(stats.totalOrders)}</b>`
  ];

  if (['week', 'month'].includes(range.period) && stats.byDay.length) {
    lines.push('');
    lines.push('<b>Theo ngay</b>');
    stats.byDay.forEach((item) => {
      lines.push(`${escapeHtml(formatVietnamDate(item.date))}: <b>${formatNumber(item.totalAmount)}</b> (${formatNumber(item.totalOrders)} lenh)`);
    });
  }

  return lines.join('\n');
}

function formatVietnamDate(value) {
  if (!value) return '-';
  const [year, month, date] = String(value).split('-');
  if (!year || !month || !date) return String(value);
  return `${date}/${month}/${year}`;
}

async function handleThongKeCommand(bot, msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  const period = (match?.[1] || '').trim().toLowerCase();
  if (period && !['week', 'month'].includes(period)) {
    await bot.sendMessage(chatId, 'Cach dung: /thongke, /thongke week hoac /thongke month');
    return;
  }

  const range = getStatsRange(period || 'day');

  try {
    const stats = await getRechargeStats(range.start, range.end);
    await bot.sendMessage(chatId, buildStatsMessage(range, stats), { parse_mode: 'HTML' });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi thong ke: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

module.exports = {
  getStatsRange,
  buildStatsMessage,
  handleThongKeCommand
};
