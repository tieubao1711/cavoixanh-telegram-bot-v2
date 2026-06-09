const env = require('../config/env');
const { getActiveRevenueDashboardSession } = require('./dashboardStore');
const {
  getRechargeStats,
  getUnsettledRevenueSummary,
  getRecentSuccessfulRechargeOrders,
  getRecentRevenueSettlements
} = require('./rechargeStore');
const { getStatsRange } = require('../handlers/statsHandler');
const { escapeHtml, formatNumber, formatDateTime } = require('../utils/formatters');

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
  if (url.pathname !== '/revenue') return false;

  const token = url.searchParams.get('token') || '';
  const session = await getActiveRevenueDashboardSession(token);
  if (!session) {
    sendHtml(res, 403, renderErrorPage('Link doanh thu khong hop le hoac da het han.'));
    return true;
  }

  try {
    const [today, week, month, unsettled, recentOrders, recentSettlements] = await Promise.all([
      getRechargeStats(getStatsRange('day').start, getStatsRange('day').end),
      getRechargeStats(getStatsRange('week').start, getStatsRange('week').end),
      getRechargeStats(getStatsRange('month').start, getStatsRange('month').end),
      getUnsettledRevenueSummary(),
      getRecentSuccessfulRechargeOrders(20),
      getRecentRevenueSettlements(10)
    ]);

    sendHtml(res, 200, renderRevenueDashboard({
      session,
      today,
      week,
      month,
      unsettled,
      recentOrders,
      recentSettlements
    }));
    return true;
  } catch (error) {
    console.error('[revenue_dashboard_error]', error?.message || error);
    sendHtml(res, 500, renderErrorPage('Khong tai duoc dashboard doanh thu.'));
    return true;
  }
}

function renderRevenueDashboard({ session, today, week, month, unsettled, recentOrders, recentSettlements }) {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>Doanh thu</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fa; color: #172033; font-family: Arial, sans-serif; }
    main { width: min(1180px, calc(100% - 28px)); margin: 24px auto 42px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; color: #647184; line-height: 1.45; }
    .badge { border: 1px solid #d9e2ec; background: #fff; border-radius: 999px; padding: 8px 11px; font-size: 13px; font-weight: 700; color: #526173; white-space: nowrap; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .card, section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; box-shadow: 0 10px 24px rgba(23,32,51,.06); }
    .card { padding: 16px; min-height: 104px; }
    .label { color: #647184; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    .value { font-size: 24px; font-weight: 800; line-height: 1.15; }
    .meta { margin-top: 6px; color: #647184; font-size: 13px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, .85fr); gap: 14px; }
    section { padding: 16px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #edf1f5; text-align: left; vertical-align: top; }
    th { color: #526173; font-size: 12px; text-transform: uppercase; letter-spacing: 0; background: #fbfcfe; }
    td.amount { font-weight: 800; white-space: nowrap; }
    code { background: #f1f4f8; border-radius: 5px; padding: 2px 5px; }
    .empty { color: #647184; padding: 14px 0; }
    @media (max-width: 860px) { header { display: block; } .badge { display: inline-block; margin-top: 12px; } .cards, .grid { grid-template-columns: 1fr; } table { font-size: 13px; } th:nth-child(4), td:nth-child(4) { display: none; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Doanh thu</h1>
        <p>Tu dong cap nhat moi 60 giay. Link het han luc ${escapeHtml(formatDateTime(session.expiresAt))}.</p>
      </div>
      <div class="badge">User ${escapeHtml(session.telegramUsername || session.userId)}</div>
    </header>

    <div class="cards">
      ${renderMetricCard('Hom nay', today)}
      ${renderMetricCard('Tuan nay', week)}
      ${renderMetricCard('Thang nay', month)}
      <div class="card">
        <div class="label">Chua chot</div>
        <div class="value">${formatNumber(unsettled.totalAmount)}</div>
        <div class="meta">${formatNumber(unsettled.totalOrders)} lenh dang cho doi soat</div>
      </div>
    </div>

    <div class="grid">
      <section>
        <h2>Lenh nap thanh cong gan nhat</h2>
        ${renderOrdersTable(recentOrders)}
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

function renderMetricCard(label, stats) {
  return `<div class="card">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${formatNumber(stats.totalAmount)}</div>
    <div class="meta">${formatNumber(stats.totalOrders)} lenh thanh cong</div>
  </div>`;
}

function renderOrdersTable(orders) {
  if (!orders.length) return '<div class="empty">Chua co lenh nap thanh cong.</div>';
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
  handleRevenueWebRequest
};
