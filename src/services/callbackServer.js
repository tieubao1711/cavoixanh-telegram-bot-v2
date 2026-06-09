const http = require('http');
const { URL } = require('url');
const env = require('../config/env');
const { verifyRechargeCallbackSignature } = require('./rechargeApiClient');
const { markRechargeCallback, markCallbackNotified } = require('./rechargeStore');
const { markWithdrawCallback, markWithdrawCallbackNotified } = require('./withdrawStore');
const { handleWithdrawWebRequest } = require('./withdrawWeb');
const { handleRevenueWebRequest } = require('./revenueWeb');
const { escapeHtml, formatNumber } = require('../utils/formatters');

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function getCallbackUrl() {
  if (env.rechargeCallbackPublicUrl) return env.rechargeCallbackPublicUrl;
  return `http://localhost:${env.rechargeCallbackPort}${env.rechargeCallbackPath}`;
}

function startRechargeCallbackServer(bot) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${env.rechargeCallbackPort}`);

    if (await handleRevenueWebRequest(req, res, url)) return;
    if (await handleWithdrawWebRequest(req, res, url)) return;

    if (req.method !== 'GET' || url.pathname !== env.rechargeCallbackPath) {
      sendJson(res, 404, { ok: false, message: 'not_found' });
      return;
    }

    const payload = Object.fromEntries(url.searchParams.entries());
    if (!payload.requestId) {
      sendJson(res, 400, { ok: false, message: 'missing_requestId' });
      return;
    }

    if (!verifyRechargeCallbackSignature(payload)) {
      sendJson(res, 403, { ok: false, message: 'invalid_signature' });
      return;
    }

    try {
      if (isWithdrawCallback(payload)) {
        await handleWithdrawCallback(bot, payload, res);
        return;
      }

      const result = await markRechargeCallback(payload.requestId, payload);
      if (!result) {
        sendJson(res, 404, { ok: false, message: 'order_not_found' });
        return;
      }

      const { before, after } = result;
      const shouldNotifySuccess = payload.status === 'success' && before.status !== 'success' && !before.callbackNotified;
      if (shouldNotifySuccess) {
        const amount = Number(payload.chargeAmount || after.amount || 0);
        await bot.sendMessage(
          after.chatId,
          [
            '<b>Nap tien thanh cong</b>',
            `So tien: <b>${formatNumber(amount)}</b>`,
            `Ma giao dich: <code>${escapeHtml(payload.chargeCode || after.rechargeData?.code || after.requestId)}</code>`
          ].join('\n'),
          { parse_mode: 'HTML' }
        );
        await markCallbackNotified(payload.requestId);
      }

      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error('[payment_callback_error]', error?.message || error);
      sendJson(res, 500, { ok: false, message: 'server_error' });
    }
  });

  server.listen(env.rechargeCallbackPort, () => {
    console.log(`Payment callback server listening on ${getCallbackUrl()}`);
  });

  return server;
}

function isWithdrawCallback(payload) {
  return ['bankout', 'momoout'].includes(String(payload.chargeType || '').toLowerCase());
}

async function handleWithdrawCallback(bot, payload, res) {
  const result = await markWithdrawCallback(payload.requestId, payload);
  if (!result) {
    sendJson(res, 404, { ok: false, message: 'withdraw_order_not_found' });
    return;
  }

  const { before, after } = result;
  const shouldNotify =
    ['success', 'deleted', 'cancel', 'timeout'].includes(payload.status) &&
    before.status !== payload.status &&
    !before.callbackNotified;

  if (shouldNotify) {
    const amount = Number(payload.chargeAmount || after.amount || 0);
    await bot.sendMessage(
      after.chatId,
      [
        `<b>${escapeHtml(getWithdrawStatusTitle(payload.status))}</b>`,
        `So tien: <b>${formatNumber(amount)}</b>`,
        `Ngan hang: <b>${escapeHtml(after.bankName || after.bankCode || '-')}</b>`,
        `So TK: <code>${escapeHtml(after.bankAccount || '-')}</code>`,
        `Ma lenh: <code>${escapeHtml(after.requestId)}</code>`
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
    await markWithdrawCallbackNotified(after.requestId);
  }

  sendJson(res, 200, { ok: true });
}

function getWithdrawStatusTitle(status) {
  if (status === 'success') return 'Rut tien thanh cong';
  if (status === 'deleted') return 'Lenh rut bi tu choi';
  if (status === 'cancel') return 'Lenh rut da huy';
  if (status === 'timeout') return 'Lenh rut qua han';
  return 'Cap nhat lenh rut';
}

module.exports = {
  startRechargeCallbackServer,
  getCallbackUrl
};
