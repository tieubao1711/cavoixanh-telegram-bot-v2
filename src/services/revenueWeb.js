const env = require('../config/env');
const { getActiveRevenueDashboardSession } = require('./dashboardStore');
const {
  getRechargeStats,
  getUnsettledRevenueSummary,
  getSuccessfulRechargeOrdersByRange
} = require('./rechargeStore');
const { createXlsxBuffer } = require('../utils/xlsxWriter');
const { escapeHtml, formatNumber, formatDateTime } = require('../utils/formatters');

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function sendXlsx(res, fileName, buffer) {
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store'
  });
  res.end(buffer);
}

function getPublicBaseUrl() {
  if (env.rechargeCallbackPublicUrl) {
    const url = new URL(env.rechargeCallbackPublicUrl);
    return `${url.protocol}//${url.host}`;
  }
  return `http://localhost:${env.rechargeCallbackPort}`;
}

function getRevenueDashboardUrl(token) {
  const params = new URLSearchParams({ token });
  return `${getPublicBaseUrl()}/revenue?${params.toString()}`;
}

async function handleRevenueWebRequest(req, res, url) {
  if (url.pathname !== '/revenue' && url.pathname !== '/revenue/export') return false;

  const token = url.searchParams.get('token') || '';
  const session = await getActiveRevenueDashboardSession(token);
  if (!session) {
    sendHtml(res, 403, renderErrorPage('Link doanh thu khong hop le hoac da het han.'));
    return true;
  }

  try {
    const range = getRevenueRange(url.searchParams);
    const [stats, orders, unsettled] = await Promise.all([
      getRechargeStats(range.start, range.end),
      getSuccessfulRechargeOrdersByRange(range.start, range.end, 500),
      getUnsettledRevenueSummary()
    ]);

    if (url.pathname === '/revenue/export') {
      const buffer = await buildRevenueExport({ range, stats, orders });
      sendXlsx(res, `doanh-thu-${range.fileSuffix}.xlsx`, buffer);
      return true;
    }

    sendHtml(res, 200, renderRevenueDashboard({
      token,
      session,
      range,
      stats,
      orders,
      unsettled
    }));
    return true;
  } catch (error) {
    console.error('[revenue_dashboard_error]', error?.message || error);
    sendHtml(res, 500, renderErrorPage('Khong tai duoc dashboard doanh thu.'));
    return true;
  }
}

function getRevenueRange(params) {
  const period = normalizePeriod(params.get('period') || 'day');
  const today = getVietnamDateString(new Date());
  const date = normalizeDate(params.get('date')) || today;
  const month = normalizeMonth(params.get('month')) || date.slice(0, 7);
  const days = normalizeDays(params.get('days'));
  const startParam = normalizeDate(params.get('start'));
  const endParam = normalizeDate(params.get('end'));

  if (period === 'last') {
    const endDate = date;
    const end = new Date(parseVietnamDate(endDate).getTime() + 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const startDate = getVietnamDateString(start);
    return {
      period,
      label: days === 1 ? `Hom nay ${formatDisplayDate(endDate)}` : `${days} ngay gan nhat`,
      start,
      end,
      date,
      month,
      days,
      startDate,
      endDate,
      fileSuffix: `${days}-ngay-gan-nhat-${endDate}`
    };
  }

  if (period === 'week') {
    const parts = getVietnamDateParts(parseVietnamDate(date));
    const mondayOffset = parts.day === 0 ? -6 : 1 - parts.day;
    const start = vietnamLocalToUtcDate(parts.year, parts.month, parts.date + mondayOffset);
    const end = vietnamLocalToUtcDate(parts.year, parts.month, parts.date + mondayOffset + 7);
    return {
      period,
      label: `Tuan ${formatShortDate(start)} - ${formatShortDate(new Date(end.getTime() - 1))}`,
      start,
      end,
      date,
      month,
      days,
      startDate: getVietnamDateString(start),
      endDate: getVietnamDateString(new Date(end.getTime() - 1)),
      fileSuffix: `tuan-${date}`
    };
  }

  if (period === 'month') {
    const [year, monthIndex] = month.split('-').map(Number);
    const start = vietnamLocalToUtcDate(year, monthIndex - 1, 1);
    const end = vietnamLocalToUtcDate(year, monthIndex, 1);
    return {
      period,
      label: `Thang ${month}`,
      start,
      end,
      date,
      month,
      days,
      startDate: getVietnamDateString(start),
      endDate: getVietnamDateString(new Date(end.getTime() - 1)),
      fileSuffix: `thang-${month}`
    };
  }

  if (period === 'custom') {
    const startDate = startParam || date;
    const endDate = endParam || startDate;
    const start = parseVietnamDate(startDate);
    const end = new Date(parseVietnamDate(endDate).getTime() + 24 * 60 * 60 * 1000);
    return {
      period,
      label: `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`,
      start,
      end,
      date,
      month,
      days,
      startDate,
      endDate,
      fileSuffix: `${startDate}_${endDate}`
    };
  }

  const start = parseVietnamDate(date);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    period: 'day',
    label: `Ngay ${formatDisplayDate(date)}`,
    start,
    end,
    date,
    month,
    days,
    startDate: date,
    endDate: date,
    fileSuffix: `ngay-${date}`
  };
}

function renderRevenueDashboard({ token, session, range, stats, orders, unsettled }) {
  const exportUrl = `/revenue/export?${buildRangeQuery(token, range)}`;
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="90">
  <title>Doanh thu</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f5f7; color: #172033; font-family: Arial, sans-serif; }
    main { width: min(1240px, calc(100% - 28px)); margin: 20px auto 42px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
    h1 { margin: 0 0 5px; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 17px; letter-spacing: 0; }
    p { margin: 0; color: #617085; line-height: 1.45; font-size: 14px; }
    a { color: inherit; text-decoration: none; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .badge { border: 1px solid #d6dee8; background: #fff; border-radius: 999px; padding: 8px 11px; font-size: 13px; font-weight: 700; color: #526173; white-space: nowrap; }
    .toolbar, .card, section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; box-shadow: 0 10px 24px rgba(23,32,51,.06); }
    .toolbar { padding: 12px; margin-bottom: 12px; }
    .quick { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .quick a { border: 1px solid #c7d3df; border-radius: 7px; padding: 8px 10px; font-size: 13px; font-weight: 800; color: #26364d; background: #fff; }
    .quick a.active { background: #075fb8; border-color: #075fb8; color: #fff; }
    form { display: grid; grid-template-columns: 150px repeat(4, minmax(130px, 1fr)) auto; gap: 10px; align-items: end; }
    label { display: grid; gap: 5px; color: #526173; font-size: 12px; font-weight: 800; }
    input, select, button, .button { min-height: 40px; border-radius: 7px; border: 1px solid #bac7d5; background: #fff; color: #172033; padding: 9px 10px; font-size: 14px; }
    button, .button { border: 0; background: #075fb8; color: #fff; font-weight: 800; cursor: pointer; text-align: center; }
    .button.secondary { background: #172033; }
    .cards { display: grid; grid-template-columns: 1.35fr repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
    .card { padding: 15px; min-height: 98px; }
    .label { color: #647184; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    .value { font-size: 24px; font-weight: 800; line-height: 1.15; }
    .cards .card:first-child .value { font-size: 30px; }
    .meta { margin-top: 6px; color: #647184; font-size: 13px; }
    section { padding: 15px; overflow: hidden; margin-bottom: 12px; }
    .chart-box { width: 100%; overflow-x: auto; }
    svg { display: block; min-width: 760px; width: 100%; height: 280px; }
    .axis { stroke: #d9e2ec; stroke-width: 1; }
    .bar { fill: #075fb8; }
    .line { fill: none; stroke: #172033; stroke-width: 2.5; }
    .tick, .bar-text { fill: #647184; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #edf1f5; text-align: left; vertical-align: top; }
    th { color: #526173; font-size: 12px; text-transform: uppercase; letter-spacing: 0; background: #fbfcfe; }
    td.amount { font-weight: 800; white-space: nowrap; }
    code { background: #f1f4f8; border-radius: 5px; padding: 2px 5px; }
    .empty { color: #647184; padding: 14px 0; }
    @media (max-width: 980px) { header { display: block; } .actions { justify-content: flex-start; margin-top: 12px; } form, .cards { grid-template-columns: 1fr; } table { font-size: 13px; } th:nth-child(4), td:nth-child(4) { display: none; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Doanh thu</h1>
        <p>${escapeHtml(range.label)}. Tu dong cap nhat moi 90 giay.</p>
      </div>
      <div class="actions">
        <a class="button secondary" href="${escapeHtml(exportUrl)}">Xuat Excel</a>
        <div class="badge">Het han ${escapeHtml(formatDateTime(session.expiresAt))}</div>
      </div>
    </header>

    <div class="toolbar">
      ${renderFilterForm(token, range, exportUrl)}
    </div>

    <div class="cards">
      ${renderMetricCard('Doanh thu filter', stats.totalAmount, `${formatNumber(stats.totalOrders)} lenh thanh cong`)}
      ${renderMetricCard('Gia tri trung binh', stats.totalOrders ? Math.round(stats.totalAmount / stats.totalOrders) : 0, 'Trung binh moi lenh')}
      ${renderMetricCard('Chua chot', unsettled.totalAmount, `${formatNumber(unsettled.totalOrders)} lenh dang doi soat`)}
      ${renderMetricCard('So lenh', stats.totalOrders, `${escapeHtml(range.startDate)} den ${escapeHtml(range.endDate)}`)}
    </div>

    <section>
      <h2>Xu huong doanh thu</h2>
      ${renderRevenueChart(stats.byDay)}
    </section>

    <section>
      <h2>Lenh nap thanh cong</h2>
      ${renderOrdersTable(orders)}
    </section>
  </main>
</body>
</html>`;
}

function renderFilterForm(token, range, exportUrl) {
  return `${renderQuickFilters(token, range)}
  <form method="get" action="/revenue">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>Che do
      <select name="period">
        ${renderOption('last', 'Gan nhat', range.period)}
        ${renderOption('day', 'Theo ngay', range.period)}
        ${renderOption('week', 'Theo tuan', range.period)}
        ${renderOption('month', 'Theo thang', range.period)}
        ${renderOption('custom', 'Khoang ngay', range.period)}
      </select>
    </label>
    <label>So ngay<input type="number" name="days" min="1" max="90" value="${escapeHtml(range.days)}"></label>
    <label>Ngay<input type="date" name="date" value="${escapeHtml(range.date)}"></label>
    <label>Thang<input type="month" name="month" value="${escapeHtml(range.month)}"></label>
    <label>Tu ngay<input type="date" name="start" value="${escapeHtml(range.startDate)}"></label>
    <label>Den ngay<input type="date" name="end" value="${escapeHtml(range.endDate)}"></label>
    <button type="submit">Loc</button>
  </form>`;
}

function renderQuickFilters(token, range) {
  const items = [
    ['last', '1', 'Hom nay'],
    ['last', '2', '2 ngay'],
    ['last', '7', '7 ngay'],
    ['last', '30', '30 ngay'],
    ['week', String(range.days), 'Tuan nay'],
    ['month', String(range.days), 'Thang nay']
  ];
  const links = items.map(([period, days, label]) => {
    const active = range.period === period && (period !== 'last' || String(range.days) === days);
    const query = new URLSearchParams({
      token,
      period,
      days,
      date: range.date,
      month: range.month,
      start: range.startDate,
      end: range.endDate
    });
    return `<a class="${active ? 'active' : ''}" href="/revenue?${query.toString()}">${escapeHtml(label)}</a>`;
  }).join('');
  return `<div class="quick">${links}</div>`;
}

function renderOption(value, label, current) {
  return `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
}

function renderMetricCard(label, value, meta) {
  return `<div class="card">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${formatNumber(value)}</div>
    <div class="meta">${escapeHtml(meta)}</div>
  </div>`;
}

function renderRevenueChart(items) {
  if (!items.length) return '<div class="empty">Chua co du lieu de ve bieu do.</div>';
  const width = 960;
  const height = 280;
  const pad = { left: 54, right: 18, top: 24, bottom: 42 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(...items.map((item) => Number(item.totalAmount || 0)), 1);
  const barGap = 10;
  const barWidth = Math.max(8, (plotWidth - barGap * (items.length - 1)) / items.length);
  const bars = items.map((item, index) => {
    const amount = Number(item.totalAmount || 0);
    const barHeight = Math.max((amount / max) * plotHeight, amount > 0 ? 3 : 0);
    const x = pad.left + index * (barWidth + barGap);
    const y = pad.top + plotHeight - barHeight;
    const label = formatDayLabel(item.date);
    const showLabel = items.length <= 16 || index % Math.ceil(items.length / 12) === 0;
    return [
      `<rect class="bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4"></rect>`,
      amount > 0 && items.length <= 12 ? `<text class="bar-text" x="${x + barWidth / 2}" y="${Math.max(y - 7, 12)}" text-anchor="middle">${formatCompactNumber(amount)}</text>` : '',
      showLabel ? `<text class="tick" x="${x + barWidth / 2}" y="${height - 16}" text-anchor="middle">${escapeHtml(label)}</text>` : ''
    ].join('');
  }).join('');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = pad.top + plotHeight - ratio * plotHeight;
    const value = max * ratio;
    return `<line class="axis" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
      <text class="tick" x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${formatCompactNumber(value)}</text>`;
  }).join('');
  return `<div class="chart-box"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bieu do doanh thu">
    ${yTicks}
    ${bars}
  </svg></div>`;
}

function renderOrdersTable(orders) {
  if (!orders.length) return '<div class="empty">Khong co lenh nap thanh cong trong filter.</div>';
  const rows = orders.map((order) => {
    const amount = Number(order.chargeAmount ?? order.amount ?? 0);
    const bank = order.selectedBank?.name || order.selectedBank?.code || order.rechargeData?.bank_provider || '-';
    const code = order.chargeCode || order.rechargeData?.code || order.requestId || '-';
    return `<tr>
      <td><code>${escapeHtml(order.requestId || '-')}</code></td>
      <td class="amount">${formatNumber(amount)}</td>
      <td>${escapeHtml(bank)}</td>
      <td><code>${escapeHtml(code)}</code></td>
      <td>${escapeHtml(formatDateTime(order.completedAt || order.updatedAt || order.createdAt))}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>Request</th><th>So tien</th><th>Bank</th><th>Ma GD</th><th>Thoi gian</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function buildRevenueExport({ range, stats, orders }) {
  const summaryRows = [
    ['Bao cao', 'Doanh thu'],
    ['Filter', range.label],
    ['Tu ngay', range.startDate],
    ['Den ngay', range.endDate],
    ['Tong doanh thu', stats.totalAmount],
    ['Tong lenh thanh cong', stats.totalOrders],
    ['Xuat luc', formatDateTime(new Date())]
  ];
  const chartRows = [
    ['Ngay', 'Doanh thu', 'So lenh'],
    ...stats.byDay.map((item) => [item.date, item.totalAmount, item.totalOrders])
  ];
  const orderRows = [
    ['STT', 'Request ID', 'Ma GD', 'So tien', 'Trang thai', 'Ngan hang', 'Thoi gian tao', 'Thoi gian thanh cong', 'Telegram user', 'Chat ID'],
    ...orders.map((order, index) => [
      index + 1,
      order.requestId || '',
      order.chargeCode || order.rechargeData?.code || '',
      Number(order.chargeAmount ?? order.amount ?? 0),
      order.status || '',
      order.selectedBank?.name || order.selectedBank?.code || order.rechargeData?.bank_provider || '',
      formatDateTime(order.createdAt),
      formatDateTime(order.completedAt || order.updatedAt),
      order.telegramUsername || order.userId || '',
      order.chatId || ''
    ])
  ];

  return createXlsxBuffer([
    { name: 'Tong quan', rows: summaryRows },
    { name: 'Theo ngay', rows: chartRows },
    { name: 'Lenh nap', rows: orderRows }
  ]);
}

function buildRangeQuery(token, range) {
  return new URLSearchParams({
    token,
    period: range.period,
    days: String(range.days),
    date: range.date,
    month: range.month,
    start: range.startDate,
    end: range.endDate
  }).toString();
}

function normalizePeriod(value) {
  return ['last', 'day', 'week', 'month', 'custom'].includes(value) ? value : 'day';
}

function normalizeDays(value) {
  const days = Number(value || 1);
  if (!Number.isInteger(days) || days < 1) return 1;
  return Math.min(days, 90);
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeMonth(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : '';
}

function parseVietnamDate(value) {
  const [year, month, date] = value.split('-').map(Number);
  return vietnamLocalToUtcDate(year, month - 1, date);
}

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

function getVietnamDateString(date) {
  const parts = getVietnamDateParts(date);
  return `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.date).padStart(2, '0')}`;
}

function formatDisplayDate(value) {
  const [year, month, date] = value.split('-');
  return `${date}/${month}/${year}`;
}

function formatShortDate(value) {
  return formatDisplayDate(getVietnamDateString(value));
}

function formatDayLabel(value) {
  if (!value) return '-';
  const parts = String(value).split('-');
  if (parts.length !== 3) return String(value);
  return `${parts[2]}/${parts[1]}`;
}

function formatCompactNumber(value) {
  const num = Number(value || 0);
  if (num >= 1000000000) return `${Math.round(num / 100000000) / 10}B`;
  if (num >= 1000000) return `${Math.round(num / 100000) / 10}M`;
  if (num >= 1000) return `${Math.round(num / 100) / 10}K`;
  return formatNumber(num);
}

function renderErrorPage(message) {
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loi</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f7fa;color:#172033;">
  <main style="width:min(680px,calc(100% - 28px));margin:40px auto;background:#fff;border:1px solid #d9e2ec;border-radius:8px;padding:22px;">
    <h1 style="margin-top:0;">Khong mo duoc dashboard</h1>
    <p>${escapeHtml(message)}</p>
  </main>
</body>
</html>`;
}

module.exports = {
  getRevenueDashboardUrl,
  handleRevenueWebRequest,
  getRevenueRange
};
