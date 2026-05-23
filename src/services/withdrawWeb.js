const crypto = require('crypto');
const { URLSearchParams } = require('url');
const env = require('../config/env');
const {
  fetchWithdrawBanks,
  createWithdrawCharge,
  checkCharge,
  cancelCharge
} = require('./withdrawApiClient');
const {
  getUsableWithdrawSession,
  touchWithdrawSession,
  refreshWithdrawSessionNonce,
  verifyWithdrawSessionNonce,
  verifyWithdrawApprovalCode,
  markWithdrawSessionUsed,
  createWithdrawOrder,
  updateWithdrawOrderAfterSubmit,
  getWithdrawOrderBySessionToken,
  markWithdrawCheckResult,
  markWithdrawCancelResult,
  canCheckWithdrawOrder,
  canCancelWithdrawOrder
} = require('./withdrawStore');
const { escapeHtml } = require('../utils/formatters');

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

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function createRequestId() {
  return `wd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function getPublicBaseUrl() {
  if (env.rechargeCallbackPublicUrl) {
    const url = new URL(env.rechargeCallbackPublicUrl);
    return `${url.protocol}//${url.host}`;
  }
  return `http://localhost:${env.rechargeCallbackPort}`;
}

function getWithdrawUrl(token) {
  const params = new URLSearchParams({ token });
  return `${getPublicBaseUrl()}/withdraw?${params.toString()}`;
}

function normalizeBanks(response) {
  return response?.data || [];
}

function renderWithdrawPage({ token, session, banks, initialOrder = null }) {
  const bankOptions = banks.map((bank) => {
    const code = escapeHtml(bank.code);
    const name = escapeHtml(bank.name || bank.code);
    const label = escapeHtml(`${bank.name || bank.code} ${bank.code}`.toLowerCase());
    return `<option value="${code}" data-label="${label}">${name} (${code})</option>`;
  }).join('');
  const amountValue = session.amount ? String(session.amount) : '';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rut tien</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f6f8; color: #172033; font-family: Arial, sans-serif; }
    main { width: min(720px, calc(100% - 28px)); margin: 28px auto; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    p { color: #627083; line-height: 1.45; }
    form, .panel { background: #fff; border: 1px solid #d8e0ea; border-radius: 8px; padding: 22px; box-shadow: 0 12px 30px rgba(21,32,51,.08); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .field { margin-top: 16px; }
    .field:first-child { margin-top: 0; }
    label { display: block; font-size: 14px; font-weight: 700; margin-bottom: 7px; }
    input, select, textarea { width: 100%; border: 1px solid #bcc8d6; border-radius: 7px; padding: 12px 13px; font-size: 16px; }
    textarea { min-height: 82px; resize: vertical; }
    button { border: 0; border-radius: 7px; padding: 12px 15px; min-height: 44px; font-size: 15px; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .primary { background: #075fb8; color: #fff; }
    .secondary { background: #edf2f7; color: #172033; }
    .danger { background: #c52828; color: #fff; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
    .notice { border: 1px solid #f1d08a; background: #fff5df; color: #5f4500; border-radius: 7px; padding: 12px 13px; font-size: 13px; }
    .error { display: none; border: 1px solid #ffd0d0; background: #fff0f0; color: #b42318; border-radius: 7px; padding: 10px 12px; font-size: 13px; }
    .error:not(:empty) { display: block; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .detail { border: 1px solid #d8e0ea; border-radius: 7px; background: #fbfcfe; padding: 11px 12px; overflow-wrap: anywhere; }
    .detail span { display: block; color: #627083; font-size: 12px; font-weight: 700; margin-bottom: 4px; }
    .status-pill { border-radius: 999px; padding: 7px 10px; background: #edf2f7; color: #627083; font-weight: 700; font-size: 13px; }
    .status-pill.success { background: #e8f6ee; color: #11753b; }
    .status-pill.danger { background: #fff0f0; color: #b42318; }
    @media (max-width: 560px) { main { width: min(100% - 22px, 720px); margin: 18px auto; } .grid, .details { grid-template-columns: 1fr; } button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <h1>Rut tien</h1>
    <p>Link tam thoi co hieu luc trong 15 phut. Kiem tra ky ngan hang, so tai khoan va ten chu tai khoan truoc khi tao lenh.</p>

    <form id="withdrawForm" ${initialOrder ? 'style="display:none;"' : ''}>
      <div class="grid">
        <div class="field">
          <label for="amount">So tien</label>
          <input id="amount" name="amount" inputmode="numeric" value="${escapeHtml(amountValue)}" placeholder="100000" required>
        </div>
        <div class="field">
          <label for="bankSearch">Tim ngan hang</label>
          <input id="bankSearch" autocomplete="off" placeholder="VCB, Vietcombank">
        </div>
      </div>
      <div class="field">
        <label for="bankCode">Ngan hang</label>
        <select id="bankCode" name="bankCode" required>
          <option value="">Chon ngan hang</option>
          ${bankOptions}
        </select>
      </div>
      <div class="grid">
        <div class="field">
          <label for="bankAccount">So tai khoan</label>
          <input id="bankAccount" name="bankAccount" autocomplete="off" required>
        </div>
        <div class="field">
          <label for="bankAccountName">Ten chu tai khoan</label>
          <input id="bankAccountName" name="bankAccountName" autocomplete="off" required>
        </div>
      </div>
      <div class="field">
        <label for="message">Ghi chu</label>
        <textarea id="message" name="message"></textarea>
      </div>
      <div class="field">
        <label for="approvalCode">Ma xac thuc 6 so</label>
        <input id="approvalCode" name="approvalCode" inputmode="numeric" maxlength="6" required>
      </div>
      <p class="notice">Ma xac thuc duoc gui rieng cho nguoi duyet tren Telegram.</p>
      <label><input type="checkbox" name="confirmInfo" value="yes" required> Toi xac nhan thong tin rut tien da chinh xac.</label>
      <div class="row"><button id="submitBtn" class="primary" type="submit">Tao lenh rut</button></div>
      <p id="formError" class="error"></p>
    </form>

    <section id="statusPanel" class="panel" style="${initialOrder ? 'display:block;' : 'display:none;'} margin-top:16px;">
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:0;">
        <h2>Trang thai lenh</h2>
        <div id="statusPill" class="status-pill">Dang xu ly</div>
      </div>
      <div id="statusDetails" class="details"></div>
      <div class="row">
        <button id="checkBtn" class="secondary" type="button">Kiem tra trang thai</button>
        <button id="cancelBtn" class="danger" type="button">Huy lenh</button>
      </div>
      <p id="actionError" class="error"></p>
    </section>
  </main>
  <script>
    const token = ${JSON.stringify(token)};
    const withdrawNonce = ${JSON.stringify(session.submitNonce || '')};
    const initialOrder = ${JSON.stringify(initialOrder)};
    const form = document.getElementById('withdrawForm');
    const formError = document.getElementById('formError');
    const statusPanel = document.getElementById('statusPanel');
    const statusPill = document.getElementById('statusPill');
    const statusDetails = document.getElementById('statusDetails');
    const actionError = document.getElementById('actionError');
    const checkBtn = document.getElementById('checkBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const submitBtn = document.getElementById('submitBtn');
    const bankSearch = document.getElementById('bankSearch');
    const bankCode = document.getElementById('bankCode');
    const originalBankOptions = Array.from(bankCode.options).map((option) => ({ value: option.value, text: option.textContent, label: option.dataset.label || option.textContent.toLowerCase() }));
    function formatMoney(value) { const num = Number(value || 0); return Number.isFinite(num) ? num.toLocaleString('vi-VN') : '0'; }
    function setError(node, message) { node.textContent = message || ''; }
    function setButtonLoading(button, loadingText) { const original = button.textContent; button.disabled = true; button.textContent = loadingText; return () => { button.disabled = false; button.textContent = original; }; }
    function getStatusLabel(status) {
      return ({ submitted: 'Da gui', waiting: 'Dang cho xu ly', processing: 'Dang xu ly', waitLink: 'Dang cho xac nhan', pending: 'Cho duyet', nCheck: 'Can kiem tra lai', success: 'Thanh cong', deleted: 'Bi tu choi', cancel: 'Da huy', timeout: 'Qua han', failed: 'That bai' })[status] || status || '-';
    }
    function renderDetail(label, value) { return '<div class="detail"><span>' + label + '</span><strong>' + String(value || '-') + '</strong></div>'; }
    function renderOrder(order) {
      if (!order) return;
      statusPanel.style.display = 'block';
      statusPill.textContent = getStatusLabel(order.status);
      statusPill.className = 'status-pill';
      if (order.status === 'success') statusPill.classList.add('success');
      if (['deleted', 'cancel', 'timeout', 'failed'].includes(order.status)) statusPill.classList.add('danger');
      statusDetails.innerHTML = [renderDetail('Ma lenh', order.requestId), renderDetail('Provider ID', order.providerChargeId), renderDetail('So tien', formatMoney(order.amount)), renderDetail('Ngan hang', order.bankName || order.bankCode), renderDetail('So TK', order.bankAccount), renderDetail('Ten TK', order.bankAccountName)].join('');
      cancelBtn.disabled = !order.canCancel;
    }
    if (initialOrder) renderOrder(initialOrder);
    bankSearch.addEventListener('input', () => {
      const keyword = bankSearch.value.trim().toLowerCase();
      const current = bankCode.value;
      const filtered = originalBankOptions.filter((option, index) => index === 0 || !keyword || option.label.includes(keyword));
      bankCode.innerHTML = filtered.map((option) => '<option value="' + option.value + '">' + option.text + '</option>').join('');
      if (filtered.some((option) => option.value === current)) bankCode.value = current;
    });
    async function callApi(path, payload) {
      const res = await fetch(path + '?token=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Withdraw-Nonce': withdrawNonce }, body: JSON.stringify(payload || {}) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Co loi xay ra');
      return data;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError(formError, '');
      const done = setButtonLoading(submitBtn, 'Dang tao...');
      try {
        const data = await callApi('/withdraw/submit', Object.fromEntries(new FormData(form).entries()));
        form.style.display = 'none';
        renderOrder(data.order);
      } catch (error) { setError(formError, error.message); } finally { done(); }
    });
    checkBtn.addEventListener('click', async () => {
      setError(actionError, '');
      const done = setButtonLoading(checkBtn, 'Dang kiem tra...');
      try {
        const data = await callApi('/withdraw/status');
        renderOrder(data.order);
        if (data.throttled) setError(actionError, 'Vua kiem tra gan day, dang hien thi trang thai da luu.');
      } catch (error) { setError(actionError, error.message); } finally { done(); }
    });
    cancelBtn.addEventListener('click', async () => {
      setError(actionError, '');
      if (!confirm('Ban chac chan muon huy lenh rut nay?')) return;
      const done = setButtonLoading(cancelBtn, 'Dang huy...');
      try {
        const data = await callApi('/withdraw/cancel');
        renderOrder(data.order);
        if (data.message) setError(actionError, data.message);
      } catch (error) { setError(actionError, error.message); } finally { done(); }
    });
  </script>
</body>
</html>`;
}

function serializeOrder(order) {
  if (!order) return null;
  return {
    requestId: order.requestId,
    status: order.status,
    amount: order.amount,
    bankCode: order.bankCode,
    bankName: order.bankName,
    bankAccount: order.bankAccount,
    bankAccountName: order.bankAccountName,
    providerChargeId: order.providerChargeId,
    providerMessage: order.providerMessage,
    canCancel: canCancelWithdrawOrder(order)
  };
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 32) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function validateSubmitPayload(payload) {
  const amount = Number(String(payload.amount || '').replace(/[,. ]/g, ''));
  const bankCode = String(payload.bankCode || '').trim();
  const bankAccount = String(payload.bankAccount || '').trim();
  const bankAccountName = String(payload.bankAccountName || '').trim();
  const message = String(payload.message || '').trim();
  const confirmInfo = String(payload.confirmInfo || '').trim();
  const approvalCode = String(payload.approvalCode || '').trim();

  if (!Number.isInteger(amount) || amount <= 0) throw new Error('So tien khong hop le.');
  if (!bankCode) throw new Error('Vui long chon ngan hang.');
  if (!bankAccount) throw new Error('Vui long nhap so tai khoan.');
  if (!bankAccountName) throw new Error('Vui long nhap ten chu tai khoan.');
  if (confirmInfo !== 'yes') throw new Error('Vui long xac nhan thong tin rut tien da chinh xac.');
  if (!/^\d{6}$/.test(approvalCode)) throw new Error('Vui long nhap ma xac thuc 6 so.');

  return { amount, bankCode, bankAccount, bankAccountName, message, approvalCode };
}

async function handleWithdrawWebRequest(req, res, url) {
  if (!url.pathname.startsWith('/withdraw')) return false;

  const token = url.searchParams.get('token') || '';
  const session = await getUsableWithdrawSession(token);
  if (!session) {
    if (req.method === 'GET') sendHtml(res, 403, '<h1>Link rut tien khong hop le hoac da het han.</h1>');
    else sendJson(res, 403, { ok: false, message: 'Link rut tien khong hop le hoac da het han.' });
    return true;
  }

  try {
    if (req.method === 'POST' && !verifyWithdrawSessionNonce(session, req.headers['x-withdraw-nonce'])) {
      sendJson(res, 403, { ok: false, message: 'Phien form khong hop le. Vui long mo lai link tu bot.' });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/withdraw') {
      await touchWithdrawSession(token);
      const submitNonce = await refreshWithdrawSessionNonce(token);
      const renderSession = { ...session, submitNonce };
      const existingOrder = await getWithdrawOrderBySessionToken(token);
      if (existingOrder) {
        sendHtml(res, 200, renderWithdrawPage({ token, session: renderSession, banks: [], initialOrder: serializeOrder(existingOrder) }));
        return true;
      }

      const bankResponse = await fetchWithdrawBanks();
      if (bankResponse?.stt !== 1) {
        sendHtml(res, 502, `<h1>Khong lay duoc danh sach ngan hang</h1><p>${escapeHtml(bankResponse?.msg || '')}</p>`);
        return true;
      }

      sendHtml(res, 200, renderWithdrawPage({ token, session: renderSession, banks: normalizeBanks(bankResponse) }));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/withdraw/submit') {
      const existingOrder = await getWithdrawOrderBySessionToken(token);
      if (existingOrder) {
        sendJson(res, 200, { ok: true, order: serializeOrder(existingOrder) });
        return true;
      }

      const payload = validateSubmitPayload(await readJsonBody(req));
      const approval = await verifyWithdrawApprovalCode(token, session, payload.approvalCode);
      if (!approval.ok) {
        sendJson(res, 403, { ok: false, message: approval.message });
        return true;
      }

      const bankResponse = await fetchWithdrawBanks();
      const bank = normalizeBanks(bankResponse).find((item) => item.code === payload.bankCode);
      if (!bank) throw new Error('Ngan hang khong hop le.');

      const requestId = createRequestId();
      await createWithdrawOrder({
        requestId,
        chatId: session.chatId,
        userId: session.userId,
        telegramUsername: session.telegramUsername || '',
        memberIdentity: String(session.userId),
        amount: payload.amount,
        bankCode: bank.code,
        bankName: bank.name || bank.code,
        bankAccount: payload.bankAccount,
        bankAccountName: payload.bankAccountName,
        message: payload.message
      });

      const apiResponse = await createWithdrawCharge({
        bankCode: bank.code,
        bankAccount: payload.bankAccount,
        bankAccountName: payload.bankAccountName,
        amount: payload.amount,
        memberIdentity: String(session.userId),
        requestId,
        callbackUrl: env.rechargeCallbackPublicUrl || `${getPublicBaseUrl()}${env.rechargeCallbackPath}`,
        message: payload.message
      });

      const order = await updateWithdrawOrderAfterSubmit(requestId, apiResponse);
      await markWithdrawSessionUsed(token, requestId);

      if (apiResponse?.stt !== 1) {
        sendJson(res, 400, { ok: false, message: apiResponse?.msg || 'Tao lenh rut that bai.', order: serializeOrder(order) });
        return true;
      }

      sendJson(res, 200, { ok: true, order: serializeOrder(order) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/withdraw/status') {
      const order = await getWithdrawOrderBySessionToken(token);
      if (!order) throw new Error('Chua co lenh rut.');
      if (!order.providerChargeId) {
        sendJson(res, 200, { ok: true, order: serializeOrder(order), throttled: false });
        return true;
      }
      if (!(await canCheckWithdrawOrder(order))) {
        sendJson(res, 200, { ok: true, order: serializeOrder(order), throttled: true });
        return true;
      }
      const response = await checkCharge(order.providerChargeId);
      const updatedOrder = await markWithdrawCheckResult(order.requestId, response);
      sendJson(res, 200, { ok: true, order: serializeOrder(updatedOrder), throttled: false });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/withdraw/cancel') {
      const order = await getWithdrawOrderBySessionToken(token);
      if (!order) throw new Error('Chua co lenh rut.');
      if (!canCancelWithdrawOrder(order)) throw new Error('Trang thai hien tai khong the huy.');
      const response = await cancelCharge(order.providerChargeId);
      const updatedOrder = await markWithdrawCancelResult(order.requestId, response);
      sendJson(res, response?.stt === 1 ? 200 : 400, {
        ok: response?.stt === 1,
        message: response?.msg || '',
        order: serializeOrder(updatedOrder)
      });
      return true;
    }

    sendJson(res, 404, { ok: false, message: 'not_found' });
    return true;
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message || 'Co loi xay ra.' });
    return true;
  }
}

module.exports = {
  getWithdrawUrl,
  handleWithdrawWebRequest
};
