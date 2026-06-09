const crypto = require('crypto');
const { getCollection } = require('../db/mongo');

const SESSION_TTL_MS = 15 * 60 * 1000;
const USED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CHECK_THROTTLE_MS = 15 * 1000;
const ACTIVE_CANCEL_STATUSES = new Set(['waiting', 'processing', 'waitLink', 'pending', 'nCheck', 'submitted']);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSessionNonce() {
  return crypto.randomBytes(24).toString('hex');
}

function createApprovalCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashApprovalCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function createWithdrawSession({ chatId, userId, telegramUsername, amount }) {
  const collection = await getCollection('withdraw_sessions');
  const token = createToken();
  const approvalCode = createApprovalCode();
  const now = new Date();
  const session = {
    tokenHash: hashToken(token),
    chatId,
    userId,
    telegramUsername,
    amount: amount || null,
    submitNonce: createSessionNonce(),
    approvalCodeHash: hashApprovalCode(approvalCode),
    approvalAttempts: 0,
    approvalVerifiedAt: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS)
  };

  await collection.insertOne(session);
  return { token, approvalCode, session };
}

async function getUsableWithdrawSession(token) {
  if (!token) return null;
  const collection = await getCollection('withdraw_sessions');
  return collection.findOne({
    tokenHash: hashToken(token),
    status: { $in: ['active', 'used'] },
    expiresAt: { $gt: new Date() }
  });
}

async function touchWithdrawSession(token) {
  const collection = await getCollection('withdraw_sessions');
  await collection.updateOne({ tokenHash: hashToken(token) }, { $set: { updatedAt: new Date() } });
}

async function refreshWithdrawSessionNonce(token) {
  const collection = await getCollection('withdraw_sessions');
  const submitNonce = createSessionNonce();
  await collection.updateOne(
    {
      tokenHash: hashToken(token),
      status: { $in: ['active', 'used'] },
      expiresAt: { $gt: new Date() }
    },
    {
      $set: {
        submitNonce,
        updatedAt: new Date()
      }
    }
  );
  return submitNonce;
}

function verifyWithdrawSessionNonce(session, nonce) {
  if (!session?.submitNonce || !nonce) return false;
  const expected = Buffer.from(String(session.submitNonce));
  const actual = Buffer.from(String(nonce));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function verifyWithdrawApprovalCode(token, session, code) {
  const collection = await getCollection('withdraw_sessions');

  if (!session?.approvalCodeHash) {
    return { ok: false, message: 'Phien rut tien chua co ma xac thuc.' };
  }

  if ((session.approvalAttempts || 0) >= 5) {
    await collection.updateOne(
      { tokenHash: hashToken(token) },
      { $set: { status: 'locked', updatedAt: new Date() } }
    );
    return { ok: false, message: 'Link da bi khoa do nhap sai ma qua nhieu lan.' };
  }

  const inputHash = hashApprovalCode(code);
  const expected = Buffer.from(String(session.approvalCodeHash));
  const actual = Buffer.from(String(inputHash));
  const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matched) {
    const attempts = (session.approvalAttempts || 0) + 1;
    const update = {
      approvalAttempts: attempts,
      updatedAt: new Date()
    };
    if (attempts >= 5) update.status = 'locked';

    await collection.updateOne({ tokenHash: hashToken(token) }, { $set: update });
    return {
      ok: false,
      message: attempts >= 5
        ? 'Link da bi khoa do nhap sai ma qua nhieu lan.'
        : `Ma xac thuc khong dung. Con ${5 - attempts} lan thu.`
    };
  }

  await collection.updateOne(
    { tokenHash: hashToken(token) },
    { $set: { approvalVerifiedAt: new Date(), updatedAt: new Date() } }
  );

  return { ok: true };
}

async function markWithdrawSessionUsed(token, requestId) {
  const collection = await getCollection('withdraw_sessions');
  await collection.updateOne(
    { tokenHash: hashToken(token) },
    {
      $set: {
        status: 'used',
        requestId,
        usedAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + USED_SESSION_TTL_MS)
      }
    }
  );
}

async function createWithdrawOrder(order) {
  const collection = await getCollection('withdraw_orders');
  const now = new Date();
  const doc = {
    ...order,
    status: 'submitted',
    callbackNotified: false,
    createdAt: now,
    updatedAt: now,
    submittedAt: now
  };
  await collection.insertOne(doc);
  return doc;
}

async function updateWithdrawOrderAfterSubmit(requestId, apiResponse) {
  const collection = await getCollection('withdraw_orders');
  const data = apiResponse?.data || {};
  const status = data.status || (apiResponse?.stt === 1 ? 'waiting' : 'failed');

  await collection.updateOne(
    { requestId },
    {
      $set: {
        status,
        exStt: apiResponse?.ex_stt,
        providerMessage: apiResponse?.msg || '',
        providerChargeId: data.id ? Number(data.id) : null,
        chargeOutResponse: apiResponse,
        updatedAt: new Date()
      }
    }
  );

  return collection.findOne({ requestId });
}

async function getWithdrawOrderByRequestId(requestId) {
  const collection = await getCollection('withdraw_orders');
  return collection.findOne({ requestId });
}

async function getWithdrawOrderBySessionToken(token) {
  const session = await getUsableWithdrawSession(token);
  if (!session?.requestId) return null;
  return getWithdrawOrderByRequestId(session.requestId);
}

async function markWithdrawCallback(requestId, callbackPayload) {
  const collection = await getCollection('withdraw_orders');
  const before = await collection.findOne({ requestId });
  if (!before) return null;

  const callbackStatus = callbackPayload.status || 'unknown';
  const now = new Date();

  await collection.updateOne(
    { requestId },
    {
      $set: {
        status: callbackStatus,
        callbackPayload,
        chargeId: callbackPayload.chargeId ? Number(callbackPayload.chargeId) : before.chargeId,
        chargeCode: callbackPayload.chargeCode || before.chargeCode,
        chargeAmount: callbackPayload.chargeAmount ? Number(callbackPayload.chargeAmount) : before.chargeAmount,
        updatedAt: now,
        completedAt: ['success', 'deleted', 'cancel', 'timeout'].includes(callbackStatus) ? now : before.completedAt
      }
    }
  );

  const after = await collection.findOne({ requestId });
  return { before, after };
}

async function markWithdrawCheckResult(requestId, checkResponse) {
  const collection = await getCollection('withdraw_orders');
  const data = checkResponse?.data || {};
  const update = {
    checkResponse,
    lastCheckedAt: new Date(),
    providerMessage: checkResponse?.msg || '',
    updatedAt: new Date()
  };

  if (data.status) update.status = data.status;
  if (data.id) update.providerChargeId = Number(data.id);
  if (data.amount) update.amount = Number(data.amount);
  if (data.finish_amount) update.finishAmount = Number(data.finish_amount);
  if (data.finish_time) update.finishTime = data.finish_time;

  await collection.updateOne({ requestId }, { $set: update });
  return collection.findOne({ requestId });
}

async function markWithdrawCancelResult(requestId, cancelResponse) {
  const collection = await getCollection('withdraw_orders');
  const now = new Date();
  const update = {
    cancelResponse,
    providerMessage: cancelResponse?.msg || '',
    updatedAt: now
  };

  if (cancelResponse?.stt === 1) {
    update.status = 'cancel';
    update.cancelledAt = now;
    update.completedAt = now;
  }

  await collection.updateOne({ requestId }, { $set: update });
  return collection.findOne({ requestId });
}

async function canCheckWithdrawOrder(order) {
  if (!order?.lastCheckedAt) return true;
  return Date.now() - new Date(order.lastCheckedAt).getTime() >= CHECK_THROTTLE_MS;
}

function canCancelWithdrawOrder(order) {
  return Boolean(order?.providerChargeId && ACTIVE_CANCEL_STATUSES.has(order.status));
}

async function markWithdrawCallbackNotified(requestId) {
  const collection = await getCollection('withdraw_orders');
  await collection.updateOne(
    { requestId },
    { $set: { callbackNotified: true, notifiedAt: new Date() } }
  );
}

async function listWithdrawOrders({ limit = 10, userId } = {}) {
  const collection = await getCollection('withdraw_orders');
  const query = {};
  if (userId) query.userId = userId;

  return collection
    .find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 10, 1), 30))
    .toArray();
}

function withdrawRangeMatch(startAt, endAt) {
  return {
    $or: [
      { completedAt: { $gte: startAt, $lt: endAt } },
      {
        completedAt: { $exists: false },
        updatedAt: { $gte: startAt, $lt: endAt }
      },
      {
        completedAt: null,
        updatedAt: { $gte: startAt, $lt: endAt }
      }
    ]
  };
}

async function getWithdrawStatsByRange(startAt, endAt) {
  const collection = await getCollection('withdraw_orders');
  const [summary] = await collection.aggregate([
    {
      $match: {
        status: 'success',
        ...withdrawRangeMatch(startAt, endAt)
      }
    },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: { $ifNull: ['$chargeAmount', '$amount'] } },
        totalOrders: { $sum: 1 }
      }
    }
  ]).toArray();

  const [pending] = await collection.aggregate([
    {
      $match: {
        status: { $in: Array.from(ACTIVE_CANCEL_STATUSES) },
        createdAt: { $gte: startAt, $lt: endAt }
      }
    },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        totalOrders: { $sum: 1 }
      }
    }
  ]).toArray();

  return {
    totalAmount: summary?.totalAmount || 0,
    totalOrders: summary?.totalOrders || 0,
    pendingAmount: pending?.totalAmount || 0,
    pendingOrders: pending?.totalOrders || 0
  };
}

async function getWithdrawOrdersByRange(startAt, endAt, limit = 500) {
  const collection = await getCollection('withdraw_orders');
  return collection
    .find(withdrawRangeMatch(startAt, endAt))
    .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 500, 1), 2000))
    .toArray();
}

module.exports = {
  createWithdrawSession,
  getUsableWithdrawSession,
  touchWithdrawSession,
  refreshWithdrawSessionNonce,
  verifyWithdrawSessionNonce,
  verifyWithdrawApprovalCode,
  markWithdrawSessionUsed,
  createWithdrawOrder,
  updateWithdrawOrderAfterSubmit,
  getWithdrawOrderByRequestId,
  getWithdrawOrderBySessionToken,
  markWithdrawCallback,
  markWithdrawCheckResult,
  markWithdrawCancelResult,
  canCheckWithdrawOrder,
  canCancelWithdrawOrder,
  markWithdrawCallbackNotified,
  listWithdrawOrders,
  getWithdrawStatsByRange,
  getWithdrawOrdersByRange
};
