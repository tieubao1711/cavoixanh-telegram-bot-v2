const assert = require('assert');
const { escapeHtml, formatNumber } = require('../src/utils/formatters');
const { commandRegex } = require('../src/utils/botUtils');
const { parseRechargeBankCallbackData } = require('../src/handlers/rechargeHandler');

assert.strictEqual(escapeHtml('<b>"x"&\'y\''), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
assert.strictEqual(formatNumber(50000), '50.000');
assert.ok(commandRegex('naptien').test('/naptien 50000'));
assert.ok(commandRegex('naptien').test('/naptien@BotUsername 50000'));
assert.ok(commandRegex('ruttien').test('/ruttien@BotUsername'));
assert.ok(commandRegex('danhsachrut').test('/danhsachrut@BotUsername mine'));
assert.ok(commandRegex('thongke').test('/thongke@BotUsername week'));
assert.ok(commandRegex('chotdoanhthu', false).test('/chotdoanhthu@BotUsername'));
assert.ok(commandRegex('lichsuchot', false).test('/lichsuchot@BotUsername'));
assert.deepStrictEqual(parseRechargeBankCallbackData('rb:dep_123:2'), {
  requestId: 'dep_123',
  bankIndex: 2,
  bankCode: null
});
assert.deepStrictEqual(parseRechargeBankCallbackData('recharge_bank:dep_123:VCB'), {
  requestId: 'dep_123',
  bankIndex: null,
  bankCode: 'VCB'
});

console.log('formatters tests passed');
