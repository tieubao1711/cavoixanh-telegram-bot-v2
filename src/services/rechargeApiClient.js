const crypto = require('crypto');
const axios = require('axios');
const env = require('../config/env');

const client = axios.create({
  baseURL: env.rechargeApiBaseUrl,
  timeout: env.requestTimeoutMs
});

function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex');
}

async function fetchAvailableBanks() {
  const { data } = await client.get('/api/Bank/getBankAvailable', {
    params: {
      apiKey: env.rechargeApiKey
    }
  });
  return data;
}

async function createBankRecharge({ amount, memberIdentity, requestId, bankCode, callbackUrl }) {
  const params = {
    apiKey: env.rechargeApiKey,
    chargeType: 'bank',
    amount,
    member_identity: memberIdentity,
    requestId,
    subType: bankCode,
    callback: callbackUrl,
    unique_request: requestId
  };

  if (env.rechargeSignKey) {
    params.sign = md5(`${amount}${params.chargeType}${requestId}${env.rechargeSignKey}`);
  }

  const { data } = await client.get('/api/v2/RegCharge', { params });
  return data;
}

function verifyRechargeCallbackSignature(query) {
  if (!env.rechargeCallbackPasswordLv2) return true;

  const expected = md5(
    `${query.chargeId || ''}${query.chargeType || ''}${query.chargeCode || ''}${query.chargeAmount || ''}${query.status || ''}${query.requestId || ''}${env.rechargeCallbackPasswordLv2}`
  );

  return String(query.signature || '').toLowerCase() === expected.toLowerCase();
}

module.exports = {
  fetchAvailableBanks,
  createBankRecharge,
  verifyRechargeCallbackSignature
};
