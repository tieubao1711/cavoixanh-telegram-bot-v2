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

async function fetchWithdrawBanks() {
  const { data } = await client.get('/api/Bank/getListBankCode', {
    params: {
      apiKey: env.rechargeApiKey
    }
  });
  return data;
}

async function createWithdrawCharge({
  bankCode,
  bankAccount,
  bankAccountName,
  amount,
  memberIdentity,
  requestId,
  callbackUrl,
  message
}) {
  const params = {
    apiKey: env.rechargeApiKey,
    bank_code: bankCode,
    bank_account: bankAccount,
    bank_accountName: bankAccountName,
    amount,
    member_identity: memberIdentity,
    requestId,
    callback: callbackUrl,
    msg: message || '',
    unique_request: requestId
  };

  if (env.rechargeCallbackPasswordLv2) {
    params.signature = md5(`${bankAccount}${amount}${requestId}${env.rechargeCallbackPasswordLv2}`);
  }

  const { data } = await client.get('/api/Bank/ChargeOut', { params });
  return data;
}

async function checkCharge(providerChargeId) {
  const { data } = await client.get('/api/MM/CheckCharge', {
    params: {
      apiKey: env.rechargeApiKey,
      id: providerChargeId
    }
  });
  return data;
}

async function cancelCharge(providerChargeId) {
  const { data } = await client.get('/api/MM/CancelCharge', {
    params: {
      apiKey: env.rechargeApiKey,
      id: providerChargeId
    }
  });
  return data;
}

module.exports = {
  fetchWithdrawBanks,
  createWithdrawCharge,
  checkCharge,
  cancelCharge
};
