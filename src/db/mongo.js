const { MongoClient } = require('mongodb');
const env = require('../config/env');

let client;
let db;

async function connectMongo() {
  if (db) return db;

  client = new MongoClient(env.mongodbUri);
  await client.connect();
  db = client.db(env.mongodbDbName);

  await db.collection('recharge_orders').createIndex({ requestId: 1 }, { unique: true });
  await db.collection('recharge_orders').createIndex({ chatId: 1, userId: 1, createdAt: -1 });
  await db.collection('recharge_orders').createIndex({ status: 1, createdAt: -1 });
  await db.collection('recharge_orders').createIndex({ status: 1, completedAt: -1 });
  await db.collection('recharge_orders').createIndex({ status: 1, settlementId: 1, completedAt: -1 });
  await db.collection('revenue_settlements').createIndex({ settlementId: 1 }, { unique: true });
  await db.collection('revenue_settlements').createIndex({ closedAt: -1 });
  await db.collection('withdraw_sessions').createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection('withdraw_sessions').createIndex({ expiresAt: 1 });
  await db.collection('withdraw_orders').createIndex({ requestId: 1 }, { unique: true });
  await db.collection('withdraw_orders').createIndex({ providerChargeId: 1 });
  await db.collection('withdraw_orders').createIndex({ chatId: 1, userId: 1, createdAt: -1 });
  await db.collection('withdraw_orders').createIndex({ status: 1, createdAt: -1 });

  return db;
}

async function getCollection(name) {
  const database = await connectMongo();
  return database.collection(name);
}

async function closeMongo() {
  if (!client) return;
  await client.close();
  client = undefined;
  db = undefined;
}

module.exports = {
  connectMongo,
  getCollection,
  closeMongo
};
