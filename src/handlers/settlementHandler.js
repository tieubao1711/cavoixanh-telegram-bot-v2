const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const {
  getUnsettledSuccessfulRechargeOrders,
  createRevenueSettlement,
  markRechargeOrdersSettled,
  getRecentRevenueSettlements
} = require('../services/rechargeStore');
const { escapeHtml, formatNumber, formatDateTime } = require('../utils/formatters');
const { isAllowedUser, extractAxiosError } = require('../utils/botUtils');

async function handleChotDoanhThuCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  await bot.sendMessage(chatId, 'Dang chot doi soat doanh thu...');

  try {
    const orders = await getUnsettledSuccessfulRechargeOrders();
    if (!orders.length) {
      await bot.sendMessage(chatId, 'Khong co lenh nap thanh cong nao chua chot.');
      return;
    }

    const closedAt = new Date();
    const settlementId = createSettlementId();
    const totalAmount = orders.reduce((sum, order) => sum + getOrderAmount(order), 0);
    const orderIds = orders.map((order) => order._id);
    const settlement = {
      settlementId,
      chatId,
      closedAt,
      closedByUserId: userId,
      closedByUsername: msg.from.username || '',
      totalAmount,
      totalOrders: orders.length,
      firstCompletedAt: getOrderCompletedAt(orders[0]),
      lastCompletedAt: getOrderCompletedAt(orders[orders.length - 1]),
      orderIds
    };

    await createRevenueSettlement(settlement);
    const updateResult = await markRechargeOrdersSettled(orderIds, settlementId, closedAt);
    const filePath = await writeSettlementXlsx(settlement, orders);

    try {
      await bot.sendDocument(chatId, filePath, {
        caption: [
          '<b>Da chot doi soat doanh thu</b>',
          `Ma chot: <code>${escapeHtml(settlementId)}</code>`,
          `Doanh thu: <b>${formatNumber(totalAmount)}</b>`,
          `Lenh nap: <b>${formatNumber(updateResult.modifiedCount || orders.length)}</b>`
        ].join('\n'),
        parse_mode: 'HTML'
      });
    } finally {
      fs.unlink(filePath, () => {});
    }
  } catch (error) {
    await bot.sendMessage(chatId, `Loi chot doanh thu: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

async function handleLichSuChotCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowedUser(userId)) {
    await bot.sendMessage(chatId, 'Ban khong co quyen dung bot nay.');
    return;
  }

  try {
    const settlements = await getRecentRevenueSettlements(10);
    await bot.sendMessage(chatId, buildSettlementHistoryMessage(settlements), {
      parse_mode: 'HTML'
    });
  } catch (error) {
    await bot.sendMessage(chatId, `Loi lay lich su chot: ${escapeHtml(extractAxiosError(error))}`, {
      parse_mode: 'HTML'
    });
  }
}

function buildSettlementHistoryMessage(settlements) {
  if (!settlements.length) return 'Chua co lan chot doanh thu nao.';

  const lines = ['<b>Lich su chot doanh thu</b>'];
  settlements.forEach((settlement, index) => {
    lines.push('');
    lines.push(`${index + 1}. <code>${escapeHtml(settlement.settlementId || '-')}</code>`);
    lines.push(`Thoi gian: ${escapeHtml(formatDateTime(settlement.closedAt))}`);
    lines.push(`Doanh thu: <b>${formatNumber(settlement.totalAmount)}</b>`);
    lines.push(`Lenh nap: <b>${formatNumber(settlement.totalOrders)}</b>`);
    lines.push(`Nguoi chot: ${escapeHtml(settlement.closedByUsername || settlement.closedByUserId || '-')}`);
  });

  return lines.join('\n');
}

function createSettlementId() {
  return `settle_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function writeSettlementXlsx(settlement, orders) {
  const summaryRows = [
    ['Ma chot', settlement.settlementId],
    ['Thoi gian chot', formatDateTime(settlement.closedAt)],
    ['Nguoi chot', settlement.closedByUsername || settlement.closedByUserId],
    ['Tong doanh thu', settlement.totalAmount],
    ['Tong lenh nap', settlement.totalOrders],
    ['Lenh dau tien', formatDateTime(settlement.firstCompletedAt)],
    ['Lenh cuoi cung', formatDateTime(settlement.lastCompletedAt)]
  ];

  const detailRows = [
    ['STT', 'Request ID', 'Ma GD', 'So tien', 'Trang thai', 'Ngan hang', 'Thoi gian tao', 'Thoi gian thanh cong', 'Telegram user', 'Chat ID'],
    ...orders.map((order, index) => [
      index + 1,
      order.requestId || '',
      order.chargeCode || order.rechargeData?.code || '',
      getOrderAmount(order),
      order.status || '',
      order.selectedBank?.name || order.selectedBank?.code || order.rechargeData?.bank_provider || '',
      formatDateTime(order.createdAt),
      formatDateTime(getOrderCompletedAt(order)),
      order.telegramUsername || order.userId || '',
      order.chatId || ''
    ])
  ];

  const filePath = path.join(os.tmpdir(), `${settlement.settlementId}.xlsx`);
  await writeMinimalXlsx(filePath, [
    { name: 'Tong quan', rows: summaryRows },
    { name: 'Chi tiet', rows: detailRows }
  ]);
  return filePath;
}

async function writeMinimalXlsx(filePath, sheets) {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', buildContentTypes(sheets.length));
  zip.folder('_rels').file('.rels', buildRootRels());
  zip.folder('xl').file('workbook.xml', buildWorkbookXml(sheets));
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', buildWorkbookRels(sheets.length));
  zip.folder('xl').folder('worksheets');

  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, buildSheetXml(sheet.rows));
  });

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.promises.writeFile(filePath, buffer);
}

function buildContentTypes(sheetCount) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
</Types>`;
}

function buildRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbookXml(sheets) {
  const sheetEntries = sheets.map((sheet, index) => (
    `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries}</sheets>
</workbook>`;
}

function buildWorkbookRels(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function buildSheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => buildCellXml(value, colIndex, rowIndex)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function buildCellXml(value, colIndex, rowIndex) {
  const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value ?? '')}</t></is></c>`;
}

function columnName(index) {
  let name = '';
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getOrderAmount(order) {
  const amount = Number(order.chargeAmount ?? order.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getOrderCompletedAt(order) {
  return order.completedAt || order.updatedAt || order.createdAt || null;
}

module.exports = {
  handleChotDoanhThuCommand,
  handleLichSuChotCommand,
  buildSettlementHistoryMessage,
  writeSettlementXlsx
};
