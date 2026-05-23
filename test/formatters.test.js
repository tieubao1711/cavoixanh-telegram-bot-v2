const assert = require('assert');
const { escapeHtml, formatNumber } = require('../src/utils/formatters');
const { commandRegex } = require('../src/utils/botUtils');

assert.strictEqual(escapeHtml('<b>"x"&\'y\''), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
assert.strictEqual(formatNumber(50000), '50.000');
assert.ok(commandRegex('naptien').test('/naptien 50000'));
assert.ok(commandRegex('naptien').test('/naptien@BotUsername 50000'));
assert.ok(commandRegex('ruttien').test('/ruttien@BotUsername'));
assert.ok(commandRegex('danhsachrut').test('/danhsachrut@BotUsername mine'));
assert.ok(commandRegex('thongke').test('/thongke@BotUsername week'));
assert.ok(commandRegex('chotdoanhthu', false).test('/chotdoanhthu@BotUsername'));
assert.ok(commandRegex('lichsuchot', false).test('/lichsuchot@BotUsername'));

console.log('formatters tests passed');
