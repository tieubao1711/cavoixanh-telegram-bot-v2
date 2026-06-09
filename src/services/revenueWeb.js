const env = require('../config/env');
const { getActiveRevenueDashboardSession } = require('./dashboardStore');
const {
  getRechargeStats,
  getUnsettledRevenueSummary,
  getSuccessfulRechargeOrdersByRange,
  getRecentRevenueSettlements
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
    const [stats, orders, unsettled, recentSettlements] = await Promise.all([
      getRechargeStats(range.start, range.end),
      getSuccessfulRechargeOrdersByRange(range.start, range.end, 500),
      getUnsettledRevenueSummary(),
      getRecentRevenueSettlements(10)
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
      unsettled,
      recentSettlements
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
  const startParam = normalizeDate(params.get('start'));
  const endParam = normalizeDate(params.get('end'));

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
    startDate: date,
    endDate: date,
    fileSuffix: `ngay-${date}`
  };
}

function renderRevenueDashboard({ token, session, range, stats, orders, unsettled, recentSettlements }) {
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
    body { margin: 0; background: #f4f6f8; color: #172033; font-family: Arial, sans-serif; }
    main { width: min(1220px, calc(100% - 28px)); margin: 22px auto 42px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 16px; }
    h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; color: #627083; line-height: 1.45; }
    a { color: inherit; text-decoration: none; }
    .badge { border: 1px solid #d9e2ec; background: #fff; border-radius: 999px; padding: 8px 11px; font-size: 13px; font-weight: 700; color: #526173; white-space: nowrap; }
    .toolbar, .card, section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; box-shadow: 0 10px 24px rgba(23,32,51,.06); }
    .toolbar { padding: 14px; margin-bottom: 14px; }
    form { display: grid; grid-template-columns: 150px repeat(4, minmax(130px, 1fr)) auto auto; gap: 10px; align-items: end; }
    label { display: grid; gap: 5px; color: #526173; font-size: 12px; font-weight: 800; }
    input, select, button, .button { min-height: 40px; border-radius: 7px; border: 1px solid #bac7d5; background: #fff; color: #172033; padding: 9px 10px; font-size: 14px; }
    button, .button { border: 0; background: #075fb8; color: #fff; font-weight: 800; cursor: pointer; text-align: center; }
    .button.secondary { background: #172033; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .card { padding: 16px; min-height: 104px; }
    .label { color: #647184; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    .value { font-size: 25px; font-weight: 800; line-height: 1.15; }
    .meta { margin-top: 6px; color: #647184; font-size: 13px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(330px, .85fr); gap: 14px; }
    section { padding: 16px; overflow: hidden; margin-bottom: 14px; }
    .chart { display: grid; grid-template-columns: repeat(var(--bars), minmax(28px, 1fr)); gap: 8px; height: 240px; align-items: end; padding: 12px 4px 4px; border-bottom: 1px solid #e4ebf2; }
    .bar-wrap { display: grid; align-items: end; height: 100%; min-width: 0; }
    .bar { min-height: 3px; background: #075fb8; border-radius: 5px 5px 0 0; position: relative; }
    .bar strong { position: absolute; left: 50%; bottom: calc(100% + 5px); transform: translateX(-50%); font-size: 11px; white-space: nowrap; color: #526173; }
    .bar-labels { display: grid; grid-template-columns: repeat(var(--bars), minmax(28px, 1fr)); gap: 8px; padding-top: 7px; color: #647184; font-size: 11px; text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #edf1f5; text-align: left; vertical-align: top; }
    th { color: #526173; font-size: 12px; text-transform: uppercase; letter-spacing: 0; background: #fbfcfe; }
    td.amount { font-weight: 800; white-space: nowrap; }
    code { background: #f1f4f8; border-radius: 5px; padding: 2px 5px; }
    .empty { color: #647184; padding: 14px 0; }
    @media (max-width: 980px) { header { display: block; } .badge { display: inline-block; margin-top: 12px; } form, .cards, .grid { grid-template-columns: 1fr; } table { font-size: 13px; } th:nth-child(4), td:nth-child(4) { display: none; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Doanh thu</h1>
        <p>${escapeHtml(range.label)}. Tu dong cap nhat moi 90 giay. Link het han luc ${escapeHtml(formatDateTime(session.expiresAt))}.</p>
      </div>
      <div class="badge">User ${escapeHtml(session.telegramUsername || session.userId)}</div>
    </header>

    <div class="toolbar">
      ${renderFilterForm(token, range, exportUrl)}
    </div>

    <div class="cards">
      ${renderMetricCard('Doanh thu filter', stats.totalAmount, `${formatNumber(stats.totalOrders)} lenh thanh cong`)}
      ${renderMetricCard('Gia tri trung binh', stats.totalOrders ? Math.round(stats.totalAmount / stats.totalOrders) : 0, 'Trung binh moi lenh')}
      ${renderMetricCard('Chua chot', unsettled.totalAmount, `${formatNumber(unsettled.totalOrders)} lenh dang doi soat`)}
      ${renderMetricCard('Khoang thoi gian', stats.totalOrders, `${escapeHtml(range.startDate)} den ${escapeHtml(range.endDate)}`)}
    </div>

    <section>
      <h2>Bieu do doanh thu</h2>
      ${renderBarChart(stats.byDay)}
    </section>

    <div class="grid">
      <section>
        <h2>Lenh nap thanh cong trong filter</h2>
        ${renderOrdersTable(orders)}
      </section>
      <section>
        <h2>Lich su chot gan nhat</h2>
        ${renderSettlementsTable(recentSettlements)}
      </section>
    </div>
  </main>
</body>
</html>`;
}

function renderFilterForm(token, range, exportUrl) {
  return `<form method="get" action="/revenue">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>Che do
      <select name="period">
        ${renderOption('day', 'Theo ngay', range.period)}
        ${renderOption('week', 'Theo tuan', range.period)}
        ${renderOption('month', 'Theo thang', range.period)}
        ${renderOption('custom', 'Khoang ngay', range.period)}
      </select>
    </label>
    <label>Ngay<input type="date" name="date" value="${escapeHtml(range.date)}"></label>
    <label>Thang<input type="month" name="month" value="${escapeHtml(range.month)}"></label>
    <label>Tu ngay<input type="date" name="start" value="${escapeHtml(range.startDate)}"></label>
    <label>Den ngay<input type="date" name="end" value="${escapeHtml(range.endDate)}"></label>
    <button type="submit">Loc</button>
    <a class="button secondary" href="${escapeHtml(exportUrl)}">Xuat Excel</a>
  </form>`;
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

function renderBarChart(items) {
  if (!items.length) return '<div class="empty">Chua co du lieu de ve bieu do.</div>';
  const max = Math.max(...items.map((item) => Number(item.totalAmount || 0)), 1);
  const bars = items.map((item) => {
    const amount = Number(item.totalAmount || 0);
    const height = Math.max(Math.round((amount / max) * 100), amount > 0 ? 3 : 0);
    return `<div class="bar-wrap"><div class="bar" style="height:${height}%"><strong>${formatCompactNumber(amount)}</strong></div></div>`;
  }).join('');
  const labels = items.map((item) => `<div>${escapeHtml(formatDayLabel(item.date))}</div>`).join('');
  return `<div style="--bars:${items.length}"><div class="chart">${bars}</div><div class="bar-labels">${labels}</div></div>`;
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

function renderSettlementsTable(settlements) {
  if (!settlements.length) return '<div class="empty">Chua co lan chot nao.</div>';
  const rows = settlements.map((settlement) => `<tr>
    <td><code>${escapeHtml(settlement.settlementId || '-')}</code></td>
    <td class="amount">${formatNumber(settlement.totalAmount)}</td>
    <td>${formatNumber(settlement.totalOrders)}</td>
    <td>${escapeHtml(formatDateTime(settlement.closedAt))}</td>
  </tr>`).join('');
  return `<table>
    <thead><tr><th>Ma chot</th><th>Doanh thu</th><th>Lenh</th><th>Thoi gian</th></tr></thead>
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
    date: range.date,
    month: range.month,
    start: range.startDate,
    end: range.endDate
  }).toString();
}

function normalizePeriod(value) {
  return ['day', 'week', 'month', 'custom'].includes(value) ? value : 'day';
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
