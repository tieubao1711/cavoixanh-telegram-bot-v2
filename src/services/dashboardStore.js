const crypto = require('crypto');
const { getCollection } = require('../db/mongo');

const DASHBOARD_SESSION_TTL_MS = 30 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createRevenueDashboardSession({ chatId, userId, telegramUsername }) {
  const collection = await getCollection('revenue_dashboard_sessions');
  const token = createToken();
  const now = new Date();
  const session = {
    tokenHash: hashToken(token),
    chatId,
    userId,
    telegramUsername: telegramUsername || '',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + DASHBOARD_SESSION_TTL_MS)
  };

  await collection.insertOne(session);
  return { token, session };
}

async function getActiveRevenueDashboardSession(token) {
  if (!token) return null;
  const collection = await getCollection('revenue_dashboard_sessions');
  return collection.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() }
  });
}

module.exports = {
  createRevenueDashboardSession,
  getActiveRevenueDashboardSession
};
