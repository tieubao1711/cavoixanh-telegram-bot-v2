const { getCollection } = require('../db/mongo');

async function createRechargeOrder(order) {
  const collection = await getCollection('recharge_orders');
  const now = new Date();
  const doc = {
    ...order,
    status: 'pending_bank',
    callbackNotified: false,
    createdAt: now,
    updatedAt: now
  };

  await collection.insertOne(doc);
  return doc;
}

async function getRechargeOrder(requestId) {
  const collection = await getCollection('recharge_orders');
  return collection.findOne({ requestId });
}

async function markBankSelected(requestId, bank, apiResponse) {
  const collection = await getCollection('recharge_orders');
  await collection.updateOne(
    { requestId },
    {
      $set: {
        status: 'waiting_payment',
        selectedBank: bank,
        rechargeResponse: apiResponse,
        rechargeData: apiResponse?.data || null,
        updatedAt: new Date()
      }
    }
  );

  return collection.findOne({ requestId });
}

async function markRechargeCallback(requestId, callbackPayload) {
  const collection = await getCollection('recharge_orders');
  const before = await collection.findOne({ requestId });
  if (!before) return null;

  const callbackStatus = callbackPayload.status || 'unknown';
  const now = new Date();

  await collection.updateOne(
    { requestId },
    {
      $set: {
        status: callbackStatus === 'success' ? 'success' : callbackStatus,
        callbackPayload,
        chargeId: callbackPayload.chargeId ? Number(callbackPayload.chargeId) : before.chargeId,
        chargeCode: callbackPayload.chargeCode || before.chargeCode,
        chargeAmount: callbackPayload.chargeAmount ? Number(callbackPayload.chargeAmount) : before.chargeAmount,
        updatedAt: now,
        completedAt: callbackStatus === 'success' ? now : before.completedAt
      }
    }
  );

  const after = await collection.findOne({ requestId });
  return { before, after };
}

async function markCallbackNotified(requestId) {
  const collection = await getCollection('recharge_orders');
  await collection.updateOne(
    { requestId },
    {
      $set: {
        callbackNotified: true,
        notifiedAt: new Date()
      }
    }
  );
}

function successRangeMatch(startAt, endAt) {
  return {
    status: 'success',
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

async function getRechargeStats(startAt, endAt) {
  const collection = await getCollection('recharge_orders');
  const match = successRangeMatch(startAt, endAt);
  const [summary] = await collection.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: { $ifNull: ['$chargeAmount', '$amount'] } },
        totalOrders: { $sum: 1 },
        firstCompletedAt: { $min: { $ifNull: ['$completedAt', '$updatedAt'] } },
        lastCompletedAt: { $max: { $ifNull: ['$completedAt', '$updatedAt'] } }
      }
    }
  ]).toArray();

  const byDay = await collection.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: { $ifNull: ['$completedAt', '$updatedAt'] },
            timezone: 'Asia/Ho_Chi_Minh'
          }
        },
        totalAmount: { $sum: { $ifNull: ['$chargeAmount', '$amount'] } },
        totalOrders: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  return {
    totalAmount: summary?.totalAmount || 0,
    totalOrders: summary?.totalOrders || 0,
    firstCompletedAt: summary?.firstCompletedAt || null,
    lastCompletedAt: summary?.lastCompletedAt || null,
    byDay: byDay.map((item) => ({
      date: item._id,
      totalAmount: item.totalAmount || 0,
      totalOrders: item.totalOrders || 0
    }))
  };
}

async function getUnsettledSuccessfulRechargeOrders() {
  const collection = await getCollection('recharge_orders');
  return collection
    .find({
      status: 'success',
      settlementId: { $exists: false }
    })
    .sort({ completedAt: 1, updatedAt: 1, createdAt: 1 })
    .toArray();
}

async function getUnsettledRevenueSummary() {
  const collection = await getCollection('recharge_orders');
  const [summary] = await collection.aggregate([
    {
      $match: {
        status: 'success',
        settlementId: { $exists: false }
      }
    },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: { $ifNull: ['$chargeAmount', '$amount'] } },
        totalOrders: { $sum: 1 },
        firstCompletedAt: { $min: { $ifNull: ['$completedAt', '$updatedAt'] } },
        lastCompletedAt: { $max: { $ifNull: ['$completedAt', '$updatedAt'] } }
      }
    }
  ]).toArray();

  return {
    totalAmount: summary?.totalAmount || 0,
    totalOrders: summary?.totalOrders || 0,
    firstCompletedAt: summary?.firstCompletedAt || null,
    lastCompletedAt: summary?.lastCompletedAt || null
  };
}

async function getRecentSuccessfulRechargeOrders(limit = 20) {
  const collection = await getCollection('recharge_orders');
  return collection
    .find({ status: 'success' })
    .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
    .toArray();
}

async function getSuccessfulRechargeOrdersByRange(startAt, endAt, limit = 500) {
  const collection = await getCollection('recharge_orders');
  return collection
    .find(successRangeMatch(startAt, endAt))
    .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 500, 1), 2000))
    .toArray();
}

async function createRevenueSettlement(settlement) {
  const collection = await getCollection('revenue_settlements');
  await collection.insertOne(settlement);
  return settlement;
}

async function markRechargeOrdersSettled(orderIds, settlementId, closedAt) {
  if (!orderIds.length) return { modifiedCount: 0 };

  const collection = await getCollection('recharge_orders');
  return collection.updateMany(
    {
      _id: { $in: orderIds },
      status: 'success',
      settlementId: { $exists: false }
    },
    {
      $set: {
        settlementId,
        settledAt: closedAt
      }
    }
  );
}

async function getRecentRevenueSettlements(limit = 10) {
  const collection = await getCollection('revenue_settlements');
  return collection
    .find({})
    .sort({ closedAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 10, 1), 30))
    .toArray();
}

module.exports = {
  createRechargeOrder,
  getRechargeOrder,
  markBankSelected,
  markRechargeCallback,
  markCallbackNotified,
  getRechargeStats,
  getUnsettledSuccessfulRechargeOrders,
  getUnsettledRevenueSummary,
  getRecentSuccessfulRechargeOrders,
  getSuccessfulRechargeOrdersByRange,
  createRevenueSettlement,
  markRechargeOrdersSettled,
  getRecentRevenueSettlements
};
