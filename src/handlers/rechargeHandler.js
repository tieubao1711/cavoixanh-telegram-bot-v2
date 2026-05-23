const crypto = require('crypto');
const env = require('../config/env');
const { fetchAvailableBanks, createBankRecharge } = require('../services/rechargeApiClient');
const { createRechargeOrder, getRechargeOrder, markBankSelected } = require('../services/rechargeStore');
const { getCallbackUrl } = require('../services/callbackServer');
const { escapeHtml, formatNumber } = require('../utils/formatters');
const { isAllowedUser, extractAxiosError } = require('../utils/botUtils');

const RECHARGE_BANK_PREFIX = 'recharge_bank:';

function createRequestId() {
  return `dep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeBanks(apiResponse) {
  return apiResponse?.data || [];
}

function buildBankKeyboard(requestId, banks) {
  return {
    inline_keyboard: banks.map((bank) => [
      {
        text: bank.name || bank.code,
        callback_data: `${RECHARGE_BANK_PREFIX}${requestId}:${bank.code}`
      }
    ])
  };
}

function buildRechargeInfoMessage(order) {
  const data = order.rechargeData || {};
  return [
    '<b>Thong tin chuyen khoan</b>',
    `Ngan hang: <b>${escapeHtml(data.bank_provider || order.selectedBank?.name || order.selectedBank?.code || '-')}</b>`,
    `So TK: <code>${escapeHtml(data.phoneNum || '-')}</code>`,
    `Nguoi nhan: <b>${escapeHtml(data.phoneName || '-')}</b>`,
    `So tien: <b>${formatNumber(data.amount || order.amount)}</b>`,
    `Noi dung: <code>${escapeHtml(data.code || order.requestId)}</code>`,
    '',
    'Vui long chuyen dung so tien va noi dung. Bot se thong bao khi callback thanh cong.'
  ].join('\n');
}

async function handleNapTienCommand(bot, msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  if (!env.rechargeApiKey) {
    await bot.sendMessage(chatId, 'Chua cau hinh RECHARGE_API_KEY.');
    return;
  }

  const amount = Number((match?.[1] || '').trim());
  if (!Number.isInteger(amount) || amount <= 0) {
    await bot.sendMessage(chatId, 'Cach dung: /naptien 50000');
    return;
  }

  await bot.sendMessage(chatId, 'Dang lay danh sach ngan hang...');

  try {
    const bankResponse = await fetchAvailableBanks();
    if (bankResponse?.stt !== 1) {
      await bot.sendMessage(chatId, `Khong lay duoc danh sach bank: ${escapeHtml(bankResponse?.msg || 'unknown')}`, {
        parse_mode: 'HTML'
      });
      return;
    }

    const banks = normalizeBanks(bankResponse);
    if (!banks.length) {
      await bot.sendMessage(chatId, 'Hien khong co ngan hang kha dung.');
      return;
    }

    const requestId = createRequestId();
    await createRechargeOrder({
      requestId,
      chatId,
      userId,
      telegramUsername: msg.from.username || '',
      memberIdentity: String(userId),
      amount,
      bankOptions: banks
    });

    await bot.sendMessage(chatId, `Chon ngan hang de nap <b>${formatNumber(amount)}</b>:`, {
      parse_mode: 'HTML',
      reply_markup: buildBankKeyboard(requestId, banks)
    });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi tao lenh nap: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

async function handleRechargeCallbackQuery(bot, query) {
  if (!query.data?.startsWith(RECHARGE_BANK_PREFIX)) return false;

  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const [, requestId, bankCode] = query.data.split(':');

  const order = await getRechargeOrder(requestId);
  if (!order || order.chatId !== chatId || order.userId !== userId) {
    await bot.answerCallbackQuery(query.id, { text: 'Lenh nap khong hop le hoac da het han.' });
    return true;
  }

  const bank = (order.bankOptions || []).find((item) => item.code === bankCode);
  if (!bank) {
    await bot.answerCallbackQuery(query.id, { text: 'Bank khong hop le.' });
    return true;
  }

  await bot.answerCallbackQuery(query.id, { text: 'Dang tao thong tin chuyen khoan...' });

  try {
    const response = await createBankRecharge({
      amount: order.amount,
      memberIdentity: order.memberIdentity,
      requestId: order.requestId,
      bankCode: bank.code,
      callbackUrl: getCallbackUrl()
    });

    if (response?.stt !== 1) {
      await bot.sendMessage(chatId, `Tao lenh nap that bai: ${escapeHtml(response?.msg || 'unknown')}`, {
        parse_mode: 'HTML'
      });
      return true;
    }

    const updatedOrder = await markBankSelected(order.requestId, bank, response);
    const message = buildRechargeInfoMessage(updatedOrder);
    const qrUrl = updatedOrder.rechargeData?.qr_url;

    if (qrUrl) {
      await bot.sendPhoto(chatId, qrUrl, { caption: message, parse_mode: 'HTML' });
      return true;
    }

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi tao QR nap tien: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }

  return true;
}

module.exports = {
  handleNapTienCommand,
  handleRechargeCallbackQuery,
  buildRechargeInfoMessage
};
